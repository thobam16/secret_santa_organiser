import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Run the real UI against an isolated in-browser service model. These tests do
// not create accounts, reset emulators, or write to Firebase.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const address = new URL(base);
if (!["127.0.0.1", "localhost"].includes(address.hostname)) {
  throw new Error(
    "Preference checks are local-only. Run the Vite development server.",
  );
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
const unexpectedRequests = [];
page.on("pageerror", (error) => errors.push(error.message));

await context.route("**/*", (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (
    url.origin !== address.origin ||
    !["GET", "HEAD"].includes(request.method())
  ) {
    unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  }
  return route.continue();
});

await context.addInitScript(() => {
  const key = "secret-santa-preferences-test";
  const saved = JSON.parse(sessionStorage.getItem(key) || "null");
  const state = {
    observers: new Set(),
    eventObservers: new Set(),
    calls: saved?.calls || [],
    member: saved?.member || null,
    isAdmin: false,
    roster: [],
    recipientPreferences:
      saved?.recipientPreferences ??
      "History books and dark chocolate.\nPlease avoid anything with nuts.",
    events: saved?.events || [
      {
        id: "gathering",
        name: "Christmas gathering",
        signupDeadline: Date.now() + 7 * 86400_000,
        exchangeAt: Date.now() + 21 * 86400_000,
        timezone: "Europe/London",
        budget: 10,
        details:
          "Gift exchange at the Christmas party. Bring your wrapped gift.",
        guidelines: [
          "Wrap your gift before the exchange",
          "Label your gift with recipient’s name only",
        ],
        giftIdeas: ["Books", "Homemade gifts", "Gourmet treats"],
        status: "open",
        memberCount: 3,
        activeRunId: null,
        createdAt: 1,
      },
    ],
  };
  state.auth = {
    currentUser: {
      uid: "alice",
      email: "alice@example.test",
      emailVerified: true,
      async reload() {},
      async getIdToken() {
        return "test-token";
      },
    },
  };
  state.eventAuth = { currentUser: null };
  state.persist = () =>
    sessionStorage.setItem(
      key,
      JSON.stringify({
        calls: state.calls,
        member: state.member,
        recipientPreferences: state.recipientPreferences,
        events: state.events,
      }),
    );
  state.emitEvents = () => {
    state.persist();
    for (const callback of state.eventObservers)
      callback(structuredClone(state.events));
  };
  state.setStatus = (status, expired = false) => {
    state.events[0] = {
      ...state.events[0],
      status,
      signupDeadline:
        status === "open" && !expired
          ? Date.now() + 7 * 86400_000
          : Date.now() - 60000,
      activeRunId: ["drawn", "archived"].includes(status) ? "saved-run" : null,
    };
    state.emitEvents();
  };
  state.record = (method, args) => {
    state.calls.push({ method, args });
    state.persist();
  };
  window.__preferencesTest = state;
});

await page.route(/\/src\/lib\/firebase\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `export const auth = window.__preferencesTest.auth;
      export const db = {};
      export const emulatorMode = true;
      export function getEventServices() { return { auth: window.__preferencesTest.eventAuth, db: {} }; }`,
  }),
);
await page.route(
  /\/node_modules\/\.vite\/deps\/firebase_auth\.js(?:\?|$)/,
  (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export function onIdTokenChanged(auth, callback) {
      const state = window.__preferencesTest;
      if (auth !== state.auth) {
        let active = true;
        queueMicrotask(() => { if (active) void callback(null); });
        return () => { active = false; };
      }
      state.observers.add(callback);
      queueMicrotask(() => { if (state.observers.has(callback)) void callback(auth.currentUser); });
      return () => state.observers.delete(callback);
    }
    export async function signOut() { throw new Error('Unexpected sign-out in preferences test'); }
    export async function sendEmailVerification() { throw new Error('Unexpected verification'); }
    export async function sendPasswordResetEmail() { throw new Error('Unexpected password reset'); }
    export async function createUserWithEmailAndPassword() { throw new Error('Unexpected account creation'); }
    export async function signInWithEmailAndPassword() { throw new Error('Unexpected sign-in'); }
  `,
    }),
);
await page.route(/\/src\/lib\/api\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `
    const state = window.__preferencesTest;
    const assert = (value, message) => { if (!value) throw new Error('Mock API: ' + message); };
    const checkPreferences = value => assert(typeof value === 'string' && value.length <= 500, 'preferences must be a string of at most 500 characters');
    export function subscribeEvents(next) {
      state.eventObservers.add(next);
      queueMicrotask(() => { if (state.eventObservers.has(next)) next(structuredClone(state.events)); });
      return () => state.eventObservers.delete(next);
    }
    export async function getIsAdmin(uid) { assert(uid === 'alice', 'wrong account'); return state.isAdmin; }
    export async function getMyMemberships(uid, ids) {
      assert(uid === 'alice', 'membership requested for wrong user');
      assert(Array.isArray(ids) && ids.every(id => id === 'gathering'), 'unexpected membership event');
      return state.member ? { gathering: structuredClone(state.member) } : {};
    }
    function saveMember(eventId, name, preferences, method) {
      assert(eventId === 'gathering', 'wrong join event');
      assert(state.events[0].status === 'open' && state.events[0].signupDeadline > Date.now(), 'name/join changes after signup closed');
      assert(typeof name === 'string' && name.trim().length > 0, 'missing name');
      checkPreferences(preferences);
      state.record(method, [eventId, name, preferences]);
      if (!state.member) state.events[0].memberCount++;
      state.member = { uid: 'alice', name: name.trim(), preferences: preferences.trim(), joinedAt: state.member?.joinedAt || 1 };
      state.emitEvents();
    }
    export async function joinWithEventPassword(eventId, name, preferences = '') {
      assert(!state.member, 'join must not overwrite an existing membership');
      saveMember(eventId, name, preferences, 'joinWithEventPassword');
      return { member: structuredClone(state.member), password: 'mock-holly-candle-snow' };
    }
    export async function updateParticipant(eventId, name, preferences = '') {
      assert(!!state.member, 'profile updates require membership');
      saveMember(eventId, name, preferences, 'updateParticipant');
    }
    export async function updateParticipantPreferences(eventId, preferences) {
      assert(eventId === 'gathering', 'wrong preferences event');
      assert(!!state.member, 'preferences require membership');
      assert(state.events[0].status !== 'archived', 'archived preferences are immutable');
      checkPreferences(preferences);
      state.record('updateParticipantPreferences', [eventId, preferences]);
      state.member = { ...state.member, preferences: preferences.trim() };
      state.persist();
    }
    export async function getParticipantRecipient(eventId) {
      const uid = state.auth.currentUser?.uid;
      assert(eventId === 'gathering' && uid === 'alice', 'wrong recipient request');
      assert(['drawn', 'archived'].includes(state.events[0].status), 'recipient requested before publication');
      state.record('getParticipantRecipient', [eventId]);
      return { giverUid: uid, recipientUid: 'taylor', recipientName: 'Taylor Reed', preferences: state.recipientPreferences };
    }
    export async function getParticipantMembership() { throw new Error('Unexpected event account membership request'); }
    export async function getParticipantPassword() { return null; }
    export async function getMemberPassword(...args) {
      state.record('getMemberPassword', args);
      throw new Error('Preferences must not fetch passwords');
    }
    export async function issueParticipantPassword() { throw new Error('Unexpected password issuance'); }
    export async function leaveParticipant() { throw new Error('Unexpected removal'); }
    export async function signInParticipant() { throw new Error('Unexpected sign-in'); }
    export async function signOutParticipant() { throw new Error('Unexpected sign-out'); }
    export async function joinEvent() { throw new Error('Participant UI must use joinWithEventPassword'); }
    export async function updatePreferences() { throw new Error('Participant UI must use updateParticipantPreferences'); }
    export async function getRecipient() { throw new Error('Participant UI must use getParticipantRecipient'); }
    export async function getAssignment(...args) {
      state.record('getAssignment', args);
      throw new Error('Preferences must not fetch pairings');
    }
    export async function getMembers(eventId) {
      assert(state.isAdmin && eventId === 'gathering', 'roster requires organiser access to this event');
      state.record('getMembers', [eventId]);
      return structuredClone(state.roster);
    }
    export async function leaveEvent() { throw new Error('Unexpected removal'); }
    export async function saveEvent() { throw new Error('Unexpected event mutation'); }
    export async function setRegistration() { throw new Error('Unexpected registration mutation'); }
    export async function runDraw() { throw new Error('Unexpected draw'); }
    export async function archiveEvent() { throw new Error('Unexpected archive'); }
  `,
  }),
);

const preferences = () =>
  page.getByRole("textbox", {
    name: "Gift preferences (optional)",
    exact: true,
  });
const ownHints = "Coffee, books and puzzles.\nPlease avoid scented products.";
const recipientHints =
  "History books and dark chocolate.\nPlease avoid anything with nuts.";
const latestCall = (method) =>
  page.evaluate(
    (method) =>
      window.__preferencesTest.calls
        .filter((call) => call.method === method)
        .at(-1),
    method,
  );
const saved = () => page.getByText("Saved.", { exact: true }).waitFor();
const checkNoOverflow = async () => {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll(
      ".admin-layout, .admin-sidebar, .admin-main, .page-heading, .countdown-grid, .panel, .tabs, .table-scroll, .participant-table",
    )]
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflow: getComputedStyle(element).overflow,
      }))
      .filter((element) =>
        element.right > window.innerWidth + 1 || element.className === "table-scroll",
      ),
  }));
  assert.ok(
    overflow.page <= overflow.viewport + 1,
    `No horizontal viewport overflow: ${JSON.stringify(overflow)}`,
  );
};

try {
  await page.goto(`${base}/#/events/gathering`);
  await page
    .locator("form")
    .getByRole("button", { name: "Join event", exact: true })
    .waitFor();
  assert.equal(await preferences().getAttribute("maxlength"), "500");
  assert.equal(
    await preferences().getAttribute("placeholder"),
    "Interests, favourite treats, or things to avoid.",
  );
  assert.equal(
    await preferences().getAttribute("required"),
    null,
    "Gift preferences are optional",
  );

  // An empty optional value must not prevent joining or invent a preference.
  await page.getByLabel("Your name", { exact: true }).fill("Alex Morgan");
  await page
    .locator("form")
    .getByRole("button", { name: "Join event", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "You’re registered", exact: true })
    .waitFor();
  assert.deepEqual(await latestCall("joinWithEventPassword"), {
    method: "joinWithEventPassword",
    args: ["gathering", "Alex Morgan", ""],
  });

  // Both editable fields travel together while signup is open, and reload from
  // persisted service state rather than merely remaining in a React textarea.
  await page
    .getByLabel("Your name", { exact: true })
    .fill("Alex Morgan Updated");
  await preferences().fill(ownHints);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await saved();
  assert.deepEqual(await latestCall("updateParticipant"), {
    method: "updateParticipant",
    args: ["gathering", "Alex Morgan Updated", ownHints],
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .waitFor();
  assert.equal(await preferences().inputValue(), ownHints);
  assert.equal(
    await page.getByLabel("Your name", { exact: true }).inputValue(),
    "Alex Morgan Updated",
  );
  assert.equal(await page.getByTestId("recipient-preferences").count(), 0);

  // Native text entry respects the declared limit; the maximum value remains savable.
  await preferences().fill("x".repeat(501));
  assert.equal((await preferences().inputValue()).length, 500);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await saved();
  assert.equal((await latestCall("updateParticipant")).args[2].length, 500);

  // Closing signup, including expiry without a state transition, freezes names
  // but retains preference edits. Drawing and publication do not change that.
  for (const status of ["open", "locked", "drawing", "drawn"]) {
    await page.evaluate(
      (status) => window.__preferencesTest.setStatus(status, true),
      status,
    );
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Your name", { exact: true }).count(),
      0,
      `No name editor in ${status} after cutoff`,
    );
    const value = `${ownHints}\nUpdated after ${status === "open" ? "the deadline" : status}.`;
    await preferences().fill(value);
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await saved();
    assert.deepEqual(await latestCall("updateParticipantPreferences"), {
      method: "updateParticipantPreferences",
      args: ["gathering", value],
    });
    assert.equal(
      await page.evaluate(() => window.__preferencesTest.member.name),
      "Alex Morgan Updated",
    );
  }
  assert.equal(
    await page.evaluate(
      () =>
        window.__preferencesTest.calls.filter(
          (call) => call.method === "getParticipantRecipient",
        ).length,
    ),
    0,
    "Recipient details are fetched only on reveal",
  );

  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  await page.getByTestId("recipient-preferences").waitFor();
  assert.equal(
    await page.getByTestId("recipient-name").textContent(),
    "Taylor Reed",
  );
  assert.ok(
    (await page.getByTestId("recipient-preferences").textContent()).includes(
      recipientHints,
    ),
  );
  assert.deepEqual(await latestCall("getParticipantRecipient"), {
    method: "getParticipantRecipient",
    args: ["gathering"],
  });
  assert.equal(
    await page
      .getByRole("heading", { name: "Gift preferences", exact: true })
      .count(),
    1,
  );
  assert.match(
    await page
      .getByTestId("recipient-preferences")
      .evaluate((element) => getComputedStyle(element).whiteSpace),
    /pre-wrap|pre-line|break-spaces/,
    "Multiline hints keep line breaks",
  );
  await page
    .getByRole("button", { name: "Hide my recipient", exact: true })
    .click();
  assert.equal(await page.getByTestId("recipient-preferences").count(), 0);
  assert.equal(await page.locator(".recipient-preferences").count(), 0);
  assert.equal(await page.getByTestId("recipient-name").count(), 0);
  assert.equal(
    await page.getByText(recipientHints, { exact: true }).count(),
    0,
    "Hidden preferences leave the rendered document",
  );

  // Missing/cleared recipient hints should not leave an empty heading or panel.
  await page.evaluate(() => {
    window.__preferencesTest.recipientPreferences = "";
    window.__preferencesTest.persist();
  });
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  await page.getByTestId("recipient-name").waitFor();
  assert.equal(await page.getByTestId("recipient-preferences").count(), 0);
  assert.equal(await page.locator(".recipient-preferences").count(), 0);
  assert.equal(
    await page
      .getByRole("heading", { name: "Gift preferences", exact: true })
      .count(),
    0,
  );
  await preferences().fill("");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await saved();
  assert.deepEqual(await latestCall("updateParticipantPreferences"), {
    method: "updateParticipantPreferences",
    args: ["gathering", ""],
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .waitFor();
  assert.equal(await preferences().inputValue(), "");

  // Archived membership retains readable hints without an edit affordance.
  await page.evaluate((value) => {
    const state = window.__preferencesTest;
    state.member.preferences = value;
    state.setStatus("archived");
  }, ownHints);
  await page.reload();
  await page
    .getByRole("heading", { name: "You’re registered", exact: true })
    .waitFor();
  assert.equal(await preferences().count(), 0);
  assert.equal(await page.getByLabel("Your name", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .count(),
    0,
  );
  await page.getByText(ownHints, { exact: true }).waitFor();

  // A long unbroken value must wrap instead of stretching the mobile viewport.
  await page.evaluate(() => {
    const state = window.__preferencesTest;
    state.recipientPreferences = "x".repeat(500);
    state.setStatus("drawn");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  await page.getByTestId("recipient-preferences").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkNoOverflow();
  assert.ok(
    await page
      .getByTestId("recipient-preferences")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    "Long preferences wrap inside their panel",
  );

  // Capture useful, natural text rather than the boundary-test filler.
  await page.evaluate(
    ({ ownHints, recipientHints }) => {
      const state = window.__preferencesTest;
      state.member.preferences = ownHints;
      state.recipientPreferences = recipientHints;
      state.persist();
    },
    { ownHints, recipientHints },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  await page.getByTestId("recipient-preferences").waitFor();
  await mkdir("artifacts", { recursive: true });
  await checkNoOverflow();
  await page.screenshot({
    path: "artifacts/preferences-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await checkNoOverflow();
  await page.screenshot({
    path: "artifacts/preferences-desktop.png",
    fullPage: true,
  });

  // The organiser can inspect each participant's hints without fetching either
  // recoverable passwords or recipient assignments.
  await page.evaluate((recipientHints) => {
    const state = window.__preferencesTest;
    state.isAdmin = true;
    state.roster = [
      structuredClone(state.member),
      {
        uid: "taylor",
        name: "Taylor Reed",
        preferences: recipientHints,
        joinedAt: 1,
      },
      { uid: "sam", name: "Sam Ellis", joinedAt: 1 },
    ];
    state.events[0].memberCount = state.roster.length;
    state.emitEvents();
    for (const callback of state.observers) void callback(state.auth.currentUser);
    location.hash = "/admin/gathering";
  }, recipientHints);
  await page.locator(".participant-table").waitFor();
  assert.equal(await page.locator(".participant-preferences").count(), 3);
  const organiserHints = page.getByTestId("participant-preferences-alice");
  const emptyHints = page.getByTestId("participant-preferences-sam");
  assert.equal(await organiserHints.locator("p").isVisible(), false);
  await organiserHints.locator("summary").click();
  await organiserHints.locator("p").waitFor();
  assert.equal(await organiserHints.locator("p").textContent(), ownHints);
  assert.match(
    await organiserHints.locator("p").evaluate(
      (element) => getComputedStyle(element).whiteSpace,
    ),
    /pre-wrap|pre-line|break-spaces/,
    "The organiser sees the participant's original line breaks",
  );
  await emptyHints.locator("summary").click();
  await emptyHints
    .getByText("No preferences provided.", { exact: true })
    .waitFor();
  await page
    .getByTestId("participant-preferences-taylor")
    .locator("summary")
    .click();
  await checkNoOverflow();
  await page.screenshot({
    path: "artifacts/organiser-preferences-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkNoOverflow();
  assert.ok(
    await organiserHints.locator("p").evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
    "Organiser preferences fit within the mobile participant cell",
  );
  await page.screenshot({
    path: "artifacts/organiser-preferences-mobile.png",
    fullPage: true,
  });

  // Long unbroken hints also remain contained, without changing table columns.
  await page.evaluate(() => {
    window.__preferencesTest.roster[0].preferences = "x".repeat(500);
    location.hash = "/";
  });
  await page.locator(".participant-table").waitFor({ state: "detached" });
  await page.evaluate(() => { location.hash = "/admin/gathering"; });
  await organiserHints.locator("summary").click();
  assert.equal((await organiserHints.locator("p").textContent()).length, 500);
  await checkNoOverflow();
  assert.ok(
    await organiserHints.locator("p").evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
    "Long organiser hints wrap without widening the roster",
  );
  await organiserHints.locator("summary").click();
  assert.equal(await organiserHints.locator("p").isVisible(), false);
  assert.equal(
    await page
      .locator('[data-testid^="password-"], [data-testid^="pairing-"]')
      .count(),
    0,
    "Passwords and recipient pairings remain hidden",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__preferencesTest.calls.filter(
      (call) => ["getMemberPassword", "getAssignment"].includes(call.method),
    )),
    [],
    "Viewing gift preferences never requests passwords or pairings",
  );
  assert.equal(await page.locator(".notice.error").count(), 0);

  assert.deepEqual(
    unexpectedRequests,
    [],
    "No real backend calls or mutation requests",
  );
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(
    "Preference checks passed: optional blank join, saved reloads, 500-character limit, edits after signup and draw, recipient reveal/hide, archived read-only, organiser expand/collapse with empty hints, and responsive multiline/long text without password or pairing reads. No Firebase data touched.",
  );
} finally {
  await browser.close();
}
