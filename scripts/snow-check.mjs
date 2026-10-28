import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const address = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(address.hostname)) {
  throw new Error('Snow checks are local-only.');
}

// Fresh, anonymous browser state: these checks never write account or event data.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

async function changeMotionPreference(value) {
  // MediaQueryList change events are dispatched on Chromium's rendering cycle,
  // independently of the JavaScript clock used for the snow simulation.
  const dispatched = page.evaluate(() => new Promise(resolve => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', () => resolve(true), { once: true });
  }));
  await page.emulateMedia({ reducedMotion: value });
  let timeout;
  try {
    await Promise.race([
      dispatched,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Media query change was not dispatched')), 5000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  await page.clock.runFor(150);
}

try {
  const initialTime = Date.now();
  await page.clock.install({ time: initialTime });
  await page.clock.pauseAt(initialTime + 1000);
  await page.addInitScript(() => {
    window.__snowCheck = { flakes: 0, logos: 0, logoSource: '', logoRatio: 0 };
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.classList.contains('snow-canvas')) window.__snowCheck.flakes++;
      return originalFill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.classList.contains('snow-canvas')) {
        window.__snowCheck.logos++;
        window.__snowCheck.logoSource = args[0].src || '';
        window.__snowCheck.logoRatio = args[3] / args[4];
      }
      return originalDrawImage.apply(this, args);
    };
  });

  await page.goto(base);
  await page.getByText('Local preview · test accounts and events only').waitFor();
  await page.getByRole('button', { name: 'Turn snow off' }).waitFor();
  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete));
  const logoResponse = await context.request.get(`${address.origin}/arm-logo.svg`);
  assert.equal(logoResponse.status(), 200, 'Official Arm logo asset is served locally');
  assert.match(await logoResponse.text(), /Official Arm 2025 ink logo/);

  await page.clock.runFor(1000);
  assert.equal(await page.locator('.snow-canvas').isVisible(), true);
  const first = await page.evaluate(() => window.__snowCheck);
  assert.ok(first.flakes > 0, 'Snow animation paints flakes');
  assert.equal(first.logos, 0, 'The logo does not appear immediately');
  assert.equal(await page.evaluate(() => {
    const canvas = document.querySelector('.snow-canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((channel, index) => index % 4 === 3 && channel > 0);
  }), true, 'Canvas contains visible snow pixels');

  // runFor fires every animation callback; fastForward would skip callbacks and
  // would not exercise this animation's elapsed-time particle scheduling.
  await page.clock.runFor(82_000);
  const rare = await page.evaluate(() => window.__snowCheck);
  assert.ok(rare.logos > 0, 'A rare Arm-logo particle is painted after simulated time');
  assert.ok(rare.logoSource.endsWith('/arm-logo.svg'));
  assert.ok(Math.abs(rare.logoRatio - 4332.3 / 1318.7) < 0.001, 'Logo proportions remain intact');

  await page.getByRole('button', { name: 'Turn snow off' }).click();
  assert.equal(await page.locator('.snow-canvas').isVisible(), false);
  const stopped = await page.evaluate(() => window.__snowCheck.flakes);
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(() => window.__snowCheck.flakes), stopped, 'Snow toggle stops painting');
  assert.equal(await page.evaluate(() => localStorage.getItem('santa-snow')), 'off');

  await page.getByRole('button', { name: 'Turn snow on' }).click();
  await page.clock.runFor(1000);
  assert.ok(await page.evaluate(() => window.__snowCheck.flakes) > stopped, 'Snow toggle restarts painting');
  await changeMotionPreference('reduce');
  assert.equal(await page.locator('.snow-canvas').isVisible(), false);
  const reduced = await page.evaluate(() => window.__snowCheck.flakes);
  await page.clock.runFor(1000);
  assert.equal(await page.evaluate(() => window.__snowCheck.flakes), reduced, 'Reduced motion stops painting');

  await changeMotionPreference('no-preference');
  await page.clock.runFor(1000);
  assert.equal(await page.locator('.snow-canvas').isVisible(), true);
  assert.ok(await page.evaluate(() => window.__snowCheck.flakes) > reduced, 'Removing reduced motion resumes snow');
  assert.deepEqual(pageErrors, [], 'No browser exceptions');
  console.log('Snow checks passed: canvas painting, rare official Arm logo, preserved proportions, toggle, preference, and reduced-motion lifecycle.');
} finally {
  await browser.close();
}
