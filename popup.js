'use strict';

/* DESTINATIONS and CATEGORIES come from data.js. */
const $ = id => document.getElementById(id);
const load = keys => new Promise(r => chrome.storage.local.get(keys, r));
const save = obj => new Promise(r => chrome.storage.local.set(obj, r));

function fill(sel, items, value) {
  sel.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = typeof it === 'string' ? it : it.id;
    o.textContent = typeof it === 'string' ? it : it.name;
    if (it.unsupported) o.className = 'unsupported';
    sel.appendChild(o);
  }
  if (value && [...sel.options].some(o => o.value === value)) sel.value = value;
}

function destById(id) { return DESTINATIONS.find(d => d.id === id) || DESTINATIONS[0]; }

function renderDestination(settings) {
  const d = destById($('destination').value);
  $('providerLine').textContent = `Provider: ${d.provider}`;
  fill($('centre'), d.centres.length ? d.centres : ['—'], settings.centre);
  $('portalLink').href = d.portal || '#';
  $('portalLink').classList.toggle('hidden', !d.portal);
  $('franceNote').classList.toggle('hidden', d.id !== 'france');
  $('destination').classList.toggle('unsupported', !!d.unsupported);
  $('start').disabled = d.id === 'france';
}

function fmt(ts) { return ts ? new Date(ts).toLocaleTimeString() : '—'; }

async function activeTab() {
  const m = location.hash.match(/tab=(\d+)/);           // test harness: popup opened for a given tab
  if (m) { try { return await chrome.tabs.get(+m[1]); } catch (e) { /* fall through */ } }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isPortalUrl(url) {
  return /^https:\/\/[^/]*(blsspainmorocco\.(com|net)|blsportugal\.com|blsinternational\.com|vfsglobal\.(com|ma)|vfsvisaonline\.com)\//.test(url || '');
}

async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) { return null; }
}

/** Tabs opened before the extension was installed have no content script yet: attach it. */
async function ensureContent(tabId) {
  if (await sendToTab(tabId, { type: 'ping' })) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['detect.js', 'content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    return true;
  } catch (e) {
    $('hint').textContent = 'Could not attach to this tab. Reload the page and try again.';
    return false;
  }
}

function collectSettings(prev) {
  const d = destById($('destination').value);
  return Object.assign({}, prev, {
    destinationId: d.id, destination: d.name.split(' ·')[0], centre: $('centre').value, category: $('category').value,
    interval: Number($('interval').value), autoRefresh: $('autoRefresh').checked, sound: $('sound').checked,
    pauseOnHit: $('pauseOnHit').checked, remind: $('remind').checked, repeatMinutes: Math.max(1, Number($('repeatMinutes').value) || 10),
    autoStart: $('autoStart').checked,
  });
}

/** Which of destination / centre / category came from the portal page, and whether we still follow it. */
function renderAuto(settings, ctx) {
  const auto = settings.auto !== false;
  $('autoLine').dataset.auto = auto ? 'on' : 'off';
  const found = ctx ? [ctx.destination, ctx.centre, ctx.category && ctx.category.split(' ·')[0]].filter(Boolean) : [];
  $('autoText').textContent = auto
    ? (found.length ? `From the portal page: ${found.join(' · ')}` : 'Will be read from the portal page when the calendar is open')
    : 'Set by hand';
  $('autoBtn').textContent = auto ? 'set by hand' : '↺ read from the page';
  if (auto && settings.autoStarted && settings.watching) $('autoText').textContent += ' · started by itself';
}

