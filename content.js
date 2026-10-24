/* content.js — runs inside the BLS / VFS page you have open.
 * It never logs in, never fills a CAPTCHA, never clicks "book".
 * It only reads the calendar area, refreshes the page at the interval you chose,
 * and alerts you when a slot shows up. */
(() => {
  'use strict';
  if (window.__rdvMarocLoaded) return;
  window.__rdvMarocLoaded = true;

  const D = window.RDVDetect;
  let settings = null;
  let myTabId = null;
  let timer = null;
  let countdown = null;
  let nextAt = 0;
  let observer = null;
  let picking = false;
  let lastFingerprint = null;
  let lastAlertAt = 0;
  let loginSince = 0;
  let loginTimer = null;
  const LOGIN_CONFIRM_MS = 4000;

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const send = (msg) => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r)); } catch (e) { res(null); } });
  const store = (obj) => new Promise(res => chrome.storage.local.set(obj, res));
  const load = (keys) => new Promise(res => chrome.storage.local.get(keys, res));
  async function loadAlertState() {
    const { alertState } = await load('alertState');
    if (alertState) { lastFingerprint = alertState.fp || null; lastAlertAt = alertState.at || 0; }
  }
  async function saveAlertState() { await store({ alertState: { fp: lastFingerprint, at: lastAlertAt } }); }
  async function patchSettings(patch) {
    const { settings: cur = {} } = await load('settings');
    const next = Object.assign({}, cur, patch);
    await store({ settings: next });
    if (settings) Object.assign(settings, patch);
    return next;
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return null;
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let sel = el.nodeName.toLowerCase();
      if (el.id && !/\d{3,}/.test(el.id)) { parts.unshift(`#${CSS.escape(el.id)}`); break; }
      const cls = [...el.classList].filter(c => !/active|hover|focus|\d{3,}/.test(c)).slice(0, 2);
      if (cls.length) sel += '.' + cls.map(c => CSS.escape(c)).join('.');
      const parent = el.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(s => s.nodeName === el.nodeName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(el) + 1})`;
      }
      parts.unshift(sel);
      el = parent;
    }
    return parts.join(' > ');
  }

  // ---------- snapshot of the watched area ----------
  function watchedArea() {
    if (settings && settings.selector) {
      const el = $(settings.selector);
      if (el) return el;
    }
    return document.querySelector('main') || document.body;
  }

  const DAY_CELL_SELECTORS = [
    // jQuery UI datepicker (BLS)
    '.ui-datepicker-calendar td',
    // Angular Material (VFS)
    '.mat-calendar-body-cell', 'td.mat-calendar-body-cell-container',
    // Bootstrap / generic
    '.datepicker td.day', '.datepicker-days td', '.fc-daygrid-day', '.fc-day',
    '[class*="calendar"] td', '[class*="Calendar"] td', '[class*="datepicker"] td',
    '[role="gridcell"]', 'td[data-date]', 'button[data-date]', '[data-day]',
  ];
  const DISABLED_TOKENS = new Set(['disabled', 'unavailable', 'past', 'off', 'inactive', 'muted', 'blocked', 'full', 'fully', 'booked', 'not-available', 'notavailable', 'no-slot', 'noslot', 'holiday', 'weekend', 'ui-state-disabled', 'mat-calendar-body-disabled', 'outside', 'closed', 'old', 'new', 'other-month', 'ui-datepicker-unselectable', 'ui-datepicker-other-month', 'prevmonthday', 'nextmonthday']);
  // Widget-prefixed variants: k-state-disabled (Kendo), flatpickr-disabled, react-datepicker__day--disabled, is-disabled…
  const DISABLED_PATTERN = /(^|[-_])(disabled|unavailable|unselectable|other-month|outside-month)$/;
  const ENABLED_TOKENS = new Set(['available', 'open', 'free', 'enabled', 'ui-state-default', 'mat-calendar-body-active', 'selectable', 'has-slot', 'hasslot', 'slot', 'slots', 'active-day', 'bookable']);
  const tokens = cls => (cls || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hasToken = (cls, set) => tokens(cls).some(t => set.has(t));
  const DISABLED_CLASS = { test: cls => hasToken(cls, DISABLED_TOKENS) || tokens(cls).some(t => DISABLED_PATTERN.test(t)) };
  const ENABLED_CLASS = { test: cls => hasToken(cls, ENABLED_TOKENS) };

  function collectDayCells(area) {
    const seen = new Set();
    let total = 0, enabled = 0;
    for (const sel of DAY_CELL_SELECTORS) {
      let nodes;
      try { nodes = area.querySelectorAll(sel); } catch (e) { continue; }
      for (const n of nodes) {
        if (seen.has(n)) continue;
        const txt = (n.textContent || '').trim();
        if (!/^\d{1,2}$/.test(txt)) continue;     // only numeric day cells
        seen.add(n);
        total++;
        const cls = n.className && typeof n.className === 'string' ? n.className : '';
        const inner = n.querySelector('a,button,[role="button"]');
        const innerCls = inner && typeof inner.className === 'string' ? inner.className : '';
        const disabledAttr = n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true' ||
          (inner && (inner.hasAttribute('disabled') || inner.getAttribute('aria-disabled') === 'true'));
        const looksDisabled = disabledAttr || DISABLED_CLASS.test(cls) || DISABLED_CLASS.test(innerCls);
        const looksEnabled = !!inner || ENABLED_CLASS.test(cls) || ENABLED_CLASS.test(innerCls) ||
          getComputedStyle(n).cursor === 'pointer';
        if (!looksDisabled && looksEnabled) enabled++;
      }
    }
    return { total, enabled };
  }

  function collectSlotOptions(area) {
    let count = 0;
    const selects = area.querySelectorAll('select');
    for (const s of selects) {
      const key = `${s.id} ${s.name} ${s.className} ${s.getAttribute('aria-label') || ''}`.toLowerCase();
      if (!/slot|time|date|appoint|cita|cr[ée]neau|rdv|horaire|hour/.test(key)) continue;
      for (const o of s.options) {
        const t = (o.textContent || '').trim().toLowerCase();
        if (!o.value || /^(select|choose|choisir|s[ée]lection|--|-|please|veuillez|seleccion)/.test(t) || t === '') continue;
        count++;
      }
    }
    return count;
  }

  // Verification widgets that show no text of their own. Only detected so we can stop and hand
  // over to the user; never touched. The invisible reCAPTCHA v3 badge is not a challenge.
  const CAPTCHA_WIDGETS = [
    'iframe[src*="recaptcha/api2/anchor"]', 'iframe[src*="recaptcha/api2/bframe"]', 'iframe[src*="recaptcha/enterprise/anchor"]',
    'iframe[src*="hcaptcha.com"]', 'iframe[src*="challenges.cloudflare.com"]',
    '.g-recaptcha', '.h-captcha', '.cf-turnstile', '#challenge-form', '#cf-challenge-running',
  ];
  function findCaptchaWidget() {
    for (const sel of CAPTCHA_WIDGETS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.grecaptcha-badge')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && getComputedStyle(el).visibility !== 'hidden') return sel;
      }
    }
    return null;
  }

  function snapshot() {
    const area = watchedArea();
    const days = collectDayCells(area);
    return {
      text: area.innerText || '',
      pageText: (document.body.innerText || '').slice(0, 20000),
      enabledDays: days.enabled,
      totalDays: days.total,
      optionCount: collectSlotOptions(area),
      captchaWidget: findCaptchaWidget(),
    };
  }

  // ---------- status UI (small badge in the page) ----------
  function ensureBadge() {
    let b = $('#rdv-maroc-badge');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'rdv-maroc-badge';
    b.innerHTML = `<span class="rdv-dot"></span><span class="rdv-text">RDV Maroc</span><span class="rdv-sub"></span>`;
    document.documentElement.appendChild(b);
    return b;
  }
  function setBadge(state, text, sub) {
    const b = ensureBadge();
    b.dataset.state = state;
    b.querySelector('.rdv-text').textContent = text;
    b.querySelector('.rdv-sub').textContent = sub || '';
  }

  function banner(title, body) {
    let el = $('#rdv-maroc-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rdv-maroc-banner';
      el.innerHTML = `<div class="rdv-b-title"></div><div class="rdv-b-body"></div><button class="rdv-b-close" title="Close">×</button>`;
      el.querySelector('.rdv-b-close').onclick = () => el.remove();
      document.documentElement.appendChild(el);
    }
    el.querySelector('.rdv-b-title').textContent = title;
    el.querySelector('.rdv-b-body').textContent = body;
  }

  let audio = null;
  function playSound() {
    if (!settings || !settings.sound) return;
    try {
      if (!audio) { audio = new Audio(chrome.runtime.getURL('alert.wav')); audio.loop = false; }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch (e) { /* autoplay may be blocked until the user interacts with the page */ }
  }

  // ---------- the check ----------
  async function publishStatus(extra) {
    await store({ status: Object.assign({
      at: Date.now(), url: location.href, tabId: myTabId, nextAt,
    }, extra) });
  }

  async function evaluate(trigger) {
    if (!settings || !settings.watching) return;
    const snap = snapshot();
    const res = D.classify(snap);
    const fp = D.hash(`${res.state}|${res.dates.join(',')}|${snap.enabledDays}|${snap.optionCount}`);
    const label = { captcha: 'Needs you', login: 'Logged out', available: 'SLOT!', none: 'No slots', unknown: 'Watching' }[res.state];
    if (res.state !== 'login') { loginSince = 0; clearTimeout(loginTimer); }

    if (res.state === 'captcha') {
      stopTimer();
      setBadge('captcha', 'Needs you', 'Solve the verification, then click Start again');
      banner('RDV Maroc – your turn', 'The page is asking for a human check. Solve it yourself; I never fill these in. Then press Start in the extension.');
      await send({ type: 'notify', title: 'RDV Maroc: human check needed', body: 'Solve the verification on the portal, then press Start again.', urgent: false });
      await patchSettings({ watching: false });
      await publishStatus({ state: res.state, reasons: res.reasons, dates: [] });
      return;
    }

    if (res.state === 'login') {
      // An SPA shows its bare shell for a moment after a refresh; only stop if it still looks
      // like a login page a few seconds later.
      if (!loginSince) loginSince = Date.now();
      if (Date.now() - loginSince < LOGIN_CONFIRM_MS) {
        setBadge('unknown', 'Watching', 'checking…');
        clearTimeout(loginTimer);
        loginTimer = setTimeout(() => evaluate('login-confirm'), LOGIN_CONFIRM_MS - (Date.now() - loginSince) + 50);
        return;
      }
      loginSince = 0;
      stopTimer();
      setBadge('login', 'Logged out', 'Log in again, open the calendar, press Start');
      banner('RDV Maroc – session ended', 'The portal sent you back to the login page. Log in again (I never store your password), open the calendar, then press Start.');
      await send({ type: 'notify', title: 'RDV Maroc: session ended', body: 'Log in again, open the calendar, then press Start.', urgent: false });
      await patchSettings({ watching: false });
      await publishStatus({ state: res.state, reasons: res.reasons, dates: [] });
      return;
    }

    if (res.state === 'available') {
      const changed = fp !== lastFingerprint;
      const repeatMs = (settings.repeatMinutes || 10) * 60000;
      const due = Date.now() - lastAlertAt > repeatMs;
      if (changed || due) {
        lastFingerprint = fp;
        lastAlertAt = Date.now();
        await saveAlertState();
        const where = describeTarget();
        const datesTxt = res.dates.length ? `Dates seen: ${res.dates.slice(0, 6).join(', ')}` : res.reasons.join(' · ');
        banner('🎉 Slot detected – book it now', `${where}\n${datesTxt}`);
        const r = await send({ type: 'slotFound', title: `RDV Maroc: slot at ${where}`, body: datesTxt, url: location.href, tabId: myTabId, sound: !!settings.sound });
        if (!r || !r.soundPlayed) playSound();
        await store({ lastHit: { at: Date.now(), where, dates: res.dates, reasons: res.reasons, url: location.href } });
      }
      setBadge('available', 'SLOT!', res.dates[0] ? `first: ${res.dates[0]}` : res.reasons[0]);
      // Keep refreshing so the badge stays accurate (settings.pauseOnHit stops the refresh instead).
      if (settings.pauseOnHit) { stopTimer(); await publishStatus({ state: res.state, reasons: res.reasons, dates: res.dates, paused: true }); return; }
    } else {
      // Only a page that says "no slots" clears the last alert. 'unknown' is usually an SPA calendar
      // that has not rendered yet after a refresh; forgetting the slot then would re-alert it.
      if (res.state === 'none' && lastFingerprint) { lastFingerprint = null; await saveAlertState(); }
      setBadge(res.state, label, trigger === 'reload' ? 'checked after refresh' : 'checked');
    }

    await publishStatus({ state: res.state, reasons: res.reasons, dates: res.dates });
    // 2. A DOM change must not push the refresh further away; only (re)schedule when no timer runs.
    if (!timer || trigger !== 'mutation') scheduleReload();
  }

  function describeTarget() {
    if (!settings) return location.hostname;
    const bits = [settings.destination, settings.centre, settings.category].filter(Boolean);
    return bits.length ? bits.join(' · ') : location.hostname;
  }

  // ---------- refresh timer ----------
  function stopTimer() {
    if (timer) clearTimeout(timer);
    if (countdown) clearInterval(countdown);
    timer = countdown = null;
    nextAt = 0;
    store({ nextAt: 0 });
  }

  function scheduleReload() {
    stopTimer();
    if (!settings.autoRefresh) return;
    const secs = D.reloadDelaySeconds(settings.interval, Math.random());
    nextAt = Date.now() + secs * 1000;
    store({ nextAt });
    countdown = setInterval(() => {
      const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
      const b = $('#rdv-maroc-badge');
      if (b && b.dataset.state !== 'available') b.querySelector('.rdv-sub').textContent = `next refresh in ${left}s`;
    }, 1000);
    timer = setTimeout(async () => {
      if (!settings.watching) return;
      // Don't reload while the user is typing in a form on this page.
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) { scheduleReload(); return; }
      await store({ reloadAt: Date.now() });
      location.reload();
    }, secs * 1000);
  }

  // ---------- live DOM changes (SPA calendars) ----------
  function startObserver() {
    if (observer) return;
    let t = null;
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => evaluate('mutation'), 1500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled'] });
  }
  function stopObserver() { if (observer) observer.disconnect(); observer = null; }

  // ---------- area picker ----------
  const CALENDAR_CONTAINER = '.ui-datepicker, mat-calendar, .mat-calendar, .k-calendar, .flatpickr-calendar, [class*="calendar" i], [class*="datepicker" i]';
  /** Clicking a single day (the natural thing to do) should select the whole calendar around it. */
  function pickTarget(el) {
    if (!el || (el.id && el.id.startsWith('rdv-maroc'))) return null;
    let n = el, cells = 0;
    while (n && n !== document.body && cells < 7) { cells = collectDayCells(n).total; if (cells < 7) n = n.parentElement; }
    if (!n || n === document.body) return el;              // not inside a calendar: keep what was clicked
    while (n.parentElement && n.parentElement !== document.body && collectDayCells(n.parentElement).total > cells) {
      n = n.parentElement; cells = collectDayCells(n).total;
    }
    const box = n.closest(CALENDAR_CONTAINER) || n.closest('table') || n;
    return box === document.body || box === document.documentElement ? n : box;
  }

  function startPicking() {
    if (picking) return;
    picking = true;
    document.documentElement.classList.add('rdv-picking');
    let current = null;
    const targets = new WeakMap();
    const resolve = t => { if (!targets.has(t)) targets.set(t, pickTarget(t)); return targets.get(t); };
    const over = e => {
      if (current) current.classList.remove('rdv-hover');
      current = resolve(e.target);
      if (current) current.classList.add('rdv-hover');
    };
    const click = async e => {
      e.preventDefault(); e.stopPropagation();
      const el = resolve(e.target);
      cleanup();
      if (!el) return;
      const sel = cssPath(el);
      await patchSettings({ selector: sel });
      setBadge('unknown', 'Area set', (el.innerText || '').trim().slice(0, 40));
      banner('Area selected', 'I will watch only this part of the page. Press Start in the extension.');
    };
    const key = e => { if (e.key === 'Escape') cleanup(); };
    const cleanup = () => {
      picking = false;
      if (current) current.classList.remove('rdv-hover');
      document.documentElement.classList.remove('rdv-picking');
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    setBadge('unknown', 'Pick area', 'Click the calendar. Esc to cancel.');
  }

  // ---------- lifecycle ----------
  async function readSettings() {
    const { settings: saved = {} } = await load('settings');
    return Object.assign({
      watching: false, autoRefresh: true, interval: 90, sound: true, repeatMinutes: 10,
      pauseOnHit: false, selector: '', destination: '', centre: '', category: '', watchTabId: null,
    }, saved);
  }

  async function start() {
    settings = await readSettings();
    if (settings.watching && settings.watchTabId && myTabId && settings.watchTabId !== myTabId) {
      // Another tab is the one being watched.
      setBadge('unknown', 'RDV Maroc', 'watching another tab');
      return;
    }
    if (!settings.watching) {
      setBadge('unknown', 'RDV Maroc', 'ready – press Start in the extension');
      stopObserver(); stopTimer();
      return;
    }
    setBadge('unknown', 'Watching', 'checking…');
    await loadAlertState();
    startObserver();
    await evaluate('reload');
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    (async () => {
      if (msg.type === 'pickArea') { startPicking(); reply({ ok: true }); }
      else if (msg.type === 'settingsChanged') { lastFingerprint = null; lastAlertAt = 0; await saveAlertState(); await start(); reply({ ok: true }); }
      else if (msg.type === 'checkNow') { settings = await readSettings(); await evaluate('manual'); reply({ ok: true }); }
      else if (msg.type === 'ping') reply({ ok: true, url: location.href, tabId: myTabId });
      else reply({ ok: false });
    })();
    return true;
  });

  (async () => {
    const r = await send({ type: 'whoami' });
    myTabId = r && r.tabId != null ? r.tabId : null;
    await start();
  })();
})();
