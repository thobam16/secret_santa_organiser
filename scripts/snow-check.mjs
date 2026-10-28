import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const address = new URL(base);
if (!["127.0.0.1", "localhost"].includes(address.hostname)) {
  throw new Error("Snow checks are local-only.");
}

// Fresh, anonymous browser state: these checks never write account or event data.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1.25,
  reducedMotion: "no-preference",
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

async function paintCounts() {
  return page.evaluate(() => ({
    flakes: window.__snowCheck.flakes,
    logos: window.__snowCheck.logo.draws,
    sleighs: window.__snowCheck.sleigh.draws,
  }));
}

async function changeMotionPreference(value) {
  // MediaQueryList changes use Chromium's rendering cycle, independently of the
  // JavaScript clock used for the animation simulation.
  const dispatched = page.evaluate(
    () =>
      new Promise((resolve) => {
        const query = matchMedia("(prefers-reduced-motion: reduce)");
        query.addEventListener("change", () => resolve(true), { once: true });
      }),
  );
  await page.emulateMedia({ reducedMotion: value });
  let timeout;
  try {
    await Promise.race([
      dispatched,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Media query change was not dispatched")),
          5000,
        );
      }),
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
    // Fixed randomness makes both rare appearances reproducible. This browser
    // is used only for animation checks, not visual screenshots or account work.
    Math.random = () => 0.5;
    const imageStats = () => ({
      draws: 0,
      source: "",
      ratio: 0,
      firstAt: null,
      lastAt: null,
      minX: Infinity,
      maxX: -Infinity,
    });
    window.__snowCheck = {
      flakes: 0,
      firstFrameAt: null,
      maxFlakeAlpha: 0,
      strongFlakeFills: 0,
      logo: imageStats(),
      sleigh: imageStats(),
      unexpectedImages: [],
    };
    window.__snowImages = [];
    const NativeImage = window.Image;
    window.Image = class extends NativeImage {
      constructor(...args) {
        super(...args);
        window.__snowImages.push(this);
      }
    };
    const nativeHidden = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "hidden",
    ).get;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return window.__snowHidden ?? nativeHidden.call(document);
      },
    });
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.classList.contains("snow-canvas")) {
        const check = window.__snowCheck;
        check.flakes++;
        check.firstFrameAt ??= performance.now();
        check.maxFlakeAlpha = Math.max(check.maxFlakeAlpha, this.globalAlpha);
        if (this.globalAlpha >= 0.55) check.strongFlakeFills++;
      }
      return originalFill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.classList.contains("snow-canvas")) {
        const source = args[0].src || "";
        const path = source ? new URL(source, location.href).pathname : "";
        const kind = path.endsWith("/arm-logo.svg")
          ? "logo"
          : path.endsWith("/sleigh.svg")
            ? "sleigh"
            : null;
        if (kind) {
          const check = window.__snowCheck[kind];
          const x = args.length === 9 ? args[5] : args[1];
          const width = args.length === 9 ? args[7] : args[3];
          const height = args.length === 9 ? args[8] : args[4];
          check.draws++;
          check.source = source;
          check.ratio = width / height;
          check.firstAt ??= performance.now();
          check.lastAt = performance.now();
          check.minX = Math.min(check.minX, x);
          check.maxX = Math.max(check.maxX, x);
        } else {
          window.__snowCheck.unexpectedImages.push(source);
        }
      }
      return originalDrawImage.apply(this, args);
    };
  });

  const logoLoaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/arm-logo.svg"),
  );
  const sleighLoaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/sleigh.svg"),
  );
  await page.goto(base);
  await page
    .getByText("Local preview · test accounts and events only")
    .waitFor();
  await page.getByRole("button", { name: "Turn snow off" }).waitFor();
  const [logoResponse, sleighResponse] = await Promise.all([
    logoLoaded,
    sleighLoaded,
  ]);
  assert.equal(
    logoResponse.status(),
    200,
    "Official Arm logo is served locally",
  );
  assert.match(await logoResponse.text(), /Official Arm 2025 ink logo/);
  assert.equal(
    sleighResponse.status(),
    200,
    "Sleigh artwork is served locally",
  );
  const dimensions = await page.evaluate(async () => {
    const images = window.__snowImages.filter((image) =>
      /\/(arm-logo|sleigh)\.svg$/.test(new URL(image.src).pathname),
    );
    await Promise.all(images.map((image) => image.decode()));
    return images.map((image) => ({
      path: new URL(image.src).pathname,
      width: image.naturalWidth,
    }));
  });
  assert.ok(
    dimensions.some(
      (image) => image.path.endsWith("/arm-logo.svg") && image.width > 0,
    ),
  );
  assert.ok(
    dimensions.some(
      (image) => image.path.endsWith("/sleigh.svg") && image.width > 0,
    ),
  );

  await page.clock.runFor(1000);
  assert.equal(await page.locator(".snow-canvas").isVisible(), true);
  const canvas = await page.evaluate(() => {
    const element = document.querySelector(".snow-canvas");
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const pixels = element
      .getContext("2d")
      .getImageData(0, 0, element.width, element.height).data;
    let maxAlpha = 0;
    for (let i = 3; i < pixels.length; i += 4)
      maxAlpha = Math.max(maxAlpha, pixels[i]);
    return {
      css: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      physical: { width: element.width, height: element.height },
      viewport: { width: innerWidth, height: innerHeight },
      ratio: devicePixelRatio,
      pointerEvents: style.pointerEvents,
      ariaHidden: element.getAttribute("aria-hidden"),
      maxAlpha,
    };
  });
  assert.equal(canvas.ratio, 1.25, "The check runs at 125% display scale");
  assert.deepEqual(
    canvas.css,
    { x: 0, y: 0, ...canvas.viewport },
    "Canvas covers the CSS viewport",
  );
  assert.deepEqual(
    canvas.physical,
    {
      width: Math.round(canvas.viewport.width * canvas.ratio),
      height: Math.round(canvas.viewport.height * canvas.ratio),
    },
    "Canvas covers the physical viewport at 125% scale",
  );
  assert.equal(canvas.pointerEvents, "none");
  assert.equal(canvas.ariaHidden, "true");
  assert.ok(
    canvas.maxAlpha >= 180,
    "Snow has clearly visible pixels, beyond the old faint opacity",
  );
  const first = await page.evaluate(() => window.__snowCheck);
  assert.ok(first.flakes > 0, "Snow animation paints flakes");
  assert.ok(
    first.maxFlakeAlpha >= 0.55 && first.strongFlakeFills > 0,
    "Snow paints with stronger opacity",
  );
  assert.equal(first.logo.draws, 0, "The Arm logo does not appear immediately");
  assert.equal(first.sleigh.draws, 0, "The sleigh does not appear immediately");

  // runFor fires every animation callback; fastForward would skip callbacks and
  // not exercise elapsed-time scheduling. Total rare-asset simulation: 83s.
  await page.clock.runFor(14_000);
  const flight = await page.evaluate(() => window.__snowCheck);
  const firstSleighDelay = flight.sleigh.firstAt - flight.firstFrameAt;
  assert.ok(
    flight.sleigh.draws > 0,
    "The sleigh begins within the first 14 active seconds",
  );
  assert.ok(
    firstSleighDelay >= 7900 && firstSleighDelay <= 14_200,
    "The sleigh first appears after 8–14 active seconds",
  );
  assert.equal(flight.logo.draws, 0, "The Arm logo remains rare");
  await page.clock.runFor(24_000);
  const crossed = await page.evaluate(() => window.__snowCheck);
  const flightDuration = crossed.sleigh.lastAt - crossed.sleigh.firstAt;
  assert.ok(
    flightDuration >= 17_900 && flightDuration <= 22_100,
    "The sleigh takes 18–22 seconds to cross",
  );
  assert.ok(
    crossed.sleigh.maxX - crossed.sleigh.minX >= canvas.viewport.width,
    "The sleigh crosses the whole viewport",
  );
  const finishedFlightDraws = crossed.sleigh.draws;
  await page.clock.runFor(44_000);
  const rare = await page.evaluate(() => window.__snowCheck);
  assert.equal(
    rare.sleigh.draws,
    finishedFlightDraws,
    "The sleigh leaves a substantial gap before returning",
  );
  assert.ok(
    rare.logo.draws > 0,
    "A rare Arm logo appears within 83 simulated seconds",
  );
  const firstLogoDelay = rare.logo.firstAt - rare.firstFrameAt;
  assert.ok(
    firstLogoDelay >= 39_900 && firstLogoDelay <= 80_200,
    "The logo first appears after 40–80 active seconds",
  );
  assert.ok(
    Math.abs(rare.logo.ratio - 4332.3 / 1318.7) < 0.001,
    "Official logo proportions remain intact",
  );
  assert.ok(
    Math.abs(rare.sleigh.ratio - 640 / 220) < 0.001,
    "Sleigh artwork proportions remain intact",
  );
  assert.deepEqual(
    rare.unexpectedImages,
    [],
    "Each image draw is classified by its asset",
  );

  // Exercise the real visibility listener without relying on headless window focus.
  await page.evaluate(() => {
    window.__snowHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await paintCounts();
  await page.clock.runFor(1000);
  assert.deepEqual(
    await paintCounts(),
    hidden,
    "Hidden documents stop every snow, logo and sleigh draw",
  );
  await page.evaluate(() => {
    window.__snowHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1000);
  assert.ok(
    (await paintCounts()).flakes > hidden.flakes,
    "Visibility restores animation",
  );

  await page.getByRole("button", { name: "Turn snow off" }).click();
  assert.equal(await page.locator(".snow-canvas").isVisible(), false);
  const stopped = await paintCounts();
  await page.clock.runFor(1000);
  assert.deepEqual(
    await paintCounts(),
    stopped,
    "The snow toggle stops all animation",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("santa-snow")),
    "off",
  );
  await page.getByRole("button", { name: "Turn snow on" }).click();
  await page.clock.runFor(1000);
  assert.ok(
    (await paintCounts()).flakes > stopped.flakes,
    "The toggle restarts animation",
  );
  await changeMotionPreference("reduce");
  assert.equal(await page.locator(".snow-canvas").isVisible(), false);
  const reduced = await paintCounts();
  await page.clock.runFor(1000);
  assert.deepEqual(
    await paintCounts(),
    reduced,
    "Reduced motion stops all animation",
  );
  await changeMotionPreference("no-preference");
  await page.clock.runFor(1000);
  assert.equal(await page.locator(".snow-canvas").isVisible(), true);
  assert.ok(
    (await paintCounts()).flakes > reduced.flakes,
    "Removing reduced motion resumes animation",
  );
  assert.deepEqual(pageErrors, [], "No browser exceptions");
  console.log(
    "Snow checks passed: 125% viewport coverage, visible snowfall, timed sleigh and Arm logo, proportions, toggle, visibility, and reduced-motion lifecycle.",
  );
} finally {
  await browser.close();
}
