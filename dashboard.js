/* dashboard.js — every application you are chasing, its live watcher state, the booked
 * appointment, your details ready to copy, and your documents. Everything stays in this browser:
 * chrome.storage.local for the data, IndexedDB for the files. Nothing is sent anywhere. */
'use strict';

// ---------- tiny DOM helpers (no innerHTML with user data) ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}
const $ = id => document.getElementById(id);
const load = keys => new Promise(r => chrome.storage.local.get(keys, r));
const save = obj => new Promise(r => chrome.storage.local.set(obj, r));

// ---------- state ----------
let apps = [], settings = {}, status = {}, nextAt = 0, lastHit = null;
let filter = 'all', query = '', selectedId = null, tab = 'detail', editing = false, zoom = 1, viewingDoc = null, manualOpen = false;

const STATE_LABEL = { watching: 'Watching', slot: 'Slot available', paused: 'Paused', booked: 'Booked', idle: 'Not watching' };
const STATE_ICON = { watching: 'radar', slot: 'calendar', paused: 'clock', booked: 'check', idle: null };

const APPLICANT_FIELDS = [
  ['surname', 'Surname', 'user'], ['givenName', 'Given name', 'user'], ['passport', 'Passport number', 'id'],
  ['passportIssue', 'Passport issue date', 'calendar', 'date'], ['passportExpiry', 'Passport expiry', 'calendar', 'date'],
  ['passportIssuePlace', 'Passport issued at', 'pin'], ['birthDate', 'Birth date', 'calendar', 'date'],
  ['birthPlace', 'Place of birth', 'pin'], ['sex', 'Sex', 'user', ['', 'Male (M)', 'Female (F)']],
  ['maritalStatus', 'Marital status', 'user', ['', 'Single', 'Married', 'Divorced', 'Widowed']],
  ['nationality', 'Nationality', 'globe'], ['email', 'Email', 'mail', 'email'], ['phone', 'Phone', 'phone', 'tel'],
  ['address', 'Address', 'pin'],
];
const VISA_FIELDS = [
  ['destinationId', 'Destination', 'globe'], ['centre', 'Centre', 'pin'], ['category', 'Visa type', 'file'],
  ['entries', 'Entries', 'hash', ['', 'Single (S)', 'Multiple (M)']],
  ['travelFrom', 'Travel from', 'calendar', 'date'], ['travelTo', 'Travel to', 'calendar', 'date'],
  ['portalAccount', 'Portal login email', 'mail', 'email'], ['notes', 'Notes', 'edit'],
];

function fullName(a) {
  if (a._locked) return 'Locked';
  const ap = a.applicant || {};
  return [ap.givenName, ap.surname].filter(Boolean).join(' ') || 'Unnamed applicant';
}
function initials(a) {
  if (a._locked) return '🔒';
  const ap = a.applicant || {};
  const s = `${(ap.givenName || '')[0] || ''}${(ap.surname || '')[0] || ''}`;
  return (s || '?').toUpperCase();
}
const AVATAR_COLORS = ['#6c4cf5', '#2f6bff', '#15a35a', '#d98a06', '#e0424b', '#0ea5a4', '#c026d3', '#475569'];
function avatarColor(id) { let n = 0; for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return AVATAR_COLORS[n % AVATAR_COLORS.length]; }
function avatar(a, cls = '') { return h('div', { class: `avatar ${cls}`, style: `background:${avatarColor(a.id)}` }, initials(a)); }
function destName(id) { const d = destinationById(id); return d ? d.name.split(' ·')[0] : '—'; }
function flag(id) { return h('span', { class: `flag ${id || ''}` }); }
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtWhen(ts) { return ts ? new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 1600);
}

/** The application the watcher's events are filed under (same rule as background.js, without creating one). */
function linkedId() {
  if (apps.some(a => a.id === settings.activeAppId)) return settings.activeAppId;
  const m = apps.find(a => a.destinationId && a.destinationId === settings.destinationId &&
    (!settings.centre || !a.centre || a.centre === settings.centre) && a.status !== 'booked');
  return m ? m.id : null;
}

function appState(a) {
  if (a.status === 'booked') return 'booked';
  if (a.id === linkedId()) {
    const s = status.state;
    if (settings.watching) return s === 'available' ? 'slot' : (s === 'captcha' || s === 'login') ? 'paused' : 'watching';
    if (s === 'captcha' || s === 'login') return 'paused';
  }
  if (a.status === 'slot') return 'slot';
  return 'idle';
}
function chip(state) {
  return h('span', { class: `chip ${state}` }, STATE_ICON[state] ? icon(STATE_ICON[state]) : h('span', { class: 'd' }), STATE_LABEL[state]);
}

// ---------- optional passphrase protection ----------
// When on, each application's private part (applicant details, notes, portal login) is stored as
// one AES-GCM box, and documents are stored encrypted. The key exists only in this page's memory.
let cryptoKey = null;
const PRIVATE = ['applicant', 'notes', 'portalAccount'];
const encryptionOn = () => !!(settings.encryption && settings.encryption.salt);
const isLocked = () => encryptionOn() && !cryptoKey;

