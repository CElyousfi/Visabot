/* Unit tests for detect.js (pure detection rules). Run: npm run test:unit */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../detect.js');

const snap = (o) => Object.assign({ text: '', pageText: '', enabledDays: 0, totalDays: 0, optionCount: 0 }, o);

test('no-slot phrases in FR / EN / ES / AR give "none"', () => {
  for (const text of [
    'Aucun rendez-vous disponible pour le moment',
    'No appointment slots are currently available',
    'No hay citas disponibles',
    'لا توجد مواعيد متاحة حاليا',
    'Pas de créneau. Veuillez réessayer.',
  ]) {
    assert.equal(D.classify(snap({ text, totalDays: 30 })).state, 'none', text);
  }
});

test('a negative phrase does not leak into a positive match', () => {
  // "aucun rendez-vous disponible" contains "rendez-vous disponible"
  assert.equal(D.classify(snap({ text: 'aucun rendez-vous disponible' })).state, 'none');
  assert.equal(D.classify(snap({ text: 'Pas de disponibilités ce mois-ci' })).state, 'none');
});

test('selectable calendar days mean "available", even beside a no-slot phrase', () => {
  const r = D.classify(snap({ text: 'Sélectionnez une date. Not available days are greyed.', enabledDays: 2, totalDays: 30 }));
  assert.equal(r.state, 'available');
  assert.match(r.reasons[0], /2 selectable day/);
});

test('slot list options mean "available"', () => {
  assert.equal(D.classify(snap({ text: 'Choose a slot', optionCount: 3 })).state, 'available');
});

test('positive phrases alone mean "available"', () => {
  const r = D.classify(snap({ text: 'Earliest available slot for Tourism is : 12/11/2026' }));
  assert.equal(r.state, 'available');
  assert.deepEqual(r.dates, ['2026-11-12']);
});

test('empty calendar with no vocabulary is "unknown"', () => {
  assert.equal(D.classify(snap({ text: 'Appointment Date', totalDays: 31 })).state, 'unknown');
});

test('verification text on the page gives "captcha" and wins over everything', () => {
  for (const pageText of ['Just a moment...', 'Checking your browser before accessing', 'Please verify you are human', 'Enter the CAPTCHA']) {
    assert.equal(D.classify(snap({ text: 'slots available', pageText, enabledDays: 4 })).state, 'captcha', pageText);
  }
});

test('a visible captcha widget (no text) gives "captcha"', () => {
  const r = D.classify(snap({ text: 'Appointment Date', pageText: 'Appointment Date', captchaWidget: 'iframe[src*="recaptcha"]' }));
  assert.equal(r.state, 'captcha');
});

test('login page gives "login"', () => {
  assert.equal(D.classify(snap({ text: 'Sign in. Email. Password. Forgot password?' })).state, 'login');
  assert.equal(D.classify(snap({ text: 'Se connecter – mot de passe oublié' })).state, 'login');
});

test('a calendar page with a "Login" link in the header is not a login page', () => {
  assert.equal(D.classify(snap({ text: 'Login | Appointment Date', totalDays: 31 })).state, 'unknown');
  assert.equal(D.classify(snap({ text: 'Login | No slots available', totalDays: 31 })).state, 'none');
});

test('extractDates handles numeric and FR / EN / ES month names', () => {
  assert.deepEqual(D.extractDates('le 3/2/2027 ou 2027-02-05'), ['2027-02-03', '2027-02-05']);
  assert.deepEqual(D.extractDates('12 novembre 2026, 1st December 2026, 7 enero 2027'), ['2026-11-12', '2026-12-01', '2027-01-07']);
  assert.deepEqual(D.extractDates('14 févr. 2027 et 2 août 2027'), ['2027-02-14', '2027-08-02']);
  assert.deepEqual(D.extractDates('32/01/2026 and 10/13/2026'), []);
});

test('reload delay honours the interval, ±15 % jitter, never under 60 s', () => {
  assert.equal(D.reloadDelaySeconds(60, 0), 60);       // jitter all the way down
  assert.equal(D.reloadDelaySeconds(60, 0.999), 69);
  assert.equal(D.reloadDelaySeconds(30, 0), 60);       // below the minimum
  assert.equal(D.reloadDelaySeconds(undefined, 0.5), 90);
  for (const iv of [60, 90, 120, 600]) {
    for (let i = 0; i < 2000; i++) {
      const s = D.reloadDelaySeconds(iv, Math.random());
      assert.ok(s >= 60 && s >= Math.floor(iv * 0.85) && s <= Math.ceil(iv * 1.15), `${iv} → ${s}`);
    }
  }
});

test('hash is stable and changes with input', () => {
  assert.equal(D.hash('available|2026-11-12|3|0'), D.hash('available|2026-11-12|3|0'));
  assert.notEqual(D.hash('available|2026-11-12|3|0'), D.hash('available|2026-11-12|4|0'));
});
