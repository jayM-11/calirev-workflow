// End-to-end test: a manual job typed like an advisor, then the full guided demo.
// Run: cd tests && npm install playwright && node e2e.mjs   (uses your installed Google Chrome; screenshots go to tests/shots/)
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const APP = process.env.APP ? new URL(process.env.APP, 'file://' + process.cwd() + '/').href : new URL('../dist/index.html', import.meta.url).href;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  → ' + extra : ''}`);
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());
const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

// ---------- A. Manual flow, typed like an advisor ----------
await page.goto(APP);
check('A1 blank on load', (await page.inputValue('#customer')) === '');
await page.click('.tabs [data-screen=review]');
check('A2 Parts locked before save', await page.isVisible('#reviewLocked'));
await page.click('.tabs [data-screen=job]');
await page.click('#saveIntake');
check('A3 save blocked, required fields flagged', await page.locator('#customer.invalid').count() === 1);
await page.fill('#customer', 'Sharon Lee');
await page.selectOption('#year', '2020');
await page.fill('#make', 'Honda');
await page.fill('#model', 'Accord');
await page.fill('#email', 'sharon@example.com');
await page.click('#saveIntake');
check('A4 save moves to Parts', (await active()) === 'review');
check('A5 headline', (await page.textContent('#rvHeadline')) === 'Parts for Sharon’s 2020 Honda Accord');
check('A6 catalog filtered to Accord + universal', await page.locator('#catalogCards [data-add]').count() === 6);
await page.click('[data-add="c07"]');
await page.click('[data-add="c09"]');
check('A7 off-road front pipe blocks', await page.locator('#legalStrip.bad').count() === 1);
await page.click('.tabs [data-screen=approval]');
check('A8 send disabled while blocked', await page.isDisabled('#sendForApproval'));
await page.click('.tabs [data-screen=review]');
await page.click('#quoteCards .pc:has-text("Front pipe")');
await page.click('#removePart');
check('A9 strip clear after removal', await page.locator('#legalStrip.bad').count() === 0);
await page.click('#addLabor');
const labor = page.locator('#laborRows .labor-row').first();
await labor.locator('[data-labor=name]').fill('Install + road test');
await labor.locator('[data-labor=qty]').fill('2');
await labor.locator('[data-labor=price]').fill('150');
await labor.locator('[data-labor=price]').press('Tab');
await page.click('.tabs [data-screen=approval]');
check('A10 estimate total $629.00', (await page.textContent('#estTotal')) === '$629.00', await page.textContent('#estTotal'));
await page.click('[data-send-method="Copy text"]');
await page.click('#sendForApproval');
await page.waitForTimeout(200);
check('A11 sent via copy', (await page.textContent('#sendBadge')) === 'Sent');
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('A12 clipboard has estimate', clip.includes('Estimate total: $629.00'));
await page.fill('#approvedBy', 'Sharon Lee');
await page.fill('#approvalDate', today);
await page.click('#recordApproval');
check('A13 approved, no advance needed', (await page.textContent('#approvalBadge')) === 'Recorded' && (await page.textContent('#payBadge')) === 'Not needed');
await page.click('.tabs [data-screen=install]');
await page.fill('#installer', 'Alex');
await page.fill('#installDate', today);
await page.check('#installedParts [data-installed]');
await page.click('#saveInstall');
check('A14 closeout saved', (await page.textContent('#installBadge')) === 'Closeout saved');
await page.click('.tabs [data-screen=packet]');
const foot = await page.textContent('#billFoot');
check('A15 receipt: tax $25.50 on $329 part, total $654.50', foot.includes('$25.50') && foot.includes('$654.50'), foot);
check('A16 email button enabled', !(await page.isDisabled('#emailPacket')));
await page.reload();
check('A17 reload starts blank', (await page.inputValue('#customer')) === '' && (await active()) === 'job');

// ---------- B. Guided demo, clicking every button ----------
await page.click('#demoBtn');
check('B0 demo panel opens', await page.isVisible('#demo'));
const steps = await page.evaluate(() => DEMO.length);
for (let i = 0; i < steps; i++) {
  const title = await page.textContent('#demoTitle');
  await page.click('#demoRun');
  const last = i === steps - 1;
  await page.waitForSelector(last ? '#demoFinish:visible' : '#demoNext:visible:not([disabled])', { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}step${String(i + 1).padStart(2, '0')}.png` });
  const scr = await active();
  if (i === 0) {
    check('B1 quote stays on Quote page after save', scr === 'job', scr);
    check('B1 fields populated', (await page.inputValue('#customer')) === 'Dana Ortiz' && (await page.inputValue('#model')) === 'Mustang GT');
    check('B1 shows saved', (await page.textContent('#intakeStatus')).startsWith('Quote saved'));
  }
  if (i === 1) check('B2 headers blocked', await page.locator('#legalStrip.bad').count() === 1 && scr === 'review');
  if (i === 2) check('B3 agent cleared CC-300', (await page.textContent('#rvStatusChip')) === 'EO D-000-30');
  if (i === 3) check('B4 labor visible on Parts', scr === 'review' && await page.locator('#laborRows .labor-row').count() === 1 && await page.locator('#laborRows').isVisible());
  if (i === 4) check('B5 estimate shown', scr === 'approval' && (await page.textContent('#estLegal')).startsWith('✓'));
  if (i === 5) check('B6 sent, panel left', (await page.textContent('#sendBadge')) === 'Sent' && await page.locator('#demo.left').count() === 1);
  if (i === 6) check('B7 approved', (await page.textContent('#approvalBadge')) === 'Recorded');
  if (i === 7) check('B8 advance received', (await page.textContent('#payBadge')) === 'Received');
  if (i === 8) check('B9 closeout saved', scr === 'install' && (await page.textContent('#installBadge')) === 'Closeout saved');
  if (i === 9) check('B10 receipt balance $2,761.64', scr === 'packet' && (await page.textContent('#billFoot')).includes('$2,761.64'));
  results.push(`      step ${i + 1}: "${title}" → screen ${scr}`);
  if (!last) await page.click('#demoNext');
}
await page.click('#demoFinish');
check('B11 demo ends, blank job back', !(await page.isVisible('#demo')) && (await page.inputValue('#customer')) === '');
check('NO page or console errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${results.filter(r => r.startsWith('FAIL')).length} failed`);
