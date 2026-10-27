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
