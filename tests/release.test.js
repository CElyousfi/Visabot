/* Unit tests for release.js (slot release schedule and countdown). Run: npm run test:unit */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../release.js');

// Tuesday 27 Oct 2026, 03:40 in Casablanca (UTC+0 per current tz data).
const NOW = new Date('2026-10-27T03:40:00Z');

test('Casablanca: next release is Sunday 1 Nov 2026 at 10:00 Casablanca time', () => {
  const n = R.next('spain', 'Casablanca', NOW);
  assert.equal(n.dayName, 'Sunday');
  assert.equal(n.time, '10:00');
  assert.equal(R.partsIn(n.at).hh, 10);
  assert.equal(R.partsIn(n.at).d, 1);
  assert.equal(R.partsIn(n.at).m, 11);
});

test('Rabat: three lines, soonest first (Tue 17:00 students today, Wed 16:00 prior visa, Sat 13:00 all)', () => {
  const u = R.upcoming('spain', 'Rabat', NOW, 3);
  assert.deepEqual(u.map(x => `${x.dayName} ${x.time}`), ['Tuesday 17:00', 'Wednesday 16:00', 'Saturday 13:00']);
  assert.equal(R.partsIn(u[0].at).d, 27);          // later today
});

test('a release earlier today is skipped for next week', () => {
  const tue18 = new Date('2026-10-27T17:30:00Z');  // 18:30 Casablanca, after the 17:00 students line
  const u = R.upcoming('spain', 'Rabat', tue18, 3);
  assert.equal(u[0].dayName, 'Wednesday');
  const nextTue = u.find(x => x.dayName === 'Tuesday');
  assert.equal(R.partsIn(nextTue.at).d, 3);         // the students line moved to Tuesday 3 Nov
  assert.equal(R.partsIn(nextTue.at).m, 11);
});

test('centre matching ignores accents and case', () => {
  assert.equal(R.next('spain', 'tetouan', NOW).time, '10:00');
  assert.equal(R.next('spain', 'TÉTOUAN', NOW).dayName, 'Saturday');
});

test('Tanger has a day but no time; Agadir has neither; VFS centres have nothing', () => {
  const t = R.next('spain', 'Tanger', NOW);
  assert.equal(t.at, null); assert.equal(t.dayName, 'Monday');
  const a = R.next('spain', 'Agadir', NOW);
  assert.equal(a.at, null); assert.equal(a.dayName, null);
  assert.equal(R.next('italy', 'Rabat', NOW), null);
});

test('countdown and relative formats', () => {
  assert.equal(R.countdown(0), 'now');
  assert.equal(R.countdown(9000), '00:00:09');
  assert.equal(R.countdown((5 * 3600 + 21 * 60 + 33) * 1000), '05:21:33');
  assert.equal(R.countdown((4 * 86400 + 5 * 3600 + 21 * 60 + 33) * 1000), '4d 05:21:33');
  assert.equal(R.relative(12 * 60000), 'in 12 min');
  assert.equal(R.relative(130 * 60000), 'in 2 h 10 min');
  assert.equal(R.relative(4 * 86400000), 'in 4 days');
});

test('zoned() always lands on the Moroccan wall clock, whatever offset is in force', () => {
  // The offset comes from the time-zone database, never hard-coded: Morocco has used UTC+1 with a
  // UTC+0 period during Ramadan, and the current tz data has it on UTC+0 in autumn 2026.
  for (const [y, m, d] of [[2026, 11, 1], [2026, 3, 1], [2025, 11, 1], [2025, 3, 10]]) {
    const p = R.partsIn(R.zoned(y, m, d, 10, 0));
    assert.deepEqual([p.y, p.m, p.d, p.hh, p.mm], [y, m, d, 10, 0]);
  }
  // A known UTC+1 moment: 1 Nov 2025 10:00 Casablanca was 09:00Z.
  assert.equal(R.zoned(2025, 11, 1, 10, 0).toISOString(), '2025-11-01T09:00:00.000Z');
});

