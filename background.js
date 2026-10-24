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
    await chrome.runtime.sendMessage({ type: 'offscreenPlay' });
    return true;
  } catch (e) { return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'offscreenPlay') return false;   // handled by the offscreen page
  (async () => {
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
        badge('!', '#dc2626');
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
    reply({ ok: false });
  })();
  return true;
});

chrome.notifications.onClicked.addListener(async (id) => {
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
  if (settings.watchTabId === tabId && settings.watching) {
    settings.watching = false;
    await chrome.storage.local.set({ settings, status: { state: 'stopped', at: Date.now(), reason: 'tab closed' } });
    badge('', '#6b7280');
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.status && changes.status.newValue) {
    const s = changes.status.newValue.state;
    if (s === 'available') badge('!', '#dc2626');
    else if (s === 'none' || s === 'unknown') badge('●', '#2563eb');
    else if (s === 'captcha' || s === 'login') badge('?', '#f59e0b');
    else badge('', '#6b7280');
  }
  if (changes.settings && changes.settings.newValue && !changes.settings.newValue.watching) badge('', '#6b7280');
});
