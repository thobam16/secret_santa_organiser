import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// This suite owns only these isolated test emulators. It must never reset the
// normal 8080/9099 preview, another project, or a deployed Firebase service.
const project = "demo-secret-santa";
const authHost = "127.0.0.1:9299";
const firestoreHost = "127.0.0.1:8280";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
const address = new URL(base);
if (
  address.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(address.hostname) ||
  address.port !== "5174" || address.pathname !== "/" ||
  address.search || address.hash || address.username || address.password ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== authHost ||
  process.env.FIRESTORE_EMULATOR_HOST !== firestoreHost ||
  [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== project)
) {
  throw new Error("Use only Vite 5174, Auth 127.0.0.1:9299, Firestore 127.0.0.1:8280, and demo-secret-santa for these isolated checks.");
}
if (process.argv.slice(2).some(arg => arg !== "--seed-only"))
  throw new Error("The only optional argument is --seed-only.");
// Local emulator tests never need Google Cloud runtime/credential discovery.
process.env.METADATA_SERVER_DETECTION = "none";

const source = await fetch(`${address.origin}/src/lib/firebase.ts`).then(response => {
  if (!response.ok) throw new Error("Start the dedicated Vite development server on port 5174 first.");
  return response.text();
});
for (const [key, value] of [
  ["VITE_USE_EMULATORS", "true"],
  ["VITE_AUTH_EMULATOR_PORT", "9299"],
  ["VITE_FIRESTORE_EMULATOR_PORT", "8280"],
]) {
  assert.match(source, new RegExp(`"${key}"\\s*:\\s*"${value}"`), `Vite must use ${key}=${value} before test data can be reset.`);
}

for (const url of [
  `http://${authHost}/emulator/v1/projects/${project}/accounts`,
  `http://${firestoreHost}/emulator/v1/projects/${project}/databases/(default)/documents`,
]) {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not reset the dedicated event-password test emulators.");
}

