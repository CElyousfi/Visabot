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

test('page with no calendar and no vocabulary is "unknown"', () => {
  assert.equal(D.classify(snap({ text: 'Appointment Date' })).state, 'unknown');
  assert.equal(D.classify(snap({ text: 'Appointment Date', totalDays: 3 })).state, 'unknown');
});

test('a calendar where no day is selectable is "none"', () => {
  const r = D.classify(snap({ text: 'Appointment Date November 2026', totalDays: 30 }));
  assert.equal(r.state, 'none');
  assert.match(r.reasons[0], /30 day\(s\) in calendar, none selectable/);
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
  assert.equal(D.classify(snap({ text: 'Login | Appointment Date', totalDays: 31, enabledDays: 1 })).state, 'available');
  assert.equal(D.classify(snap({ text: 'Login | No slots available', totalDays: 31 })).state, 'none');
});

test('cases from the original suite still hold', () => {
  assert.equal(D.classify(snap({ text: 'Currently no slots are available for the selected category' })).state, 'none');
  assert.equal(D.classify(snap({ text: 'Earliest available appointment date: 12/11/2026. Select a time slot' })).state, 'available');
  // "Log out" in the page header while the calendar says no slots.
  assert.equal(D.classify(snap({ text: 'Aucun créneau disponible', pageText: 'Log out\nAucun créneau disponible', totalDays: 30 })).state, 'none');
  const ar = D.classify(snap({ text: 'مواعيد متاحة: 2026-12-03' }));
  assert.equal(ar.state, 'available');
  assert.deepEqual(ar.dates, ['2026-12-03']);
  assert.equal(D.classify(snap({ text: 'Slots available. Some dates not available.', enabledDays: 2 })).state, 'available');
  assert.deepEqual(D.extractDates('12/11/2026 and 2026-12-03 and 5 décembre 2026, 1st January 2027'), ['2026-11-12', '2026-12-03', '2026-12-05', '2027-01-01']);
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

test('detectContext reads destination, centre and category from a BLS page', () => {
  const r = D.detectContext({
    hostname: 'www.blsspainmorocco.com', pathname: '/MAR/appointment/newappointment',
    fields: [{ label: 'CenterId Centre', value: 'Casablanca' }, { label: 'VisaTypeId Visa Type', value: 'Tourism' }],
  });
  assert.deepEqual(r, { destinationId: 'spain', destination: 'Spain', provider: 'BLS International', centre: 'Casablanca', category: 'Tourism · Tourisme' });
});

test('detectContext reads the VFS mission from the URL and a Material dropdown', () => {
  const r = D.detectContext({
    hostname: 'visa.vfsglobal.com', pathname: '/mar/fr/ita/book-appointment',
    fields: [{ label: 'Application Centre Rabat', value: 'Rabat' }, { label: 'Catégorie', value: 'Regroupement familial' }],
  });
  assert.equal(r.provider, 'VFS Global');
  assert.equal(r.destinationId, 'italy');
  assert.equal(r.centre, 'Rabat');
  assert.equal(r.category, 'Family reunification · Regroupement familial');
});

test('detectContext falls back to headings and leaves unknowns empty', () => {
  const r = D.detectContext({ hostname: 'www.blsinternational.com', pathname: '/', fields: [], headings: 'BLS Portugal Visa – Tanger' });
  assert.equal(r.destinationId, 'portugal');
  assert.equal(r.centre, 'Tanger');
  assert.equal(r.category, '');
  const none = D.detectContext({ hostname: 'example.com', pathname: '/' });
  assert.equal(none.destination, '');
  assert.equal(none.centre, '');
});

test('detectBooking reads a BLS / VFS confirmation page', () => {
  const bls = D.detectBooking('Appointment Confirmed\nYour appointment has been booked successfully.\nAppointment No : BLS/RBA/2611/00123\nAppointment Date: 12/11/2026\nTime Slot: 09:30-09:45\nCentre: Rabat');
  assert.deepEqual([bls.booked, bls.date, bls.time, bls.reference], [true, '2026-11-12', '09:30', 'BLS/RBA/2611/00123']);
  const vfs = D.detectBooking('Booking confirmed. Reference Number: ITA-MA-998877 on 03 décembre 2026 at 10h15');
  assert.deepEqual([vfs.booked, vfs.date, vfs.time, vfs.reference], [true, '2026-12-03', '10:15', 'ITA-MA-998877']);
  const fr = D.detectBooking('Votre rendez-vous est confirmé pour le 5/1/2027 à 8:05');
  assert.deepEqual([fr.booked, fr.date, fr.time], [true, '2027-01-05', '08:05']);
});

test('detectBooking ignores pages that only mention confirmation', () => {
  assert.equal(D.detectBooking('Download your appointment confirmation after booking.').booked, false);
  assert.equal(D.detectBooking('Select a date. Earliest available 12/11/2026').booked, false);
  assert.equal(D.detectBooking('').booked, false);
});

test('isFormDateField: personal and travel date fields are not the appointment calendar', () => {
  for (const l of ['DateOfBirth Date of Birth', 'Date de naissance', 'PassportExpiry Passport Expiry Date', "Date de délivrance du passeport",
    'Intended date of arrival', 'Fecha de salida', 'Travel start date', 'CIN expiry']) {
    assert.equal(D.isFormDateField(l), true, l);
  }
  for (const l of ['AppointmentDate Appointment Date', 'Date du rendez-vous', 'Select a slot', 'Fecha de la cita', 'Booking date', '']) {
    assert.equal(D.isFormDateField(l), false, l);
  }
});

test('hasAppointmentVocabulary: appointment pages pass, applicant forms do not', () => {
  assert.equal(D.hasAppointmentVocabulary('https://www.blsspainmorocco.com/MAR/appointment/newappointment BLS Spain'), true);
  assert.equal(D.hasAppointmentVocabulary('https://visa.vfsglobal.com/mar/en/ita/book-appointment'), true);
  assert.equal(D.hasAppointmentVocabulary('Choisir un créneau'), true);
  assert.equal(D.hasAppointmentVocabulary('https://www.blsspainmorocco.com/MAR/account/applicant-details Applicant Details Personal information'), false);
  assert.equal(D.hasAppointmentVocabulary(''), false);
});

test('isManualCheckHost: BLS hosts have no auto-refresh, VFS hosts keep it', () => {
  for (const h of ['www.blsspainmorocco.net', 'www.blsspainmorocco.com', 'blsportugal.com', 'www.blsinternational.com']) assert.equal(D.isManualCheckHost(h), true, h);
  for (const h of ['visa.vfsglobal.com', 'www.vfsglobal.ma', 'example.com', '']) assert.equal(D.isManualCheckHost(h), false, h);
});

test('detectReadiness: the Manage Appointments record status', () => {
  assert.equal(D.detectReadiness('Manage Appointments\nApplicant\tPassport\tStatus\nYAHYA EL AMRANI\tXB1234567\tNot Completed\tEdit'), 'incomplete');
  assert.equal(D.detectReadiness('Manage Appointments\nApplicant\tPassport\tStatus\nYAHYA EL AMRANI\tXB1234567\tCompleted\tView'), 'complete');
  assert.equal(D.detectReadiness('Book New Appointment\nCurrently, no slots are available'), null);
  assert.equal(D.detectReadiness(''), null);
});

test('matchFormField: BLS / VFS applicant form labels map to saved details; credentials and verification never do', () => {
  const cases = {
    'Surname Surname (as in passport)': 'surname', 'FirstName First Name': 'givenName', 'Prénom': 'givenName', 'Nom': 'surname',
    'Gender': 'sex', 'MaritalStatus Marital Status': 'maritalStatus', 'DateOfBirth Date of Birth DD/MM/YYYY': 'birthDate',
    'PlaceOfBirth Place of Birth': 'birthPlace', 'Nationality Current Nationality': 'nationality',
    'PassportNo Passport Number': 'passport', 'PassportIssueDate Date of Issue': 'passportIssue', 'PassportExpiryDate Date of Expiry': 'passportExpiry',
    'PassportIssuePlace Place of Issue': 'passportIssuePlace', 'Email': 'email', 'ConfirmEmail Confirm Email': 'email', 'Mobile Mobile Number': 'phone',
    'Password': null, 'ConfirmPassword Confirm Password': null, 'CaptchaCode Enter the code shown captcha': null, 'Verification': null,
    'Occupation': null, "FatherName Father's name": null, 'EntryDate Intended date of entry': null, 'CountryOfBirth Country of Birth': null, '': null,
  };
  for (const [label, key] of Object.entries(cases)) assert.equal(D.matchFormField(label), key, label);
});

test('formatDate follows the field hint; matchOption finds the right option', () => {
  assert.equal(D.formatDate('1994-03-07', D.dateFormatHint('DD/MM/YYYY')), '07/03/1994');
  assert.equal(D.formatDate('1994-03-07', D.dateFormatHint('MM/DD/YYYY')), '03/07/1994');
  assert.equal(D.formatDate('1994-03-07', D.dateFormatHint('yyyy-mm-dd')), '1994-03-07');
  assert.equal(D.formatDate('1994-03-07', D.dateFormatHint('Date of Birth')), '07/03/1994');
  assert.equal(D.formatDate('', 'dd/mm/yyyy'), '');
  assert.equal(D.matchOption(['Select', 'Male', 'Female'], 'Male (M)'), 1);
  assert.equal(D.matchOption(['Select', 'M', 'F'], 'Female (F)'), 2);
  assert.equal(D.matchOption(['Select', 'MONACO', 'MOROCCO', 'SPAIN'], 'Moroccan'), 2);
  assert.equal(D.matchOption(['Select', 'Single', 'Married'], 'married'), 2);
  assert.equal(D.matchOption(['Select', 'Single', 'Married'], 'Widowed'), -1);
  assert.equal(D.matchOption(['Select'], ''), -1);
});

test('hash is stable and changes with input', () => {
  assert.equal(D.hash('available|2026-11-12|3|0'), D.hash('available|2026-11-12|3|0'));
  assert.notEqual(D.hash('available|2026-11-12|3|0'), D.hash('available|2026-11-12|4|0'));
});
