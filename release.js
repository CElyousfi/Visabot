/* release.js — when each BLS centre in Morocco releases its appointment slots, and the countdown
 * to the next one. Pure functions, shared by popup, HUD, dashboard, background and the tests.
 *
 * Source: BLS Spain Morocco's own centre pages (blsspainmorocco.com/<centre>/, read 27 Oct 2026) and
 * the Nador consulate's appointment page; Tétouan only from third-party guides. Times are Moroccan local time
 * (Africa/Casablanca). "line" names who the release is for. Entries without a time are shown as
 * "time not published" and never scheduled. Confirm on the consulate's own page before relying on it. */
(function (root) {
  'use strict';

  const TZ = 'Africa/Casablanca';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* day: 0 = Sunday … 6 = Saturday. time: "HH:MM" local, or null when not published.
   * verified: 'bls' = read on blsspainmorocco.com's own centre page (27 Oct 2026); 'secondary' = only
   * relayed by third-party guides; 'none' = nothing published. */
  const RELEASES = [
    { dest: 'spain', centre: 'Casablanca', day: 0, time: '10:00', line: 'All applicants (CASA-1..4)', verified: 'bls' },
    { dest: 'spain', centre: 'Rabat',      day: 6, time: '13:00', line: 'All applicants (weekly quota)', verified: 'bls' },
    { dest: 'spain', centre: 'Rabat',      day: 3, time: '16:00', line: 'Prior Schengen visa, valid under 1 year, issued since 2023', verified: 'bls' },
    { dest: 'spain', centre: 'Rabat',      day: 2, time: '17:00', line: 'Non-university students (language / vocational courses)', verified: 'bls' },
    { dest: 'spain', centre: 'Nador',      day: 6, time: '10:00', line: 'All applicants (Nador consulate jurisdiction)', verified: 'bls' },
    { dest: 'spain', centre: 'Tétouan',    day: 6, time: '10:00', line: 'All applicants – not confirmed on the BLS page', verified: 'secondary' },
    { dest: 'spain', centre: 'Tanger',     day: 1, time: null,    line: 'Opened weekly every Monday – time not published', verified: 'bls' },
    { dest: 'spain', centre: 'Agadir',     day: null, time: null, line: 'Release day not published', verified: 'none' },
  ];

  /* Lines that may not need an online slot. BLS's own pages contradict themselves on several of these
   * (one section allows walk-ins, another says nobody enters without an appointment), so each is a
   * "check with the centre" hint, never a promise. Quoted from blsspainmorocco.com on 27 Oct 2026. */
  const WALK_INS = [
    { dest: 'spain', centre: 'Rabat', hours: 'Mon–Fri 9:00–11:00 (weekly quota)', who: 'last Schengen visa of 1 year or more, issued within 4 years; university students and EU-citizen family are listed with 8:00–10:00 on the same page – confirm with BLS' },
    { dest: 'spain', centre: 'Casablanca', hours: 'Mon–Fri 9:00–12:00', who: 'CASA-3 only (last visa a 1-year Schengen visa issued from 01-01-2022), "subject to the volume of applications each day" – another notice on the same page says no entry without an appointment, so confirm first' },
    { dest: 'spain', centre: 'Tanger', hours: 'Mon–Thu 9:00–12:00 (Fri for visas over 3 years)', who: 'last visa valid at least 180 days within the last year, or over 1 year within the last 4 years; daily quota' },
    { dest: 'spain', centre: 'Nador', hours: 'Fri 10:00–12:00', who: 'renewals: Schengen visa holders whose visa expired or expires within 3 months; depends on each Friday\'s volume' },
  ];

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

  /** Wall-clock parts of an instant in the Moroccan time zone. */
  function partsIn(date, tz = TZ) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {};
    for (const p of f.formatToParts(date)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, ss: +o.second, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
  }

  /** The instant at which the Moroccan wall clock reads y-m-d hh:mm (handles the Ramadan UTC+0 switch). */
  function zoned(y, m, d, hh, mm, tz = TZ) {
    let guess = Date.UTC(y, m - 1, d, hh, mm, 0);
    for (let i = 0; i < 3; i++) {                       // converge on the offset in force at that moment
      const p = partsIn(new Date(guess), tz);
      const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
      const diff = Date.UTC(y, m - 1, d, hh, mm, 0) - asUtc;
      if (diff === 0) break;
      guess += diff;
    }
    return new Date(guess);
  }

  /** Release rules for a destination + centre (centre match ignores accents and case). */
  function rulesFor(dest, centre) {
    const c = norm(centre);
    return RELEASES.filter(r => r.dest === dest && norm(r.centre) === c);
  }

  /**
   * Upcoming releases for a centre, soonest first, each { at: Date, rule, dayName, time, line }.
   * Rules without a published time are returned once with at = null, after the scheduled ones.
   */
  function upcoming(dest, centre, now = new Date(), count = 3) {
    const out = [];
    const p = partsIn(now);
    for (const rule of rulesFor(dest, centre)) {
      if (rule.day == null || !rule.time) { out.push({ at: null, rule, dayName: rule.day == null ? null : DAYS[rule.day], time: null, line: rule.line, verified: rule.verified }); continue; }
      const [hh, mm] = rule.time.split(':').map(Number);
      for (let add = 0; add < 8; add++) {
        const base = new Date(Date.UTC(p.y, p.m - 1, p.d + add));
        const bp = partsIn(base, 'UTC');
        const wd = base.getUTCDay();
        if (wd !== rule.day) continue;
        const at = zoned(bp.y, bp.m, bp.d, hh, mm);
        if (at.getTime() > now.getTime()) { out.push({ at, rule, dayName: DAYS[rule.day], time: rule.time, line: rule.line, verified: rule.verified }); break; }
      }
    }
    out.sort((a, b) => (a.at ? a.at.getTime() : Infinity) - (b.at ? b.at.getTime() : Infinity));
    return out.slice(0, count);
  }

  function next(dest, centre, now = new Date()) {
    return upcoming(dest, centre, now, 5).find(r => r.at) || upcoming(dest, centre, now, 1)[0] || null;
  }

  /** "4d 05:21:33", "05:21:33", "00:00:09"; negative → "now". */
  function countdown(ms) {
    if (ms <= 0) return 'now';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${d ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  /** Short human form for notifications: "in 4 days", "in 2 h 10 min", "in 12 min", "now". */
  function relative(ms) {
    if (ms <= 0) return 'now';
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
    const d = Math.round(h / 24);
    return `in ${d} day${d === 1 ? '' : 's'}`;
  }

  /** What to have done before the release minute. Each item: id, label, state 'ok' | 'todo' | 'unknown'. */
  function checklist({ readiness, pageContext, status, now = Date.now() } = {}) {
    const items = [];
    const r = readiness && readiness.state;
    items.push({ id: 'form', label: 'Applicant form completed on the portal (Manage Appointments must not say "Not Completed")',
      state: r === 'complete' ? 'ok' : r === 'incomplete' ? 'todo' : 'unknown' });
    const fresh = pageContext && pageContext.at && now - pageContext.at < 30 * 60000;
    const loggedIn = fresh && status && status.state !== 'login' && !/login|logincaptcha/i.test(pageContext.url || '');
    items.push({ id: 'login', label: 'Logged in to the portal (verification passed by you)', state: loggedIn ? 'ok' : fresh ? 'todo' : 'unknown' });
    const onVisaType = fresh && /VisaType/i.test(pageContext.url || '');
    const onSlots = fresh && /newappointment|slotselection|appointment\/new/i.test(pageContext.url || '');
    items.push({ id: 'position', label: 'In position: on "Visa Type Selection" with location, type, sub-type and category chosen',
      state: onVisaType || onSlots ? 'ok' : fresh ? 'todo' : 'unknown' });
    items.push({ id: 'details', label: 'Your details saved in the dashboard (one-click fill at booking)', state: pageContext && pageContext.hasApplicant ? 'ok' : 'unknown' });
    return items;
  }

  const api = { TZ, DAYS, RELEASES, WALK_INS, rulesFor, upcoming, next, countdown, relative, checklist, zoned, partsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RDVRelease = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
