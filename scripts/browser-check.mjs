import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const address = new URL(base);
if (!["127.0.0.1", "localhost"].includes(address.hostname))
  throw new Error("Browser checks are local-only.");
if (
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
)
  throw new Error(
    "Start and seed the local demo-secret-santa emulators first.",
  );

// These tests own this explicitly named local demo database. Re-seed for repeatability.
const reset = await fetch(
  "http://127.0.0.1:8080/emulator/v1/projects/demo-secret-santa/databases/(default)/documents",
  { method: "DELETE" },
);
if (!reset.ok)
  throw new Error("Could not reset the local demo Firestore database.");
execFileSync(
  process.execPath,
  ["scripts/seed-emulators.mjs", "--project", "demo-secret-santa"],
  { stdio: "pipe", env: process.env },
);

await mkdir("artifacts", { recursive: true });
const sdk = initializeApp({ projectId: "demo-secret-santa" }, "browser-check");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: "reduce",
});
const page = await desktop.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const password = "Santa-Local-Only-2026!";
const go = (path) => page.goto(`${base}/#${path}`);
async function login(email) {
  await go("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out" }).waitFor();
  await page.waitForURL("**/#/");
}

try {
  await go("/");
  await page
    .getByText("Local preview · test accounts and events only")
    .waitFor();
  await page.locator(".event-card").first().waitFor();
  await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
  assert.equal(await page.locator(".event-card").count(), 2);
  assert.equal(
    await page.locator("canvas").isVisible(),
    false,
    "Reduced motion hides snow",
  );

  await go("/login?next=%2Fevents%2Fdemo-manchester");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const testEmail = `browser-${Date.now()}@example.test`;
  await page.locator('input[type="email"]').fill(testEmail);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "Create account" })
    .click();
  await page.getByRole("heading", { name: "Verify your email" }).waitFor();
  await go("/events/demo-manchester");
  await page.getByRole("link", { name: "Verify my email" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Join event" }).count(),
    0,
  );
  const account = await getAuth(sdk).getUserByEmail(testEmail);
  await getAuth(sdk).updateUser(account.uid, { emailVerified: true });
  await page.getByRole("link", { name: "Verify my email" }).click();
  await page.getByRole("button", { name: "Check verification" }).click();
  await page.getByRole("heading", { name: "Signed in" }).waitFor();
  await page.getByRole("link", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Browser Test Guest");
  await page.getByRole("button", { name: "Join event" }).click();
  await page.getByRole("heading", { name: "You’re registered" }).waitFor();
  await page.getByLabel("Your name").fill("Browser Test Guest Updated");
  await page.getByRole("button", { name: "Save my name" }).click();
  await page
    .getByText("Your name has been updated.", { exact: true })
    .waitFor();
  await go("/events/demo-sheffield");
  await page.getByLabel("Your name").fill("Browser Test Guest");
  await page.getByRole("button", { name: "Join event" }).click();
  await page.getByRole("heading", { name: "You’re registered" }).waitFor();
  await page.getByRole("button", { name: "Leave event" }).click();
  await page.getByRole("button", { name: "Yes, leave event" }).click();
  await page.getByText("You’ve left this event.", { exact: true }).waitFor();
  await go("/my-events");
  await page.locator(".event-card").waitFor();
  assert.equal(await page.locator(".event-card").count(), 1);
  await page.getByRole("button", { name: "Sign out" }).click();

  await login("organiser@example.test");
  await go("/admin/demo-manchester");
  await page.locator("tbody tr").first().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 5);
  await page
    .getByRole("button", { name: "Close registration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw recipients", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm & draw", exact: true })
    .click();
  await page
    .getByText("Draw complete. Participants can now view their recipients.", {
      exact: true,
    })
    .waitFor({ timeout: 45000 });
  assert.equal(await page.locator(".masked").count(), 5);
  assert.equal(await page.locator('[data-testid^="pairing-"]').count(), 0);
  await page.screenshot({
    path: "artifacts/admin-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Reveal recipient for Alex Morgan",
      exact: true,
    })
    .click();
  await page.locator('[data-testid="pairing-demo-alex"]').waitFor();
  assert.equal(await page.locator('[data-testid^="pairing-"]').count(), 1);
  await page
    .getByRole("button", {
      name: "Hide recipient for Alex Morgan",
      exact: true,
    })
    .click();
  assert.equal(await page.locator('[data-testid^="pairing-"]').count(), 0);
  await page
    .getByRole("button", {
      name: "Reveal recipient for Alex Morgan",
      exact: true,
    })
    .click();
  await page.locator('[data-testid="pairing-demo-alex"]').waitFor();
  await page
    .getByRole("button", { name: "Event details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Participants & draw", exact: true })
    .click();
  assert.equal(
    await page.locator('[data-testid^="pairing-"]').count(),
    0,
    "Changing tabs conceals every pairing",
  );
  await page.reload();
  await page.locator(".masked").first().waitFor();
  assert.equal(await page.locator(".masked").count(), 5);
  await go("/admin/new");
  await page
    .getByLabel("Location / event name")
    .fill("Browser-created gathering");
  await page
    .getByLabel("Signup deadline")
    .fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16));
  await page
    .locator('input[type="datetime-local"]')
    .nth(1)
    .fill(new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 16));
  await page
    .locator("form")
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Browser-created gathering", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();

  await login("alex@example.test");
  await go("/events/demo-manchester");
  await page.getByRole("button", { name: "Reveal my recipient" }).waitFor();
  assert.equal(await page.locator('[data-testid="recipient-name"]').count(), 0);
  await page.getByRole("button", { name: "Reveal my recipient" }).click();
  await page.locator('[data-testid="recipient-name"]').waitFor();
  const recipient = await page
    .locator('[data-testid="recipient-name"]')
    .innerText();
  assert.notEqual(recipient, "Alex Morgan");
  await page.getByRole("button", { name: "Hide my recipient" }).click();
  assert.equal(await page.locator('[data-testid="recipient-name"]').count(), 0);
  await page.screenshot({
    path: "artifacts/event-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Reveal my recipient" }).waitFor();
  assert.equal(await page.locator('[data-testid="recipient-name"]').count(), 0);
  await go("/admin");
  await page
    .getByText("This account does not have organiser access.", { exact: false })
    .waitFor();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    storageState: await desktop.storageState({ indexedDB: true }),
  });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`${base}/#/`);
  await phone.locator(".event-card").first().waitFor();
  await phone.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No mobile horizontal overflow",
  );
  await phone.goto(`${base}/#/events/demo-manchester`);
  await phone.getByRole("button", { name: "Reveal my recipient" }).waitFor();
  await phone.screenshot({
    path: "artifacts/event-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No event overflow on mobile",
  );
  await mobile.close();
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(
    "Browser checks passed: registration, verification, join/edit/leave, multiple events, admin draw, privacy toggles, event creation, participant reveal, route refresh, responsive layout.",
  );
} finally {
  await browser.close();
  await deleteApp(sdk);
}
