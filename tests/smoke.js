/* tests/smoke.js — loads the unpacked extension into Playwright's Chromium and runs it against
 * fake BLS and VFS calendar pages served at the real portal URLs (via request routing, nothing
 * reaches the network). Drives the real popup buttons. Takes ~2 min: it waits for one real
 * 60 s auto-refresh.  Run: npm run test:smoke   (HEADED=1 to watch it)
 *
 * The fixtures only imitate calendar markup. Nothing here logs in, solves a verification or books. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const BLS_URL = 'https://www.blsspainmorocco.com/MAR/appointment/slotselection';
const VFS_URL = 'https://visa.vfsglobal.com/mar/en/ita/book-appointment';

// ---------- fixtures ----------
function page(title, body, head = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head>
<body><header><a href="#">Logout</a> | <a href="#">Login</a></header><main>${body}</main></body></html>`;
}

/** BLS: jQuery UI datepicker, server-rendered. `open` = day numbers that are bookable. */
function blsCalendar(open = []) {
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
  const html = `<div class="alert">${banner}</div><mat-calendar class="mat-calendar"><table class="mat-calendar-table"><tbody class="mat-calendar-body"><tr>${cells.join('')}</tr></tbody></table></mat-calendar>`;
  return page('VFS Global – Book appointment', '<app-root><p>Loading…</p></app-root>',
    `<style>.mat-calendar-body-cell{cursor:default}.mat-calendar-body-cell:not(.mat-calendar-body-disabled){cursor:pointer}</style>
     <script>setTimeout(() => { document.querySelector('app-root').innerHTML = ${JSON.stringify(html)}; }, 1000);</script>`);
}

/** Generic Kendo-style widget: disabled days still contain a link, only the class says "disabled". */
function kendoCalendar() {
  let cells = '';
  for (let d = 1; d <= 30; d++) cells += `<td role="gridcell" class="k-state-disabled k-disabled" aria-disabled="false"><a class="k-link" href="#">${d}</a></td>`;
  return page('BLS – Appointment', `<h2>Appointment Date</h2><div class="k-calendar"><table class="k-content"><tbody><tr>${cells}</tr></tbody></table></div>`);
}

const FIXTURES = {
  'bls-none': () => blsCalendar([]),
  'bls-slot': () => blsCalendar([12, 19]),
  'vfs-none': () => vfsCalendar(),
  'vfs-slot': () => vfsCalendar({ open: [12], banner: 'Earliest available slot for Tourism is : 12/11/2026' }),
  'kendo-none': () => kendoCalendar(),
  'cf-challenge': () => `<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Just a moment...</h1><p>Checking your browser before accessing the site.</p></body></html>`,
  'captcha-widget': () => page('BLS – Appointment', `<h2>Appointment Date</h2><div class="g-recaptcha" style="width:304px;height:78px;border:1px solid #ccc"></div>`),
  'login': () => `<!doctype html><html><body><main><h1>Sign in</h1><input type="email"><input type="password"><a href="#">Forgot password?</a></main></body></html>`,
};

