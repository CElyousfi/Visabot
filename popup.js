'use strict';

/* Moroccan Schengen landscape (France excluded: random allocation, nothing to watch). */
const DESTINATIONS = [
  { id: 'spain', name: 'Spain · Espagne', provider: 'BLS International', portal: 'https://www.blsspainmorocco.com/',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Nador', 'Tétouan', 'Agadir'] },
  { id: 'portugal', name: 'Portugal', provider: 'BLS International', portal: 'https://www.blsinternational.com/',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Other'] },
  { id: 'italy', name: 'Italy · Italie', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/ita',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Other'] },
  { id: 'netherlands', name: 'Netherlands · Pays-Bas', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/nld',
    centres: ['Rabat', 'Tanger', 'Other'] },
  { id: 'germany', name: 'Germany · Allemagne', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/deu',
    centres: ['Casablanca', 'Rabat', 'Other'] },
  { id: 'switzerland', name: 'Switzerland · Suisse', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/che',
    centres: ['Rabat', 'Casablanca', 'Other'] },
  { id: 'belgium', name: 'Belgium · Belgique', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/bel',
    centres: ['Casablanca', 'Rabat', 'Other'] },
  { id: 'austria', name: 'Austria · Autriche', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/aut',
    centres: ['Rabat', 'Other'] },
  { id: 'other', name: 'Other Schengen country', provider: 'Check the embassy site', portal: '',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Marrakech', 'Fès', 'Agadir', 'Oujda', 'Nador', 'Tétouan', 'Other'] },
  { id: 'france', name: 'France (not supported)', provider: 'TLScontact – random allocation', portal: 'https://visas-fr.tlscontact.com/',
    centres: [], unsupported: true },
];
const CATEGORIES = [
  'Tourism · Tourisme', 'Family / friends visit · Visite familiale', 'Business · Affaires', 'Study · Études',
  'Medical · Médical', 'Work · Travail', 'Family reunification · Regroupement familial', 'Transit', 'Other · Autre',
];

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
    pauseOnHit: $('pauseOnHit').checked, repeatMinutes: Math.max(1, Number($('repeatMinutes').value) || 10),
  });
}

async function renderStatus() {
  const { settings = {}, status = {}, lastHit, nextAt } = await load(['settings', 'status', 'lastHit', 'nextAt']);
  const watching = !!settings.watching;
  $('start').classList.toggle('hidden', watching);
  $('stop').classList.toggle('hidden', !watching);
  const st = watching ? (status.state || 'watching') : 'idle';
  $('statusPill').dataset.state = st;
  $('statusPill').textContent = { idle: 'Idle', watching: 'Watching', none: 'No slots', unknown: 'Watching', available: 'SLOT!', captcha: 'Needs you', login: 'Logged out', stopped: 'Stopped' }[st] || st;
  $('statusText').textContent = watching
    ? ({ none: 'No slots yet', unknown: 'Watching (page not recognised yet)', available: 'Slot visible – book now!', captcha: 'Solve the verification', login: 'Session ended' }[status.state] || 'Watching…')
    : (status.state === 'captcha' ? 'Stopped: verification needed' : status.state === 'login' ? 'Stopped: logged out' : 'Not watching');
  $('lastCheck').textContent = watching ? fmt(status.at) : '—';
  const left = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
  $('nextCheck').textContent = watching && settings.autoRefresh && left != null ? `${left}s` : '—';
  if (lastHit) {
    $('hit').classList.remove('hidden');
    $('hitText').textContent = `${new Date(lastHit.at).toLocaleString()} · ${lastHit.where}` + (lastHit.dates && lastHit.dates.length ? ` · ${lastHit.dates.slice(0, 4).join(', ')}` : '');
  }
  $('selectorText').textContent = settings.selector ? `Watching area: ${settings.selector}` : 'Watching: whole page (pick the calendar for better accuracy)';
}

async function init() {
  const { settings = {} } = await load('settings');
  fill($('destination'), DESTINATIONS, settings.destinationId);
  fill($('category'), CATEGORIES, settings.category);
  renderDestination(settings);
  $('interval').value = settings.interval || 90; $('intervalVal').textContent = $('interval').value;
  $('autoRefresh').checked = settings.autoRefresh !== false;
  $('sound').checked = settings.sound !== false;
  $('pauseOnHit').checked = !!settings.pauseOnHit;
  $('repeatMinutes').value = settings.repeatMinutes || 10;

  const tab = await activeTab();
  if (!isPortalUrl(tab && tab.url)) $('hint').textContent = 'Open your BLS or VFS appointment calendar in this tab first (log in yourself), then press Start.';

  $('destination').onchange = async () => { renderDestination({}); await persist(); };
  $('interval').oninput = () => { $('intervalVal').textContent = $('interval').value; };
  for (const id of ['centre', 'category', 'interval', 'autoRefresh', 'sound', 'pauseOnHit', 'repeatMinutes']) $(id).onchange = persist;

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
    s.watching = true; s.watchTabId = t.id;
    await save({ settings: s, status: { state: 'unknown', at: Date.now() } });
    if (!(await ensureContent(t.id))) return;
    await sendToTab(t.id, { type: 'settingsChanged' });
    $('hint').textContent = 'Watching. Keep this tab open; you can switch to other tabs or windows.';
    await renderStatus();
  };
  $('stop').onclick = async () => {
    const { settings: s = {} } = await load('settings');
    const tabId = s.watchTabId; s.watching = false;
    await save({ settings: s, status: { state: 'stopped', at: Date.now() } });
    if (tabId != null) await sendToTab(tabId, { type: 'settingsChanged' });
    await renderStatus();
  };
  $('checkNow').onclick = async () => {
    const t = await activeTab();
    if (isPortalUrl(t.url) && await ensureContent(t.id)) await sendToTab(t.id, { type: 'checkNow' });
    setTimeout(renderStatus, 500);
  };
  $('test').onclick = async () => {
    const r = await chrome.runtime.sendMessage({ type: 'slotFound', test: true, title: 'RDV Maroc: test alert', body: 'This is what a real slot alert looks like.', tabId: null, sound: $('sound').checked });
    if ($('sound').checked && !(r && r.soundPlayed)) { try { const a = new Audio(chrome.runtime.getURL('alert.wav')); a.play().catch(() => {}); } catch (e) {} }
    $('hint').textContent = 'Test alert sent (notification' + ($('sound').checked ? ' + sound' : '') + ').';
  };

  await renderStatus();
  setInterval(renderStatus, 1000);
}

async function persist() {
  const { settings: prev = {} } = await load('settings');
  const s = collectSettings(prev);
  await save({ settings: s });
  if (s.watching && s.watchTabId != null) await sendToTab(s.watchTabId, { type: 'settingsChanged' });
}

document.addEventListener('DOMContentLoaded', init);
