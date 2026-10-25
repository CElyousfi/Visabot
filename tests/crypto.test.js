/* Unit tests for crypto.js (passphrase protection). Run: npm run test:unit */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../crypto.js');

test('JSON round-trips with the right key and fails with a wrong passphrase', async () => {
  const salt = C.newSalt();
  const key = await C.deriveKey('correct horse battery', salt, 1000);
  const box = await C.encryptJSON(key, { applicant: { passport: 'XB1234567', surname: 'El Amrani' }, notes: 'ok' });
  assert.ok(typeof box.iv === 'string' && typeof box.data === 'string');
  assert.ok(!box.data.includes('XB1234567'));
  assert.deepEqual(await C.decryptJSON(key, box), { applicant: { passport: 'XB1234567', surname: 'El Amrani' }, notes: 'ok' });
  const wrong = await C.deriveKey('correct horse batterz', salt, 1000);
  await assert.rejects(C.decryptJSON(wrong, box));
});

test('bytes round-trip (documents) and each encryption uses a fresh IV', async () => {
  const key = await C.deriveKey('pass-phrase', C.newSalt(), 1000);
  const bytes = new Uint8Array(70000).map((_, i) => i % 251);
  const a = await C.encryptBytes(key, bytes);
  const b = await C.encryptBytes(key, bytes);
  assert.notEqual(a.iv, b.iv);
  assert.deepEqual(new Uint8Array(await C.decryptBytes(key, a)), bytes);
});

test('salts are unique and the key derivation is deterministic for the same salt', async () => {
  const s1 = C.newSalt(), s2 = C.newSalt();
  assert.notEqual(s1, s2);
  const k1 = await C.deriveKey('p', s1, 1000), k2 = await C.deriveKey('p', s1, 1000);
  const box = await C.encryptJSON(k1, 'x');
  assert.equal(await C.decryptJSON(k2, box), 'x');
});