/** What goes to storage for an application. */
async function sealApp(a) {
  const copy = Object.assign({}, a);
  delete copy._locked;
  if (encryptionOn() && cryptoKey) {
    const priv = {};
    for (const k of PRIVATE) if (a[k] !== undefined) priv[k] = a[k];
    copy.privateEnc = await RDVCrypto.encryptJSON(cryptoKey, priv);
    copy.applicant = {}; delete copy.notes; delete copy.portalAccount; copy.applicantLocked = true;
  } else if (encryptionOn() && a.privateEnc) {
    copy.applicant = {}; delete copy.notes; delete copy.portalAccount; copy.applicantLocked = true;   // locked: the sealed box is kept as it is
  } else {
    delete copy.privateEnc; delete copy.applicantLocked;
  }
  return copy;
}
/** What was loaded from storage, opened for this page when the key is available. */
async function openApp(a) {
  if (!a.privateEnc) { a._locked = false; return a; }
  if (!cryptoKey) { a._locked = true; a.applicant = {}; return a; }
  try { Object.assign(a, await RDVCrypto.decryptJSON(cryptoKey, a.privateEnc)); a._locked = false; }
  catch (e) { a._locked = true; a.applicant = {}; }
  return a;
}
function askPassphrase({ title, note, confirm = false, okLabel = 'Unlock' }) {
  return new Promise(res => {
    const d = $('passDlg');
    $('passTitle').textContent = title; $('passNote').textContent = note || '';
    $('pass1').value = ''; $('pass2').value = ''; $('passErr').textContent = '';
    $('pass2wrap').classList.toggle('hidden', !confirm);
    $('pass2').required = confirm;
    $('passOk').textContent = okLabel;
    const done = v => { d.onclose = null; if (d.open) d.close(); res(v); };
    $('passForm').onsubmit = e => {
      e.preventDefault();
      const v = $('pass1').value;
      if (v.length < 6) { $('passErr').textContent = 'At least 6 characters.'; return; }
      if (confirm && v !== $('pass2').value) { $('passErr').textContent = 'The two entries differ.'; return; }
      done(v);
    };
    $('passCancel').onclick = () => done(null);
    d.onclose = () => res(null);
    d.showModal();
    $('pass1').focus();
  });
}
async function verifyPassphrase(pass) {
  const e = settings.encryption;
  const key = await RDVCrypto.deriveKey(pass, e.salt, e.iterations || RDVCrypto.ITER);
  try { const c = await RDVCrypto.decryptJSON(key, e.check); return c && c.ok ? key : null; } catch (err) { return null; }
}
async function unlock() {
  const pass = await askPassphrase({ title: 'Unlock', note: 'Enter your passphrase to see applicant details and documents.' });
  if (pass == null) return false;
  const key = await verifyPassphrase(pass);
  if (!key) { toast('Wrong passphrase'); return false; }
  cryptoKey = key;
  await refresh(); render(); if (selectedId) renderDrawer();
  $('lockScreen').classList.add('hidden');
  toast('Unlocked for this tab');
  return true;
}
function lockNow() {
  cryptoKey = null;
  refresh().then(() => { render(); if (selectedId) renderDrawer(); });
  toast('Locked');
}
async function enableEncryption() {
  const pass = await askPassphrase({
    title: 'Protect with a passphrase', confirm: true, okLabel: 'Encrypt',
    note: 'Applicant details, notes, the portal login email and your documents will be encrypted (AES-GCM, key from your passphrase). You will be asked for it each time you open the dashboard. There is no recovery if you forget it.',
  });
  if (pass == null) return;
  const salt = RDVCrypto.newSalt();
  const key = await RDVCrypto.deriveKey(pass, salt);
  const check = await RDVCrypto.encryptJSON(key, { ok: true });
  cryptoKey = key;
  settings = Object.assign((await load('settings')).settings || {}, { encryption: { v: 1, salt, iterations: RDVCrypto.ITER, check } });
  await save({ settings });
  await saveApps();
  await reencryptDocs(true);
  render(); if (selectedId) renderDrawer();
  toast('Encrypted. Keep the passphrase safe.');
}
async function disableEncryption() {
  if (isLocked() && !(await unlock())) return;
  const pass = await askPassphrase({ title: 'Remove the passphrase', okLabel: 'Remove', note: 'Details and documents will be stored readable again in this browser. Enter the passphrase to confirm.' });
  if (pass == null) return;
  if (!(await verifyPassphrase(pass))) { toast('Wrong passphrase'); return; }
  await reencryptDocs(false);
  settings = (await load('settings')).settings || {};
  delete settings.encryption;
  await save({ settings });
  cryptoKey = null;
  await saveApps();                          // in memory the applications are open: stored plain again
  render(); if (selectedId) renderDrawer();
  toast('Passphrase removed');
}
function openSecurity() {
  const on = encryptionOn(), locked = isLocked();
  $('secStatus').textContent = !on ? 'Off. Applicant details and documents are stored readable in this browser profile.'
    : locked ? 'On and locked for this tab.' : 'On. Unlocked for this tab until you lock it or close the tab.';
  $('secEnable').classList.toggle('hidden', on);
  $('secUnlock').classList.toggle('hidden', !locked);
  $('secLock').classList.toggle('hidden', !on || locked);
  $('secDisable').classList.toggle('hidden', !on);
  $('secDlg').showModal();
}

// ---------- persistence ----------
let writing = 0;
async function saveApps() {
  const stored = await Promise.all(apps.map(sealApp));
  writing++;
  await save({ applications: stored });
  setTimeout(() => writing--, 50);
}
function appById(id) { return apps.find(a => a.id === id); }
/** Storage refreshes replace the objects; handlers must write to the current one. */
const live = a => appById(a.id) || a;

