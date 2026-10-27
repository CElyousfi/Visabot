/* background.js — service worker: desktop notifications, badge, tab bookkeeping. */
'use strict';

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function playSoundOffscreen() {
  if (!chrome.offscreen) return false;            // Firefox: no offscreen API
  try {
    const has = await chrome.offscreen.hasDocument();
    if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play the slot alert sound' });
    const r = await chrome.runtime.sendMessage({ type: 'offscreenPlay' });
    return !!(r && r.played);                       // false → the caller plays the sound itself
  } catch (e) { return false; }
}

// ---------- applications tracked in the dashboard (stored only in this browser) ----------
async function getApps() {
  const { applications = [], settings = {} } = await chrome.storage.local.get(['applications', 'settings']);
  return { applications, settings };
}

/** The application an event belongs to: the active one, else one for the same destination, else a new one. */
function targetApp(applications, settings, ctx = {}, create = true) {
  let app = applications.find(a => a.id === settings.activeAppId);
  if (!app && ctx.destinationId) {
    app = applications.find(a => a.destinationId === ctx.destinationId && (!ctx.centre || !a.centre || a.centre === ctx.centre) && a.status !== 'booked');
  }
  if (!app && !create) return null;
  if (!app) {
    const n = applications.reduce((m, a) => Math.max(m, a.num || 0), 1000) + 1;
    app = {
      id: `app-${Date.now()}`, num: n, createdAt: Date.now(), status: 'watching',
      destinationId: ctx.destinationId || settings.destinationId || '', destination: ctx.destination || settings.destination || '',
      centre: ctx.centre || settings.centre || '', category: ctx.category || settings.category || '',
      applicant: {}, history: [],
    };
    applications.push(app);
  }
  return app;
}

function logEvent(app, type, text, extra) {
  app.history = [{ at: Date.now(), type, text, ...extra }, ...(app.history || [])].slice(0, 200);
}

async function recordSlot(msg) {
  const { applications, settings } = await getApps();
  const app = targetApp(applications, settings, settings);
  if (app.status !== 'booked') app.status = 'slot';
  app.lastSlot = { at: Date.now(), dates: msg.dates || [], text: msg.body || '', url: msg.url || '' };
  logEvent(app, 'slot', msg.body || 'Slot seen', { url: msg.url || '' });
  await chrome.storage.local.set({ applications });
}

async function recordBooking(b, tabId) {
  const { applications, settings } = await getApps();
  const app = targetApp(applications, settings, b);
  app.status = 'booked';
  app.appointment = {
    date: b.date || '', time: b.time || '', reference: b.reference || '',
    destination: b.destination || app.destination, centre: b.centre || app.centre, category: b.category || app.category,
    provider: b.provider || '', url: b.url || '', at: b.at || Date.now(),
  };
  if (!app.destination && b.destination) { app.destination = b.destination; app.destinationId = b.destinationId; }
  if (!app.centre && b.centre) app.centre = b.centre;
  logEvent(app, 'booked', `Booked ${[b.date, b.time].filter(Boolean).join(' ')}${b.reference ? ` · ref ${b.reference}` : ''}`, { url: b.url || '' });
  await chrome.storage.local.set({ applications });
  badge('✓', '#16a34a');
  try {
    await chrome.notifications.create(`rdv-booked-${Date.now()}`, {
      type: 'basic', iconUrl: 'icons/icon128.png', priority: 2, requireInteraction: true,
      title: 'RDV Maroc: appointment booked ✓',
      message: [app.appointment.destination, app.appointment.centre, b.date, b.time, b.reference && `ref ${b.reference}`].filter(Boolean).join(' · '),
    });
  } catch (e) {}
  return app;
}

/** BLS applicant record status seen on Manage Appointments: filed on the linked application when it changes. */
async function recordReadiness(state, url) {
  const { applications, settings } = await getApps();
  const app = targetApp(applications, settings, settings, false);
  if (!app) return;
  const complete = state === 'complete';
  if (app.formCompleted === complete) return;
  app.formCompleted = complete;
  app.formUrl = url || app.formUrl || '';
  logEvent(app, 'form', complete ? 'Application form completed ✓' : 'Application form not completed – BLS will not book without it', { url: url || '' });
  await chrome.storage.local.set({ applications });
}

