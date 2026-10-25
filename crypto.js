/* crypto.js — optional passphrase protection for applicant details and documents.
 * AES-GCM (256) with a key derived from the passphrase by PBKDF2-SHA256. WebCrypto only; the key
 * never leaves the page that derived it and is never stored. Shared by the dashboard and the tests. */
(function (root) {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 310000;
  const subtle = () => (root.crypto || require('crypto').webcrypto).subtle;
  const rnd = n => (root.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n));
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(passphrase, saltB64, iterations = ITER) {
    const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  /** Bytes in, {iv, data: ArrayBuffer} out (for IndexedDB, which stores buffers as they are). */
  async function encryptBytes(key, bytes) {
    const iv = rnd(12);
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: b64(iv), data };
  }
  async function decryptBytes(key, box) {
    return subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, box.data);
  }
  /** Any JSON value in, {iv, data} as base64 strings out (for chrome.storage). */
  async function encryptJSON(key, value) {
    const r = await encryptBytes(key, enc.encode(JSON.stringify(value)));
    return { iv: r.iv, data: b64(r.data) };
  }
  async function decryptJSON(key, box) {
    return JSON.parse(dec.decode(await decryptBytes(key, { iv: box.iv, data: unb64(box.data) })));
  }
  const newSalt = () => b64(rnd(16));

  const api = { deriveKey, encryptBytes, decryptBytes, encryptJSON, decryptJSON, newSalt, ITER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RDVCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