async function newApplication() {
  if (isLocked()) { toast('Unlock first'); return; }
  const n = apps.reduce((m, a) => Math.max(m, a.num || 0), 1000) + 1;
  const a = {
    id: `app-${Date.now()}`, num: n, createdAt: Date.now(), status: 'idle',
    destinationId: settings.destinationId || 'spain', destination: settings.destination || '',
    centre: settings.centre || '', category: settings.category || CATEGORIES[0],
    applicant: {}, history: [{ at: Date.now(), type: 'created', text: 'Application created' }], checklist: {},
  };
  apps.push(a);
  await saveApps();
  if (!apps.some(x => x.id === settings.activeAppId)) await setActive(a.id);
  openDrawer(a.id, 'detail', true);
  render();
}

async function setActive(id) {
  const { settings: cur = {} } = await load('settings');
  const a = appById(id);
  const patch = { activeAppId: id };
  // Point the watcher's labels at this application; the page can still refine them.
  if (a) Object.assign(patch, { destinationId: a.destinationId, destination: destName(a.destinationId), centre: a.centre, category: a.category });
  settings = Object.assign(cur, patch);
  await save({ settings });
}

// ---------- list ----------
function visibleApps() {
  const q = query.trim().toLowerCase();
  return apps
    .filter(a => filter === 'all' || appState(a) === filter)
    .filter(a => {
      if (!q) return true;
      const ap = a.applicant || {};
      return [fullName(a), ap.passport, ap.email, ap.phone, destName(a.destinationId), a.centre, a.category, `#${a.num}`, a.appointment && a.appointment.reference]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    })
    .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
}

function render() {
  const states = apps.map(appState);
  $('sTotal').textContent = apps.length;
  $('sWatching').textContent = states.filter(s => s === 'watching').length;
  $('sSlot').textContent = states.filter(s => s === 'slot').length;
  $('sBooked').textContent = states.filter(s => s === 'booked').length;

  const list = visibleApps();
  const linked = linkedId();
  const rows = list.map(a => {
    const st = appState(a);
    const ap = a.appointment;
    return h('tr', { class: `${a.id === selectedId ? 'sel' : ''} ${a.id === linked && st === 'slot' ? 'live-slot' : ''}`.trim(), dataset: { id: a.id }, onclick: () => openDrawer(a.id) },
      h('td', { class: 'idc' }, `#${a.num}`),
      h('td', {}, h('div', { class: 'cell-name' }, avatar(a), fullName(a), a.id === linked ? h('span', { class: 'lnk-star', title: 'Watcher linked to this application' }, icon('star')) : null)),
      h('td', {}, h('div', { class: 'dest' }, flag(a.destinationId), destName(a.destinationId))),
      h('td', {}, a.centre || '—'),
      h('td', {}, (a.category || '—').split(' ·')[0]),
      h('td', {}, chip(st)),
      h('td', {}, ap && ap.date ? `${fmtDate(ap.date)}${ap.time ? ` · ${ap.time}` : ''}` : st === 'slot' && a.lastSlot ? `seen ${ago(a.lastSlot.at)}` : '—'));
  });
  $('rows').replaceChildren(...rows);
  $('empty').classList.toggle('hidden', apps.length > 0);
  $('emptyNew').parentElement.querySelector('h3').textContent = apps.length ? 'No match' : 'No application yet';
  if (apps.length && !list.length) { $('empty').classList.remove('hidden'); $('emptyNew').classList.add('hidden'); }
  else $('emptyNew').classList.remove('hidden');

  renderLive();
  if (selectedId && !editing) renderDrawer();
}

function renderLive() {
  const pill = $('livePill');
  const s = status.state;
  let state = 'idle', text = 'Watcher idle';
  const where = [settings.destination, settings.centre].filter(Boolean).join(' · ');
  if (s === 'booked') { state = 'booked'; text = 'Booked ✓'; }
  else if (settings.watching) {
    if (s === 'available') { state = 'available'; text = `Slot available · ${where}`; }
    else {
      state = 'watching';
      const left = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
      text = `Watching${where ? ` · ${where}` : ''}${left != null && settings.autoRefresh !== false ? ` · next ${left}s` : ''}`;
    }
  } else if (s === 'captcha') { state = 'paused'; text = 'Paused · verification on the portal'; }
  else if (s === 'login') { state = 'paused'; text = 'Paused · logged out'; }
  pill.dataset.state = state;
  $('liveText').textContent = text;
  pill.title = settings.watchTabId != null ? 'Click to open the watched tab' : '';

  // Alert bar + toast on every change of the watcher's state; the tab title says it too.
  const bar = $('liveBar');
  const barOn = state === 'available' || state === 'paused';
  bar.classList.toggle('hidden', !barOn);
  bar.dataset.state = state;
  if (state === 'available') {
    $('liveBarText').textContent = `SLOT AVAILABLE · ${where || 'portal'} – go and book it`;
    const seen = (lastHit && lastHit.at) || status.at;
    $('liveBarAgo').textContent = seen ? `seen ${ago(seen)}` : '';
  } else if (state === 'paused') {
    $('liveBarText').textContent = text + ' – deal with it in the portal tab, watching resumes by itself';
    $('liveBarAgo').textContent = status.at ? ago(status.at) : '';
  }
  const prefix = { available: '🟢 SLOT!', paused: '⚠ Needs you', booked: '✅ Booked', watching: '● Watching' }[state] || '';
  const full = `${prefix ? `${prefix} – ` : ''}RDV Maroc · Applications`;
  if (document.title !== full) document.title = full;
  if (renderLive.last !== undefined && renderLive.last !== state) {
    const msg = { available: `Slot available · ${where}`, paused: text, booked: 'Appointment booked ✓', watching: `Watching ${where}`.trim(), idle: 'Watcher idle' }[state];
    if (msg) toast(msg);
  }
  renderLive.last = state;
}

