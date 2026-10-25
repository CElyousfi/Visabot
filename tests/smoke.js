/* tests/smoke.js — loads the unpacked extension into Playwright's Chromium and runs it against
 * fake BLS and VFS calendar pages served at the real portal URLs (via request routing, nothing
 * reaches the network). Drives the real popup buttons. Takes ~2 min: it waits for one real
 * 60 s auto-refresh.  Run: npm run test:smoke   (HEADED=1 to watch it, FAST=1 to skip the 60 s wait)
 *
 * Every scenario starts from a clean state: storage and the documents store are wiped, it opens its
 * own tabs, and they are closed when it ends, pass or fail. No scenario depends on another.
 *
 * The fixtures only imitate calendar markup. Nothing here logs in, solves a verification or books. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const BLS_URL = 'https://www.blsspainmorocco.com/MAR/appointment/slotselection';
const BLS_AUTO_URL = 'https://www.blsspainmorocco.com/MAR/appointment/newappointment';
const BLS_CONFIRM_URL = 'https://www.blsspainmorocco.com/MAR/appointment/confirmation';
const VFS_URL = 'https://visa.vfsglobal.com/mar/en/ita/book-appointment';
const VFS_AUTO_URL = 'https://visa.vfsglobal.com/mar/fr/ita/appointment';

// ---------- fixtures ----------
function page(title, body, head = '', header = '<header><a href="#">Logout</a> | <a href="#">Login</a></header>') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head>
<body>${header}<main>${body}</main></body></html>`;
}

/** BLS: jQuery UI datepicker, server-rendered. `open` = day numbers that are bookable. */
function blsCalendar(open = [], { centre, category } = {}) {
  let rows = '', day = 1;
  for (let w = 0; w < 5; w++) {
    rows += '<tr>';
    for (let i = 0; i < 7; i++, day++) {
      if (day > 30) { rows += '<td class="ui-datepicker-other-month ui-datepicker-unselectable ui-state-disabled">&nbsp;</td>'; continue; }
      rows += open.includes(day)
        ? `<td data-handler="selectDay" data-month="10" data-year="2026"><a class="ui-state-default" href="#">${day}</a></td>`
        : `<td class="ui-datepicker-unselectable ui-state-disabled"><span class="ui-state-default">${day}</span></td>`;
    }
    rows += '</tr>';
  }
  return page('BLS Spain – Appointment', `
    <h2>Book New Appointment</h2>
    ${centre ? `<div class="form-group"><label for="CenterId">Centre</label><select id="CenterId" name="CenterId"><option value="">--Select--</option><option value="2">Rabat</option><option value="3" selected>${centre}</option></select></div>` : ''}
    ${category ? `<div class="form-group"><label for="VisaTypeId">Visa Type</label><select id="VisaTypeId" name="VisaTypeId"><option value="">--Select--</option><option value="7" selected>${category}</option></select></div>` : ''}
    <label for="AppointmentDate">Appointment Date</label><input id="AppointmentDate" readonly>
    <div id="ui-datepicker-div" class="ui-datepicker ui-widget">
      <div class="ui-datepicker-title">November 2026</div>
      <table class="ui-datepicker-calendar"><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    <label>Appointment Slot <select id="AppointmentSlot" name="AppointmentSlot"><option value="">--Select--</option></select></label>`);
}

/** VFS: Angular Material calendar rendered ~1 s after load, like the SPA. */
function vfsCalendar({ open = [], banner = 'No appointment slots are currently available' } = {}) {
  const cells = [];
  for (let d = 1; d <= 30; d++) {
    const on = open.includes(d);
    cells.push(`<td role="gridcell" class="mat-calendar-body-cell-container"><button type="button" class="mat-calendar-body-cell${on ? '' : ' mat-calendar-body-disabled'}" aria-disabled="${!on}"><span class="mat-calendar-body-cell-content">${d}</span></button></td>`);
  }
  const html = `<div class="mat-form-field"><label class="mat-label">Application Centre</label><div class="mat-select-value">Rabat</div></div><div class="alert">${banner}</div><mat-calendar class="mat-calendar"><table class="mat-calendar-table"><tbody class="mat-calendar-body"><tr>${cells.join('')}</tr></tbody></table></mat-calendar>`;
  return page('VFS Global – Book appointment', '<app-root><p>Loading…</p></app-root>',
    `<style>.mat-calendar-body-cell{cursor:default}.mat-calendar-body-cell:not(.mat-calendar-body-disabled){cursor:pointer}</style>
     <script>setTimeout(() => { document.querySelector('app-root').innerHTML = ${JSON.stringify(html)}; }, 1000);</script>`, '');
}

/** Generic Kendo-style widget: disabled days still contain a link, only the class says "disabled". */
function kendoCalendar() {
  let cells = '';
  for (let d = 1; d <= 30; d++) cells += `<td role="gridcell" class="k-state-disabled k-disabled" aria-disabled="false"><a class="k-link" href="#">${d}</a></td>`;
  return page('BLS – Appointment', `<h2>Appointment Date</h2><div class="k-calendar"><table class="k-content"><tbody><tr>${cells}</tr></tbody></table></div>`);
}

/** BLS-style applicant form: birth date and passport expiry open a jQuery UI popup with every day
 *  selectable, like the real one. Nothing here is an appointment calendar. */
function blsApplicantForm() {
  return page('BLS Spain – Applicant Details', `
    <h2>Applicant Details</h2>
    <form>
      <div class="form-group"><label for="GivenName">Given name</label><input id="GivenName"></div>
      <div class="form-group"><label for="DateOfBirth">Date of Birth</label><input id="DateOfBirth" class="hasDatepicker" autocomplete="off"></div>
      <div class="form-group"><label for="PassportExpiry">Passport Expiry Date</label><input id="PassportExpiry" class="hasDatepicker" autocomplete="off"></div>
      <div class="form-group"><label for="TravelDate">Intended date of travel</label><input id="TravelDate" class="hasDatepicker" autocomplete="off"></div>
    </form>
    <div id="ui-datepicker-div" class="ui-datepicker ui-widget" style="position:absolute;display:none"></div>`,
    `<script>
      // Like jQuery UI: the popup is filled and shown when a date input gets focus, hidden on blur.
      document.addEventListener('focusin', e => {
        if (!e.target.classList || !e.target.classList.contains('hasDatepicker')) return;
        let rows = '', d = 1;
        for (let w = 0; w < 5; w++) { rows += '<tr>'; for (let i = 0; i < 7; i++, d++) rows += d <= 30 ? '<td data-handler="selectDay"><a class="ui-state-default" href="#">' + d + '</a></td>' : '<td class="ui-datepicker-other-month ui-state-disabled">&nbsp;</td>'; rows += '</tr>'; }
        const div = document.getElementById('ui-datepicker-div');
        div.innerHTML = '<div class="ui-datepicker-title">March 1994</div><table class="ui-datepicker-calendar"><tbody>' + rows + '</tbody></table>';
        const r = e.target.getBoundingClientRect();
        div.style.left = r.left + 'px'; div.style.top = (r.bottom + window.scrollY) + 'px'; div.style.display = 'block';
      });
      document.addEventListener('focusout', () => { document.getElementById('ui-datepicker-div').style.display = 'none'; });
    </script>`, '<header><a href="#">Logout</a></header>');
}