test('checklist reads readiness and the last portal page', () => {
  const now = Date.now();
  const c = R.checklist({ readiness: { state: 'incomplete' }, pageContext: { url: 'https://www.blsspainmorocco.net/MAR/Appointment/VisaType?data=x', at: now - 1000, hasApplicant: true }, status: { state: 'none' }, now });
  assert.deepEqual(c.map(i => i.state), ['todo', 'ok', 'ok', 'ok']);
  const stale = R.checklist({ readiness: { state: 'complete' }, pageContext: { url: 'https://www.blsspainmorocco.net/MAR/home', at: now - 3 * 3600000 }, status: {}, now });
  assert.deepEqual(stale.map(i => i.state), ['ok', 'unknown', 'unknown', 'unknown']);
  const login = R.checklist({ readiness: null, pageContext: { url: 'https://www.blsspainmorocco.net/MAR/account/login', at: now }, status: { state: 'login' }, now });
  assert.deepEqual(login.map(i => i.state), ['unknown', 'todo', 'todo', 'unknown']);
});

test('parseReleaseText reads the exact sentences on BLS centre pages, in EN / ES / FR', () => {
  const cases = [
    ['appointments for Schengen and national visas for Casablanca will be available on our website every Sunday at 10 am.', [[0, '10:00']]],
    ['Appointments for the Rabat Centre will be released. EVERY SATURDAY, AT 01:00 PM Until the weekly quota is exhausted.', [[6, '13:00']]],
    ['Appointments open every Wednesday at 4:00 PM via the Rabat booking page.', [[3, '16:00']]],
    ['Appointments for this category open every Tuesday at 5:00 p.m.', [[2, '17:00']]],
    ['Appointments are released on the website: Every Saturday at 10:00 AM until the weekly quota is exhausted.', [[6, '10:00']]],
    ['Appointments will be opened weekly every Monday on the BLS website.', [[1, null]]],
    ['las citas para NADOR estarán disponibles todos los sábados a las 10 a. m', [[6, '10:00']]],
    ['Les rendez-vous seront disponibles tous les dimanches à 10h sur notre site.', [[0, '10:00']]],
    ['Our office is open Monday to Friday from 8 am to 1 pm. Walk-ins Monday to Thursday 09:00 to 12:00.', []],
  ];
  for (const [text, want] of cases) assert.deepEqual(R.parseReleaseText(text).map(o => [o.day, o.time]), want, text);
});

test('effectiveRules follows a fresh page reading and reports differences', () => {
  const now = Date.now();
  const fresh = { at: now - 3600000, url: 'https://blsspainmorocco.com/casablanca/', found: [{ day: 0, time: '11:00', sentence: 'x' }] };
  const e = R.effectiveRules('spain', 'Casablanca', fresh, now);
  assert.equal(e.source, 'live');
  assert.equal(e.rules[0].time, '11:00');
  assert.deepEqual(e.diffs.map(d => d.kind), ['time-changed']);
  const same = R.effectiveRules('spain', 'Casablanca', { at: now, found: [{ day: 0, time: '10:00' }] }, now);
  assert.equal(same.diffs.length, 0);
  const stale = R.effectiveRules('spain', 'Casablanca', { at: now - 20 * 86400000, found: [{ day: 0, time: '11:00' }] }, now);
  assert.equal(stale.source, 'built-in'); assert.equal(stale.rules[0].time, '10:00');
  const none = R.effectiveRules('spain', 'Casablanca', null, now);
  assert.equal(none.source, 'built-in'); assert.equal(none.fresh, false);
  // Rabat: the page shows two of the three lines → the third is reported missing, countdown uses the page's two
  const rabat = R.effectiveRules('spain', 'Rabat', { at: now, found: [{ day: 6, time: '13:00' }, { day: 3, time: '16:00' }] }, now);
  assert.equal(rabat.rules.length, 2);
  assert.deepEqual(rabat.diffs.map(d => [d.kind, d.rule.day]), [['missing-on-page', 2]]);
});

test('centre page URL and path mapping', () => {
  assert.equal(R.centrePageUrl('spain', 'Tanger'), 'https://blsspainmorocco.com/tangier/');
  assert.equal(R.centrePageUrl('spain', 'Tétouan'), 'https://blsspainmorocco.com/tetouan/');
  assert.equal(R.centrePageUrl('italy', 'Rabat'), null);
  assert.equal(R.centreFromPath('blsspainmorocco.com', '/tangier/'), 'Tanger');
  assert.equal(R.centreFromPath('www.blsspainmorocco.com', '/rabat/french/'), 'Rabat');
  assert.equal(R.centreFromPath('www.blsspainmorocco.net', '/MAR/appointment/newappointment'), null);
});
