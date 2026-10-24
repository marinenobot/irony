// Browser regressions; external services are blocked and Firebase is disabled.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if(!filename.startsWith(root + path.sep)){ res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(filename);
      res.setHeader('Content-Type', {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png'}[path.extname(filename)] || 'text/plain');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const failures = [];
  try {
    browser = await chromium.launch({
      headless:true,
      executablePath:process.env.CSS_TEST_BROWSER || undefined,
      args:JSON.parse(process.env.CSS_TEST_BROWSER_ARGS || '[]')
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cases = [
      ['custom settings survive reload', {arrivalMarineSettings:JSON.stringify({rallyMin:'7', prepTime:'47'})}, async page => {
        assert.equal(await page.locator('#rally-min').inputValue(), '7');
        assert.equal(await page.locator('#prep-time').inputValue(), '47');
        await page.reload();
        assert.equal(await page.locator('#rally-min').inputValue(), '7');
        assert.equal(await page.locator('#prep-time').inputValue(), '47');
        await page.locator('[data-page="page-calc"]').click();
        await page.locator('#action-btn').click();
        assert.match(await page.locator('#common-impact-time').textContent(), /^\d{2}:\d{2}:\d{2}$/);
      }],
      ['zero landing preparation is respected', {landingPrepTime:'0'}, async page => {
        await page.locator('[data-page="page-landing"]').click();
        await page.locator('#l-action-btn').click();
        await page.waitForTimeout(750);
        assert.equal(await page.locator('#l-result-time').textContent(), '12:05:00');
      }],
      ['invalid pet JSON does not stop startup', {pets:'{broken'}, null],
      ['null pet records do not stop startup', {pets:JSON.stringify({Marine:null})}, null],
      ['null history does not stop startup', {memberHistory:'null'}, null],
      ['invalid history entries do not stop startup', {memberHistory:JSON.stringify({all:[{name:123, marchSec:40}, null]})}, null],
      ['old color themes fall back to light', {rallyThemeV3:'mint'}, async page => {
        assert.equal(await page.locator('body').getAttribute('data-theme'), 'light');
      }],
      ['saved dark mode is preserved', {rallyThemeV3:'dark'}, async page => {
        assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
      }],
      ['light and dark choices persist', {}, async page => {
        for(const theme of ['dark', 'light']){
          await page.locator('#app-settings-button').click();
          await page.locator('#quick-theme-btn').click();
          await page.locator(`[data-theme-choice="${theme}"]`).click();
          await page.reload();
          assert.equal(await page.locator('body').getAttribute('data-theme'), theme);
        }
      }]
    ];
    for(const [name, seed, check] of cases){
      const context = await browser.newContext({viewport:{width:390,height:844}});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await page.addInitScript(seed => {
        window.ARRIVAL_FIREBASE_CONFIG = {};
        if(!sessionStorage.getItem('behaviorSeeded')){
          localStorage.clear();
          for(const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
          sessionStorage.setItem('behaviorSeeded', '1');
        }
      }, seed);
      await page.clock.install({time:new Date('2026-10-22T12:00:00Z')});
      await page.clock.setFixedTime(new Date('2026-10-22T12:00:00Z'));
      try {
        await page.goto(origin + '/');
        await page.waitForTimeout(150);
        assert.deepEqual(errors, [], 'startup errors');
        assert.deepEqual(await page.locator('[data-theme-choice]').evaluateAll(els => els.map(el => el.dataset.themeChoice)), ['light', 'dark']);
        const countdownStyle = await page.locator('.member-departure-status').first().evaluate(el => {
          el.classList.remove('resting');
          el.classList.add('counting');
          const s = getComputedStyle(el);
          return [s.backgroundColor, s.boxShadow, s.borderTopWidth];
        });
        assert.deepEqual(countdownStyle, ['rgba(0, 0, 0, 0)', 'none', '0px']);
        await page.locator('[data-page="page-switch"]').click();
        await page.locator('#sw-action-btn').click();
        await page.waitForTimeout(750);
        assert.equal(await page.locator('#sw-impact-time').textContent(), '12:01:25');
        if(check) await check(page);
        assert.deepEqual(errors, [], 'runtime errors');
        console.log('PASS ' + name);
      } catch(error) {
        failures.push(name);
        console.log('FAIL ' + name + ': ' + error.message);
      } finally { await page.close(); }
    }
    assert.deepEqual(failures, [], 'browser regressions');
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