const FIXTURES = {
  'bls-form': () => blsApplicantForm(),
  'bls-none': () => blsCalendar([]),
  'bls-slot': () => blsCalendar([12, 19]),
  'bls-auto': () => blsCalendar([12, 19], { centre: 'Casablanca', category: 'Tourism' }),
  'vfs-none': () => vfsCalendar(),
  'vfs-slot': () => vfsCalendar({ open: [12], banner: 'Earliest available slot for Tourism is : 12/11/2026' }),
  'kendo-none': () => kendoCalendar(),
  'cf-challenge': () => `<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><p>Checking your browser before accessing the site.</p></body></html>`,
  'captcha-widget': () => page('BLS – Appointment', `<h2>Appointment Date</h2><div class="g-recaptcha" style="width:304px;height:78px;border:1px solid #ccc"></div>`),
  'bls-booked': () => page('BLS Spain – Appointment confirmed', `
    <h2>Appointment Confirmed</h2>
    <p>Your appointment has been booked successfully. Please print this page.</p>
    <table><tr><td>Appointment No :</td><td>BLS/RBA/2611/00123</td></tr>
    <tr><td>Appointment Date:</td><td>12/11/2026</td></tr><tr><td>Time Slot:</td><td>09:30-09:45</td></tr>
    <tr><td>Centre:</td><td>Rabat</td></tr></table>`),
  'login': () => `<!doctype html><html><body><main><h1>Sign in</h1><input type="email"><input type="password"><a href="#">Forgot password?</a></main></body></html>`,
};

