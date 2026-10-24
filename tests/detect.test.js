const assert = require('assert');
const D = require('../detect.js');

const cases = [
  ['BLS: no slots FR', { text: 'Calendrier\nAucun rendez-vous disponible pour le moment. Veuillez réessayer plus tard.', enabledDays: 0, totalDays: 30 }, 'none'],
  ['BLS: no slots EN', { text: 'Currently no slots are available for the selected category', enabledDays: 0, totalDays: 0 }, 'none'],
  ['VFS: earliest date', { text: 'Earliest available appointment date: 12/11/2026. Select a time slot', enabledDays: 0, totalDays: 0 }, 'available'],
  ['VFS: no dates', { text: 'No appointment slots are currently available for the selected category. Please try again later.', enabledDays: 0, totalDays: 31 }, 'none'],
  ['Calendar with enabled days', { text: 'Novembre 2026\n1 2 3 4 5 6 7 8 9 10', enabledDays: 3, totalDays: 30 }, 'available'],
  ['Calendar all disabled', { text: 'Novembre 2026\n1 2 3 4 5 6 7 8 9 10', enabledDays: 0, totalDays: 30 }, 'unknown'],
  ['Slot select populated', { text: 'Choisir un créneau', optionCount: 4 }, 'available'],
  ['Cloudflare challenge', { text: '', pageText: 'Just a moment... Checking your browser before accessing blsspainmorocco.com', enabledDays: 0 }, 'captcha'],
  ['Captcha widget', { text: 'Enter the captcha', pageText: 'Enter the text shown in the captcha image', enabledDays: 0 }, 'captcha'],
  ['Login page', { text: '', pageText: 'Sign in\nEmail\nPassword\nForgot password?', enabledDays: 0, totalDays: 0 }, 'login'],
  ['Login words but calendar present', { text: 'Aucun créneau disponible', pageText: 'Log out\nAucun créneau disponible', enabledDays: 0, totalDays: 30 }, 'none'],
  ['Spanish no cita', { text: 'No hay citas disponibles', enabledDays: 0 }, 'none'],
  ['Arabic available', { text: 'مواعيد متاحة: 2026-12-03', enabledDays: 0 }, 'available'],
  ['Mixed: available wins over generic not available', { text: 'Slots available. Some dates not available.', enabledDays: 2 }, 'available'],
];

let fail = 0;
for (const [name, snap, want] of cases) {
  const got = D.classify(snap);
  const ok = got.state === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} → ${got.state}${ok ? '' : ` (wanted ${want})`} ${got.dates.length ? got.dates.join(',') : ''}`);
}

assert.deepStrictEqual(D.extractDates('12/11/2026 and 2026-12-03 and 5 décembre 2026, 1st January 2027'), ['2026-11-12', '2026-12-03', '2026-12-05', '2027-01-01']);
assert.strictEqual(D.extractDates('32/13/2026').length, 0);
console.log('PASS  extractDates');
assert.strictEqual(D.hash('a'), D.hash('a'));
assert.notStrictEqual(D.hash('a'), D.hash('b'));
console.log('PASS  hash');

if (fail) { console.error(`${fail} failing`); process.exit(1); }
console.log('All detection tests passed');
