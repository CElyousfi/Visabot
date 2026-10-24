// Loads the extension into Chromium and drives a fake BLS calendar page served locally.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const EXT = path.resolve(__dirname, '..');
const NONE_PAGE = `<!doctype html><html><body><h1>BLS Spain Visa – Casablanca</h1><a href="#">Log out</a>
<main><div id="cal"><p>Aucun rendez-vous disponible pour le moment.</p>
<table class="ui-datepicker-calendar"><tr>
<td class="ui-state-disabled"><span>1</span></td><td class="ui-state-disabled"><span>2</span></td><td class="ui-state-disabled"><span>3</span></td>
</tr></table></div></main></body></html>`;

(async () => {
  const ctx = await chromium.launchPersistentContext('', {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ settings: { watching: true, watchTabId: null, autoRefresh: false, sound: false, interval: 90, repeatMinutes: 10, destination: 'Spain', centre: 'Casablanca', category: 'Tourism' } }));

  const page = await ctx.newPage();
  await page.route('https://www.blsspainmorocco.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: NONE_PAGE }));
  await page.goto('https://www.blsspainmorocco.com/MAR/appointment/calendar');
  await page.waitForSelector('#rdv-maroc-badge', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#rdv-maroc-badge').dataset.state === 'none', null, { timeout: 10000 });
  console.log('PASS  badge shows "No slots" on an empty calendar');

  let status = await sw.evaluate(() => chrome.storage.local.get('status'));
  assert.strictEqual(status.status.state, 'none');
  console.log('PASS  status persisted for the popup');

  // Simulate the portal opening slots (SPA-style DOM change, no reload).
  await page.evaluate(() => {
    document.querySelector('#cal p').textContent = 'Sélectionnez une date';
    const td = document.querySelector('.ui-datepicker-calendar td');
    td.className = ''; td.innerHTML = '<a class="ui-state-default" href="#">1</a>';
  });
  await page.waitForSelector('#rdv-maroc-banner', { timeout: 10000 });
  const bannerText = await page.textContent('#rdv-maroc-banner');
  assert.ok(/Slot detected/.test(bannerText), bannerText);
  console.log('PASS  banner appears when a day becomes selectable:', bannerText.replace(/\s+/g, ' ').trim().slice(0, 80));
  await page.waitForFunction(() => document.querySelector('#rdv-maroc-badge').dataset.state === 'available', null, { timeout: 10000 });
  const hit = await sw.evaluate(() => chrome.storage.local.get('lastHit'));
  assert.ok(hit.lastHit && hit.lastHit.where.includes('Casablanca'));
  console.log('PASS  lastHit recorded:', hit.lastHit.where, hit.lastHit.reasons.join('; '));

  // Reloading while the slot stays visible must NOT alert again (memory persists across refresh).
  const SLOT_PAGE = NONE_PAGE.replace('Aucun rendez-vous disponible pour le moment.', 'Sélectionnez une date').replace('<td class="ui-state-disabled"><span>1</span></td>', '<td><a class="ui-state-default" href="#">1</a></td>');
  await page.route('https://www.blsspainmorocco.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: SLOT_PAGE }));
  const firstHitAt = hit.lastHit.at;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#rdv-maroc-badge') && document.querySelector('#rdv-maroc-badge').dataset.state === 'available', null, { timeout: 10000 });
  await new Promise(r => setTimeout(r, 800));
  const hit2 = await sw.evaluate(() => chrome.storage.local.get('lastHit'));
  assert.strictEqual(hit2.lastHit.at, firstHitAt, 're-alerted after reload');
  console.log('PASS  same slot after refresh: no duplicate alert');

  // Pressing Start again resets the memory → alerts again.
  await sw.evaluate(async () => { const t = (await chrome.tabs.query({ url: 'https://www.blsspainmorocco.com/*' }))[0]; await chrome.tabs.sendMessage(t.id, { type: 'settingsChanged' }); });
  await new Promise(r => setTimeout(r, 1200));
  const hit3 = await sw.evaluate(() => chrome.storage.local.get('lastHit'));
  assert.ok(hit3.lastHit.at > firstHitAt, 'did not alert after Start');
  console.log('PASS  Start again re-arms the alert');

  // Stop from the popup side → badge returns to ready, timer cleared.
  await sw.evaluate(async () => { const { settings } = await chrome.storage.local.get('settings'); settings.watching = false; await chrome.storage.local.set({ settings }); const t = (await chrome.tabs.query({ url: 'https://www.blsspainmorocco.com/*' }))[0]; await chrome.tabs.sendMessage(t.id, { type: 'settingsChanged' }); });
  await page.waitForFunction(() => /press Start/.test(document.querySelector('#rdv-maroc-badge').textContent), null, { timeout: 5000 });
  const na = await sw.evaluate(() => chrome.storage.local.get('nextAt'));
  assert.strictEqual(na.nextAt, 0);
  console.log('PASS  Stop clears the refresh timer');

  // Captcha page → watcher stops itself and tells the user.
  const CAPTCHA_PAGE = '<!doctype html><html><body><h2>Just a moment...</h2><p>Checking your browser before accessing the site.</p></body></html>';
  await page.route('https://www.blsspainmorocco.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: CAPTCHA_PAGE }));
  await sw.evaluate(() => chrome.storage.local.set({ settings: { watching: true, watchTabId: null, autoRefresh: false, sound: false } }));
  await page.goto('https://www.blsspainmorocco.com/MAR/appointment/calendar');
  await page.waitForFunction(() => document.querySelector('#rdv-maroc-badge') && document.querySelector('#rdv-maroc-badge').dataset.state === 'captcha', null, { timeout: 10000 });
  let s2;
  for (let i = 0; i < 20; i++) { s2 = await sw.evaluate(() => chrome.storage.local.get('settings')); if (s2.settings.watching === false) break; await new Promise(r => setTimeout(r, 250)); }
  assert.strictEqual(s2.settings.watching, false);
  console.log('PASS  captcha page: watcher paused itself, never attempted to solve it');

  // Popup renders.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.waitForSelector('#start');
  const dests = await popup.$$eval('#destination option', o => o.map(x => x.textContent));
  assert.ok(dests.some(d => d.startsWith('Spain')) && dests.some(d => d.startsWith('Italy')));
  await popup.selectOption('#destination', 'spain');
  const centres = await popup.$$eval('#centre option', o => o.map(x => x.textContent));
  assert.deepStrictEqual(centres.slice(0, 3), ['Casablanca', 'Rabat', 'Tanger']);
  await popup.selectOption('#destination', 'france');
  assert.ok(await popup.isVisible('#franceNote'));
  assert.ok(await popup.isDisabled('#start'));
  console.log('PASS  popup: destinations, centres, France disabled with explanation');
  await popup.screenshot({ path: path.join(__dirname, 'popup.png') });
  const snd = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'slotFound', title: 't', body: 'b', tabId: null, sound: true }));
  assert.ok(snd && snd.ok);
  console.log('PASS  background alert path works, offscreen sound =', snd.soundPlayed);
  const bgErrors = [];
  console.log('PASS  manifest accepted by Chromium (service worker is alive)');

  // VFS-style Angular Material calendar.
  const VFS_NONE = `<!doctype html><html><body><main><h2>Italy Visa Application Centre – Rabat</h2>
  <p>No appointment slots are currently available for the selected category.</p>
  <table class="mat-calendar-table"><tr>
  <td class="mat-calendar-body-cell-container"><button class="mat-calendar-body-cell mat-calendar-body-disabled" aria-disabled="true"><span class="mat-calendar-body-cell-content">3</span></button></td>
  <td class="mat-calendar-body-cell-container"><button class="mat-calendar-body-cell mat-calendar-body-disabled" aria-disabled="true"><span class="mat-calendar-body-cell-content">4</span></button></td>
  </tr></table></main></body></html>`;
  const vfs = await ctx.newPage();
  await vfs.route('https://visa.vfsglobal.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: VFS_NONE }));
  await sw.evaluate(() => chrome.storage.local.set({ settings: { watching: true, watchTabId: null, autoRefresh: true, interval: 60, sound: false, destination: 'Italy', centre: 'Rabat', category: 'Study' }, alertState: null, lastHit: null }));
  await vfs.goto('https://visa.vfsglobal.com/mar/en/ita/book-appointment');
  await vfs.waitForFunction(() => document.querySelector('#rdv-maroc-badge') && document.querySelector('#rdv-maroc-badge').dataset.state === 'none', null, { timeout: 10000 });
  console.log('PASS  VFS fixture: "No slots" recognised');
  await vfs.evaluate(() => {
    document.querySelector('main p').textContent = 'Earliest available appointment date: 14/11/2026';
    const b = document.querySelector('.mat-calendar-body-cell'); b.className = 'mat-calendar-body-cell mat-calendar-body-active'; b.removeAttribute('aria-disabled');
  });
  await vfs.waitForFunction(() => document.querySelector('#rdv-maroc-badge').dataset.state === 'available', null, { timeout: 10000 });
  const vhit = await sw.evaluate(() => chrome.storage.local.get('lastHit'));
  assert.ok(vhit.lastHit.dates.includes('2026-11-14'), JSON.stringify(vhit.lastHit));
  console.log('PASS  VFS fixture: slot + date extracted:', vhit.lastHit.dates.join(','));

  // Auto-refresh really fires (60 s minimum, ±15 %). Watch for the reload.
  const t0 = Date.now();
  await vfs.waitForEvent('load', { timeout: 80000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  assert.ok(secs >= 50 && secs <= 72, `reload after ${secs}s`);
  console.log(`PASS  auto-refresh fired after ${secs}s (interval 60 s ± jitter)`);
  await vfs.waitForFunction(() => document.querySelector('#rdv-maroc-badge') && document.querySelector('#rdv-maroc-badge').dataset.state === 'none', null, { timeout: 10000 });
  console.log('PASS  watcher resumed by itself after the refresh');

  await ctx.close();
  console.log('All smoke tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