// ---------- tiny runner ----------
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { results.push({ name, ok: false, err: e }); console.log(`  ✘ ${name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`); }
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
  const waitBadge = (p, state, timeout = 10000) => p.waitForFunction(s => { const b = document.getElementById('rdv-maroc-badge'); return b && b.dataset.state === s; }, state, { timeout });

  /** Opens popup.html in a tab, pointed at `targetUrl` as if it were the active tab. */
  async function openPopup(targetUrl) {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`);
    await p.waitForSelector('#destination option');
    if (targetUrl) {
      const id = await tabIdOf(targetUrl);
      await p.evaluate((tid) => { chrome.tabs.query = async () => [await chrome.tabs.get(tid)]; }, id);
    }
    return p;
  }

  console.log(`Extension ${extId} loaded in ${await sw.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0])}`);

  // ---------- manifest ----------
  await check('chrome://extensions reports no errors or warnings for the extension', async () => {
    const p = await context.newPage();
    await p.goto('chrome://extensions/');
    const info = await p.evaluate((id) => new Promise(r => chrome.developerPrivate.getExtensionInfo(id, r)), extId);
    await p.close();
    const problems = [...(info.manifestErrors || []).map(e => e.message), ...(info.installWarnings || []), ...(info.runtimeErrors || []).map(e => e.message)];
    assert(!problems.length, problems.join('\n'));
  });

  // ---------- popup ----------
  await check('popup lists every destination and its centres', async () => {
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
    await p.close();
  });

  await check('France is greyed out, explained, and cannot be started', async () => {
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
    await p.close();
  });

  await check('"Test alert" creates a desktop notification and plays the sound', async () => {
    await clearNotifications();
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
    await p.close();
    await clearNotifications();
  });

  // ---------- BLS flow ----------
  const blsPath = new URL(BLS_URL).pathname;
  scenario[blsPath] = 'bls-none';
  const bls = await context.newPage();
  await bls.goto(BLS_URL);

  await check('BLS page shows the in-page badge before watching', async () => {
    await bls.waitForSelector('#rdv-maroc-badge', { timeout: 10000 });
    assert(/ready/.test((await badgeState(bls)).text), JSON.stringify(await badgeState(bls)));
  });

  await check('"Pick calendar area": clicking a day cell selects the whole calendar', async () => {
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

  let started;
  await check('"Start watching this tab" with interval 60 s → status "No slots"', async () => {
    const p = await openPopup(BLS_URL);
    await p.selectOption('#destination', 'spain');
    await p.selectOption('#centre', 'Rabat');
    await p.$eval('#interval', el => { el.value = '60'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await p.$eval('#sound', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
    await p.click('#start');
    started = Date.now();
    await waitBadge(bls, 'none');
    await p.waitForFunction(() => document.getElementById('statusPill').textContent === 'No slots');
    const { settings, status } = await storage();
    assert(settings.watching && settings.interval === 60 && settings.watchTabId === (await tabIdOf(BLS_URL)), JSON.stringify(settings));
    assert(status.state === 'none', JSON.stringify(status));
    await p.close();
  });

  await check('refresh is scheduled 60–69 s out (never under 60 s)', async () => {
    const { nextAt } = await storage();
    const secs = (nextAt - started) / 1000;
    assert(secs >= 59.5 && secs <= 70, `next refresh in ${secs.toFixed(1)} s`);
  });

  await check('auto-refresh fires after the interval and a new slot alerts once', async () => {
    await clearNotifications();
    const before = hits[blsPath];
    scenario[blsPath] = 'bls-slot';
    const { nextAt } = await storage();
    await bls.waitForEvent('load', { timeout: Math.max(0, nextAt - Date.now()) + 10000 });
    const waited = (Date.now() - started) / 1000;
    assert(hits[blsPath] === before + 1, `expected exactly one reload, got ${hits[blsPath] - before}`);
    assert(waited >= 59.5, `reloaded after only ${waited.toFixed(1)} s`);
    await waitBadge(bls, 'available');
    await bls.waitForSelector('#rdv-maroc-banner');
    const { lastHit } = await storage();
    assert(lastHit && lastHit.where === 'Spain · Rabat · Tourism · Tourisme', JSON.stringify(lastHit));
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
  });

  await check('after a refresh the interval is still 60 s and the same slot does not re-alert', async () => {
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
    assert(!(await bls.$('#rdv-maroc-banner')), 'banner shown again for the same slot');
  });

  await check('slot disappears then reappears → alerts again', async () => {
    scenario[blsPath] = 'bls-none';
    await bls.reload(); await waitBadge(bls, 'none');
    scenario[blsPath] = 'bls-slot';
    await bls.reload(); await waitBadge(bls, 'available');
    await bls.waitForTimeout(500);
    assert((await notifications()).length === 2, `notifications: ${await notifications()}`);
  });

  await check('Cloudflare-style "Just a moment" page pauses the watcher', async () => {
    scenario[blsPath] = 'cf-challenge';
    await bls.reload();
    await waitBadge(bls, 'captcha');
    const { settings, status, nextAt } = await storage();
    assert(settings.watching === false && status.state === 'captcha' && !nextAt, JSON.stringify({ watching: settings.watching, status, nextAt }));
    assert(/human check/i.test(await bls.textContent('#rdv-maroc-banner')), 'banner should ask the user');
  });

  async function restart(url) {
    const p = await openPopup(url);
    await p.click('#start');
    await p.close();
  }

  await check('a visible CAPTCHA widget (no text) pauses the watcher', async () => {
    scenario[blsPath] = 'captcha-widget';
    await bls.reload();
    await waitBadge(bls, 'unknown');                // not watching → ready badge
    await restart(BLS_URL);
    await waitBadge(bls, 'captcha');
    const { settings, status } = await storage();
    assert(settings.watching === false && status.state === 'captcha', JSON.stringify(status));
  });

  await check('a paused watcher does not refresh by itself', async () => {
    const before = hits[blsPath];
    await bls.waitForTimeout(3000);
    assert(hits[blsPath] === before && !(await storage()).nextAt, 'refresh still scheduled while paused');
  });

  await check('being logged out stops the watcher', async () => {
    scenario[blsPath] = 'bls-none';
    await bls.reload();
    await restart(BLS_URL);
    await waitBadge(bls, 'none');
    scenario[blsPath] = 'login';
    await bls.reload();
    await waitBadge(bls, 'login');
    const { settings } = await storage();
    assert(settings.watching === false, 'still watching after logout');
  });

  await check('Kendo-style calendar with only disabled days is not a slot', async () => {
    scenario[blsPath] = 'kendo-none';
    await bls.reload();
    const p = await openPopup(BLS_URL);
    await p.click('#clearPick');
    await p.click('#start');
    await p.close();
    await bls.waitForFunction(() => ['none', 'unknown', 'available'].includes(document.getElementById('rdv-maroc-badge').dataset.state) && !/checking/.test(document.getElementById('rdv-maroc-badge').textContent));
    const st = (await badgeState(bls)).state;
    assert(st !== 'available', 'disabled Kendo days were counted as selectable');
  });
  await bls.close();

  // ---------- VFS flow (SPA calendar rendered after load) ----------
  const vfsPath = new URL(VFS_URL).pathname;
  scenario[vfsPath] = 'vfs-none';
  const vfs = await context.newPage();
  await vfs.goto(VFS_URL);
  await vfs.waitForSelector('#rdv-maroc-badge');

  await check('VFS: watching an Angular Material calendar → "No slots"', async () => {
    const p = await openPopup(VFS_URL);
    await p.selectOption('#destination', 'italy');
    await p.click('#clearPick');
    await p.click('#start');
    await p.close();
    await waitBadge(vfs, 'none');
  });

  await check('VFS: a day enabling live (no reload) alerts via the DOM observer', async () => {
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
    scenario[vfsPath] = 'vfs-slot';
    const { lastHit } = await storage();
    await vfs.reload();
    await waitBadge(vfs, 'available', 8000);
    await vfs.waitForTimeout(2500);
    const s = await storage();
    assert(s.lastHit.at === lastHit.at, 're-alerted after refresh');
    assert((await notifications()).length === 1, `notifications: ${await notifications()}`);
  });

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
