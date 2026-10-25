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
  const MUTATION_DEBOUNCE_MS = 400;   // react to a calendar change in well under a second

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
  let lastWritten = '';                 // our own settings writes, so the storage listener ignores them
  async function patchSettings(patch) {
    const { settings: cur = {} } = await load('settings');
    const next = Object.assign({}, cur, patch);
    lastWritten = JSON.stringify(next);
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

  // ---------- form date pickers are not the appointment calendar ----------
  const CALENDAR_BOX = '.ui-datepicker, mat-calendar, .mat-calendar, .mat-datepicker-content, .k-calendar, .flatpickr-calendar, .datepicker, .react-datepicker, [class*="calendar" i], [class*="datepicker" i], table';
  const POPUP_HOST = '.cdk-overlay-container, .mat-datepicker-popup, .k-animation-container, .datepicker-dropdown, .ui-datepicker:not(.ui-datepicker-inline)';
  let lastFocusedInput = null;          // a popup picker shows the dates of the field that opened it, even after blur
  document.addEventListener('focusin', e => { if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) lastFocusedInput = e.target; }, true);
  const isInput = el => el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  function isPopupBox(box) {
    if (box.id === 'ui-datepicker-div' || box.closest(POPUP_HOST)) return true;
    const pos = getComputedStyle(box).position;
    return pos === 'absolute' || pos === 'fixed';
  }
  /** The form field a calendar belongs to, or null when it stands on its own. */
  function boundField(box) {
    if (box.id) {
      const owner = document.querySelector(`[aria-owns~="${CSS.escape(box.id)}"], [aria-controls~="${CSS.escape(box.id)}"], [aria-describedby~="${CSS.escape(box.id)}"]`);
      if (owner) return owner;
    }
    if (isPopupBox(box)) {
      if (isInput(document.activeElement)) return document.activeElement;
      if (lastFocusedInput && lastFocusedInput.isConnected) return lastFocusedInput;
      return null;
    }
    const prev = box.previousElementSibling;
    if (isInput(prev)) return prev;
    const wrap = box.closest('label, .form-group, .mat-form-field, .mat-mdc-form-field, .field, .input-group');
    const inputs = wrap ? wrap.querySelectorAll('input:not([type=hidden]), textarea') : [];
    return inputs.length === 1 ? inputs[0] : null;
  }
  /** A picker for a birth / passport / travel date: ignore it, whatever it shows. */
  function isFormPicker(box, cache) {
    if (cache.has(box)) return cache.get(box);
    const f = boundField(box);
    const r = !!f && D.isFormDateField(fieldLabel(f));
    cache.set(box, r);
    return r;
  }

  function collectDayCells(area) {
    const seen = new Set();
    const cells = [];
    const pickers = new Map();
    let total = 0, enabled = 0;
    for (const sel of DAY_CELL_SELECTORS) {
      let nodes;
      try { nodes = area.querySelectorAll(sel); } catch (e) { continue; }
      for (const n of nodes) {
        if (seen.has(n)) continue;
        const txt = (n.textContent || '').trim();
        if (!/^\d{1,2}$/.test(txt)) continue;     // only numeric day cells
        const box = n.parentElement && n.parentElement.closest(CALENDAR_BOX);
        if (box && isFormPicker(box, pickers)) continue;
        // A <td> wrapping a <button> for the same day (Angular Material) is one cell, not two.
        let nested = false;
        for (const s of seen) if (s.contains(n) || n.contains(s)) { nested = true; break; }
        if (nested) continue;
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
        if (!looksDisabled && looksEnabled) { enabled++; cells.push(n); }
      }
    }
    return { total, enabled, cells };
  }

  const PLACEHOLDER_OPTION = /^(select|choose|choisir|s[ée]lection|--|-|please|veuillez|seleccion)/;
  function collectSlotOptions(area) {
    let count = 0;
    const filled = [];
    const selects = area.querySelectorAll('select');
    for (const s of selects) {
      const key = `${s.id} ${s.name} ${s.className} ${s.getAttribute('aria-label') || ''}`.toLowerCase();
      if (!/slot|time|date|appoint|cita|cr[ée]neau|rdv|horaire|hour/.test(key)) continue;
      let n = 0;
      for (const o of s.options) {
        const t = (o.textContent || '').trim().toLowerCase();
        if (!o.value || PLACEHOLDER_OPTION.test(t) || t === '') continue;
        n++;
      }
      if (n) { count += n; filled.push(s); }
    }
    return { count, filled };
  }

  // ---------- what the user chose on the portal ----------
  function fieldLabel(el) {
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrap = el.closest('label, .form-group, .mat-form-field, .mat-mdc-form-field, .field, .input-group');
    return [el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('placeholder'),
      forLabel && forLabel.textContent, wrap && wrap.textContent,
      el.previousElementSibling && el.previousElementSibling.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 300);
  }
  function pageContext() {
    const fields = [];
    for (const s of document.querySelectorAll('select')) {
      const o = s.selectedOptions && s.selectedOptions[0];
      const t = o ? (o.textContent || '').trim() : '';
      if (!o || !o.value || PLACEHOLDER_OPTION.test(t.toLowerCase())) continue;
      fields.push({ label: fieldLabel(s), value: t });
    }
    // Angular Material / custom dropdowns show the chosen value as text.
    for (const v of document.querySelectorAll('.mat-select-value, .mat-mdc-select-value, [role="combobox"], .select2-selection__rendered, .k-input-value-text')) {
      const t = (v.textContent || '').trim();
      if (t) fields.push({ label: fieldLabel(v), value: t });
    }
    for (const i of document.querySelectorAll('input[type="radio"]:checked, input[readonly][value]')) {
      const lab = i.type === 'radio' && i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]` ) : null;
      fields.push({ label: fieldLabel(i), value: (lab && lab.textContent) || i.value });
    }
    const headings = [document.title, ...[...document.querySelectorAll('h1, h2, h3, h4, .breadcrumb, [class*="selected" i]')].map(e => e.textContent)]
      .join('\n').slice(0, 4000);
    return D.detectContext({ hostname: location.hostname, pathname: location.pathname, fields, headings });
  }

  /** Fill the settings from the page unless the user chose to set them by hand. */
  async function applyPageContext() {
    const ctx = pageContext();
    await store({ pageContext: Object.assign({ url: location.href, at: Date.now() }, ctx) });
    if (settings.auto === false) return ctx;
    const patch = {};
    if (ctx.destinationId) { patch.destinationId = ctx.destinationId; patch.destination = ctx.destination; }
    if (ctx.centre) patch.centre = ctx.centre;
    if (ctx.category) patch.category = ctx.category;
    if (Object.keys(patch).some(k => patch[k] !== settings[k])) await patchSettings(patch);
    return ctx;
  }

  // ---------- the booking you made ----------
  /** When the portal shows its confirmation page, record the appointment and stop watching. */
  async function checkBooking() {
    const text = (document.body.innerText || '').slice(0, 30000);
    const b = D.detectBooking(text);
    if (!b.booked) return false;
    const key = D.hash(`${location.host}|${b.reference}|${b.date}|${b.time}`);
    const summary = [b.date, b.time, b.reference].filter(Boolean).join(' · ');
    const { bookedSeen = [] } = await load('bookedSeen');
    if (bookedSeen.includes(key)) { setBadge('booked', 'Booked ✓', summary); return true; }   // already filed
    await store({ bookedSeen: [...bookedSeen, key].slice(-50) });
    const ctx = pageContext();
    stopTimer();
    highlightSlots(document.body, false);
    if (settings && settings.watching) await patchSettings({ watching: false, manualStopUrl: location.href });
    await send({ type: 'booked', booking: Object.assign({}, b, ctx, { url: location.href, at: Date.now() }), tabId: myTabId });
    setBadge('booked', 'Booked ✓', summary);
    banner('✅ Appointment booked', `${[b.date, b.time].filter(Boolean).join(' at ')}${b.reference ? `\nReference: ${b.reference}` : ''}\nSaved in the RDV Maroc dashboard. Watching stopped.`);
    await publishStatus({ state: 'booked', reasons: b.reasons, dates: b.date ? [b.date] : [] });
    return true;
  }

  // ---------- highlight what to click (we never click it ourselves) ----------
  function highlightSlots(area, on, scroll) {
    const want = new Set();
    if (on) {
      for (const c of collectDayCells(area).cells) want.add(c);
      for (const s of collectSlotOptions(area).filled) want.add(s);
    }
    // Only touch classes that change, otherwise our own edits retrigger the mutation observer.
    for (const el of document.querySelectorAll('.rdv-slot-day')) if (!want.has(el)) el.classList.remove('rdv-slot-day');
    for (const el of want) if (!el.classList.contains('rdv-slot-day')) el.classList.add('rdv-slot-day');
    if (scroll && want.size) {
      try { [...want][0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    }
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
      area,
      text: area.innerText || '',
      pageText: (document.body.innerText || '').slice(0, 20000),
      enabledDays: days.enabled,
      totalDays: days.total,
      optionCount: collectSlotOptions(area).count,
      captchaWidget: findCaptchaWidget(),
    };
  }

  // ---------- in-page HUD: live state, countdown ring, toasts, slot pop-up, tab title ----------
  // Everything here lives outside <body> (so our own updates never trigger the page observer) and
  // only acts on the extension: it never clicks, fills or submits anything on the portal.
  const hud = { lastState: null, checks: 0, slotsSeen: 0, lastCheckAt: 0, baseTitle: document.title, lastFull: document.title, expanded: false };
  const RING_LEN = 2 * Math.PI * 15.5;
  function ensureBadge() {
    let b = $('#rdv-maroc-badge');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'rdv-maroc-badge';
    b.innerHTML = `
      <div class="rdv-main">
        <span class="rdv-dot"></span>
        <svg class="rdv-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="rdv-ring-bg" cx="18" cy="18" r="15.5"/><circle class="rdv-ring-fg" cx="18" cy="18" r="15.5"/><text x="18" y="22.5" text-anchor="middle"></text></svg>
        <span class="rdv-text">RDV Maroc</span><span class="rdv-sub"></span>
        <button type="button" class="rdv-more" title="Details">▾</button>
      </div>
      <div class="rdv-details">
        <div class="rdv-meta"></div>
        <div class="rdv-actions">
          <button type="button" data-act="check">Check now</button>
          <button type="button" data-act="pause">Pause</button>
          <button type="button" data-act="resume">Resume</button>
          <button type="button" data-act="mute">Stop sound</button>
          <button type="button" data-act="dash">Dashboard</button>
        </div>
      </div>`;
    b.querySelector('.rdv-more').onclick = () => { hud.expanded = !hud.expanded; b.classList.toggle('rdv-open', hud.expanded); renderMeta(); };
    b.querySelector('.rdv-actions').onclick = e => { const act = e.target.dataset && e.target.dataset.act; if (act) hudAction(act); };
    document.documentElement.appendChild(b);
    return b;
  }
  const TOASTS = {
    none: (prev) => prev === 'available' ? ['warn', 'Slot gone – still watching'] : ['info', 'Watching · no slots yet'],
    unknown: () => ['info', 'Watching'],
    captcha: () => ['warn', 'Verification needed – your turn, I resume after'],
    login: () => ['warn', 'Logged out – log in again, I resume after'],
    booked: () => ['ok', 'Appointment booked ✓'],
  };
  function setBadge(state, text, sub) {
    const b = ensureBadge();
    b.dataset.state = state;
    b.classList.toggle('rdv-watching', !!(settings && settings.watching));
    b.querySelector('.rdv-text').textContent = text;
    b.querySelector('.rdv-sub').textContent = sub || '';
    if (state !== hud.lastState) {
      const watching = settings && settings.watching;
      if (watching && TOASTS[state] && (state !== 'unknown' || /Watching/.test(text))) {
        const [kind, msg] = TOASTS[state](hud.lastState);
        toast(kind, state === 'unknown' && sub === 'started automatically' ? 'Watching started by itself' : msg);
      } else if (TOASTS[state] && state !== 'none' && state !== 'unknown') {
        const [kind, msg] = TOASTS[state](hud.lastState);
        toast(kind, msg);
      }
      hud.lastState = state;
    }
    if (state === 'available') setTitle('🟢 SLOT!');
    else if (state === 'captcha' || state === 'login') setTitle('⚠ Needs you');
    else if (state === 'booked') setTitle('✅ Booked');
    else if (!(settings && settings.watching)) setTitle('');
    else if (!timer) setTitle('● Watching');
    renderMeta();
  }
  function renderMeta() {
    const b = $('#rdv-maroc-badge');
    if (!b || !hud.expanded) return;
    const who = hud.app ? `#${hud.app.num} ${[hud.app.applicant && hud.app.applicant.givenName, hud.app.applicant && hud.app.applicant.surname].filter(Boolean).join(' ') || ''}`.trim() : '';
    const bits = [
      [who, describeTarget()].filter(Boolean).join(' · '),
      `${hud.checks} check${hud.checks === 1 ? '' : 's'}${hud.lastCheckAt ? ` · last ${new Date(hud.lastCheckAt).toLocaleTimeString()}` : ''}`,
      settings && settings.autoRefresh ? `refresh every ${Math.max(D.MIN_INTERVAL, Number(settings.interval) || 90)} s` : 'auto-refresh off',
      hud.slotsSeen ? `${hud.slotsSeen} slot alert${hud.slotsSeen === 1 ? '' : 's'} this session` : '',
    ].filter(Boolean);
    b.querySelector('.rdv-meta').textContent = bits.join('\n');
  }
  function setRing(left, total) {
    const b = $('#rdv-maroc-badge');
    if (!b) return;
    const ring = b.querySelector('.rdv-ring');
    if (left == null) { ring.classList.remove('rdv-on'); return; }
    ring.classList.add('rdv-on');
    ring.querySelector('.rdv-ring-fg').style.strokeDashoffset = String(RING_LEN * (1 - Math.max(0, Math.min(1, left / total))));
    ring.querySelector('text').textContent = left;
  }
  /** Tab title prefix so the state shows from any other tab; the page's own title stays after it. */
  function setTitle(prefix) {
    if (document.title !== hud.lastFull) hud.baseTitle = document.title;   // the page changed its title
    const full = prefix ? `${prefix} – ${hud.baseTitle}` : hud.baseTitle;
    hud.lastFull = full;
    if (document.title !== full) document.title = full;
  }
  function toast(kind, text, { sticky = false, ms = 4500 } = {}) {
    let wrap = $('#rdv-maroc-toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'rdv-maroc-toasts'; document.documentElement.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = `rdv-toast rdv-${kind}`;
    t.textContent = text;
    wrap.prepend(t);
    while (wrap.children.length > 4) wrap.lastChild.remove();
    if (!sticky) setTimeout(() => { t.classList.add('rdv-out'); setTimeout(() => t.remove(), 300); }, ms);
    return t;
  }
  async function hudAction(act) {
    if (act === 'check') { settings = await readSettings(); toast('info', 'Checking…', { ms: 1500 }); await evaluate('manual'); }
    else if (act === 'pause') { await patchSettings({ watching: false, manualStopUrl: location.href, autoStarted: false }); toast('info', 'Paused – press Resume or Start'); requestStart(); }
    else if (act === 'resume') { lastFingerprint = null; lastAlertAt = 0; await saveAlertState(); await patchSettings({ watching: true, watchTabId: myTabId, manualStopUrl: '', autoStarted: false }); requestStart(); }
    else if (act === 'mute') { stopRinging(); if (audio) { try { audio.pause(); } catch (e) {} } toast('info', 'Sound stopped for this slot', { ms: 2500 }); }
    else if (act === 'dash') send({ type: 'openDashboard' });
  }

  /** The dashboard application this tab's alerts are filed under (for the copy strip). */
  async function linkedApplication() {
    const { applications = [] } = await load('applications');
    const app = applications.find(a => a.id === settings.activeAppId)
      || applications.find(a => a.destinationId && a.destinationId === settings.destinationId && (!settings.centre || !a.centre || a.centre === settings.centre) && a.status !== 'booked')
      || null;
    hud.app = app;
    return app;
  }
  const ddmmyyyy = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : (iso || '');

  // Sound repeats while the slot pop-up is up, so a slot found while you are away is not missed.
  let ringTimer = null, ringCount = 0;
  function startRinging() {
    stopRinging();
    if (!settings || !settings.sound) return;
    ringTimer = setInterval(() => { if (++ringCount > 4 || !$('#rdv-maroc-slot')) return stopRinging(); playSound(); }, 30000);
  }
  function stopRinging() { clearInterval(ringTimer); ringTimer = null; ringCount = 0; }

  function flashPage() {
    let f = $('#rdv-maroc-flash');
    if (!f) { f = document.createElement('div'); f.id = 'rdv-maroc-flash'; document.documentElement.appendChild(f); }
    clearTimeout(flashPage.t);
    flashPage.t = setTimeout(() => f.remove(), 8000);
  }
  /** Scroll to a free day and flash it. We point; the click is yours. */
  function showDay(dateIso) {
    const cells = collectDayCells(watchedArea()).cells;
    let target = cells[0] || collectSlotOptions(watchedArea()).filled[0];
    if (dateIso && cells.length) { const day = String(+dateIso.slice(8)); target = cells.find(c => c.textContent.trim() === day) || target; }
    if (!target) return;
    try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    target.classList.add('rdv-flash');
    setTimeout(() => target.classList.remove('rdv-flash'), 2400);
  }
  function closeSlotPopup() {
    const el = $('#rdv-maroc-slot');
    if (el) { clearInterval(el._tick); el.remove(); }
    stopRinging();
  }
  async function showSlotPopup(res, snap, where, fp) {
    closeSlotPopup();
    const el = document.createElement('div');
    el.id = 'rdv-maroc-slot';
    el.dataset.fp = fp;
    el.innerHTML = `
      <div class="rdv-s-head"><span class="rdv-s-live"></span><b>SLOT AVAILABLE</b><span class="rdv-s-ago">just now</span><button type="button" class="rdv-s-x" data-act="dismiss" title="Dismiss">×</button></div>
      <div class="rdv-s-where"></div>
      <div class="rdv-s-dates"></div>
      <div class="rdv-s-steps">1. Click a green day → 2. choose the time → 3. confirm. I never click for you.</div>
      <div class="rdv-s-copy"></div>
      <div class="rdv-s-actions"><button type="button" class="rdv-primary" data-act="show">Show me the day</button><button type="button" data-act="mute">Stop sound</button><button type="button" data-act="dismiss">Dismiss</button></div>`;
    el.querySelector('.rdv-s-where').textContent = where;
    const dd = el.querySelector('.rdv-s-dates');
    const dates = res.dates.slice(0, 8);
    if (dates.length) {
      for (const d of dates) { const c = document.createElement('button'); c.type = 'button'; c.className = 'rdv-chip'; c.textContent = d; c.title = 'Show this day'; c.onclick = () => showDay(d); dd.appendChild(c); }
    } else {
      dd.textContent = `${snap.enabledDays} free day(s) outlined in green` + (snap.optionCount ? ` · ${snap.optionCount} time slot(s) listed` : '');
    }
    const app = await linkedApplication();
    const strip = el.querySelector('.rdv-s-copy');
    const ap = app && app.applicant;
    if (ap && Object.keys(ap).length) {
      const fields = [['Passport', ap.passport], ['Surname', ap.surname], ['Given name', ap.givenName], ['Birth date', ddmmyyyy(ap.birthDate)], ['Passport expiry', ddmmyyyy(ap.passportExpiry)], ['Phone', ap.phone], ['Email', ap.email]].filter(f => f[1]);
      if (fields.length) {
        const lab = document.createElement('span'); lab.className = 'rdv-s-lab'; lab.textContent = 'For the form, one click:'; strip.appendChild(lab);
        for (const [k, v] of fields) {
          const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'rdv-copy'; btn.dataset.copy = v; btn.textContent = `${k}: ${v}`;
          btn.onclick = async () => { try { await navigator.clipboard.writeText(v); } catch (e) {} btn.classList.add('rdv-done'); setTimeout(() => btn.classList.remove('rdv-done'), 1200); };
          strip.appendChild(btn);
        }
      }
    } else if (app && app.applicantLocked) {
      strip.textContent = 'Details are locked with your passphrase: open the dashboard to copy them.';
    } else {
      strip.textContent = 'Tip: add your passport details in the dashboard and they appear here to copy.';
    }
    el.addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'show') showDay(dates[0]);
      else if (act === 'mute') hudAction('mute');
      else if (act === 'dismiss') closeSlotPopup();
    });
    const shownAt = Date.now();
    el._tick = setInterval(() => {
      const s = Math.round((Date.now() - shownAt) / 1000);
      const ago = el.querySelector('.rdv-s-ago');
      if (ago) ago.textContent = s < 60 ? `seen ${s}s ago` : `seen ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s ago`;
    }, 1000);
    document.documentElement.appendChild(el);
    flashPage();
    startRinging();
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
    hud.checks++; hud.lastCheckAt = Date.now();
    if (!hud.app) linkedApplication();

    if (res.state === 'captcha') {
      stopTimer();
      closeSlotPopup();
      highlightSlots(document.body, false);
      setBadge('captcha', 'Needs you', 'Solve the verification; I resume when the calendar is back');
      banner('RDV Maroc – your turn', 'The page is asking for a human check. Solve it yourself; I never fill these in. I start watching again as soon as the calendar shows.');
      await send({ type: 'notify', title: 'RDV Maroc: human check needed', body: 'Solve the verification on the portal. Watching resumes by itself afterwards.', urgent: false });
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
      closeSlotPopup();
      highlightSlots(document.body, false);
      setBadge('login', 'Logged out', 'Log in again and open the calendar; I resume by myself');
      banner('RDV Maroc – session ended', 'The portal sent you back to the login page. Log in again (I never store your password) and open the calendar; watching resumes on its own.');
      await send({ type: 'notify', title: 'RDV Maroc: session ended', body: 'Log in again and open the calendar. Watching resumes by itself.', urgent: false });
      await patchSettings({ watching: false });
      await publishStatus({ state: res.state, reasons: res.reasons, dates: [] });
      return;
    }

    if (res.state === 'available') {
      const changed = fp !== lastFingerprint;
      const repeatMs = (settings.repeatMinutes || 10) * 60000;
      const due = Date.now() - lastAlertAt > repeatMs;
      highlightSlots(snap.area, true, changed || due);
      if (changed || due) {
        lastFingerprint = fp;
        lastAlertAt = Date.now();
        hud.slotsSeen++;
        await saveAlertState();
        const where = describeTarget();
        const datesTxt = res.dates.length ? `Dates seen: ${res.dates.slice(0, 6).join(', ')}` : res.reasons.join(' · ');
        toast('ok', `SLOT AVAILABLE · ${where}`, { sticky: true });
        showSlotPopup(res, snap, where, fp);
        const r = await send({ type: 'slotFound', title: `RDV Maroc: slot at ${where}`, body: datesTxt, dates: res.dates, url: location.href, tabId: myTabId, sound: !!settings.sound });
        if (!r || !r.soundPlayed) playSound();
        await store({ lastHit: { at: Date.now(), where, dates: res.dates, reasons: res.reasons, url: location.href } });
      }
      setBadge('available', 'SLOT!', res.dates[0] ? `first: ${res.dates[0]}` : res.reasons[0]);
      // Keep refreshing so the badge stays accurate (settings.pauseOnHit stops the refresh instead).
      if (settings.pauseOnHit) { stopTimer(); await publishStatus({ state: res.state, reasons: res.reasons, dates: res.dates, paused: true }); return; }
    } else {
      // Only a page that says "no slots" clears the last alert. 'unknown' is usually an SPA calendar
      // that has not rendered yet after a refresh; forgetting the slot then would re-alert it.
      if (res.state === 'none' && lastFingerprint) {
        lastFingerprint = null; await saveAlertState();
        if (hud.lastState !== 'available') toast('warn', 'Slot gone – still watching');   // the transition happened across a refresh
      }
      highlightSlots(document.body, false);
      closeSlotPopup();
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
    setRing(null);
  }

  function scheduleReload() {
    stopTimer();
    if (!settings.autoRefresh) return;
    const secs = D.reloadDelaySeconds(settings.interval, Math.random());
    nextAt = Date.now() + secs * 1000;
    store({ nextAt });
    setRing(secs, secs);
    let warned = false;
    countdown = setInterval(() => {
      const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
      const b = $('#rdv-maroc-badge');
      setRing(left, secs);
      if (b && b.dataset.state !== 'available') {
        b.querySelector('.rdv-sub').textContent = `next refresh in ${left}s`;
        setTitle(`● ${left}s`);
      }
      if (left <= 3 && !warned) { warned = true; toast('info', 'Refreshing in 3 s…', { ms: 3200 }); }
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
  // Always on: while watching it re-checks the calendar; while idle it waits for a calendar
  // to appear so watching can start by itself (SPA portals render it after the page loads).
  function startObserver() {
    if (observer) return;
    let t = null;
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (await checkBooking()) return;
        if (settings && settings.watching) evaluate('mutation'); else tryAutoStart();
      }, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled'] });
  }
  function stopObserver() { if (observer) observer.disconnect(); observer = null; }

  // ---------- area picker ----------
  const CALENDAR_CONTAINER = '.ui-datepicker, mat-calendar, .mat-calendar, .k-calendar, .flatpickr-calendar, [class*="calendar" i], [class*="datepicker" i]';
  /** Clicking a single day (the natural thing to do) should select the whole calendar around it. */
  function pickTarget(el) {
    if (!el || !(el instanceof Element) || el.closest('[id^="rdv-maroc"]')) return null;
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
      banner('Area selected', 'I will watch only this part of the page.');
      if (settings.watching) await evaluate('manual'); else await tryAutoStart({ quiet: true });
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
      auto: true, autoStart: true, manualStopUrl: '',
    }, saved);
  }

  function watchedElsewhere() {
    return settings.watching && settings.watchTabId != null && myTabId != null && settings.watchTabId !== myTabId;
  }

  /** Start by itself when this tab shows a calendar: no button to press. */
  async function tryAutoStart(opts = {}) {
    settings = await readSettings();
    if (settings.watching || picking) return false;
    const idle = (state, text, sub) => { if (!opts.quiet) setBadge(state, text, sub); };   // quiet: keep the badge the caller set
    if (settings.autoStart === false) { idle('unknown', 'RDV Maroc', 'ready – press Start in the extension'); return false; }
    if (settings.manualStopUrl && settings.manualStopUrl === location.href) { idle('unknown', 'RDV Maroc', 'stopped – press Start to watch again'); return false; }
    const snap = snapshot();
    const res = D.classify(snap);
    const calendar = snap.totalDays >= 7 || snap.optionCount > 0 || res.state === 'available' || res.state === 'none';
    if (res.state === 'captcha') { idle('captcha', 'Needs you', 'solve the verification; I resume after'); return false; }
    if (res.state === 'login') { idle('login', 'Logged out', 'log in and open the calendar; I resume after'); return false; }
    // Only pages about appointments start by themselves; a form page with date pickers does not.
    // An area the user picked, or a real slot list, is trusted. Start in the popup always works.
    const pageWords = `${location.href} ${document.title} ${[...document.querySelectorAll('h1, h2, h3, h4, legend')].map(e => e.textContent).join(' ')}`;
    if (!settings.selector && !(snap.optionCount > 0) && !D.hasAppointmentVocabulary(pageWords)) {
      idle('unknown', 'RDV Maroc', 'waiting for an appointment calendar – press Start if this is it');
      return false;
    }
    if (!calendar) { idle('unknown', 'RDV Maroc', 'waiting for a calendar on this page'); return false; }
    await patchSettings({ watching: true, watchTabId: myTabId, autoStarted: true, manualStopUrl: '' });
    await store({ status: { state: 'unknown', at: Date.now(), tabId: myTabId, url: location.href } });
    await applyPageContext();
    hud.lastState = null;
    setBadge('unknown', 'Watching', 'started automatically');
    await loadAlertState();
    await evaluate('auto');
    return true;
  }

  async function start() {
    settings = await readSettings();
    if (await checkBooking()) { startObserver(); return; }
    if (watchedElsewhere()) {
      setBadge('unknown', 'RDV Maroc', 'watching another tab');
      stopObserver(); stopTimer();
      return;
    }
    if (!settings.watching) {
      stopTimer();
      closeSlotPopup();
      highlightSlots(document.body, false);
      startObserver();
      await tryAutoStart();
      return;
    }
    setBadge('unknown', 'Watching', 'checking…');
    await applyPageContext();
    await loadAlertState();
    startObserver();
    await evaluate('reload');
  }

  // Start / Stop pressed anywhere (popup, dashboard, another tab) lands in storage. Follow storage,
  // so a message that never arrives (the popup closed a moment too early) cannot leave this tab
  // watching when it should not be, or idle when it should watch. A start pressed while idle
  // re-arms the alert; our own writes and the duplicate message trigger are coalesced into one start.
  let startTimer = null;
  function requestStart() { clearTimeout(startTimer); startTimer = setTimeout(start, 80); }
  const WATCH_KEYS = ['watching', 'watchTabId', 'selector', 'interval', 'autoRefresh', 'autoStart', 'manualStopUrl', 'pauseOnHit'];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const n = changes.settings.newValue || {}, o = changes.settings.oldValue || {};
    if (JSON.stringify(n) === lastWritten) return;
    if (!WATCH_KEYS.some(k => n[k] !== o[k])) return;
    if (n.watching && !o.watching) { lastFingerprint = null; lastAlertAt = 0; saveAlertState(); }
    requestStart();
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    (async () => {
      if (msg.type === 'pickArea') { startPicking(); reply({ ok: true }); }
      else if (msg.type === 'settingsChanged') { requestStart(); reply({ ok: true }); }
      else if (msg.type === 'checkNow') { settings = await readSettings(); await evaluate('manual'); reply({ ok: true }); }
      else if (msg.type === 'ping') reply({ ok: true, url: location.href, tabId: myTabId });
      else if (msg.type === 'pageContext') { settings = await readSettings(); reply({ ok: true, context: await applyPageContext() }); }
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
