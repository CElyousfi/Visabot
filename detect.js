/* detect.js — slot detection heuristics shared by the content script and tests.
 * Pure functions only: no DOM access, no browser APIs. */
(function (root) {
  'use strict';

  // Phrases that mean "nothing available". French, English, Spanish, Arabic.
  const NO_SLOT_PHRASES = [
    'no appointment', 'no appointments', 'no slots', 'no slot available',
    'no dates available', 'currently no', 'not available', 'no available',
    'aucun rendez-vous', 'aucun créneau', 'aucune date', 'pas de rendez-vous',
    'pas de créneau', 'pas de disponibilité', 'indisponible', 'complet',
    'no hay citas', 'no hay cita', 'sin citas', 'no disponible',
    'لا توجد مواعيد', 'لا يوجد موعد', 'غير متاح', 'غير متوفر',
    'earliest available appointment date is not available',
    'all slots are booked', 'fully booked', 'try again later',
  ];

  // Phrases that mean "available". Only trusted when no NO_SLOT phrase is present.
  const SLOT_PHRASES = [
    'slots available', 'slot available', 'appointments available',
    'appointment available', 'available appointments', 'available slots',
    'earliest available', 'select a time', 'select time slot', 'choose a time',
    'créneaux disponibles', 'créneau disponible', 'rendez-vous disponible',
    'disponibilités', 'choisir un créneau', 'sélectionnez un créneau',
    'citas disponibles', 'cita disponible', 'horarios disponibles',
    'مواعيد متاحة', 'موعد متاح', 'اختر الوقت',
  ];

  // Signs the page is asking for a human (never auto-solved; we pause and tell the user).
  const CAPTCHA_MARKERS = [
    'captcha', 'g-recaptcha', 'h-captcha', 'cf-turnstile', 'cf-challenge',
    'verify you are human', 'checking your browser', 'just a moment',
    'prouvez que vous êtes humain', 'verifica que eres humano',
  ];

  // Signs the session dropped back to a login page.
  const LOGIN_MARKERS = [
    'sign in', 'log in', 'login', 'se connecter', 'connexion', 'identifiant',
    'iniciar sesión', 'forgot password', 'mot de passe oublié',
  ];

  function norm(text) {
    return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function containsAny(text, phrases) {
    const t = norm(text);
    return phrases.filter(p => t.includes(p));
  }

  function isoDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /**
   * Extract candidate dates mentioned in text. Accepts DD/MM/YYYY, DD-MM-YYYY,
   * YYYY-MM-DD, and "12 novembre 2026" style in FR/EN/ES.
   * Returns ISO strings, deduplicated and sorted.
   */
  function extractDates(text) {
    const t = (text || '');
    const out = new Set();
    let m;

    const dmy = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
    while ((m = dmy.exec(t))) {
      const d = +m[1], mo = +m[2], y = +m[3];
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.add(isoDate(y, mo, d));
    }

    const ymd = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = ymd.exec(t))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.add(isoDate(y, mo, d));
    }

    const months = {
      jan: 1, janv: 1, january: 1, janvier: 1, enero: 1, ene: 1,
      feb: 2, fév: 2, fev: 2, févr: 2, fevr: 2, february: 2, février: 2, fevrier: 2, febrero: 2,
      mar: 3, march: 3, mars: 3, marzo: 3,
      apr: 4, avr: 4, april: 4, avril: 4, abril: 4, abr: 4,
      may: 5, mai: 5, mayo: 5,
      jun: 6, juin: 6, june: 6, junio: 6,
      jul: 7, juil: 7, july: 7, juillet: 7, julio: 7,
      aug: 8, août: 8, aout: 8, august: 8, agosto: 8, ago: 8,
      sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9,
      oct: 10, october: 10, octobre: 10, octubre: 10,
      nov: 11, november: 11, novembre: 11, noviembre: 11,
      dec: 12, déc: 12, december: 12, décembre: 12, decembre: 12, diciembre: 12, dic: 12,
    };
    const words = /\b(\d{1,2})(?:er|st|nd|rd|th)?\s+([a-zéû]+)\.?\s+(\d{4})\b/gi;
    while ((m = words.exec(t))) {
      const mo = months[m[2].toLowerCase()];
      const d = +m[1];
      if (mo && d >= 1 && d <= 31) out.add(isoDate(+m[3], mo, d));
    }
    return [...out].sort();
  }

  /**
   * Classify a snapshot of the watched area.
   * @param {object} snap
   *   text        – visible text of the watched area
   *   pageText    – visible text of the whole page (for captcha/login detection)
   *   enabledDays – number of calendar day cells that look clickable/enabled
   *   totalDays   – number of calendar day cells seen
   *   optionCount – number of non-placeholder <option>s in slot/date selects
   *   captchaWidget – selector of a visible verification widget on the page, if any
   * @returns {{state:string, reasons:string[], dates:string[]}}
   *   state ∈ 'captcha' | 'login' | 'available' | 'none' | 'unknown'
   */
  function classify(snap) {
    const reasons = [];
    const page = snap.pageText || snap.text || '';

    if (snap.captchaWidget) return { state: 'captcha', reasons: [`verification widget: ${snap.captchaWidget}`], dates: [] };
    const cap = containsAny(page, CAPTCHA_MARKERS);
    if (cap.length) return { state: 'captcha', reasons: cap, dates: [] };

    const text = snap.text || '';
    const no = containsAny(text, NO_SLOT_PHRASES);
    // Remove the negative phrases first so "aucun rendez-vous disponible"
    // cannot also match "rendez-vous disponible".
    let positiveText = norm(text);
    for (const p of no) positiveText = positiveText.split(p).join(' ');
    const yes = containsAny(positiveText, SLOT_PHRASES);
    const dates = extractDates(text);

    // A login page has login words and none of the appointment vocabulary.
    const login = containsAny(page, LOGIN_MARKERS);
    if (login.length && !yes.length && !no.length && !(snap.totalDays > 0) && !(snap.optionCount > 0)) {
      return { state: 'login', reasons: login, dates: [] };
    }

    if (no.length && !yes.length && !(snap.enabledDays > 0) && !(snap.optionCount > 0)) {
      return { state: 'none', reasons: no, dates: [] };
    }

    if (snap.enabledDays > 0) reasons.push(`${snap.enabledDays} selectable day(s) in calendar`);
    if (snap.optionCount > 0) reasons.push(`${snap.optionCount} option(s) in a slot list`);
    if (yes.length) reasons.push(...yes);

    if (reasons.length) return { state: 'available', reasons, dates };

    if (no.length) return { state: 'none', reasons: no, dates: [] };
    // A recognisable calendar (a week or more of day cells) with nothing selectable is "no slots".
    if (snap.totalDays >= 7) return { state: 'none', reasons: [`${snap.totalDays} day(s) in calendar, none selectable`], dates: [] };
    return { state: 'unknown', reasons: [], dates };
  }

  /** Cheap stable hash of a string, for change detection. */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  const MIN_INTERVAL = 60;          // seconds — keep it human-like
  const JITTER = 0.15;              // ±15 % so refreshes are not metronomic

  /** Seconds until the next refresh. `rand` ∈ [0, 1). The jitter never goes under the minimum. */
  function reloadDelaySeconds(interval, rand) {
    const base = Math.max(MIN_INTERVAL, Number(interval) || 90);
    const jitter = base * JITTER * (rand * 2 - 1);
    return Math.max(MIN_INTERVAL, Math.round(base + jitter));
  }

  const api = { classify, extractDates, hash, norm, reloadDelaySeconds, MIN_INTERVAL, NO_SLOT_PHRASES, SLOT_PHRASES, CAPTCHA_MARKERS, LOGIN_MARKERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RDVDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
