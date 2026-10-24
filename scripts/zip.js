/* scripts/zip.js — builds rdv-maroc.zip without needing a `zip` binary (works on Windows).
 * Packs every file the manifest references, plus files those pages load, then re-reads the
 * archive and fails if anything referenced is missing. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'rdv-maroc.zip');

/** Every extension file the manifest names, directly or through an HTML page / background code. */
function referencedFiles() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const refs = new Set(['manifest.json']);
  Object.values(m.icons || {}).forEach(f => refs.add(f));
  if (m.background) {
    if (m.background.service_worker) refs.add(m.background.service_worker);
    (m.background.scripts || []).forEach(f => refs.add(f));
  }
  if (m.action && m.action.default_popup) refs.add(m.action.default_popup);
  Object.values((m.action && m.action.default_icon) || {}).forEach(f => refs.add(f));
  for (const cs of m.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(f => refs.add(f));
  for (const w of m.web_accessible_resources || []) (w.resources || []).forEach(f => refs.add(f));
  // Pages opened from code (offscreen document) and assets loaded by HTML pages.
  for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !f.startsWith('.'))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [, p] of src.matchAll(/url:\s*'([\w./-]+\.html)'/g)) refs.add(p);
  }
  for (const f of [...refs].filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [, p] of html.matchAll(/(?:src|href)="([\w./-]+)"/g)) if (!/^[a-z]+:/.test(p)) refs.add(p);
  }
  return [...refs].map(f => f.replace(/^\.?\//, '')).sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const name of files) {
    const data = fs.readFileSync(path.join(ROOT, name));
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const { time, date } = dosTime(fs.statSync(path.join(ROOT, name)).mtime);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                 // version needed
    local.writeUInt16LE(0x0800, 6);             // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Names and contents read back from the archive's central directory. */
function readZip(buf) {
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(endAt + 10);
  let p = buf.readUInt32LE(endAt + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), crc = buf.readUInt32LE(p + 16);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    entries.set(name, data);
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}

const files = [...new Set([...referencedFiles(), 'README.md'])].sort();
const missing = files.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) { console.error('Missing files referenced by the extension:', missing.join(', ')); process.exit(1); }

fs.writeFileSync(OUT, buildZip(files));
const entries = readZip(fs.readFileSync(OUT));
const notPacked = referencedFiles().filter(f => !entries.has(f));
if (notPacked.length) { console.error('Not in zip:', notPacked.join(', ')); process.exit(1); }
for (const [name, data] of entries) {
  if (!data.equals(fs.readFileSync(path.join(ROOT, name)))) { console.error(`Content differs: ${name}`); process.exit(1); }
}
console.log(`rdv-maroc.zip: ${entries.size} files, ${fs.statSync(OUT).size} bytes, all manifest references present`);
for (const name of entries.keys()) console.log('  ' + name);