const sdk = initializeApp({ projectId: project }, "event-password-browser-check");
const database = getFirestore(sdk);
const testPassword = "Santa-Local-Only-2026!";
const firstEvent = "password-manchester";
const secondEvent = "password-sheffield";
const guestName = "Taylor Guest Updated";
const organiserGuestName = "Organiser Participant";
const names = { "legacy-casey": "Casey Legacy", "legacy-robin": "Robin Legacy" };
const now = Date.now();
let browser;
const diagnosticPages = [];
try {
  for (const [uid, email, displayName] of [
    ["demo-organiser", "organiser@example.test", "Test Organiser"],
    ["legacy-casey", "casey@example.test", names["legacy-casey"]],
    ["legacy-robin", "robin@example.test", names["legacy-robin"]],
  ]) {
    await getAuth(sdk).createUser({ uid, email, displayName, emailVerified: true, password: testPassword });
  }
  const seed = database.batch();
  seed.set(database.doc("config/admin"), { uid: "demo-organiser" });
  for (const [id, name, memberCount] of [
    [firstEvent, "Manchester", 2],
    [secondEvent, "Sheffield", 0],
  ]) {
    seed.set(database.doc(`events/${id}`), {
      name, memberCount, signupDeadline: now + 7 * 86400000,
      exchangeAt: now + 28 * 86400000, timezone: "Europe/London", budget: 10,
      details: "Gift exchange at the Christmas party.",
      guidelines: ["Keep your recipient secret.", "Wrap and label your gift."],
      giftIdeas: ["Books", "Treats", "Desk accessories"],
      status: "open", activeRunId: null, createdAt: now,
    });
  }
  for (const [uid, name] of Object.entries(names)) {
    seed.set(database.doc(`events/${firstEvent}/members/${uid}`), {
      uid, name, joinedAt: now,
      preferences: uid === "legacy-robin" ? "" : `${name} likes books and chocolate.`,
    });
  }
  await seed.commit();
  if (process.argv.includes("--seed-only")) {
    console.log("Seeded only the isolated Auth 9299 / Firestore 8280 test project.");
  } else {
    await mkdir("artifacts", { recursive: true });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const errors = [];
    const unexpectedRequests = [];
    const allowedOrigins = new Set([address.origin, `http://${authHost}`, `http://${firestoreHost}`]);
    const createContext = async (options = {}) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce", ...options,
      });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (!allowedOrigins.has(url.origin)) {
          unexpectedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      context.on("page", page => {
        diagnosticPages.push(page);
        page.on("pageerror", error => errors.push(error.message));
      });
      return context;
    };
    const guestContext = await createContext();
    const guest = await guestContext.newPage();
    const organiserContext = await createContext();
    const organiser = await organiserContext.newPage();
    const registered = page => page.getByRole("heading", { name: "You’re registered", exact: true });
    const form = page => page.locator(".join-panel form");
    const secret = page => page.getByTestId("event-password");
    const go = (page, path) => page.goto(`${address.origin}/#${path}`);
    const navigate = async (page, path) => {
      await page.evaluate(value => { location.hash = value; }, path);
      await page.waitForURL(url => url.hash === `#${path}`);
    };
    const expectHidden = async page => {
      await page.getByRole("button", { name: "Show my password", exact: true }).waitFor();
      assert.equal(await secret(page).count(), 0, "Own password is hidden until requested.");
    };
    const enterPassword = async (page, password, succeeds = true) => {
      const input = page.getByLabel("Your password", { exact: true });
      if (!(await input.count())) {
        await page.locator('.tabs[aria-label="Event access"]').getByRole("button", { name: "Sign in", exact: true }).click();
      }
      await input.fill(password);
      await form(page).getByRole("button", { name: "Sign in", exact: true }).click();
      if (succeeds) {
        await registered(page).waitFor();
        await expectHidden(page);
      } else {
        await page.getByText("That password does not match this event.", { exact: true }).waitFor();
        assert.equal(await registered(page).count(), 0, "Incorrect credentials cannot open a membership.");
      }
    };
    const join = async (page, name, hints) => {
      await page.getByLabel("Your name", { exact: true }).fill(name);
      await page.getByRole("textbox", { name: "Gift preferences (optional)", exact: true }).fill(hints);
      assert.equal(await page.locator('input[type="email"]').count(), 0, "Guests join without supplying email.");
      await form(page).getByRole("button", { name: "Join event", exact: true }).click();
      await registered(page).waitFor();
      await secret(page).waitFor();
      const password = (await secret(page).innerText()).trim();
      assert.ok(/^[a-z]+-[a-z]+-[a-z]+$/.test(password), "A generated password contains exactly three words separated by hyphens.");
      return password;
    };
    const primaryUid = page => page.evaluate(async () => {
      const { auth } = await import("/src/lib/firebase.ts");
      await auth.authStateReady();
      return auth.currentUser?.uid ?? null;
    });
    const emailSignIn = async (page, email, next) => {
      await go(page, `/login?next=${encodeURIComponent(next)}`);
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[autocomplete="current-password"]').fill(testPassword);
      await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(url => url.hash === `#${next}`);
    };

    await go(guest, `/events/${firstEvent}`);
    await guest.getByText("Local preview · test accounts and events only").waitFor();
    const guestPassword = await join(guest, "Taylor Guest", "Coffee and books.\nPlease avoid nuts.");
    // Requested visual QA of a newly-issued password in this disposable test project.
    await guest.screenshot({ path: "artifacts/password-signup-threewords.png", fullPage: true });
    const guestMember = (await database.collection(`events/${firstEvent}/members`).where("name", "==", "Taylor Guest").get()).docs[0];
    assert.ok(guestMember, "Joining creates one participant.");
    const guestUid = guestMember.id;
    assert.equal((await database.doc(`events/${firstEvent}`).get()).data().memberCount, 3);
    assert.equal(await primaryUid(guest), null, "Guest signup does not sign in the primary email account.");

    let clipboardAvailable = true;
    try { await guestContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: address.origin }); }
    catch { clipboardAvailable = false; }
    if (clipboardAvailable) {
      await guest.getByRole("button", { name: "Copy password", exact: true }).click();
      await guest.getByText("Password copied.", { exact: true }).waitFor();
      assert.ok(await guest.evaluate(async value => (await navigator.clipboard.readText()) === value, guestPassword), "Copy password copies the displayed value.");
    }
    await guest.getByRole("button", { name: "Hide password", exact: true }).click();
    await expectHidden(guest);
    await guest.getByLabel("Your name", { exact: true }).fill(guestName);
    await guest.getByRole("textbox", { name: "Gift preferences (optional)", exact: true }).fill("Decaf coffee and history books.\nPlease avoid nuts.");
    await form(guest).getByRole("button", { name: "Save changes", exact: true }).click();
    await guest.getByText("Saved.", { exact: true }).waitFor();
    const updatedGuest = (await guestMember.ref.get()).data();
    assert.equal(updatedGuest.uid, guestUid);
    assert.equal(updatedGuest.name, guestName);
    assert.equal(updatedGuest.preferences, "Decaf coffee and history books.\nPlease avoid nuts.");
    assert.equal((await database.doc(`events/${firstEvent}`).get()).data().memberCount, 3);

    await guest.getByRole("button", { name: "Show my password", exact: true }).click();
    await secret(guest).waitFor();
    assert.ok((await secret(guest).innerText()).trim() === guestPassword, "Saved password is recoverable by its owner.");
    await navigate(guest, "/");
    await guest.locator(".event-card").first().waitFor();
    await navigate(guest, `/events/${firstEvent}`);
    await expectHidden(guest);
    await guest.getByRole("button", { name: "Show my password", exact: true }).click();
    await secret(guest).waitFor();
    await guest.reload();
    await registered(guest).waitFor();
    await expectHidden(guest);
    await guest.getByRole("button", { name: "Sign out of event", exact: true }).click();
    await guest.getByLabel("Your password", { exact: true }).waitFor();
    const wrongPassword = guestPassword.slice(0, -1) + (guestPassword.endsWith("z") ? "y" : "z");
    await enterPassword(guest, wrongPassword, false);
    await enterPassword(guest, guestPassword.toUpperCase().replaceAll("-", "  "));
    assert.equal(await guest.getByRole("textbox", { name: "Gift preferences (optional)", exact: true }).inputValue(), updatedGuest.preferences);

    await navigate(guest, `/events/${secondEvent}`);
    await guest.getByLabel("Your name", { exact: true }).waitFor();
    await enterPassword(guest, guestPassword, false);
    await guest.locator('.tabs[aria-label="Event access"]').getByRole("button", { name: "Join event", exact: true }).click();
    const secondPassword = await join(guest, guestName, "Tea in Sheffield.");
    assert.ok(secondPassword !== guestPassword, "One person gets separate passwords for separate events.");
    await guest.getByRole("button", { name: "Hide password", exact: true }).click();
    await guest.getByRole("button", { name: "Sign out of event", exact: true }).click();
    await guest.getByLabel("Your password", { exact: true }).waitFor();
    await navigate(guest, `/events/${firstEvent}`);
    await registered(guest).waitFor();
    await expectHidden(guest);
    await navigate(guest, `/events/${secondEvent}`);
    await enterPassword(guest, secondPassword);
    await guest.reload();
    await registered(guest).waitFor();
    await navigate(guest, "/my-events");
    await guest.locator(".event-card").nth(1).waitFor();
    assert.equal(await guest.locator(".event-card").count(), 2, "Both event memberships survive reload.");
    console.log("Passed guest joining, personal passwords, edits, copy/conceal, password-only return, and independent event sessions.");

    await go(organiser, "/");
    await organiser.getByRole("link", { name: "Organiser", exact: true }).click();
    await organiser.getByRole("heading", { name: "Organiser sign in", exact: true }).waitFor();
    assert.equal(await organiser.getByRole("button", { name: "Create account", exact: true }).count(), 0);
    await emailSignIn(organiser, "organiser@example.test", "/admin");
    await go(organiser, `/events/${firstEvent}`);
    const organiserGuestPassword = await join(organiser, organiserGuestName, "Dark chocolate.");
    assert.ok(organiserGuestPassword !== guestPassword, "Different participants in the same event receive different passwords.");
    assert.equal(await primaryUid(organiser), "demo-organiser", "Guest signup preserves the organiser's primary session.");
    await organiser.getByRole("button", { name: "Hide password", exact: true }).click();
    await navigate(organiser, `/admin/${firstEvent}`);
    await organiser.locator("tbody tr").nth(3).waitFor();
    assert.equal(await organiser.locator("tbody tr").count(), 4);
    const organiserPreferences = organiser.getByTestId(`participant-preferences-${guestUid}`);
    assert.equal(await organiserPreferences.getAttribute("open"), null, "Organiser preferences start collapsed.");
    await organiserPreferences.locator("summary").click();
    assert.equal(await organiserPreferences.locator("p").innerText(), updatedGuest.preferences);
    assert.match(await organiserPreferences.locator("p").evaluate(element => getComputedStyle(element).whiteSpace), /pre-wrap|pre-line|break-spaces/, "Organiser preferences preserve line breaks.");
    assert.equal(await organiser.locator('[data-testid^="password-"]').count(), 0, "Expanding preferences never reveals passwords.");
    assert.equal(await organiser.locator('[data-testid^="pairing-"]').count(), 0, "Expanding preferences never reveals assignments.");
    await organiser.screenshot({ path: "artifacts/password-admin-preferences-desktop.png", fullPage: true });
    await organiserPreferences.locator("summary").click();
    const emptyPreferences = organiser.getByTestId("participant-preferences-legacy-robin");
    await emptyPreferences.locator("summary").click();
    await emptyPreferences.getByText("No preferences provided.", { exact: true }).waitFor();
    await emptyPreferences.locator("summary").click();
    await organiser.getByRole("button", { name: `Reveal password for ${guestName}`, exact: true }).click();
    await organiser.getByTestId(`password-${guestUid}`).waitFor();
    assert.ok((await organiser.getByTestId(`password-${guestUid}`).innerText()).trim() === guestPassword, "The organiser can recover the correct participant password.");
    await organiser.getByRole("button", { name: `Hide password for ${guestName}`, exact: true }).click();
    assert.equal(await organiser.locator('[data-testid^="password-"]').count(), 0);
    await organiser.getByRole("button", { name: `Reveal password for ${guestName}`, exact: true }).click();
    await organiser.getByTestId(`password-${guestUid}`).waitFor();
    await organiser.getByRole("button", { name: "Event details", exact: true }).click();
    await organiser.getByRole("button", { name: "Participants & draw", exact: true }).click();
    assert.equal(await organiser.locator('[data-testid^="password-"]').count(), 0, "Changing tabs conceals all passwords.");
    await organiser.reload();
    await organiser.locator("tbody tr").nth(3).waitFor();
    assert.equal(await organiser.locator('[data-testid^="password-"]').count(), 0, "Reload conceals all organiser password rows.");

    await organiser.getByRole("button", { name: "Close registration", exact: true }).click();
    await organiser.getByRole("button", { name: "Draw recipients", exact: true }).click();
    await organiser.getByRole("button", { name: "Confirm & draw", exact: true }).click();
    await organiser.getByText("Draw complete. Participants can now view their recipients.", { exact: true }).waitFor({ timeout: 45000 });
    const drawnEvent = (await database.doc(`events/${firstEvent}`).get()).data();
    const assignmentsCollection = database.collection(`events/${firstEvent}/runs/${drawnEvent.activeRunId}/assignments`);
    const assignmentsBefore = Object.fromEntries((await assignmentsCollection.get()).docs.map(doc => [doc.id, doc.data()]));
    assert.equal(Object.keys(assignmentsBefore).length, 4);
    assert.equal(await organiser.locator('[data-testid^="pairing-"]').count(), 0, "Drawing never automatically reveals pairings.");

    const legacyPasswords = new Map();
    for (const [uid, name] of Object.entries(names)) {
      const memberBefore = (await database.doc(`events/${firstEvent}/members/${uid}`).get()).data();
      await organiser.getByRole("button", { name: `Reveal password for ${name}`, exact: true }).click();
      await organiser.getByRole("button", { name: `Create password for ${name}`, exact: true }).click();
      await organiser.getByTestId(`password-${uid}`).waitFor();
      const issuedPassword = (await organiser.getByTestId(`password-${uid}`).innerText()).trim();
      assert.ok(/^[a-z]+-[a-z]+-[a-z]+$/.test(issuedPassword), "Legacy password issuance also uses exactly three words.");
      legacyPasswords.set(uid, issuedPassword);
      await organiser.getByRole("button", { name: `Hide password for ${name}`, exact: true }).click();
      assert.deepEqual((await database.doc(`events/${firstEvent}/members/${uid}`).get()).data(), memberBefore, "Issuing a password keeps the original membership intact.");
    }
    assert.deepEqual(Object.fromEntries((await assignmentsCollection.get()).docs.map(doc => [doc.id, doc.data()])), assignmentsBefore, "Passwords issued after drawing never change published assignments.");
    assert.equal((await database.doc(`events/${firstEvent}`).get()).data().memberCount, 4);
    assert.equal(await primaryUid(organiser), "demo-organiser", "Issuing passwords through temporary accounts preserves organiser access.");
    await organiser.screenshot({ path: "artifacts/password-admin-desktop.png", fullPage: true });
    console.log("Passed organiser session isolation, recovery/concealment, drawing, and legacy issuance without membership or assignment changes.");

    await navigate(guest, `/events/${firstEvent}`);
    await registered(guest).waitFor();
    await expectHidden(guest);
    await guest.getByRole("button", { name: "Reveal my recipient", exact: true }).click();
    await guest.getByTestId("recipient-name").waitFor();
    const assignment = assignmentsBefore[guestUid];
    assert.equal((await guest.getByTestId("recipient-name").innerText()).trim(), assignment.recipientName);
    const recipientCredential = (await database.doc(`events/${firstEvent}/credentials/${assignment.recipientUid}`).get()).data();
    assert.ok(recipientCredential, "Every possible test recipient has credentials so the privacy assertion is meaningful.");
    assert.ok(!(await guest.locator("body").innerText()).includes(recipientCredential.password), "A giver never sees the recipient's password.");
    assert.equal(await guest.locator('[data-testid^="password-"]').count(), 0);
    const token = await guest.evaluate(async eventId => {
      const { getEventServices } = await import("/src/lib/firebase.ts");
      return getEventServices(eventId).auth.currentUser.getIdToken();
    }, firstEvent);
    const forbidden = await fetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/events/${firstEvent}/credentials/${assignment.recipientUid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(forbidden.status, 403, "Rules deny direct recipient-password reads, including by the assigned giver.");
    await guest.getByRole("button", { name: "Hide my recipient", exact: true }).click();
    await guest.getByRole("textbox", { name: "Gift preferences (optional)", exact: true }).fill("Updated after the draw: decaf only.");
    await form(guest).getByRole("button", { name: "Save preferences", exact: true }).click();
    await guest.getByText("Saved.", { exact: true }).waitFor();
    assert.equal((await guestMember.ref.get()).data().name, guestName);
    assert.equal((await guestMember.ref.get()).data().preferences, "Updated after the draw: decaf only.");
    await organiser.reload();
    await organiser.locator("tbody tr").nth(3).waitFor();
    await organiserPreferences.locator("summary").click();
    assert.equal(await organiserPreferences.locator("p").innerText(), "Updated after the draw: decaf only.", "The organiser can read saved post-draw preferences after reloading.");
    assert.equal(await organiser.locator('[data-testid^="password-"]').count(), 0);
    assert.equal(await organiser.locator('[data-testid^="pairing-"]').count(), 0);
    await organiserPreferences.locator("summary").click();

    const legacyContext = await createContext();
    const legacy = await legacyContext.newPage();
    await emailSignIn(legacy, "casey@example.test", `/events/${firstEvent}`);
    await registered(legacy).waitFor();
    await expectHidden(legacy);
    await legacy.getByRole("button", { name: "Show my password", exact: true }).click();
    await secret(legacy).waitFor();
    assert.ok((await secret(legacy).innerText()).trim() === legacyPasswords.get("legacy-casey"), "An existing email account can retrieve its newly-issued password.");
    await legacy.getByRole("button", { name: "Sign out of email account", exact: true }).click();
    await legacy.getByLabel("Your password", { exact: true }).waitFor();
    await enterPassword(legacy, legacyPasswords.get("legacy-casey"));
    assert.equal(await primaryUid(legacy), null, "A migrated participant returns without an email session.");
    await legacy.getByRole("button", { name: "Reveal my recipient", exact: true }).click();
    await legacy.getByTestId("recipient-name").waitFor();
    assert.equal((await legacy.getByTestId("recipient-name").innerText()).trim(), assignmentsBefore["legacy-casey"].recipientName);
    await legacy.getByRole("button", { name: "Hide my recipient", exact: true }).click();
    await legacyContext.close();

    const secrets = [guestPassword, secondPassword, organiserGuestPassword, ...legacyPasswords.values()];
    assert.ok(await guest.evaluate(values => {
      const stored = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
      return values.every(value => !stored.includes(value));
    }, secrets), "Passwords are not saved as plaintext in browser local/session storage.");
    assert.ok(secrets.every(value => !guest.url().includes(value) && !organiser.url().includes(value)), "Passwords never enter URLs.");

    const mobileContext = await createContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      storageState: await guestContext.storageState({ indexedDB: true }),
    });
    const mobile = await mobileContext.newPage();
    await go(mobile, `/events/${firstEvent}`);
    await registered(mobile).waitFor();
    await expectHidden(mobile);
    await mobile.getByRole("button", { name: "Show my password", exact: true }).click();
    await secret(mobile).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Visible password does not cause mobile horizontal overflow.");
    await mobile.getByRole("button", { name: "Hide password", exact: true }).click();
    await mobile.screenshot({ path: "artifacts/password-event-mobile.png", fullPage: true });
    await go(mobile, "/my-events");
    await mobile.locator(".event-card").nth(1).waitFor();
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Multiple memberships fit the mobile layout.");
    await mobileContext.close();
    const adminMobileContext = await createContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      storageState: await organiserContext.storageState({ indexedDB: true }),
    });
    const adminMobile = await adminMobileContext.newPage();
    await go(adminMobile, `/admin/${firstEvent}`);
    await adminMobile.locator("tbody tr").nth(3).waitFor();
    await adminMobile.getByTestId(`participant-preferences-${guestUid}`).locator("summary").click();
    assert.ok(await adminMobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Expanded organiser preferences do not cause mobile page overflow.");
    assert.equal(await adminMobile.locator('[data-testid^="password-"]').count(), 0);
    await adminMobile.screenshot({ path: "artifacts/password-admin-mobile.png", fullPage: true });
    await adminMobileContext.close();
    await guest.screenshot({ path: "artifacts/password-event-desktop.png", fullPage: true });
    assert.deepEqual(unexpectedRequests, [], "No browser requests reached production or unrelated services.");
    assert.deepEqual(errors, [], "No uncaught browser errors.");
    console.log(`Event password browser checks passed: guest registration, independent three-word passwords, edits, normalized return, wrong credentials, organiser recovery/preferences, preserved legacy identities/draws, recipient privacy, concealment, persistence, and mobile layout. Clipboard ${clipboardAvailable ? "verified" : "unavailable in this browser"}.`);
  }
} catch (error) {
  for (const [index, page] of diagnosticPages.entries()) {
    if (page.isClosed()) continue;
    const state = await page.evaluate(() => ({
      route: location.hash,
      headings: Array.from(document.querySelectorAll("h1,h2"), element => element.textContent),
      labels: Array.from(document.querySelectorAll("label"), element => element.textContent?.trim()),
      alerts: Array.from(document.querySelectorAll('[role="alert"]'), element => element.textContent),
    })).catch(() => ({ unavailable: true }));
    console.error("Browser failure state", index, state);
    await page.screenshot({
      path: `artifacts/password-failure-${index}.png`, fullPage: true,
      mask: [page.locator('[data-testid="event-password"], [data-testid^="password-"], input')],
    }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await deleteApp(sdk);
}