// ---------- tiny runner ----------
const results = [];
const opened = [];                           // pages a scenario opened; closed when it ends
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✘ ${name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`); }
  finally {
    for (const p of opened.splice(0)) { try { if (!p.isClosed()) await p.close(); } catch (e) {} }
    // The background's tab-closed handler writes settings a moment after a watched tab closes;
    // let it finish so it cannot overwrite the next scenario's clean state.
    await new Promise(r => setTimeout(r, 300));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdv-smoke-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--autoplay-policy=no-user-gesture-required'],
  });

  const scenario = {};                       // url path → fixture key
  const hits = {};                           // url path → request count
  await context.route(/^https:\/\/(www\.blsspainmorocco\.com|visa\.vfsglobal\.com)\//, async route => {
    const u = new URL(route.request().url());
    if (route.request().resourceType() !== 'document') return route.fulfill({ status: 204, body: '' });
    hits[u.pathname] = (hits[u.pathname] || 0) + 1;
    const key = scenario[u.pathname];
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: key ? FIXTURES[key]() : '<h1>404</h1>' });
  });
  // Anything else stays offline.
  await context.route(/^https?:\/\/(?!www\.blsspainmorocco\.com|visa\.vfsglobal\.com)/, r => r.abort());

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const storage = () => sw.evaluate(() => chrome.storage.local.get(null));
  const notifications = () => sw.evaluate(async () => Object.keys(await chrome.notifications.getAll()));
  const clearNotifications = () => sw.evaluate(async () => { for (const id of Object.keys(await chrome.notifications.getAll())) await chrome.notifications.clear(id); });
  const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find(t => t.url === u).id, url);
  const badgeState = (p) => p.evaluate(() => { const b = document.getElementById('rdv-maroc-badge'); return b ? { state: b.dataset.state, text: b.textContent } : null; });
  const waitBadge = (p, state, timeout = 10000) => p.waitForFunction(s => { const b = document.getElementById('rdv-maroc-badge'); return b && b.dataset.state === s; }, state, { timeout })
    .catch(async e => { throw new Error(`badge never became "${state}": now ${JSON.stringify(await badgeState(p).catch(() => null))}, status ${JSON.stringify((await storage()).status)}`); });
  /** The refresh timer is stored a moment after the badge and status; wait for it. */
  async function waitNextAt(timeout = 5000) {
    const end = Date.now() + timeout;
    for (;;) {
      const { nextAt } = await storage();
      if (nextAt > Date.now()) return nextAt;
      if (Date.now() > end) throw new Error(`no refresh scheduled (nextAt ${nextAt})`);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  /** The content script writes settings/status right after the badge; wait for them. */
  async function waitStatus(state, timeout = 5000) {
    const end = Date.now() + timeout;
    for (;;) {
      const s = await storage();
      if (s.status && s.status.state === state) return s;
      if (Date.now() > end) throw new Error(`status never became "${state}": ${JSON.stringify(s.status)}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const MANUAL = { autoStart: false, auto: false, sound: false, interval: 60 };
  const AUTO = { autoStart: true, auto: true, sound: false, interval: 60 };
  /** Clean slate: no storage, no documents, no notifications; then the given settings. */
  async function fresh(settings = MANUAL) {
    await clearNotifications();
    await sw.evaluate(async (s) => {
      await chrome.storage.local.clear();
      await new Promise(res => {
        const r = indexedDB.deleteDatabase('rdv-maroc');
        r.onsuccess = r.onerror = r.onblocked = () => res();
        setTimeout(res, 2000);
      });
      await chrome.storage.local.set({ settings: s });
    }, settings);
  }
  /** Opens a portal URL serving `fixture`; the tab is closed when the scenario ends. */
  async function open(url, fixture) {
    scenario[new URL(url).pathname] = fixture;
    const p = await context.newPage();
    opened.push(p);
    await p.goto(url);
    return p;
  }

  /** Opens popup.html in a tab, pointed at `targetUrl` as if it were the active tab. */
  async function openPopup(targetUrl) {
    const p = await context.newPage();
    opened.push(p);
    await p.goto(`chrome-extension://${extId}/popup.html`);
    await p.waitForSelector('#destination option', { state: 'attached' });
    if (targetUrl) {
      const id = await tabIdOf(targetUrl);
      await p.evaluate((tid) => { chrome.tabs.query = async () => [await chrome.tabs.get(tid)]; }, id);
    }
    return p;
  }
  /** Presses Start in the popup for `url`, with the choices a user would make. */
  async function startWatching(url, { destination = 'spain', centre = 'Rabat', clearPick = false } = {}) {
    const p = await openPopup(url);
    await p.selectOption('#destination', destination);
    if (centre) await p.selectOption('#centre', centre);
    if (clearPick) await p.click('#clearPick');
    await p.click('#start');
    await p.waitForFunction(() => /Watching\./.test(document.getElementById('hint').textContent));   // the popup has finished
    await p.close();
  }
  async function stopWatching(url) {
    const p = await openPopup(url);
    await p.click('#stop');
    await p.waitForFunction(() => !document.getElementById('start').classList.contains('hidden'));
    await p.close();
  }
  async function openDashboard() {
    const d = await context.newPage();
    opened.push(d);
    await d.goto(`chrome-extension://${extId}/dashboard.html`);
    await d.waitForSelector('#rows', { state: 'attached' });
    return d;
  }
  /** Creates "Yahya El Amrani · Spain · Rabat" through the dashboard UI; returns its id. */
  async function createApp(dash) {
    await dash.click('#newApp');
    await dash.waitForSelector('#drawer:not(.hidden) [data-key="surname"]');
    await dash.fill('[data-key="givenName"]', 'Yahya');
    await dash.fill('[data-key="surname"]', 'El Amrani');
    await dash.fill('[data-key="passport"]', 'XB1234567');
    await dash.fill('[data-key="birthDate"]', '1994-03-07');
    await dash.selectOption('[data-key="destinationId"]', 'spain');
    await dash.selectOption('[data-key="centre"]', 'Rabat');
    await dash.click('#editBtn');                     // Done
    await dash.waitForFunction(() => document.getElementById('pName').textContent === 'Yahya El Amrani');
    const { applications } = await storage();
    assert(applications.length === 1, `${applications.length} applications`);
    return applications[0].id;
  }
  /** Opens the portal's confirmation page and waits until the application is booked. */
  async function bookViaPortal(appId) {
    const conf = await open(BLS_CONFIRM_URL, 'bls-booked');
    await waitBadge(conf, 'booked', 10000);
    const end = Date.now() + 5000;
    let a;
    do { a = (await storage()).applications.find(x => x.id === appId); if (a && a.status === 'booked') break; await conf.waitForTimeout(100); } while (Date.now() < end);
    assert(a && a.status === 'booked', `status ${a && a.status}`);
    return conf;
  }

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  async function uploadDoc(dash) {
    await dash.click('#dTabs [data-t="docs"]');
    await dash.setInputFiles('#fileIn', { name: 'passport-scan.png', mimeType: 'image/png', buffer: PNG });
    await dash.waitForSelector('.doc');
  }
  /** Documents as stored in IndexedDB, seen from an extension page. */
  const storedDocs = (p) => p.evaluate(() => new Promise(res => {
    const r = indexedDB.open('rdv-maroc', 1);
    r.onsuccess = () => { const g = r.result.transaction('docs').objectStore('docs').getAll(); g.onsuccess = () => res(g.result.map(d => ({ encrypted: !!d.encrypted, hasBlob: !!d.blob, hasEnc: !!d.enc, name: d.name }))); };
  }));
  async function closeDrawer(dash) { if (await dash.isVisible('#scrim')) { await dash.click('#close'); await dash.waitForSelector('#scrim.hidden', { state: 'attached' }); } }
  async function enableProtection(dash, pass) {
    await closeDrawer(dash);
    await dash.click('#railLock');
    await dash.click('#secEnable');
    await dash.fill('#pass1', pass);
    await dash.fill('#pass2', pass);
    await dash.click('#passOk');
    await dash.waitForFunction(() => document.getElementById('railLock').classList.contains('on'));
    const end = Date.now() + 8000;
    for (;;) {
      const s = await storage();
      if (s.applications.length && s.applications.every(a => a.privateEnc)) return s;
      if (Date.now() > end) throw new Error('applications were not sealed');
      await dash.waitForTimeout(100);
    }
  }

  console.log(`Extension ${extId} loaded in ${await sw.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0])}`);

  // ---------- manifest ----------
  await check('chrome://extensions reports no errors or warnings for the extension', async () => {
    const p = await context.newPage();
    opened.push(p);
    await p.goto('chrome://extensions/');
    const info = await p.evaluate((id) => new Promise(r => chrome.developerPrivate.getExtensionInfo(id, r)), extId);
    const problems = [...(info.manifestErrors || []).map(e => e.message), ...(info.installWarnings || []), ...(info.runtimeErrors || []).map(e => e.message)];
    assert(!problems.length, problems.join('\n'));
  });

  // ---------- popup ----------
  await check('popup lists every destination and its centres', async () => {
    await fresh();
    const p = await openPopup();
    const dests = await p.$$eval('#destination option', os => os.map(o => [o.value, o.textContent]));
    const ids = dests.map(d => d[0]);
    for (const id of ['spain', 'portugal', 'italy', 'netherlands', 'germany', 'switzerland', 'belgium', 'austria', 'other', 'france']) assert(ids.includes(id), `missing destination ${id}`);
    const expectCentres = { spain: ['Casablanca', 'Rabat', 'Tanger', 'Nador', 'Tétouan', 'Agadir'], portugal: ['Casablanca', 'Rabat', 'Tanger'], italy: ['Casablanca', 'Rabat', 'Tanger'], austria: ['Rabat'] };
    for (const [id, centres] of Object.entries(expectCentres)) {
      await p.selectOption('#destination', id);
      const got = await p.$$eval('#centre option', os => os.map(o => o.value));
      for (const c of centres) assert(got.includes(c), `${id}: missing centre ${c} (got ${got.join(', ')})`);
    }
    assert((await p.$$eval('#category option', os => os.length)) >= 8, 'categories missing');
  });

  await check('France is greyed out, explained, and cannot be started', async () => {
    await fresh();
    const p = await openPopup();
    const fr = await p.$eval('#destination option[value="france"]', o => ({ cls: o.className, color: getComputedStyle(o).color }));
    const normal = await p.$eval('#destination option[value="spain"]', o => getComputedStyle(o).color);
    assert(fr.color !== normal, `France option is not greyed (color ${fr.color})`);
    await p.selectOption('#destination', 'france');
    assert(await p.isVisible('#franceNote'), 'France explanation not shown');
    assert(/randomly/.test(await p.textContent('#franceNote')), 'France explanation text');
    assert(await p.isDisabled('#start'), 'Start should be disabled for France');
    assert((await p.$eval('#start', b => getComputedStyle(b).opacity)) < 1, 'disabled Start button should look disabled');
    await p.selectOption('#destination', 'spain');
    assert(!(await p.isVisible('#franceNote')) && !(await p.isDisabled('#start')), 'Spain re-enables Start');
  });

  await check('"Test alert" creates a desktop notification and plays the sound', async () => {
    await fresh({ ...MANUAL, sound: true });
    const p = await openPopup();
    await p.click('#test');
    await p.waitForFunction(() => /Test alert sent/.test(document.getElementById('hint').textContent));
    const ids = await notifications();
    assert(ids.some(id => id.startsWith('rdv-')), `no notification (got ${ids})`);
    const offscreen = await sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).map(c => c.documentUrl));
    assert(offscreen.some(u => u.endsWith('/offscreen.html')), 'offscreen audio document not created');
    // Same message the Test button sends; the reply says whether alert.wav actually started playing.
    const r = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'slotFound', test: true, title: 'RDV Maroc: test alert', body: 'smoke', tabId: null, sound: true }));
    assert(r && r.soundPlayed === true, `alert.wav did not play in the offscreen document (${JSON.stringify(r)})`);
    assert((await sw.evaluate(() => chrome.action.getBadgeText({}))) !== '!', 'test alert must not leave the red "slot" badge');
  });

  // ---------- BLS flow, buttons pressed by hand ----------
  await check('BLS page shows the in-page badge before watching', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    await bls.waitForSelector('#rdv-maroc-badge', { timeout: 10000 });
    assert(/ready/.test((await badgeState(bls)).text), JSON.stringify(await badgeState(bls)));
  });

  await check('"Pick calendar area": clicking a day cell selects the whole calendar', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    await bls.waitForSelector('#rdv-maroc-badge');
    const p = await openPopup(BLS_URL);
    await p.click('#pick').catch(() => {});        // the popup closes itself
    await waitBadge(bls, 'unknown');
    assert(/Pick area/.test((await badgeState(bls)).text), 'picker not active');
    await bls.click('table.ui-datepicker-calendar td:nth-child(3) >> nth=1');
    await bls.waitForFunction(() => /Area set/.test(document.getElementById('rdv-maroc-badge').textContent));
    const { settings } = await storage();
    const picked = await bls.evaluate(sel => { const el = document.querySelector(sel); return el && el.querySelectorAll('td').length; }, settings.selector);
    assert(picked >= 28, `picked area "${settings.selector}" holds ${picked} cells, expected the whole calendar`);
  });

  await check('"Start watching this tab" with interval 60 s → status "No slots"', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    const p = await openPopup(BLS_URL);
    await p.selectOption('#destination', 'spain');
    await p.selectOption('#centre', 'Rabat');
    await p.$eval('#interval', el => { el.value = '60'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await p.$eval('#sound', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
    await p.click('#start');
    await waitBadge(bls, 'none');
    await p.waitForFunction(() => document.getElementById('statusPill').textContent === 'No slots');
    const { settings, status } = await storage();
    assert(settings.watching && settings.interval === 60 && settings.watchTabId === (await tabIdOf(BLS_URL)), JSON.stringify(settings));
    assert(status.state === 'none', JSON.stringify(status));
  });

  await check('Start takes effect even if the popup closes before its message is sent', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    await bls.waitForSelector('#rdv-maroc-badge');
    const p = await openPopup(BLS_URL);
    await p.click('#start');
    await p.close();                               // no waiting: the message to the tab may be lost
    await waitBadge(bls, 'none');
    const s = await waitStatus('none');
    assert(s.settings.watching, 'tab did not follow the stored Start');
    await waitNextAt();
    await stopWatching(BLS_URL);
    await bls.waitForFunction(() => /press Start/.test(document.getElementById('rdv-maroc-badge').textContent));
  });

  await check('refresh is scheduled 60–69 s out (never under 60 s)', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    const started = Date.now();
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    const nextAt = await waitNextAt();
    const secs = (nextAt - started) / 1000;
    assert(secs >= 59.5 && secs <= 70, `next refresh in ${secs.toFixed(1)} s`);
  });

  await check('auto-refresh fires after the interval and a new slot alerts once', async () => {
    await fresh();
    const blsPath = new URL(BLS_URL).pathname;
    const bls = await open(BLS_URL, 'bls-none');
    const started = Date.now();
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    const nextAt = await waitNextAt();
    const before = hits[blsPath];
    scenario[blsPath] = 'bls-slot';
    if (process.env.FAST) { hits[blsPath]++; await bls.reload(); hits[blsPath]--; }   // FAST=1: skip the real 60 s wait while iterating
    else await bls.waitForEvent('load', { timeout: Math.max(0, nextAt - Date.now()) + 10000 });
    const waited = process.env.FAST ? 60 : (Date.now() - started) / 1000;
    assert(hits[blsPath] === before + 1, `expected exactly one reload, got ${hits[blsPath] - before}`);
    assert(waited >= 59.5, `reloaded after only ${waited.toFixed(1)} s`);
    await waitBadge(bls, 'available');
    await bls.waitForSelector('#rdv-maroc-slot');
    const { lastHit } = await storage();
    assert(lastHit && lastHit.where === 'Spain · Rabat · Tourism · Tourisme', JSON.stringify(lastHit));
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
  });

  await check('after a refresh the interval is still 60 s and the same slot does not re-alert', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-slot');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'available');
    const { lastHit } = await storage();
    const t0 = Date.now();
    await bls.reload();
    await waitBadge(bls, 'available');
    await bls.waitForTimeout(2500);               // let the mutation observer settle
    const s = await storage();
    assert(s.settings.interval === 60, `interval changed to ${s.settings.interval}`);
    const secs = (s.nextAt - t0) / 1000;
    assert(secs >= 59 && secs <= 71, `next refresh in ${secs.toFixed(1)} s`);
    assert(s.lastHit.at === lastHit.at, 're-alerted for the same slot');
    assert((await notifications()).length === 1, `notifications after refresh: ${await notifications()}`);
    assert(!(await bls.$('#rdv-maroc-slot')), 'slot pop-up shown again for the same slot');
  });

  await check('slot disappears then reappears → alerts again', async () => {
    await fresh();
    const blsPath = new URL(BLS_URL).pathname;
    const bls = await open(BLS_URL, 'bls-slot');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'available');
    scenario[blsPath] = 'bls-none';
    await bls.reload(); await waitBadge(bls, 'none');
    scenario[blsPath] = 'bls-slot';
    await bls.reload(); await waitBadge(bls, 'available');
    await bls.waitForTimeout(500);
    assert((await notifications()).length === 2, `notifications: ${await notifications()}`);
  });

  await check('Cloudflare-style "Just a moment" page pauses the watcher', async () => {
    await fresh();
    const blsPath = new URL(BLS_URL).pathname;
    const bls = await open(BLS_URL, 'bls-none');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    scenario[blsPath] = 'cf-challenge';
    await bls.reload();
    await waitBadge(bls, 'captcha');
    const { settings, status, nextAt } = await waitStatus('captcha');
    assert(settings.watching === false && status.state === 'captcha' && !nextAt, JSON.stringify({ watching: settings.watching, status, nextAt }));
    assert(/human check/i.test(await bls.textContent('#rdv-maroc-banner')), 'banner should ask the user');
  });

  await check('a visible CAPTCHA widget (no text) pauses the watcher', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'captcha-widget');
    await bls.waitForSelector('#rdv-maroc-badge');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'captcha');
    const { settings, status } = await waitStatus('captcha');
    assert(settings.watching === false && status.state === 'captcha', JSON.stringify(status));
  });

  await check('a paused watcher does not refresh by itself', async () => {
    await fresh();
    const blsPath = new URL(BLS_URL).pathname;
    const bls = await open(BLS_URL, 'cf-challenge');
    await bls.waitForSelector('#rdv-maroc-badge');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'captcha');
    await waitStatus('captcha');
    const before = hits[blsPath];
    await bls.waitForTimeout(3000);
    assert(hits[blsPath] === before && !(await storage()).nextAt, 'refresh still scheduled while paused');
  });

  await check('being logged out stops the watcher', async () => {
    await fresh();
    const blsPath = new URL(BLS_URL).pathname;
    const bls = await open(BLS_URL, 'bls-none');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    scenario[blsPath] = 'login';
    await bls.reload();
    await waitBadge(bls, 'login', 15000);
    const { settings } = await waitStatus('login');
    assert(settings.watching === false, 'still watching after logout');
  });

  await check('Stop then Start again re-arms the alert for a slot already seen', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-slot');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'available');
    const { lastHit } = await storage();
    const p = await openPopup(BLS_URL);
    await p.click('#stop');
    await bls.waitForFunction(() => /press Start/.test(document.getElementById('rdv-maroc-badge').textContent));
    await p.click('#start');
    await p.close();
    await waitBadge(bls, 'available');
    const end = Date.now() + 5000;
    let s;
    do { s = await storage(); if (s.lastHit.at > lastHit.at) break; await bls.waitForTimeout(100); } while (Date.now() < end);
    assert(s.lastHit.at > lastHit.at, 'Start again did not alert for the slot already on screen');
  });

  await check('Stop clears the refresh timer and returns the badge to ready', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    await stopWatching(BLS_URL);
    await bls.waitForFunction(() => /press Start/.test(document.getElementById('rdv-maroc-badge').textContent));
    const s = await storage();
    assert(!s.settings.watching && !s.nextAt, JSON.stringify({ watching: s.settings.watching, nextAt: s.nextAt }));
  });

  await check('Kendo-style calendar with only disabled days is not a slot', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'kendo-none');
    await bls.waitForSelector('#rdv-maroc-badge');
    await startWatching(BLS_URL, { clearPick: true });
    await bls.waitForFunction(() => ['none', 'unknown', 'available'].includes(document.getElementById('rdv-maroc-badge').dataset.state) && !/checking/.test(document.getElementById('rdv-maroc-badge').textContent));
    const st = (await badgeState(bls)).state;
    assert(st !== 'available', 'disabled Kendo days were counted as selectable');
  });

  // ---------- VFS flow (SPA calendar rendered after load) ----------
  await check('VFS: watching an Angular Material calendar → "No slots"', async () => {
    await fresh();
    const vfs = await open(VFS_URL, 'vfs-none');
    await vfs.waitForSelector('#rdv-maroc-badge');
    await startWatching(VFS_URL, { destination: 'italy', centre: '', clearPick: true });
    await waitBadge(vfs, 'none');
  });

  await check('VFS: a day enabling live (no reload) alerts via the DOM observer', async () => {
    await fresh();
    const vfs = await open(VFS_URL, 'vfs-none');
    await vfs.waitForSelector('#rdv-maroc-badge');
    await startWatching(VFS_URL, { destination: 'italy', centre: '' });
    await waitBadge(vfs, 'none');
    await clearNotifications();
    await vfs.evaluate(() => {
      const b = document.querySelectorAll('.mat-calendar-body-cell')[11];
      b.classList.remove('mat-calendar-body-disabled'); b.setAttribute('aria-disabled', 'false');
      document.querySelector('.alert').textContent = 'Earliest available slot for Tourism is : 12/11/2026';
    });
    await waitBadge(vfs, 'available', 6000);
    const { lastHit } = await storage();
    assert(lastHit.dates.includes('2026-11-12'), JSON.stringify(lastHit));
    assert((await notifications()).length === 1, 'expected one notification');
  });

  await check('VFS: after a refresh the late-rendering calendar does not re-alert the same slot', async () => {
    await fresh();
    const vfs = await open(VFS_URL, 'vfs-slot');
    await vfs.waitForSelector('#rdv-maroc-badge');
    await startWatching(VFS_URL, { destination: 'italy', centre: '' });
    await waitBadge(vfs, 'available', 8000);
    const { lastHit } = await storage();
    await vfs.reload();
    await waitBadge(vfs, 'available', 8000);
    await vfs.waitForTimeout(2500);
    const s = await storage();
    assert(s.lastHit.at === lastHit.at, 're-alerted after refresh');
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
  });

  // ---------- in-page HUD, toasts, slot pop-up, tab title ----------
  await check('HUD: countdown ring, live details, toasts and a tab-title countdown while watching; Pause from the HUD', async () => {
    await fresh();
    const bls = await open(BLS_URL, 'bls-none');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'none');
    await bls.waitForFunction(() => /^● \d+s – BLS Spain/.test(document.title));
    assert(await bls.$('#rdv-maroc-badge .rdv-ring.rdv-on'), 'countdown ring not shown');
    const ringText = await bls.textContent('#rdv-maroc-badge .rdv-ring text');
    assert(/^\d+$/.test(ringText) && +ringText <= 70 && +ringText >= 50, `ring shows "${ringText}"`);
    const toasts = await bls.$$eval('#rdv-maroc-toasts .rdv-toast', els => els.map(e => e.textContent));
    assert(toasts.some(t => /Watching/.test(t)), `toasts: ${toasts.join(' | ')}`);
    await bls.click('#rdv-maroc-badge .rdv-more');
    await bls.waitForFunction(() => /\d+ checks?/.test(document.querySelector('#rdv-maroc-badge .rdv-meta').textContent));
    assert(/Spain · Rabat/.test(await bls.textContent('#rdv-maroc-badge .rdv-meta')), await bls.textContent('#rdv-maroc-badge .rdv-meta'));
    await bls.click('#rdv-maroc-badge [data-act="pause"]');
    await bls.waitForFunction(() => /press Start/.test(document.querySelector('#rdv-maroc-badge .rdv-sub').textContent));
    const s = await storage();
    assert(!s.settings.watching && !s.nextAt, 'Pause from the HUD was ignored');
    assert(!/^● /.test(await bls.title()), `title prefix not restored: ${await bls.title()}`);
    await bls.click('#rdv-maroc-badge [data-act="resume"]');
    await waitBadge(bls, 'none');
    assert((await storage()).settings.watching, 'Resume from the HUD was ignored');
  });

  await check('slot pop-up: dates, timer, page flash, title, "Show me the day" scrolls to the green day, applicant details ready to copy', async () => {
    await fresh();
    await sw.evaluate((m) => chrome.storage.local.set({
      applications: [{ id: 'app-1', num: 1001, createdAt: Date.now(), status: 'watching', destinationId: 'italy', centre: 'Rabat', category: 'Tourism · Tourisme',
        applicant: { givenName: 'Yahya', surname: 'El Amrani', passport: 'XB1234567', birthDate: '1994-03-07' }, history: [] }],
      settings: { ...m, activeAppId: 'app-1' },
    }), MANUAL);
    const vfs = await open(VFS_URL, 'vfs-slot');
    await vfs.waitForSelector('#rdv-maroc-badge');
    await startWatching(VFS_URL, { destination: 'italy', centre: 'Rabat' });
    await waitBadge(vfs, 'available', 8000);
    await vfs.waitForSelector('#rdv-maroc-slot');
    const pop = await vfs.textContent('#rdv-maroc-slot');
    assert(/SLOT AVAILABLE/.test(pop) && /2026-11-12/.test(pop) && /Italy · Rabat/.test(pop), pop);
    assert(/^🟢 SLOT! – /.test(await vfs.title()), await vfs.title());
    assert(await vfs.$('#rdv-maroc-flash'), 'no page flash');
    await vfs.waitForFunction(() => /seen \d+s ago/.test(document.querySelector('#rdv-maroc-slot .rdv-s-ago').textContent), null, { timeout: 4000 });
    const copies = await vfs.$$eval('#rdv-maroc-slot .rdv-copy', els => els.map(e => e.dataset.copy));
    assert(copies.includes('XB1234567') && copies.includes('07/03/1994') && copies.includes('El Amrani'), `copy strip: ${copies}`);
    // Push the calendar far down, then ask to be shown the day: it scrolls into view and flashes.
    await vfs.evaluate(() => { document.querySelector('mat-calendar').style.marginTop = '2400px'; window.scrollTo(0, 0); });
    await vfs.click('#rdv-maroc-slot [data-act="show"]');
    await vfs.waitForFunction(() => {
      const c = document.querySelector('.rdv-slot-day');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && c.classList.contains('rdv-flash');
    }, null, { timeout: 5000 });
    assert((await vfs.$$('.rdv-slot-day')).length === 1, 'the free day lost its outline');
    await vfs.click('#rdv-maroc-slot [data-act="dismiss"]');
    await vfs.waitForFunction(() => !document.getElementById('rdv-maroc-slot'));
    // Same slot after a refresh: no second pop-up. Slot gone: a toast says so.
    await vfs.reload();
    await waitBadge(vfs, 'available', 8000);
    await vfs.waitForTimeout(2500);
    assert(!(await vfs.$('#rdv-maroc-slot')), 'the same slot popped up again after a refresh');
    scenario[new URL(VFS_URL).pathname] = 'vfs-none';
    await vfs.reload();
    await waitBadge(vfs, 'none', 8000);
    await vfs.waitForFunction(() => [...document.querySelectorAll('#rdv-maroc-toasts .rdv-toast')].some(t => /Slot gone/.test(t.textContent)), null, { timeout: 4000 });
  });

  await check('dashboard: live alert bar, pulsing row and title while a slot is visible; "Go to the portal tab" focuses it', async () => {
    await fresh();
    const dash = await openDashboard();
    const appId = await createApp(dash);
    const bls = await open(BLS_URL, 'bls-slot');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'available');
    await dash.bringToFront();
    await dash.waitForFunction(() => !document.getElementById('liveBar').classList.contains('hidden') && /SLOT AVAILABLE/.test(document.getElementById('liveBarText').textContent));
    assert(/^🟢 SLOT!/.test(await dash.title()), await dash.title());
    await dash.waitForFunction(id => { const tr = document.querySelector(`#rows tr[data-id="${id}"]`); return tr && tr.classList.contains('live-slot'); }, appId);
    await dash.click('#close');                       // the detail panel was still open from creating the application
    await dash.click('#liveBarGo');
    await dash.waitForTimeout(400);
    const active = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].url);
    assert(active === BLS_URL, `active tab is ${active}`);
  });

  // ---------- autonomous mode: nothing pressed, choices read from the page ----------
  await check('auto: a BLS calendar with free days starts watching and alerts without any click', async () => {
    await fresh(AUTO);
    const auto = await open(BLS_AUTO_URL, 'bls-auto');
    await waitBadge(auto, 'available', 15000);
    const s = await waitStatus('available');
    assert(s.settings.watching && s.settings.autoStarted, JSON.stringify(s.settings));
    assert(s.settings.watchTabId === (await tabIdOf(BLS_AUTO_URL)), 'watchTabId is not this tab');
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
  });

  await check('auto: destination, centre and category are read from the portal page', async () => {
    await fresh(AUTO);
    const auto = await open(BLS_AUTO_URL, 'bls-auto');
    await waitBadge(auto, 'available', 15000);
    await waitStatus('available');
    const { settings, lastHit } = await storage();
    assert(settings.destinationId === 'spain' && settings.centre === 'Casablanca' && settings.category === 'Tourism · Tourisme', JSON.stringify([settings.destinationId, settings.centre, settings.category]));
    assert(lastHit.where === 'Spain · Casablanca · Tourism · Tourisme', lastHit.where);
    const p = await openPopup(BLS_AUTO_URL);
    await p.waitForFunction(() => /From the portal page: Spain · Casablanca · Tourism/.test(document.getElementById('autoText').textContent));
    assert((await p.inputValue('#destination')) === 'spain' && (await p.inputValue('#centre')) === 'Casablanca', 'popup lists do not show the detected values');
  });

  await check('auto: the free days are outlined on the page, never clicked', async () => {
    await fresh(AUTO);
    const blsAutoPath = new URL(BLS_AUTO_URL).pathname;
    const before = hits[blsAutoPath] || 0;
    const auto = await open(BLS_AUTO_URL, 'bls-auto');
    await waitBadge(auto, 'available', 15000);
    const days = await auto.$$eval('.rdv-slot-day', els => els.map(e => e.textContent.trim()));
    assert(days.length === 2 && days.includes('12') && days.includes('19'), `highlighted: ${days}`);
    assert(hits[blsAutoPath] === before + 1, 'the page navigated by itself');
  });

  await check('auto: Stop in the popup is respected on that page, even after a reload', async () => {
    await fresh(AUTO);
    const auto = await open(BLS_AUTO_URL, 'bls-auto');
    await waitBadge(auto, 'available', 15000);
    await stopWatching(BLS_AUTO_URL);
    await auto.waitForFunction(() => /stopped/.test(document.getElementById('rdv-maroc-badge').textContent));
    await auto.reload();
    await auto.waitForSelector('#rdv-maroc-badge');
    await auto.waitForTimeout(3000);
    const { settings } = await storage();
    assert(!settings.watching && /stopped/.test((await badgeState(auto)).text), JSON.stringify(await badgeState(auto)));
    assert(!(await auto.$('.rdv-slot-day')), 'highlight left behind while stopped');
  });

  await check('auto: an applicant form with birth / passport / travel date pickers never starts or alerts', async () => {
    await fresh(AUTO);
    const form = await open('https://www.blsspainmorocco.com/MAR/account/applicant-details', 'bls-form');
    await form.waitForSelector('#rdv-maroc-badge');
    for (const id of ['DateOfBirth', 'PassportExpiry', 'TravelDate']) {
      await form.focus(`#${id}`);
      await form.waitForSelector('#ui-datepicker-div td a');         // 30 "selectable" days are showing
      await form.waitForTimeout(1200);
      await form.focus('#GivenName');
      await form.waitForTimeout(600);
    }
    const s = await storage();
    assert(!s.settings.watching, 'started watching on an applicant form');
    assert((await notifications()).length === 0, `alerted on a form date picker: ${await notifications()}`);
    assert(!(await form.$('.rdv-slot-day')), 'form picker days were highlighted');
    assert(/waiting for an appointment calendar/.test((await badgeState(form)).text), JSON.stringify(await badgeState(form)));
  });

  await check('a manual Start on the applicant form watches but ignores its date pickers', async () => {
    await fresh();
    const form = await open('https://www.blsspainmorocco.com/MAR/account/applicant-details', 'bls-form');
    await form.waitForSelector('#rdv-maroc-badge');
    await startWatching('https://www.blsspainmorocco.com/MAR/account/applicant-details');
    await form.focus('#DateOfBirth');
    await form.waitForSelector('#ui-datepicker-div td a');
    await form.waitForTimeout(1500);
    const st = await badgeState(form);
    const s = await storage();
    assert(s.settings.watching, 'manual Start was ignored');
    assert(st.state !== 'available' && (await notifications()).length === 0, `birth-date picker counted as a slot: ${JSON.stringify(st)}`);
  });

  await check('auto: a VFS calendar rendered after load starts watching by itself', async () => {
    await fresh(AUTO);
    const vauto = await open(VFS_AUTO_URL, 'vfs-none');
    await waitBadge(vauto, 'none', 15000);
    const s = await waitStatus('none');
    assert(s.settings.watching && s.settings.autoStarted, 'not watching');
    assert(s.settings.destinationId === 'italy' && s.settings.centre === 'Rabat', JSON.stringify([s.settings.destinationId, s.settings.centre]));
  });

  await check('auto: a verification page pauses, and watching resumes by itself once the calendar is back', async () => {
    await fresh(AUTO);
    const vfsAutoPath = new URL(VFS_AUTO_URL).pathname;
    const vauto = await open(VFS_AUTO_URL, 'vfs-none');
    await waitBadge(vauto, 'none', 15000);
    scenario[vfsAutoPath] = 'cf-challenge';
    await vauto.reload();
    await waitBadge(vauto, 'captcha');
    const paused = await waitStatus('captcha');
    assert(paused.settings.watching === false, 'still watching on the challenge page');
    scenario[vfsAutoPath] = 'vfs-slot';
    await clearNotifications();
    await vauto.reload();                       // the user solved it; the portal shows the calendar again
    await waitBadge(vauto, 'available', 15000);
    const s = await waitStatus('available');
    assert(s.settings.watching && s.settings.autoStarted, 'did not resume');
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
    assert((await vauto.$$('.rdv-slot-day')).length === 1, 'free day not highlighted');
  });

  // ---------- dashboard: applications, booking capture, documents ----------
  await check('dashboard: empty state, then a new application is created, filled and linked to the watcher', async () => {
    await fresh();
    const dash = await openDashboard();
    assert(await dash.isVisible('#empty'), 'empty state not shown');
    const appId = await createApp(dash);
    const { applications, settings } = await storage();
    const a = applications[0];
    assert(a.id === appId && a.applicant.passport === 'XB1234567' && a.centre === 'Rabat' && a.destinationId === 'spain', JSON.stringify(a));
    assert(settings.activeAppId === a.id, 'first application should be linked to the watcher');
    const row = await dash.textContent('#rows tr');
    assert(/#1001/.test(row) && /Yahya El Amrani/.test(row) && /Spain/.test(row) && /Rabat/.test(row), row);
    assert((await dash.$$('#kvApplicant .copy')).length >= 4, 'copy buttons missing');
    const birth = await dash.$$eval('#kvApplicant .v', vs => vs.map(v => v.textContent).find(t => /1994/.test(t)));
    assert(birth, 'birth date not shown');
  });

  await check('dashboard: the portal confirmation page books the linked application automatically', async () => {
    await fresh();
    const dash = await openDashboard();
    const appId = await createApp(dash);
    await clearNotifications();
    const conf = await bookViaPortal(appId);
    const a = (await storage()).applications.find(x => x.id === appId);
    assert(a.appointment.date === '2026-11-12' && a.appointment.time === '09:30' && a.appointment.reference === 'BLS/RBA/2611/00123', JSON.stringify(a.appointment));
    assert(a.history[0].type === 'booked', JSON.stringify(a.history[0]));
    assert((await notifications()).some(id => id.startsWith('rdv-booked-')), 'no booked notification');
    // Reloading the confirmation page must not file the booking twice.
    await conf.reload();
    await waitBadge(conf, 'booked', 10000);
    await conf.waitForTimeout(800);
    const again = (await storage()).applications.find(x => x.id === appId);
    assert(again.history.filter(h => h.type === 'booked').length === 1, 'booking recorded twice');
  });

  await check('dashboard: shows the booking, its details and an .ics for the calendar', async () => {
    await fresh();
    const dash = await openDashboard();
    const appId = await createApp(dash);
    await bookViaPortal(appId);
    await dash.bringToFront();
    await dash.waitForFunction(() => document.getElementById('sBooked').textContent === '1');
    const row = await dash.textContent('#rows tr');
    assert(/Booked/.test(row) && /2026/.test(row) && /09:30/.test(row), row);
    await dash.click('#dTabs [data-t="appt"]');
    await dash.waitForSelector('.appt.booked');
    const card = await dash.textContent('.appt.booked');
    assert(/BLS\/RBA\/2611\/00123/.test(card) && /09:30/.test(card) && /Rabat/.test(card), card);
    const [dl] = await Promise.all([dash.waitForEvent('download'), dash.click('text=Add to calendar')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert(/DTSTART:20261112T093000/.test(ics) && /BLS\/RBA\/2611\/00123/.test(ics), ics);
    await dash.click('.checklist input >> nth=0');
    await dash.waitForFunction(() => /1 \/ 10 ready/.test(document.getElementById('chkCount').textContent));
  });

  await check('dashboard: documents are stored in the browser, previewed and deleted', async () => {
    await fresh();
    const dash = await openDashboard();
    await createApp(dash);
    await dash.click('#dTabs [data-t="docs"]');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await dash.setInputFiles('#fileIn', { name: 'passport-scan.png', mimeType: 'image/png', buffer: png });
    await dash.waitForSelector('.doc');
    assert(/passport-scan\.png/.test(await dash.textContent('.doc')), 'document not listed');
    await dash.click('.doc >> text=Preview');
    await dash.waitForSelector('#viewer:not(.hidden) img');
    await dash.click('#zIn');
    assert((await dash.textContent('#zVal')) === '125%', 'zoom');
    dash.once('dialog', d => d.accept());
    await dash.click('.doc [title="Delete"]');
    await dash.waitForFunction(() => !document.querySelector('.doc'));
  });

  // ---------- passphrase protection ----------
  await check('protection: switching it on seals applicant details and documents; storage and the backup hold no plaintext', async () => {
    await fresh();
    const dash = await openDashboard();
    await createApp(dash);
    await uploadDoc(dash);
    const s = await enableProtection(dash, 'horse-battery-7');
    const a = s.applications[0];
    assert(a.applicantLocked && !Object.keys(a.applicant || {}).length && a.privateEnc.iv && a.privateEnc.data, JSON.stringify(a));
    const dump = JSON.stringify(s);
    assert(!dump.includes('XB1234567') && !dump.includes('El Amrani') && !dump.includes('1994-03-07'), 'plaintext left in storage');
    assert(s.settings.encryption.salt && s.settings.encryption.check, 'encryption settings missing');
    await dash.click('#rows tr');
    await dash.waitForSelector('#drawer:not(.hidden)');
    assert((await dash.textContent('#pName')) === 'Yahya El Amrani', 'the tab that holds the key should still show the name');
    assert(/XB1234567/.test(await dash.textContent('#kvApplicant')), 'the tab that holds the key should still show the passport');
    const docs = await storedDocs(dash);
    assert(docs.length === 1 && docs[0].encrypted && docs[0].hasEnc && !docs[0].hasBlob && docs[0].name === 'Encrypted document', JSON.stringify(docs));
    await dash.click('#dTabs [data-t="docs"]');
    await dash.waitForFunction(() => /passport-scan\.png/.test(((document.querySelector('.doc .doc-name') || {}).textContent) || ''));
    await closeDrawer(dash);
    const [dl] = await Promise.all([dash.waitForEvent('download'), dash.click('#railExport')]);
    const json = fs.readFileSync(await dl.path(), 'utf8');
    assert(!json.includes('XB1234567') && !json.includes('El Amrani') && /"encrypted": true/.test(json), 'backup leaks plaintext');
  });

  await check('protection: a new dashboard tab is locked; wrong passphrase refused, right one opens details and documents; popup and slot pop-up stay locked; removal restores plaintext', async () => {
    await fresh();
    const dash = await openDashboard();
    await createApp(dash);
    await uploadDoc(dash);
    await enableProtection(dash, 'horse-battery-7');
    const p = await openPopup();
    const opts = await p.$$eval('#activeApp option', os => os.map(o => o.textContent));
    assert(opts.some(o => /#1001 🔒 locked · Spain/.test(o)), opts.join(' | '));
    await p.close();
    const bls = await open(BLS_URL, 'bls-slot');
    await startWatching(BLS_URL);
    await waitBadge(bls, 'available');
    await bls.waitForSelector('#rdv-maroc-slot .rdv-s-copy');
    const popText = await bls.textContent('#rdv-maroc-slot');
    assert(/locked with your passphrase/.test(popText) && !popText.includes('XB1234567'), popText);
    const d2 = await openDashboard();
    await d2.waitForSelector('#lockScreen:not(.hidden)');
    await d2.waitForFunction(() => /Locked/.test(document.querySelector('#rows tr').textContent));
    await d2.click('#lockUnlock');
    await d2.fill('#pass1', 'wrong-pass-1');
    await d2.click('#passOk');
    await d2.waitForFunction(() => /Wrong passphrase/.test(document.getElementById('toast').textContent));
    assert(await d2.isVisible('#lockScreen'), 'unlocked with a wrong passphrase');
    await d2.click('#lockUnlock');
    await d2.fill('#pass1', 'horse-battery-7');
    await d2.click('#passOk');
    await d2.waitForFunction(() => document.getElementById('lockScreen').classList.contains('hidden') && /Yahya El Amrani/.test(document.querySelector('#rows tr').textContent));
    await d2.click('#rows tr');
    await d2.waitForSelector('#drawer:not(.hidden)');
    assert(/XB1234567/.test(await d2.textContent('#kvApplicant')), 'passport not shown after unlock');
    await d2.click('#dTabs [data-t="docs"]');
    await d2.waitForFunction(() => /passport-scan\.png/.test(((document.querySelector('.doc .doc-name') || {}).textContent) || ''));
    await d2.click('.doc >> text=Preview');
    await d2.waitForSelector('#viewer:not(.hidden) img');
    await closeDrawer(d2);
    await d2.click('#railLock');
    await d2.click('#secDisable');
    await d2.fill('#pass1', 'horse-battery-7');
    await d2.click('#passOk');
    await d2.waitForFunction(() => !document.getElementById('railLock').classList.contains('on'));
    const end = Date.now() + 8000;
    let s;
    do { s = await storage(); if (s.applications[0].applicant && s.applications[0].applicant.passport) break; await d2.waitForTimeout(100); } while (Date.now() < end);
    assert(s.applications[0].applicant.passport === 'XB1234567' && !s.applications[0].privateEnc && !s.settings.encryption, 'plaintext not restored');
    const docs = await storedDocs(d2);
    assert(docs.length === 1 && !docs[0].encrypted && docs[0].hasBlob && docs[0].name === 'passport-scan.png', JSON.stringify(docs));
  });

  await check('popup: lists the application and shows the booked appointment', async () => {
    await fresh();
    const dash = await openDashboard();
    const appId = await createApp(dash);
    await bookViaPortal(appId);
    const p = await openPopup();
    await p.waitForFunction(() => !document.getElementById('booked').classList.contains('hidden'));
    const txt = await p.textContent('#bookedText');
    assert(/Yahya El Amrani/.test(txt) && /2026-11-12/.test(txt) && /BLS\/RBA\/2611\/00123/.test(txt), txt);
    const opts = await p.$$eval('#activeApp option', os => os.map(o => o.textContent));
    assert(opts.some(o => /#1001 Yahya El Amrani · Spain ✓/.test(o)), opts.join(' | '));
  });

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