// Log pauses and resumes on the active application so its history tells the whole story.
let lastLoggedState = null;
async function logStatusChange(state) {
  if (state === lastLoggedState || !['captcha', 'login', 'none', 'available'].includes(state)) return;
  const prev = lastLoggedState;
  lastLoggedState = state;
  const { applications, settings } = await getApps();
  const app = targetApp(applications, settings, settings, false);
  if (!app || app.status === 'booked') return;
  const text = { captcha: 'Paused: verification on the portal', login: 'Paused: logged out', none: prev === 'available' ? 'Slot gone' : 'Watching: no slots', available: 'Slot visible' }[state];
  if (state === 'none' && prev === 'none') return;
  if (state === 'captcha' || state === 'login') app.status = 'paused';
  else if (state === 'none') app.status = 'watching';
  else if (state === 'available') app.status = 'slot';
  logEvent(app, state, text);
  await chrome.storage.local.set({ applications });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'offscreenPlay') return false;   // handled by the offscreen page
  (async () => {
    if (msg.type === 'booked') {
      const app = await recordBooking(msg.booking || {}, msg.tabId);
      reply({ ok: true, appId: app.id });
      return;
    }
    if (msg.type === 'whoami') {
      reply({ tabId: sender.tab ? sender.tab.id : null });
      return;
    }
    if (msg.type === 'notify' || msg.type === 'slotFound') {
      const id = `rdv-${Date.now()}`;
      try {
        await chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: msg.title || 'RDV Maroc',
          message: msg.body || '',
          priority: 2,
          requireInteraction: msg.type === 'slotFound',
        });
      } catch (e) { /* notifications may be disabled at OS level */ }
      let soundPlayed = false;
      if (msg.type === 'slotFound') {
        if (!msg.test) { badge('!', '#dc2626'); await recordSlot(msg); }
        if (msg.sound !== false) soundPlayed = await playSoundOffscreen();
        await chrome.storage.local.set({ notifTab: { [id]: msg.tabId } });
        // Bring the tab forward so the user can book immediately.
        if (msg.tabId != null) {
          try {
            const tab = await chrome.tabs.get(msg.tabId);
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(msg.tabId, { active: true });
          } catch (e) { /* tab may be gone */ }
        }
      }
      reply({ ok: true, soundPlayed });
      return;
    }
    if (msg.type === 'setBadge') { badge(msg.text || '', msg.color); reply({ ok: true }); return; }
    if (msg.type === 'openDashboard') { chrome.runtime.openOptionsPage(); reply({ ok: true }); return; }
    if (msg.type === 'readiness') { await recordReadiness(msg.state, msg.url); reply({ ok: true }); return; }
    if (msg.type === 'tabAlive') { let alive = false; try { alive = !!(await chrome.tabs.get(msg.tabId)); } catch (e) {} reply({ alive }); return; }
    reply({ ok: false });
  })();
  return true;
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (id.startsWith('rdv-booked-')) { chrome.runtime.openOptionsPage(); chrome.notifications.clear(id); return; }
  const { notifTab = {} } = await chrome.storage.local.get('notifTab');
  const tabId = notifTab[id];
  if (tabId != null) {
    try { const tab = await chrome.tabs.get(tabId); await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
  }
  chrome.notifications.clear(id);
});

// Keep the badge honest when the watched tab closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.watchTabId === tabId) {
    const wasWatching = settings.watching;
    settings.watching = false;
    settings.watchTabId = null;
    await chrome.storage.local.set(wasWatching ? { settings, status: { state: 'stopped', at: Date.now(), reason: 'tab closed' } } : { settings });
    badge('', '#6b7280');
  }
});

// Tab ids do not survive a browser restart: a stored one would point at a tab that no longer
// exists and every portal page would think another tab is being watched.
chrome.runtime.onStartup.addListener(async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.watchTabId != null || settings.watching) {
    settings.watchTabId = null; settings.watching = false;
    await chrome.storage.local.set({ settings, status: { state: 'stopped', at: Date.now(), reason: 'browser restarted' } });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.status && changes.status.newValue) {
    const s = changes.status.newValue.state;
    logStatusChange(s);
    if (s === 'available') badge('!', '#dc2626');
    else if (s === 'booked') badge('✓', '#16a34a');
    else if (s === 'none' || s === 'unknown') badge('●', '#2563eb');
    else if (s === 'captcha' || s === 'login') badge('?', '#f59e0b');
    else badge('', '#6b7280');
  }
  if (changes.settings && changes.settings.newValue && !changes.settings.newValue.watching) badge('', '#6b7280');
});

// Attach to portal tabs that were already open when the extension was installed or updated,
// so watching can start without the user reloading the page.
chrome.runtime.onInstalled.addListener(async () => {
  const { host_permissions = [] } = chrome.runtime.getManifest();
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: host_permissions }); } catch (e) { return; }
  for (const t of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['detect.js', 'content.js'] });
    } catch (e) { /* discarded tab or page we cannot script */ }
  }
});