// ---------- drawer ----------
function openDrawer(id, t, edit) {
  if (id !== selectedId) manualOpen = false;
  selectedId = id;
  if (t) tab = t;
  editing = !!edit;
  history.replaceState(null, '', `#${id}`);
  $('drawer').classList.remove('hidden');
  $('scrim').classList.remove('hidden');
  renderDrawer();
  render();
}
function closeDrawer() {
  selectedId = null; editing = false; viewingDoc = null;
  history.replaceState(null, '', location.pathname);
  $('drawer').classList.add('hidden');
  $('scrim').classList.add('hidden');
  render();
}

function renderDrawer() {
  const a = appById(selectedId);
  if (!a) { closeDrawer(); return; }
  const list = visibleApps();
  const idx = list.findIndex(x => x.id === a.id);
  $('pos').replaceChildren(h('b', {}, String(idx + 1).padStart(2, '0')), ` of ${list.length}`);
  $('prev').disabled = idx <= 0;
  $('next').disabled = idx < 0 || idx >= list.length - 1;

  $('avatar').replaceWith(Object.assign(avatar(a, 'lg'), { id: 'avatar' }));
  $('pName').textContent = fullName(a);
  $('pId').textContent = `#${a.num}`;
  $('pMail').textContent = (a.applicant || {}).email || '';
  $('pPhone').textContent = (a.applicant || {}).phone || '';
  const linked = a.id === linkedId();
  $('activeBtn').classList.toggle('on', linked);
  $('activeBtn').title = linked ? 'The watcher files slots and bookings under this application' : 'Link the watcher to this application';

  const st = appState(a);
  $('sumId').textContent = `#${a.num}`;
  $('sumStatus').replaceChildren(chip(st));
  if (a.appointment && a.appointment.date) { $('sumDateK').textContent = 'Appointment'; $('sumDate').textContent = `${fmtDate(a.appointment.date)}${a.appointment.time ? ` · ${a.appointment.time}` : ''}`; }
  else { $('sumDateK').textContent = 'Created'; $('sumDate').textContent = fmtDate(new Date(a.createdAt).toISOString().slice(0, 10)); }

  for (const b of $('dTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.t === tab);
  for (const t of ['detail', 'appt', 'docs']) $(`t-${t}`).classList.toggle('hidden', t !== tab);
  if (tab === 'detail') renderDetail(a);
  if (tab === 'appt') renderAppt(a);
  if (tab === 'docs') renderDocs(a);
}

// ----- detail tab -----
function copyBtn(text) {
  return h('button', {
    class: 'copy', title: 'Copy', onclick: async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(text);
      const b = e.currentTarget;
      b.classList.add('done'); b.replaceChildren(icon('check'));
      setTimeout(() => { b.classList.remove('done'); b.replaceChildren(icon('copy')); }, 1200);
      toast('Copied');
    },
  }, icon('copy'));
}

function displayValue(key, val) {
  if (!val) return '';
  if (key === 'destinationId') return destName(val);
  if (['passportIssue', 'passportExpiry', 'birthDate', 'travelFrom', 'travelTo'].includes(key)) return fmtDate(val);
  if (key === 'category') return val.split(' ·')[0];
  return val;
}
/** What gets copied: the raw value portals expect (dates as DD/MM/YYYY). */
function copyValue(key, val) {
  if (['passportIssue', 'passportExpiry', 'birthDate', 'travelFrom', 'travelTo'].includes(key) && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-'); return `${d}/${m}/${y}`;
  }
  return displayValue(key, val);
}

let saveTimer = null;
function fieldInput(a, key, spec, isVisa) {
  const val = (isVisa ? a : (a.applicant || {}))[key] || '';
  const onchange = async (e) => {
    const cur = live(a);
    const obj = isVisa ? cur : (cur.applicant = cur.applicant || {});
    obj[key] = e.target.value;
    if (key === 'destinationId') { cur.destination = destName(cur.destinationId); cur.centre = ''; renderDetail(cur); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { await saveApps(); render(); renderDrawerHeader(live(a)); }, 250);
  };
  let options = Array.isArray(spec) ? spec : null;
  if (key === 'destinationId') options = DESTINATIONS.filter(d => !d.unsupported).map(d => [d.id, d.name]);
  if (key === 'centre') { const d = destinationById(a.destinationId); options = ['', ...((d && d.centres) || [])]; }
  if (key === 'category') options = ['', ...CATEGORIES];
  if (options) {
    return h('select', { onchange, dataset: { key } }, options.map(o => {
      const [v, label] = Array.isArray(o) ? o : [o, o || '—'];
      return h('option', { value: v, selected: v === val }, label);
    }));
  }
  return h('input', { type: typeof spec === 'string' ? spec : 'text', value: val, oninput: onchange, dataset: { key }, autocomplete: 'off', spellcheck: 'false' });
}
function renderDrawerHeader(a) {
  $('pName').textContent = fullName(a);
  $('pMail').textContent = (a.applicant || {}).email || '';
  $('pPhone').textContent = (a.applicant || {}).phone || '';
  $('avatar').replaceWith(Object.assign(avatar(a, 'lg'), { id: 'avatar' }));
}

function kvRows(a, fields, isVisa) {
  const src = isVisa ? a : (a.applicant || {});
  return fields.flatMap(([key, label, ic, spec]) => {
    const raw = src[key] || '';
    const shown = displayValue(key, raw);
    const lockedField = a._locked && (!isVisa || PRIVATE.includes(key));
    const value = lockedField
      ? h('div', { class: 'v' }, h('span', { class: 'empty-val' }, '🔒 locked'))
      : editing
      ? h('div', { class: 'v' }, fieldInput(a, key, spec, isVisa))
      : h('div', { class: 'v' },
        key === 'destinationId' && raw ? flag(raw) : null,
        shown ? h('span', { class: 'val' }, shown) : h('span', { class: 'empty-val' }, 'not set'),
        shown ? copyBtn(copyValue(key, raw)) : null);
    return [h('div', { class: 'k' }, icon(ic), label), value];
  });
}
function renderDetail(a) {
  $('editBtn').querySelector('span').textContent = editing ? 'Done' : 'Edit';
  $('editBtn').classList.toggle('hidden', !!a._locked);
  if (a._locked) editing = false;
  $('kvApplicant').replaceChildren(
    a._locked ? h('div', { class: 'locked-note', style: 'grid-column: 1 / -1; margin-bottom: 6px' }, icon('lock'), 'Encrypted with your passphrase. ', h('button', { class: 'btn sm primary', onclick: unlock }, icon('unlock'), 'Unlock')) : null,
    ...kvRows(a, APPLICANT_FIELDS, false));
  $('kvVisa').replaceChildren(...kvRows(a, VISA_FIELDS, true));
}

// ----- appointment tab -----
function icsFor(a) {
  const ap = a.appointment;
  const [y, m, d] = ap.date.split('-');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = s => String(s || '').replace(/[\\;,]/g, c => `\\${c}`).replace(/\n/g, '\\n');
  let when;
  if (ap.time) {
    const [hh, mm] = ap.time.split(':').map(Number);
    const end = new Date(+y, +m - 1, +d, hh, mm + 60);
    const p = n => String(n).padStart(2, '0');
    when = [`DTSTART:${y}${m}${d}T${p(hh)}${p(mm)}00`, `DTEND:${end.getFullYear()}${p(end.getMonth() + 1)}${p(end.getDate())}T${p(end.getHours())}${p(end.getMinutes())}00`];
  } else {
    when = [`DTSTART;VALUE=DATE:${y}${m}${d}`];
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RDV Maroc//EN', 'BEGIN:VEVENT',
    `UID:${a.id}-${ap.reference || ap.date}@rdv-maroc`, `DTSTAMP:${stamp}`, ...when,
    `SUMMARY:${esc(`Visa appointment – ${destName(a.destinationId)}${ap.centre ? ` (${ap.centre})` : ''}`)}`,
    `LOCATION:${esc(`${ap.provider || ''} ${ap.centre || ''}`.trim())}`,
    `DESCRIPTION:${esc(`${fullName(a)}${ap.reference ? `\nReference: ${ap.reference}` : ''}\nBring the documents on your checklist.`)}`,
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Visa appointment tomorrow', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function focusWatchedTab() {
  if (settings.watchTabId == null) return false;
  try {
    const t = await chrome.tabs.get(settings.watchTabId);
    await chrome.windows.update(t.windowId, { focused: true });
    await chrome.tabs.update(t.id, { active: true });
    return true;
  } catch (e) { return false; }
}

function manualBookingForm(a) {
  const date = h('input', { type: 'date', value: (a.appointment && a.appointment.date) || '' });
  const time = h('input', { type: 'time', value: (a.appointment && a.appointment.time) || '' });
  const ref = h('input', { placeholder: 'Reference', value: (a.appointment && a.appointment.reference) || '' });
  const centre = h('input', { placeholder: 'Centre', value: (a.appointment && a.appointment.centre) || a.centre || '' });
  const wrap = h('div', { class: manualOpen ? '' : 'hidden' },
    h('div', { class: 'manual' }, date, time, centre, ref),
    h('div', { class: 'appt-actions' }, h('button', {
      class: 'btn primary sm', onclick: async () => {
        if (!date.value) { toast('Enter the date'); return; }
        a = live(a);
        a.status = 'booked';
        a.appointment = Object.assign({}, a.appointment, { date: date.value, time: time.value, reference: ref.value.trim(), centre: centre.value.trim(), at: Date.now(), manual: true });
        a.history = [{ at: Date.now(), type: 'booked', text: `Booked ${date.value} ${time.value} (entered by hand)` }, ...(a.history || [])];
        manualOpen = false;
        await saveApps(); render(); toast('Appointment saved');
      },
    }, icon('check'), 'Save appointment')));
  const toggle = h('button', { class: 'btn ghost sm', onclick: () => { manualOpen = !manualOpen; wrap.classList.toggle('hidden', !manualOpen); } }, icon('edit'), a.status === 'booked' ? 'Edit appointment' : 'Booked elsewhere? Enter it');
  return [toggle, wrap];
}

function renderAppt(a) {
  const st = appState(a);
  const ap = a.appointment || {};
  const card = h('div', { class: `appt ${st}` });
  const actions = h('div', { class: 'appt-actions' });
  const [manualToggle, manualForm] = manualBookingForm(a);

  if (st === 'booked') {
    card.append(
      h('div', { class: 'appt-top' }, h('div', {}, h('div', { class: 'appt-title' }, 'Appointment booked'),
        h('div', { class: 'appt-sub' }, [destName(a.destinationId), ap.category || a.category].filter(Boolean).map(s => s.split(' ·')[0]).join(' · '))), chip('booked')),
      h('div', { class: 'appt-big' },
        h('div', {}, h('div', { class: 'k' }, icon('calendar'), 'Date'), h('div', { class: 'v' }, ap.date ? fmtDate(ap.date) : '—')),
        h('div', {}, h('div', { class: 'k' }, icon('clock'), 'Time'), h('div', { class: 'v' }, ap.time || '—')),
        h('div', {}, h('div', { class: 'k' }, icon('pin'), 'Centre'), h('div', { class: 'v' }, [ap.provider, ap.centre || a.centre].filter(Boolean).join(' · ') || '—')),
        h('div', {}, h('div', { class: 'k' }, icon('hash'), 'Reference'), h('div', { class: 'v' }, ap.reference || '—', ap.reference ? copyBtn(ap.reference) : null))));
    if (ap.date) actions.append(h('button', { class: 'btn primary sm', onclick: () => download(`visa-appointment-${ap.date}.ics`, new Blob([icsFor(a)], { type: 'text/calendar' })) }, icon('calendar'), 'Add to calendar'));
    if (ap.url) actions.append(h('a', { class: 'btn sm', href: ap.url, target: '_blank', rel: 'noopener' }, icon('link'), 'Confirmation page'));
    actions.append(manualToggle, h('button', {
      class: 'btn ghost sm danger', onclick: async () => {
        if (!confirm('Mark this application as not booked?')) return;
        a = live(a);
        a.status = 'idle'; delete a.appointment;
        a.history = [{ at: Date.now(), type: 'created', text: 'Booking removed' }, ...(a.history || [])];
        await saveApps(); render();
      },
    }, 'Not booked'));
    card.append(actions, manualForm);
  } else {
    const linked = a.id === linkedId();
    const where = [destName(a.destinationId), a.centre].filter(Boolean).join(' · ');
    let title, sub;
    if (st === 'slot') { title = 'Slot available – book it now'; sub = a.lastSlot ? `Seen ${ago(a.lastSlot.at)}${a.lastSlot.dates && a.lastSlot.dates.length ? ` · ${a.lastSlot.dates.slice(0, 4).map(fmtDate).join(', ')}` : ''}` : where; }
    else if (st === 'watching') {
      const left = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
      title = `Watching ${where}`; sub = `Last check ${status.at ? ago(status.at) : '—'}${left != null ? ` · next refresh in ${left}s` : ''}`;
    } else if (st === 'paused') { title = status.state === 'login' ? 'Paused – logged out' : 'Paused – verification on the portal'; sub = 'Deal with it in the portal tab; watching resumes by itself.'; }
    else { title = 'Not watching'; sub = linked ? 'Open the portal, log in and show the calendar: watching starts by itself.' : 'Link the watcher to this application, then open the portal calendar.'; }
    card.append(h('div', { class: 'appt-top' }, h('div', {}, h('div', { class: 'appt-title' }, title), h('div', { class: 'appt-sub' }, sub)), chip(st)));
    if (st === 'slot' || st === 'paused' || st === 'watching') actions.append(h('button', { class: `btn ${st === 'slot' ? 'primary' : ''} sm`, onclick: async () => { if (!(await focusWatchedTab())) toast('The watched tab is closed'); } }, icon('link'), 'Go to the portal tab'));
    const d = destinationById(a.destinationId);
    if (st === 'idle' && d && d.portal) actions.append(h('a', { class: 'btn primary sm', href: d.portal, target: '_blank', rel: 'noopener' }, icon('link'), `Open ${d.provider}`));
    if (!linked) actions.append(h('button', { class: 'btn sm', onclick: async () => { await setActive(a.id); render(); toast('Watcher linked to this application'); } }, icon('star'), 'Link watcher here'));
    actions.append(manualToggle);
    card.append(actions, manualForm);
  }
  if (a.formCompleted != null) {
    const line = h('div', { class: `readiness ${a.formCompleted ? 'ok' : 'warn'}` }, icon(a.formCompleted ? 'check' : 'edit'),
      a.formCompleted ? 'Application form completed' : 'Application form not completed – BLS will not book without it',
      !a.formCompleted && a.formUrl ? h('a', { href: a.formUrl, target: '_blank', rel: 'noopener' }, 'Open Manage Appointments') : null);
    card.insertBefore(line, card.querySelector('.appt-actions'));
  }
  $('apptCard').replaceChildren(card);

  const done = a.checklist || {};
  $('checklist').replaceChildren(...CHECKLIST.map(([key, label]) => h('label', { class: done[key] ? 'done' : '' },
    h('input', {
      type: 'checkbox', checked: !!done[key], onchange: async (e) => {
        a = live(a);
        a.checklist = Object.assign({}, a.checklist, { [key]: e.target.checked });
        await saveApps(); renderAppt(a);
      },
    }), h('span', {}, label))));
  $('chkCount').textContent = `${CHECKLIST.filter(([k]) => done[k]).length} / ${CHECKLIST.length} ready`;

  const hist = a.history || [];
  $('history').replaceChildren(...(hist.length ? hist.slice(0, 40) : [{ at: a.createdAt, type: 'created', text: 'Application created' }])
    .map(e => h('li', { dataset: { t: e.type } }, h('div', { class: 'tt' }, e.text), h('div', { class: 'ts' }, fmtWhen(e.at)))));
}

// ----- documents tab (IndexedDB) -----
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('rdv-maroc', 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore('docs', { keyPath: 'id' }); s.createIndex('appId', 'appId'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('docs', mode);
    const out = fn(tx.objectStore('docs'));
    tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}
const docsFor = appId => idb('readonly', s => s.index('appId').getAll(appId));
const allDocs = () => idb('readonly', s => s.getAll());
const putDoc = doc => idb('readwrite', s => s.put(doc));
const delDoc = id => idb('readwrite', s => s.delete(id));

/** A document record for the store: encrypted content and name when protection is on. */
async function sealDoc(meta, blob) {
  if (encryptionOn() && cryptoKey) {
    const enc = await RDVCrypto.encryptBytes(cryptoKey, await blob.arrayBuffer());
    const nameEnc = await RDVCrypto.encryptJSON(cryptoKey, { name: meta.name });
    return Object.assign({}, meta, { name: 'Encrypted document', encrypted: true, enc, nameEnc });
  }
  return Object.assign({}, meta, { blob });
}
async function docBlob(doc) {
  if (!doc.encrypted) return doc.blob;
  if (!cryptoKey) return null;
  return new Blob([await RDVCrypto.decryptBytes(cryptoKey, doc.enc)], { type: doc.type });
}
async function docName(doc) {
  if (!doc.encrypted) return doc.name;
  if (!cryptoKey) return 'Encrypted document';
  try { return (await RDVCrypto.decryptJSON(cryptoKey, doc.nameEnc)).name; } catch (e) { return 'Encrypted document'; }
}
/** Turning protection on or off re-stores every document accordingly. */
async function reencryptDocs(on) {
  for (const doc of await allDocs()) {
    if (on && !doc.encrypted) {
      const { blob, ...meta } = doc;
      await putDoc(await sealDoc(meta, blob));
    } else if (!on && doc.encrypted) {
      const blob = await docBlob(doc), name = await docName(doc);
      const { enc, nameEnc, encrypted, ...meta } = doc;
      await putDoc(Object.assign(meta, { blob, name }));
    }
  }
}

function size(n) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }

async function renderDocs(a) {
  const docs = (await docsFor(a.id)).sort((x, y) => y.at - x.at);
  const names = await Promise.all(docs.map(docName));
  if (selectedId !== a.id || tab !== 'docs') return;
  const locked = isLocked();
  $('drop').classList.toggle('hidden', locked);
  $('docList').replaceChildren(...docs.map((doc, i) => {
    const isImg = doc.type.startsWith('image/');
    const sealed = doc.encrypted && !cryptoKey;
    return h('div', { class: `doc ${viewingDoc === doc.id ? 'on' : ''}` },
      h('div', { class: `doc-ic ${isImg ? 'img' : ''}` }, icon(sealed ? 'lock' : 'file')),
      h('div', { class: 'doc-meta' }, h('div', { class: 'doc-name' }, names[i]), h('div', { class: 'doc-sub' }, `${isImg ? 'Image' : 'PDF'} · ${size(doc.size)} · ${fmtWhen(doc.at)}${doc.encrypted ? ' · encrypted' : ''}`)),
      h('button', { class: 'btn sm', disabled: sealed, onclick: () => preview(doc) }, icon('eye'), 'Preview'),
      h('button', { class: 'btn sm', disabled: sealed, onclick: async () => download(await docName(doc), await docBlob(doc)) }, icon('download'), 'Download'),
      h('button', {
        class: 'icon-btn plain', title: 'Delete', onclick: async () => {
          if (!confirm(`Delete ${doc.name}?`)) return;
          await delDoc(doc.id);
          if (viewingDoc === doc.id) { viewingDoc = null; $('viewer').classList.add('hidden'); }
          renderDocs(a);
        },
      }, icon('trash')));
  }));
  if (viewingDoc && !docs.some(d => d.id === viewingDoc)) { viewingDoc = null; $('viewer').classList.add('hidden'); }
}

let previewUrl = null;
async function preview(doc) {
  const blob = await docBlob(doc);
  if (!blob) { toast('Unlock first'); return; }
  const name = await docName(doc);
  viewingDoc = doc.id;
  zoom = 1;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const isImg = doc.type.startsWith('image/');
  $('stage').replaceChildren(isImg ? h('img', { src: previewUrl, alt: name }) : h('iframe', { src: previewUrl, title: name }));
  $('stage').style.display = isImg ? 'grid' : 'block';
  $('viewer').querySelector('.zoom').classList.toggle('hidden', !isImg);
  $('zVal').textContent = '100%';
  $('viewer').classList.remove('hidden');
  renderDocs(appById(selectedId));
  $('viewer').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function setZoom(z) {
  zoom = Math.min(4, Math.max(0.25, z));
  const img = $('stage').querySelector('img');
  if (img) img.style.transform = `scale(${zoom})`;
  $('zVal').textContent = `${Math.round(zoom * 100)}%`;
}

async function addFiles(files) {
  const a = appById(selectedId);
  if (!a) return;
  let added = 0;
  for (const f of files) {
    if (!/^image\/|application\/pdf/.test(f.type)) { toast(`${f.name}: only PDF or images`); continue; }
    if (f.size > 25 * 1048576) { toast(`${f.name} is over 25 MB`); continue; }
    await putDoc(await sealDoc({ id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, appId: a.id, name: f.name, type: f.type, size: f.size, at: Date.now() }, f));
    added++;
  }
  if (added) { toast(`${added} document${added > 1 ? 's' : ''} added`); renderDocs(a); }
}

/** "Fill the portal form": sends this application's details to the portal tab, which fills matching
 *  fields on that click only (never submits). Works with protection on, since this page holds the key. */
async function fillPortalForm() {
  const a = appById(selectedId);
  if (!a) return;
  if (a._locked) { toast('Unlock first'); return; }
  const { host_permissions = [] } = chrome.runtime.getManifest();
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: host_permissions }); } catch (e) {}
  const tab = tabs.find(t => t.id === settings.watchTabId) || tabs.find(t => t.active) || tabs[tabs.length - 1];
  if (!tab) { toast('Open the portal form in a tab first'); return; }
  const msg = { type: 'fillForm', applicant: a.applicant || {} };
  let r = null;
  try { r = await chrome.tabs.sendMessage(tab.id, msg); } catch (e) {}
  if (!r) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['detect.js', 'content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      r = await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {}
  }
  if (!r) { toast('Could not reach the portal tab'); return; }
  toast(`Filled ${r.filled.length} field${r.filled.length === 1 ? '' : 's'}, skipped ${r.skipped.length} – nothing submitted`);
  try { await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
}

// ---------- wiring ----------
async function refresh() {
  const s = await load(['applications', 'settings', 'status', 'nextAt', 'lastHit']);
  apps = s.applications || [];
  settings = s.settings || {};
  status = s.status || {};
  nextAt = s.nextAt || 0;
  lastHit = s.lastHit || null;
  for (const a of apps) await openApp(a);
  $('railLock').classList.toggle('on', encryptionOn());
  $('railLock').title = !encryptionOn() ? 'Passphrase protection: off' : isLocked() ? 'Passphrase protection: locked' : 'Passphrase protection: on (unlocked)';
}

async function init() {
  await refresh();
  for (const b of $('filters').querySelectorAll('button')) b.onclick = () => {
    filter = b.dataset.f;
    for (const x of $('filters').querySelectorAll('button')) x.classList.toggle('on', x === b);
    render();
  };
  const onSearch = e => { query = e.target.value; $('search').value = $('topSearch').value = query; render(); };
  $('search').oninput = onSearch;
  $('topSearch').oninput = onSearch;
  for (const id of ['newApp', 'railNew', 'emptyNew']) $(id).onclick = newApplication;
  $('railExport').onclick = async () => {
    // With protection on, the backup holds the sealed boxes, never the plaintext.
    const applications = await Promise.all(apps.map(sealApp));
    const e = settings.encryption;
    const body = { exportedAt: new Date().toISOString(), encrypted: encryptionOn(),
      encryption: encryptionOn() ? { kdf: 'PBKDF2-SHA256', iterations: e.iterations, salt: e.salt, cipher: 'AES-GCM-256' } : undefined,
      applications, settings: Object.assign({}, settings, { encryption: undefined }) };
    download(`rdv-maroc-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  };
  $('railLock').onclick = openSecurity;
  $('secEnable').onclick = () => { $('secDlg').close(); enableEncryption(); };
  $('secUnlock').onclick = () => { $('secDlg').close(); unlock(); };
  $('secLock').onclick = () => { $('secDlg').close(); lockNow(); };
  $('secDisable').onclick = () => { $('secDlg').close(); disableEncryption(); };
  $('secClose').onclick = () => $('secDlg').close();
  $('lockUnlock').onclick = unlock;
  $('lockSkip').onclick = () => $('lockScreen').classList.add('hidden');
  if (isLocked()) $('lockScreen').classList.remove('hidden');
  $('livePill').onclick = focusWatchedTab;
  $('liveBarGo').onclick = async () => { if (!(await focusWatchedTab())) toast('The watched tab is closed'); };

  $('close').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selectedId) closeDrawer();
    if (!selectedId || editing || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') $('prev').click();
    if (e.key === 'ArrowRight') $('next').click();
  });
  const step = d => { const l = visibleApps(); const i = l.findIndex(x => x.id === selectedId); const n = l[i + d]; if (n) openDrawer(n.id); };
  $('prev').onclick = () => step(-1);
  $('next').onclick = () => step(1);
  for (const b of $('dTabs').querySelectorAll('button')) b.onclick = () => { tab = b.dataset.t; editing = false; renderDrawer(); };
  $('editBtn').onclick = async () => {
    editing = !editing;
    if (!editing) { clearTimeout(saveTimer); await saveApps(); render(); }
    renderDrawer();
  };
  $('activeBtn').onclick = async () => { await setActive(selectedId); render(); toast('Watcher linked to this application'); };
  $('fillBtn').onclick = fillPortalForm;
  $('deleteApp').onclick = async () => {
    const a = appById(selectedId);
    if (!a || !confirm(`Delete ${fullName(a)} (#${a.num}) and its documents?`)) return;
    for (const d of await docsFor(a.id)) await delDoc(d.id);
    apps = apps.filter(x => x.id !== a.id);
    await saveApps();
    if (settings.activeAppId === a.id) { settings.activeAppId = ''; await save({ settings }); }
    closeDrawer();
  };

  $('fileIn').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  const drop = $('drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
  $('zIn').onclick = () => setZoom(zoom + 0.25);
  $('zOut').onclick = () => setZoom(zoom - 0.25);

  chrome.storage.onChanged.addListener(async (changes) => {
    if (!['applications', 'settings', 'status', 'nextAt', 'lastHit'].some(k => k in changes)) return;
    if (writing && Object.keys(changes).every(k => k === 'applications')) return;   // our own save
    await refresh();
    render();
  });
  setInterval(() => {
    renderLive();
    const a = selectedId && appById(selectedId);
    if (a && tab === 'appt' && !manualOpen && ['watching', 'slot'].includes(appState(a))) renderAppt(a);
  }, 1000);

  render();
  const fromHash = location.hash.slice(1);
  if (fromHash && appById(fromHash)) openDrawer(fromHash, new URLSearchParams(location.search).get('tab') || 'detail');
}

document.addEventListener('DOMContentLoaded', init);
