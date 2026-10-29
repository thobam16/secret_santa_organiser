import assert from "node:assert/strict";
import { chromium } from "playwright";

// Exercise the real React app with deferred service responses. All Firebase-facing
// modules are replaced in this isolated browser context; no emulator data is used.
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) {
  throw new Error(
    "Auth race checks are local-only. Run the Vite development server.",
  );
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await context.addInitScript(() => {
  const state = {
    observers: new Set(),
    eventObservers: new Set(),
    rolesHeld: new Set(),
    roleWaiters: new Map(),
    membershipsHeld: new Set(),
    membershipWaiters: new Map(),
    reloadHeld: false,
    reloadWaiter: null,
    eventsListener: null,
    joinAllowed: false,
    joinMember: null,
    joinWaiter: null,
    joinNumber: 0,
    joinCalls: [],
  };
  const makeUser = (uid, verified = true) => ({
    uid,
    email: `${uid}@example.test`,
    emailVerified: verified,
    async reload() {
      if (state.reloadHeld)
        await new Promise((resolve, reject) => {
          state.reloadWaiter = { resolve, reject };
        });
      this.emailVerified = true;
    },
    async getIdToken() {
      if (state.auth.currentUser === this) state.emit(this);
      return "test-token";
    },
  });
  state.auth = { currentUser: makeUser("alice") };
  state.eventAuth = { currentUser: null };
  state.makeUser = makeUser;
  state.emit = (user) => {
    state.auth.currentUser = user;
    for (const callback of state.observers) void callback(user);
  };
  state.emitEvent = (user) => {
    state.eventAuth.currentUser = user;
    for (const callback of state.eventObservers) void callback(user);
  };
  state.setHidden = (hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  state.prepareJoin = () => {
    state.joinAllowed = true;
    state.joinMember = null;
    state.joinWaiter = null;
    state.joinNumber += 1;
    state.joinCalls = [];
    state.emitEvent(null);
    state.setHidden(false);
    state.events = state.events.map((event) => ({
      ...event,
      status: "open",
      signupDeadline: Date.now() + 86_400_000,
      exchangeAt: Date.now() + 172_800_000,
      activeRunId: null,
    }));
    state.eventsListener([...state.events]);
  };
  state.resolveJoin = () => {
    if (!state.joinWaiter) throw new Error("No pending mock join");
    const { name, preferences, resolve } = state.joinWaiter;
    const uid = `joined-${state.joinNumber}`;
    state.joinMember = { uid, name, preferences, joinedAt: 1 };
    state.emitEvent(makeUser(uid, false));
    state.joinWaiter = null;
    resolve({
      member: structuredClone(state.joinMember),
      password: "mock-holly-candle-password",
    });
  };
  state.switchUser = (uid, { verified = true, holdRole = false } = {}) => {
    if (holdRole) state.rolesHeld.add(uid);
    state.emit(uid ? makeUser(uid, verified) : null);
  };
  state.resolveRole = (uid) => {
    state.rolesHeld.delete(uid);
    for (const resolve of state.roleWaiters.get(uid) || []) resolve(false);
    state.roleWaiters.delete(uid);
  };
  state.membershipFor = (uid) => ({
    gathering: {
      uid,
      name: `Member ${uid}`,
      preferences: `Gift ideas for ${uid}`,
      joinedAt: 1,
    },
  });
  state.resolveMembership = (uid) => {
    state.membershipsHeld.delete(uid);
    for (const { resolve } of state.membershipWaiters.get(uid) || [])
      resolve(state.membershipFor(uid));
    state.membershipWaiters.delete(uid);
  };
  state.events = [
    {
      id: "gathering",
      name: "Christmas gathering",
      signupDeadline: Date.now() - 60_000,
      exchangeAt: Date.now() + 86_400_000,
      timezone: "Europe/London",
      budget: 10,
      details: "Christmas party",
      guidelines: ["Wrap your gift"],
      giftIdeas: ["Books"],
      status: "drawn",
      memberCount: 3,
      activeRunId: "saved-run",
      createdAt: 1,
    },
  ];
  window.__authRace = state;
});

await page.route(/\/src\/lib\/firebase\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `export const auth = window.__authRace.auth;
      export const db = {};
      export const emulatorMode = true;
      export function getEventServices() { return { auth: window.__authRace.eventAuth, db: {} }; }`,
  }),
);
await page.route(
  /\/node_modules\/\.vite\/deps\/firebase_auth\.js(?:\?|$)/,
  (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export function onIdTokenChanged(auth, callback) {
      const state = window.__authRace;
      if (auth !== state.auth) {
        state.eventObservers.add(callback);
        queueMicrotask(() => { if (state.eventObservers.has(callback)) void callback(auth.currentUser); });
        return () => state.eventObservers.delete(callback);
      }
      state.observers.add(callback);
      queueMicrotask(() => { if (state.observers.has(callback)) void callback(auth.currentUser); });
      return () => state.observers.delete(callback);
    }
    export async function signOut() { window.__authRace.emit(null); }
    export async function sendEmailVerification() {}
    export async function sendPasswordResetEmail() {}
    export async function createUserWithEmailAndPassword() { throw new Error('Unexpected account creation in race test'); }
    export async function signInWithEmailAndPassword() { throw new Error('Unexpected sign-in in race test'); }
  `,
    }),
);
await page.route(/\/src\/lib\/api\.ts(?:\?|$)/, (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `
    const state = window.__authRace;
    export function subscribeEvents(next) {
      state.eventsListener = next;
      queueMicrotask(() => next([...state.events]));
      return () => { if (state.eventsListener === next) state.eventsListener = null; };
    }
    export async function getIsAdmin(uid) {
      if (!state.rolesHeld.has(uid)) return false;
      return new Promise(resolve => state.roleWaiters.set(uid, [...(state.roleWaiters.get(uid) || []), resolve]));
    }
    export async function getMyMemberships(uid) {
      if (!state.membershipsHeld.has(uid)) return state.membershipFor(uid);
      return new Promise((resolve, reject) => state.membershipWaiters.set(uid, [...(state.membershipWaiters.get(uid) || []), { resolve, reject }]));
    }
    export async function getAssignment(eventId, uid) {
      return { giverUid: uid, recipientUid: 'recipient-' + uid, recipientName: 'Recipient for ' + uid };
    }
    export async function getRecipient(eventId, uid) {
      return { ...await getAssignment(eventId, uid), preferences: 'Preferences for ' + uid };
    }
    export async function getParticipantRecipient(eventId) {
      if (!state.auth.currentUser) throw new Error('Recipient requested without an account');
      return getRecipient(eventId, state.auth.currentUser.uid);
    }
    export async function getParticipantMembership(eventId) {
      if (!state.joinAllowed || eventId !== 'gathering') throw new Error('Unexpected event account membership request');
      if (state.joinMember?.uid !== state.eventAuth.currentUser?.uid) throw new Error('Wrong event account');
      return structuredClone(state.joinMember);
    }
    export async function getParticipantPassword() { return null; }
    export async function getMemberPassword() { throw new Error('Unexpected organiser password request'); }
    export async function issueParticipantPassword() { throw new Error('Unexpected mutation'); }
    export async function joinWithEventPassword(eventId, name, preferences) {
      if (!state.joinAllowed || eventId !== 'gathering' || state.joinWaiter || state.joinMember) throw new Error('Unexpected mutation');
      state.joinCalls.push([eventId, name, preferences]);
      return new Promise(resolve => { state.joinWaiter = { name, preferences, resolve }; });
    }
    export async function leaveParticipant() { throw new Error('Unexpected mutation'); }
    export async function signInParticipant() { throw new Error('Unexpected sign-in'); }
    export async function signOutParticipant() { throw new Error('Unexpected sign-out'); }
    export async function updateParticipant() { throw new Error('Unexpected mutation'); }
    export async function updateParticipantPreferences() { throw new Error('Unexpected mutation'); }
    export async function getMembers() { return []; }
    export async function joinEvent() { throw new Error('Unexpected mutation'); }
    export async function updatePreferences() { throw new Error('Unexpected mutation'); }
    export async function leaveEvent() { throw new Error('Unexpected mutation'); }
    export async function saveEvent() { throw new Error('Unexpected mutation'); }
    export async function setRegistration() { throw new Error('Unexpected mutation'); }
    export async function runDraw() { throw new Error('Unexpected mutation'); }
    export async function archiveEvent() { throw new Error('Unexpected mutation'); }
  `,
  }),
);

try {
  await page.goto(`${base}/#/events/gathering`);
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  assert.equal(
    await page.getByTestId("recipient-name").textContent(),
    "Recipient for alice",
  );

  // Hold an old membership response, then switch accounts while the new role is delayed.
  await page.evaluate(() => {
    const state = window.__authRace;
    state.membershipsHeld.add("alice");
    state.eventsListener([...state.events]);
  });
  await page.waitForFunction(() =>
    window.__authRace.membershipWaiters.has("alice"),
  );
  await page.evaluate(() =>
    window.__authRace.switchUser("bob", { holdRole: true }),
  );
  await page.waitForFunction(() => window.__authRace.roleWaiters.has("bob"));
  await page.getByRole("status").filter({ hasText: "Loading event" }).waitFor();
  assert.equal(
    await page.getByTestId("recipient-name").count(),
    0,
    "Old recipient disappears before the new role resolves",
  );
  await page.evaluate(() => window.__authRace.resolveMembership("alice"));
  assert.equal(
    await page.getByText("Member alice", { exact: false }).count(),
    0,
    "A late old membership cannot restore the previous account",
  );

  // Another switch overtakes the pending Bob role; resolving Bob must not revive him.
  await page.evaluate(() =>
    window.__authRace.switchUser("cara", { holdRole: true }),
  );
  await page.waitForFunction(() => window.__authRace.roleWaiters.has("cara"));
  await page.evaluate(() => window.__authRace.resolveRole("bob"));
  assert.equal(
    await page
      .getByRole("button", { name: "Reveal my recipient", exact: true })
      .count(),
    0,
  );
  await page.evaluate(() => window.__authRace.resolveRole("cara"));
  await page.getByText("Member cara", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .click();
  assert.equal(
    await page.getByTestId("recipient-name").textContent(),
    "Recipient for cara",
  );

  // Same-UID refreshes must conceal a revealed result even with immediately resolved promises.
  await page.evaluate(() =>
    window.__authRace.auth.currentUser.getIdToken(true),
  );
  await page
    .getByRole("button", { name: "Reveal my recipient", exact: true })
    .waitFor();
  assert.equal(await page.getByTestId("recipient-name").count(), 0);

  // Refreshing verification must still update same-UID identity through the token listener.
  await page.evaluate(() =>
    window.__authRace.switchUser("new-user", { verified: false }),
  );
  await page
    .getByRole("link", {
      name: "Previously joined with email? Sign in here",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Check verification", exact: true })
    .click();
  await page.getByRole("heading", { name: "Signed in" }).waitFor();
  await page.getByText("new-user@example.test", { exact: true }).waitFor();

  // A verification request finishing after sign-out cannot bring the old account back.
  await page.evaluate(() => {
    window.__authRace.reloadHeld = true;
    window.__authRace.switchUser("pending-user", { verified: false });
  });
  await page
    .getByRole("button", { name: "Check verification", exact: true })
    .click();
  await page.waitForFunction(() => window.__authRace.reloadWaiter !== null);
  await page.evaluate(() => {
    const state = window.__authRace;
    state.switchUser(null);
    state.reloadWaiter.resolve();
  });
  await page.getByRole("heading", { name: "Email sign in" }).waitFor();
  assert.equal(
    await page.getByText("pending-user@example.test", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Sign out", exact: true }).count(),
    0,
  );

  // The join response is deliberately held across visibility changes. Concealment
  // must survive both completion in the background and completion after returning.
  for (const timing of ["hidden", "returned", "visible"]) {
    await page.evaluate(() => { location.hash = "/"; });
    await page.locator(".event-page").waitFor({ state: "detached" });
    await page.evaluate(() => {
      window.__authRace.prepareJoin();
      location.hash = "/events/gathering";
    });
    await page.getByLabel("Your name", { exact: true }).fill("Jordan Smith");
    await page
      .locator("form")
      .getByRole("button", { name: "Join event", exact: true })
      .click();
    await page.waitForFunction(() => window.__authRace.joinWaiter !== null);
    assert.deepEqual(
      await page.evaluate(() => window.__authRace.joinCalls),
      [["gathering", "Jordan Smith", ""]],
      "The pending join receives the submitted name and optional blank hint",
    );

    if (timing !== "visible")
      await page.evaluate(() => window.__authRace.setHidden(true));
    if (timing === "returned")
      await page.evaluate(() => window.__authRace.setHidden(false));
    await page.evaluate(() => window.__authRace.resolveJoin());
    await page.getByText("You’re registered.", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .waitFor();

    if (timing === "visible") {
      assert.equal(
        await page.getByTestId("event-password").textContent(),
        "mock-holly-candle-password",
        "A normal visible signup still displays the participant’s password",
      );
    } else {
      assert.equal(
        await page.getByTestId("event-password").count(),
        0,
        `A join completing ${timing === "hidden" ? "while hidden" : "after returning"} cannot restore a concealed password`,
      );
      await page.evaluate(() => window.__authRace.setHidden(false));
      await page
        .getByRole("button", { name: "Show my password", exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("mock-holly-candle-password", { exact: true }).count(),
        0,
        "Returning to the page does not reveal the completed signup receipt",
      );
    }
  }
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(
    "Auth race checks passed: immediate concealment, late membership/role isolation, same-UID privacy reset, verification refresh, refresh-after-sign-out, and pending signup concealment during/after hidden tabs with a visible-signup control. No Firebase data touched.",
  );
} finally {
  await browser.close();
}