/** Which dashboard application the watcher files slots and bookings under. */
function renderApps(applications, settings) {
  const sel = $('activeApp');
  if (document.activeElement === sel) return;
  const opts = [['', applications.length ? 'Auto (match destination)' : 'None yet – add one in the dashboard']];
  for (const a of applications) {
    const ap = a.applicant || {};
    const name = a.applicantLocked ? '🔒 locked' : [ap.givenName, ap.surname].filter(Boolean).join(' ') || 'Unnamed applicant';
    opts.push([a.id, `#${a.num} ${name} · ${destById(a.destinationId).name.split(' ·')[0]}${a.status === 'booked' ? ' ✓' : ''}`]);
  }
  const key = JSON.stringify(opts) + (settings.activeAppId || '');
  if (sel.dataset.key === key) return;
  sel.dataset.key = key;
  sel.replaceChildren(...opts.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
  sel.value = applications.some(a => a.id === settings.activeAppId) ? settings.activeAppId : '';
}

async function renderStatus() {
  const { settings = {}, status = {}, lastHit, nextAt, pageContext, applications = [], readiness } = await load(['settings', 'status', 'lastHit', 'nextAt', 'pageContext', 'applications', 'readiness']);
  const watching = !!settings.watching;
  renderRelease(settings, { readiness, pageContext: pageContext && Object.assign({ hasApplicant: applications.length > 0 }, pageContext), status });
  renderAuto(settings, pageContext);
  renderApps(applications, settings);
  $('start').classList.toggle('hidden', watching);
  $('stop').classList.toggle('hidden', !watching);
  const st = watching ? (status.state || 'watching') : status.state === 'booked' ? 'booked' : 'idle';
  $('statusPill').dataset.state = st;
  $('statusPill').textContent = { idle: 'Idle', watching: 'Watching', none: 'No slots', unknown: 'Watching', available: 'SLOT!', captcha: 'Needs you', login: 'Logged out', stopped: 'Stopped', booked: 'Booked ✓' }[st] || st;
  $('statusText').textContent = watching
    ? ({ none: 'No slots yet', unknown: 'Watching (page not recognised yet)', available: 'Slot visible – book now!', captcha: 'Solve the verification', login: 'Session ended' }[status.state] || 'Watching…')
    : (status.state === 'booked' ? 'Appointment booked' : status.state === 'captcha' ? 'Paused: solve the verification, I resume after' : status.state === 'login' ? 'Paused: log in and open the calendar' : settings.autoStart === false ? 'Not watching' : 'Waiting for a calendar in a portal tab');
  const booked = applications.filter(a => a.status === 'booked' && a.appointment).sort((x, y) => (y.appointment.at || 0) - (x.appointment.at || 0))[0];
  $('booked').classList.toggle('hidden', !booked);
  if (booked) {
    const ap = booked.appointment;
    const who = booked.applicantLocked ? '' : [booked.applicant && booked.applicant.givenName, booked.applicant && booked.applicant.surname].filter(Boolean).join(' ');
    $('bookedText').textContent = [who, destById(booked.destinationId).name.split(' ·')[0], ap.centre, ap.date, ap.time, ap.reference && `ref ${ap.reference}`].filter(Boolean).join(' · ');
  }
  $('lastCheck').textContent = watching ? fmt(status.at) : '—';
  const left = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
  $('nextCheck').textContent = watching && settings.autoRefresh && left != null ? `${left}s` : '—';
  if (lastHit) {
    $('hit').classList.remove('hidden');
    $('hitText').textContent = `${new Date(lastHit.at).toLocaleString()} · ${lastHit.where}` + (lastHit.dates && lastHit.dates.length ? ` · ${lastHit.dates.slice(0, 4).join(', ')}` : '');
  }
  $('selectorText').textContent = settings.selector ? `Watching area: ${settings.selector}` : 'Watching: whole page (pick the calendar for better accuracy)';
}

function renderRelease(settings, ctx) {
  const card = $('releaseCard');
  const R = window.RDVRelease;
  const dest = settings.destinationId, centre = settings.centre;
  const list = R.upcoming(dest, centre, new Date(), 3);
  if (!list.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const now = Date.now();
  const nxt = list.find(x => x.at);
  const cd = $('relCountdown');
  if (nxt) {
    const ms = nxt.at.getTime() - now;
    $('relWhen').textContent = `${centre} · ${nxt.dayName} ${nxt.time}`;
    cd.textContent = ms <= 0 ? 'NOW – go!' : R.countdown(ms);
    cd.classList.toggle('soon', ms > 0 && ms <= 15 * 60000);
    cd.classList.toggle('now', ms <= 0 && ms > -30 * 60000);
    const tag = nxt.verified === 'bls' ? '✓ confirmed on the BLS centre page' : nxt.verified === 'secondary' ? '⚠ not confirmed on the BLS page' : '';
    $('relLine').textContent = `${nxt.line} · ${nxt.at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${tag ? ` · ${tag}` : ''}`;
  } else {
    $('relWhen').textContent = `${centre}`;
    cd.textContent = '—'; cd.className = 'countdown';
    $('relLine').textContent = list[0].dayName ? `${list[0].dayName} – ${list[0].line}` : list[0].line;
  }
  const ul = $('relList'); ul.innerHTML = '';
  for (const r of list.filter(x => x !== nxt)) {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><b></b>`;
    li.firstChild.textContent = r.line;
    li.lastChild.textContent = r.at ? `${r.dayName} ${r.time} · ${R.relative(r.at.getTime() - now)}` : (r.dayName ? `${r.dayName}, time not published` : 'not published');
    ul.appendChild(li);
  }
  const walk = R.WALK_INS.filter(w => w.dest === dest && w.centre.toLowerCase() === String(centre || '').toLowerCase());
  $('relWalkin').classList.toggle('hidden', !walk.length);
  if (walk.length) $('relWalkin').textContent = `Possible walk-in (${walk[0].hours}): ${walk[0].who}. Check with the centre first.`;
  const cl = $('checklist'); cl.innerHTML = '';
  for (const it of R.checklist(Object.assign({ now }, ctx))) {
    const li = document.createElement('li'); li.dataset.state = it.state; li.textContent = it.label; cl.appendChild(li);
  }
  if (document.activeElement !== $('remind')) $('remind').checked = settings.remind !== false;
}

function fillChoices(settings) {
  fill($('destination'), DESTINATIONS, settings.destinationId);
  fill($('category'), CATEGORIES, settings.category);
  renderDestination(settings);
}

async function init() {
  let { settings = {} } = await load('settings');
  // Ask the page what the user selected on the portal before showing the lists.
  const portalTab = await activeTab();
  if (isPortalUrl(portalTab && portalTab.url) && await sendToTab(portalTab.id, { type: 'pageContext' })) ({ settings = {} } = await load('settings'));
  fillChoices(settings);
  $('autoStart').checked = settings.autoStart !== false;
  $('interval').value = settings.interval || 90; $('intervalVal').textContent = $('interval').value;
  $('autoRefresh').checked = settings.autoRefresh !== false;
  $('sound').checked = settings.sound !== false;
  $('pauseOnHit').checked = !!settings.pauseOnHit;
  $('repeatMinutes').value = settings.repeatMinutes || 10;

  const tab = await activeTab();
  if (!isPortalUrl(tab && tab.url)) $('hint').textContent = 'Open your BLS or VFS appointment calendar in this tab first (log in yourself), then press Start.';
  // BLS puts a verification before every look at the slots: no refresh timer there, ever.
  if (tab && tab.url && /bls(spain|portugal|international)/i.test(new URL(tab.url).hostname)) {
    $('autoRefresh').disabled = true;
    $('autoRefresh').closest('label').classList.add('off');
    $('autoRefresh').closest('label').title = 'Not possible on BLS: a verification sits before each check. Press Try Again on the portal when you want to check; the result is read.';
    $('interval').disabled = true;
    $('hint').textContent = 'BLS: no auto-refresh (verification before each check). Press Try Again on the portal yourself; I read the result and alert instantly.';
  }

  // Changing destination / centre / category by hand switches off reading them from the page.
  $('destination').onchange = async () => { renderDestination({}); await persist({ auto: false }); };
  for (const id of ['centre', 'category']) $(id).onchange = () => persist({ auto: false });
  $('interval').oninput = () => { $('intervalVal').textContent = $('interval').value; };
  for (const id of ['interval', 'autoRefresh', 'sound', 'pauseOnHit', 'repeatMinutes', 'autoStart', 'remind']) $(id).onchange = () => persist();
  $('autoBtn').onclick = async () => {
    const { settings: cur = {} } = await load('settings');
    if (cur.auto === false) {
      await persist({ auto: true });
      const t = await activeTab();
      if (isPortalUrl(t && t.url)) await sendToTab(t.id, { type: 'pageContext' });
      fillChoices((await load('settings')).settings || {});
    } else {
      await persist({ auto: false });
    }
    await renderStatus();
  };

  $('pick').onclick = async () => {
    const t = await activeTab();
    if (!isPortalUrl(t.url)) { $('hint').textContent = 'Open the portal calendar in this tab first.'; return; }
    if (!(await ensureContent(t.id))) return;
    await sendToTab(t.id, { type: 'pickArea' });
    window.close();
  };
  $('clearPick').onclick = async () => { const { settings: s = {} } = await load('settings'); s.selector = ''; await save({ settings: s }); await renderStatus(); };

  $('start').onclick = async () => {
    const t = await activeTab();
    if (!isPortalUrl(t.url)) { $('hint').textContent = 'This tab is not a BLS/VFS page. Open the portal, log in, show the calendar, then Start.'; return; }
    const { settings: prev = {} } = await load('settings');
    const s = collectSettings(prev);
    s.watching = true; s.watchTabId = t.id; s.manualStopUrl = ''; s.autoStarted = false;
    await save({ settings: s, status: { state: 'unknown', at: Date.now() } });
    if (!(await ensureContent(t.id))) return;
    await sendToTab(t.id, { type: 'settingsChanged' });
    $('hint').textContent = 'Watching. Keep this tab open; you can switch to other tabs or windows.';
    await renderStatus();
  };
  $('stop').onclick = async () => {
    const { settings: s = {} } = await load('settings');
    const tabId = s.watchTabId; s.watching = false; s.autoStarted = false;
    // Remember where the user stopped so watching does not restart by itself on that same page.
    try { s.manualStopUrl = tabId != null ? (await chrome.tabs.get(tabId)).url : ''; } catch (e) { s.manualStopUrl = ''; }
    await save({ settings: s, status: { state: 'stopped', at: Date.now() } });
    if (tabId != null) await sendToTab(tabId, { type: 'settingsChanged' });
    await renderStatus();
  };
  $('checkNow').onclick = async () => {
    const t = await activeTab();
    if (isPortalUrl(t.url) && await ensureContent(t.id)) await sendToTab(t.id, { type: 'checkNow' });
    setTimeout(renderStatus, 500);
  };
  $('openDash').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
  $('activeApp').onchange = async () => {
    const { settings: s = {}, applications = [] } = await load(['settings', 'applications']);
    s.activeAppId = $('activeApp').value;
    const a = applications.find(x => x.id === s.activeAppId);
    if (a) Object.assign(s, { destinationId: a.destinationId, destination: destById(a.destinationId).name.split(' ·')[0], centre: a.centre || s.centre, category: a.category || s.category });
    await save({ settings: s });
    fillChoices(s);
    await renderStatus();
  };
  $('test').onclick = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'slotFound', test: true, title: 'RDV Maroc: test alert', body: 'This is what a real slot alert looks like.', tabId: null, sound: $('sound').checked });
    if ($('sound').checked && !(r && r.soundPlayed)) { try { const a = new Audio(chrome.runtime.getURL('alert.wav')); a.play().catch(() => {}); } catch (e) {} }
    $('hint').textContent = 'Test alert sent (notification' + ($('sound').checked ? ' + sound' : '') + ').';
  };

  await renderStatus();
  setInterval(renderStatus, 1000);
}

async function persist(extra) {
  const { settings: prev = {} } = await load('settings');
  const s = collectSettings(prev);
  if (extra) Object.assign(s, extra);
  await save({ settings: s });
  if (s.watching && s.watchTabId != null) await sendToTab(s.watchTabId, { type: 'settingsChanged' });
}

document.addEventListener('DOMContentLoaded', init);
