import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import {
  getAssignment,
  getRecipient,
  getMemberPassword,
  getParticipantMembership,
  getParticipantPassword,
  getParticipantRecipient,
  issueParticipantPassword,
  joinEvent,
  joinWithEventPassword,
  leaveEvent,
  leaveParticipant,
  runDraw,
  saveEvent,
  signInParticipant,
  signOutParticipant,
  updateParticipant,
  updateParticipantPreferences,
  updatePreferences,
} from "../src/lib/api";
import { validateAssignments } from "../src/lib/draw";
import type { Assignment, Member } from "../src/types";

const apiSession = vi.hoisted(() => ({
  database: null as Firestore | null,
  currentUser: null as { uid: string; emailVerified: boolean } | null,
  anonymous: null as Firestore | null,
  guestDatabase: null as ((uid: string) => Firestore) | null,
  eventSessions: new Map<
    string,
    {
      database: Firestore;
      currentUser: { uid: string; emailVerified: boolean } | null;
    }
  >(),
  accounts: new Map<
    string,
    { database: Firestore; user: { uid: string; emailVerified: boolean } }
  >(),
  accountCounter: 0,
  passwordCounter: 0,
  passwordCandidates: [
    "holly-cabinet-orchestra",
    "cocoa-bonfire-elephant",
    "jingle-hammock-lullaby",
    "merry-compass-pineapple",
    "frost-lantern-meadow",
    "candle-octopus-coconut",
  ],
  creationAttempts: [] as string[],
  creationErrors: [] as string[],
  discarded: [] as string[],
  afterAccountCreated: null as (() => Promise<void>) | null,
  throwAfterCommit: false,
  uncertainCommitWithoutWrite: false,
  blockServerReads: false,
}));
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    async runTransaction(...args: Parameters<typeof actual.runTransaction>) {
      if (apiSession.uncertainCommitWithoutWrite) {
        apiSession.uncertainCommitWithoutWrite = false;
        const transaction = {
          get: actual.getDoc,
          set() {
            return transaction;
          },
          update() {
            return transaction;
          },
          delete() {
            return transaction;
          },
        } as unknown as import("firebase/firestore").Transaction;
        await args[1](transaction);
        throw Object.assign(new Error("Commit outcome unavailable"), {
          code: "unavailable",
        });
      }
      const result = await actual.runTransaction(...args);
      if (apiSession.throwAfterCommit) {
        apiSession.throwAfterCommit = false;
        throw Object.assign(new Error("Connection lost after commit"), {
          code: "unavailable",
        });
      }
      return result;
    },
    getDocFromServer(...args: Parameters<typeof actual.getDocFromServer>) {
      if (apiSession.blockServerReads)
        return Promise.reject(
          Object.assign(new Error("Connection unavailable"), {
            code: "unavailable",
          }),
        );
      return actual.getDocFromServer(...args);
    },
  };
});
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>();
  return {
    ...actual,
    async deleteUser(user: { uid: string }) {
      apiSession.discarded.push(user.uid);
      for (const session of apiSession.eventSessions.values()) {
        if (session.currentUser?.uid === user.uid) session.currentUser = null;
      }
      for (const [key, account] of apiSession.accounts) {
        if (account.user.uid === user.uid) apiSession.accounts.delete(key);
      }
    },
  };
});
vi.mock("../src/lib/event-auth", () => {
  const keyFor = (eventId: string, password: string) =>
    `${eventId}:${password.toLowerCase().replace(/[\s-]/g, "")}`;
  const create = (eventId: string, password: string) => {
    apiSession.creationAttempts.push(password);
    const code =
      apiSession.creationErrors.shift() ??
      (apiSession.accounts.has(keyFor(eventId, password))
        ? "auth/email-already-in-use"
        : undefined);
    if (code)
      throw Object.assign(new Error("Account creation failed"), { code });
    const uid = `guest-${++apiSession.accountCounter}`;
    const account = {
      database: apiSession.guestDatabase!(uid),
      user: { uid, emailVerified: false },
    };
    apiSession.accounts.set(keyFor(eventId, password), account);
    return account;
  };
  return {
    generateEventPassword: () => {
      const password =
        apiSession.passwordCandidates[apiSession.passwordCounter++];
      if (!password) throw new Error("Test password fixtures exhausted");
      return password;
    },
    async createEventAccount(eventId: string, password: string) {
      const account = create(eventId, password);
      apiSession.eventSessions.set(eventId, {
        database: account.database,
        currentUser: account.user,
      });
      await apiSession.afterAccountCreated?.();
      return account.user;
    },
    async signInEvent(eventId: string, password: string) {
      const account = apiSession.accounts.get(keyFor(eventId, password));
      if (!account)
        throw Object.assign(new Error("Invalid credential"), {
          code: "auth/invalid-credential",
        });
      apiSession.eventSessions.set(eventId, {
        database: account.database,
        currentUser: account.user,
      });
      return account.user;
    },
    async signOutEvent(eventId: string) {
      const session = apiSession.eventSessions.get(eventId);
      if (session) session.currentUser = null;
    },
    async createTemporaryEventAccount(eventId: string, password: string) {
      const account = create(eventId, password);
      return {
        uid: account.user.uid,
        async dispose() {},
        async discard() {
          apiSession.discarded.push(account.user.uid);
          apiSession.accounts.delete(keyFor(eventId, password));
        },
      };
    },
  };
});
vi.mock("../src/lib/firebase", () => ({
  get db() {
    return apiSession.database;
  },
  auth: {
    get currentUser() {
      return apiSession.currentUser;
    },
  },
  getEventServices(eventId: string) {
    return {
      get db() {
        return (
          apiSession.eventSessions.get(eventId)?.database ??
          apiSession.anonymous
        );
      },
      auth: {
        get currentUser() {
          return apiSession.eventSessions.get(eventId)?.currentUser ?? null;
        },
        async authStateReady() {},
      },
    };
  },
}));

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const NOW = Date.now();
const eventData = {
  name: "Manchester",
  signupDeadline: NOW + 86_400_000,
  exchangeAt: NOW + 172_800_000,
  timezone: "Europe/London",
  budget: 10,
  details: "Christmas party",
  guidelines: ["Wrap your gift"],
  giftIdeas: ["Books"],
  status: "open",
  memberCount: 3,
  activeRunId: null,
  createdAt: NOW,
};
const people = { alice: "Alice", bob: "Bob", cara: "Cara" };
const plan = {
  members: people,
  recipients: { alice: "bob", bob: "cara", cara: "alice" },
  count: 3,
  createdAt: NOW,
};
const assignment = {
  giverUid: "alice",
  recipientUid: "bob",
  recipientName: "Bob",
};

describe.skipIf(!enabled)("Firestore access and lifecycle rules", () => {
  let environment: RulesTestEnvironment;
  let admin: Firestore;
  let alice: Firestore;
  let bob: Firestore;
  let outsider: Firestore;
  let unverified: Firestore;
  let anonymous: Firestore;

  beforeAll(async () => {
    const [host, port] = (
      process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
    ).split(":");
    environment = await initializeTestEnvironment({
      projectId: "demo-secret-santa",
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync(
          new URL("../firestore.rules", import.meta.url),
          "utf8",
        ),
      },
    });
    // RulesUnitTesting returns compat wrappers; modular SDK APIs unwrap them internally.
    admin = environment
      .authenticatedContext("organiser", {
        email: "organiser@example.com",
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
    alice = environment
      .authenticatedContext("alice", {
        email: "alice@example.com",
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
    bob = environment
      .authenticatedContext("bob", {
        email: "bob@example.com",
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
    outsider = environment
      .authenticatedContext("dave", {
        email: "dave@example.com",
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
    unverified = environment
      .authenticatedContext("unverified", {
        email: "new@example.com",
        email_verified: false,
      })
      .firestore() as unknown as Firestore;
    anonymous = environment
      .unauthenticatedContext()
      .firestore() as unknown as Firestore;
  }, 30_000);

  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      const batch = writeBatch(database);
      batch.set(doc(database, "config/admin"), { uid: "organiser" });
      for (const id of ["manchester", "sheffield"]) {
        batch.set(doc(database, `events/${id}`), { ...eventData, name: id });
        for (const [uid, name] of Object.entries(people)) {
          batch.set(doc(database, `events/${id}/members/${uid}`), {
            uid,
            name,
            joinedAt: NOW,
          });
        }
      }
      await batch.commit();
    });
    apiSession.database = admin;
    apiSession.currentUser = { uid: "organiser", emailVerified: true };
    apiSession.anonymous = anonymous;
    apiSession.guestDatabase = (uid) =>
      environment
        .authenticatedContext(uid, {
          email: `${"a".repeat(64)}@event.santa.invalid`,
          email_verified: false,
          firebase: { sign_in_provider: "password" },
        })
        .firestore() as unknown as Firestore;
    apiSession.eventSessions.clear();
    apiSession.accounts.clear();
    apiSession.accountCounter = 0;
    apiSession.passwordCounter = 0;
    apiSession.creationAttempts = [];
    apiSession.creationErrors = [];
    apiSession.discarded = [];
    apiSession.afterAccountCreated = null;
    apiSession.throwAfterCommit = false;
    apiSession.uncertainCommitWithoutWrite = false;
    apiSession.blockServerReads = false;
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  function join(
    database: Firestore,
    uid: string,
    eventId = "manchester",
    count = 4,
    preferences?: unknown,
  ) {
    const batch = writeBatch(database);
    batch.set(doc(database, `events/${eventId}/members/${uid}`), {
      uid,
      name: "New person",
      joinedAt: NOW,
      ...(preferences === undefined ? {} : { preferences }),
    });
    batch.update(doc(database, `events/${eventId}`), { memberCount: count });
    return batch.commit();
  }

  async function reserveDraw(eventId = "manchester", runId = "run-one") {
    await updateDoc(doc(admin, `events/${eventId}`), { status: "locked" });
    const batch = writeBatch(admin);
    batch.set(doc(admin, `events/${eventId}/runs/${runId}`), plan);
    batch.update(doc(admin, `events/${eventId}`), {
      status: "drawing",
      activeRunId: runId,
    });
    await batch.commit();
  }

  async function publishDraw(eventId = "manchester", runId = "run-one") {
    await reserveDraw(eventId, runId);
    const batch = writeBatch(admin);
    for (const [giverUid, recipientUid] of Object.entries(plan.recipients)) {
      batch.set(
        doc(admin, `events/${eventId}/runs/${runId}/assignments/${giverUid}`),
        {
          giverUid,
          recipientUid,
          recipientName: people[recipientUid as keyof typeof people],
        },
      );
    }
    await batch.commit();
    await updateDoc(doc(admin, `events/${eventId}`), { status: "drawn" });
  }

  it("allows public event discovery but keeps rosters private", async () => {
    await assertSucceeds(getDocs(collection(anonymous, "events")));
    await assertFails(
      getDocs(collection(anonymous, "events/manchester/members")),
    );
    await assertFails(
      getDoc(doc(anonymous, "events/manchester/members/alice")),
    );
    await assertFails(getDocs(collection(alice, "events/manchester/members")));
    await assertSucceeds(getDoc(doc(alice, "events/manchester/members/alice")));
    await assertFails(getDoc(doc(alice, "events/manchester/members/bob")));
    await assertSucceeds(
      getDocs(collection(admin, "events/manchester/members")),
    );
  });

  it("permits only the configured verified organiser to create events", async () => {
    const newEvent = { ...eventData, memberCount: 0 };
    await assertFails(setDoc(doc(anonymous, "events/new"), newEvent));
    await assertFails(setDoc(doc(alice, "events/new"), newEvent));
    await assertSucceeds(setDoc(doc(admin, "events/new"), newEvent));
    const unverifiedAdmin = environment
      .authenticatedContext("organiser", { email_verified: false })
      .firestore();
    await assertFails(setDoc(doc(unverifiedAdmin, "events/another"), newEvent));
  });

  it("denies self-promotion even by an existing administrator", async () => {
    await assertFails(setDoc(doc(alice, "config/admin"), { uid: "alice" }));
    await assertFails(setDoc(doc(admin, "config/admin"), { uid: "alice" }));
    await assertFails(setDoc(doc(alice, "admins/alice"), { admin: true }));
  });

  it("requires verified email and atomic count updates to join", async () => {
    await assertFails(join(unverified, "unverified"));
    await assertFails(join(anonymous, "nobody"));
    await assertFails(
      setDoc(doc(outsider, "events/manchester/members/dave"), {
        uid: "dave",
        name: "Dave",
        joinedAt: NOW,
      }),
    );
    await assertSucceeds(join(outsider, "dave"));
    expect(
      (await getDoc(doc(outsider, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
  });

  it("allows one account to join separate events independently", async () => {
    await assertSucceeds(join(outsider, "dave", "manchester"));
    await assertSucceeds(join(outsider, "dave", "sheffield"));
    await assertSucceeds(
      getDoc(doc(outsider, "events/sheffield/members/dave")),
    );
  });

  it("rejects duplicate membership, impersonation and count manipulation", async () => {
    await assertFails(join(alice, "alice"));
    await assertFails(join(outsider, "somebody-else"));
    await assertFails(join(outsider, "dave", "manchester", 100));
    await assertFails(
      updateDoc(doc(alice, "events/manchester"), { memberCount: 100 }),
    );
  });

  it("allows own name changes but rejects extra fields, identity changes and editing others", async () => {
    await assertSucceeds(
      updateDoc(doc(alice, "events/manchester/members/alice"), {
        name: "Alice B.",
      }),
    );
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/alice"), { uid: "bob" }),
    );
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/alice"), { admin: true }),
    );
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/bob"), { name: "Alice" }),
    );
  });

  it("accepts optional preferences on new and legacy memberships and enforces their limits", async () => {
    await assertSucceeds(
      join(outsider, "dave", "manchester", 4, "x".repeat(500)),
    );
    await assertFails(join(outsider, "dave", "sheffield", 4, "x".repeat(501)));
    await assertFails(join(outsider, "dave", "sheffield", 4, ["Books"]));
    await assertSucceeds(join(outsider, "dave", "sheffield"));
    const legacy = doc(alice, "events/manchester/members/alice");
    expect((await getDoc(legacy)).data()).not.toHaveProperty("preferences");
    await assertSucceeds(updateDoc(legacy, { preferences: "Books" }));
    await assertSucceeds(updateDoc(legacy, { preferences: "x".repeat(500) }));
    for (const preferences of [
      "x".repeat(501),
      42,
      null,
      ["Books"],
      { books: true },
    ]) {
      await assertFails(updateDoc(legacy, { preferences }));
    }
    await assertSucceeds(updateDoc(legacy, { preferences: "" }));
    await assertSucceeds(updateDoc(legacy, { preferences: deleteField() }));
    await assertSucceeds(updateDoc(legacy, { name: "Alice B." }));
  });

  it.each(["open", "locked", "drawing", "drawn"])(
    "allows preferences-only updates after the deadline in %s events while freezing identity",
    async (status) => {
      await updateDoc(doc(admin, "events/manchester"), {
        signupDeadline: NOW - 60_000,
      });
      if (status === "locked")
        await updateDoc(doc(admin, "events/manchester"), { status });
      if (status === "drawing") await reserveDraw();
      if (status === "drawn") await publishDraw();
      const member = doc(alice, "events/manchester/members/alice");
      await assertSucceeds(
        updateDoc(member, { preferences: "Coffee and books" }),
      );
      for (const forbidden of [
        { name: "Another person" },
        { uid: "bob" },
        { joinedAt: NOW + 1 },
      ]) {
        await assertFails(
          updateDoc(member, { preferences: "New notes", ...forbidden }),
        );
      }
      expect((await getDoc(member)).data()).toEqual({
        uid: "alice",
        name: "Alice",
        joinedAt: NOW,
        preferences: "Coffee and books",
      });
    },
  );

  it("only lets the verified member edit their own preferences", async () => {
    await publishDraw();
    const unverifiedAlice = environment
      .authenticatedContext("alice", { email_verified: false })
      .firestore() as unknown as Firestore;
    for (const database of [anonymous, outsider, admin, unverifiedAlice]) {
      await assertFails(
        updateDoc(doc(database, "events/manchester/members/alice"), {
          preferences: "Changed by someone else",
        }),
      );
    }
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/bob"), {
        preferences: "Gift choice",
      }),
    );
    await assertFails(
      setDoc(doc(outsider, "events/manchester/members/dave"), {
        uid: "dave",
        name: "Dave",
        joinedAt: NOW,
        preferences: "Not a participant",
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice, "events/manchester/members/alice"), {
        preferences: "My own choice",
      }),
    );
  });

  it("keeps preferences private until publication, then allows only the assigned giver and organiser", async () => {
    await updateDoc(doc(bob, "events/manchester/members/bob"), {
      preferences: "Tea",
    });
    await assertFails(getDoc(doc(alice, "events/manchester/members/bob")));
    await reserveDraw();
    await setDoc(
      doc(admin, "events/manchester/runs/run-one/assignments/alice"),
      assignment,
    );
    await assertFails(getDoc(doc(alice, "events/manchester/members/bob")));
    await updateDoc(doc(admin, "events/manchester"), { status: "drawn" });
    const recipient = await assertSucceeds(
      getDoc(doc(alice, "events/manchester/members/bob")),
    );
    expect(recipient.data()?.preferences).toBe("Tea");
    await assertFails(getDoc(doc(alice, "events/manchester/members/cara")));
    await assertFails(getDoc(doc(outsider, "events/manchester/members/bob")));
    await assertFails(getDoc(doc(anonymous, "events/manchester/members/bob")));
    await assertFails(getDocs(collection(alice, "events/manchester/members")));
    await assertSucceeds(getDoc(doc(admin, "events/manchester/members/bob")));
  });

  it("ignores stale assignments and never uses a published assignment from another event for preferences", async () => {
    await publishDraw();
    await reserveDraw("sheffield");
    await setDoc(
      doc(admin, "events/sheffield/runs/run-one/assignments/alice"),
      assignment,
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(
        doc(database, "events/manchester/runs/old-run/assignments/alice"),
        {
          ...assignment,
          recipientUid: "cara",
          recipientName: "Cara",
        },
      );
    });
    await assertSucceeds(getDoc(doc(alice, "events/manchester/members/bob")));
    await assertFails(getDoc(doc(alice, "events/manchester/members/cara")));
    await assertFails(getDoc(doc(alice, "events/sheffield/members/bob")));
    await updateDoc(doc(admin, "events/sheffield"), { status: "drawn" });
    await assertSucceeds(getDoc(doc(alice, "events/sheffield/members/bob")));
  });

  it("keeps published preferences readable after archive but rejects all preference changes", async () => {
    await publishDraw();
    await updateDoc(doc(admin, "events/manchester"), { status: "archived" });
    await assertSucceeds(getDoc(doc(alice, "events/manchester/members/bob")));
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/alice"), {
        preferences: "Too late",
      }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester/members/alice"), {
        preferences: "Too late",
      }),
    );
    await updateDoc(doc(admin, "events/sheffield"), { status: "archived" });
    await assertFails(getDoc(doc(alice, "events/sheffield/members/bob")));
  });

  it("rejects changing preferences in the same batch that archives the event", async () => {
    await join(admin, "organiser");
    const batch = writeBatch(admin);
    batch.update(doc(admin, "events/manchester/members/organiser"), {
      preferences: "Last edit",
    });
    batch.update(doc(admin, "events/manchester"), { status: "archived" });
    await assertFails(batch.commit());
  });

  it("trims per-event preferences through the API without changing registration or identity", async () => {
    apiSession.database = outsider;
    apiSession.currentUser = { uid: "dave", emailVerified: true };
    await joinEvent("manchester", "  Dave  ", "  Tea\nBooks  ");
    await joinEvent("sheffield", "Dave");
    const member = doc(outsider, "events/manchester/members/dave");
    const original = (await getDoc(member)).data()!;
    expect(original.preferences).toBe("Tea\nBooks");
    expect(
      (await getDoc(doc(outsider, "events/sheffield/members/dave"))).data()
        ?.preferences,
    ).toBe("");
    await joinEvent("manchester", "Dave B.", "Chocolate");
    await updateDoc(doc(admin, "events/manchester"), { status: "locked" });
    await updatePreferences("manchester", "  New suggestions  ");
    expect((await getDoc(member)).data()).toEqual({
      ...original,
      name: "Dave B.",
      preferences: "New suggestions",
    });
    expect(
      (await getDoc(doc(outsider, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
    await expect(
      updatePreferences("manchester", "x".repeat(501)),
    ).rejects.toThrow("500");
    await expect(
      joinEvent("sheffield", "Dave", "x".repeat(501)),
    ).rejects.toThrow("500");
    await updatePreferences("manchester", "   ");
    expect((await getDoc(member)).data()?.preferences).toBe("");
  });

  it("returns current recipient preferences rather than a draw-time snapshot", async () => {
    apiSession.database = alice;
    apiSession.currentUser = { uid: "alice", emailVerified: true };
    expect(await getRecipient("manchester", "alice")).toBeNull();
    await publishDraw();
    expect(await getRecipient("manchester", "alice")).toEqual({
      ...assignment,
      preferences: "",
    });
    await assertFails(getRecipient("manchester", "bob"));
    apiSession.database = bob;
    apiSession.currentUser = { uid: "bob", emailVerified: true };
    await updatePreferences("manchester", "  Decaf coffee  ");
    apiSession.database = alice;
    apiSession.currentUser = { uid: "alice", emailVerified: true };
    expect(await getRecipient("manchester", "alice")).toEqual({
      ...assignment,
      preferences: "Decaf coffee",
    });
    expect(await getAssignment("manchester", "alice")).toEqual(assignment);
    await updateDoc(doc(admin, "events/manchester"), { status: "archived" });
    expect((await getRecipient("manchester", "alice"))?.preferences).toBe(
      "Decaf coffee",
    );
  });

  it("reports API preference errors for non-members, unverified accounts and archived events", async () => {
    apiSession.database = outsider;
    apiSession.currentUser = { uid: "dave", emailVerified: true };
    await expect(updatePreferences("manchester", "Books")).rejects.toThrow(
      "Join this event",
    );
    apiSession.database = alice;
    apiSession.currentUser = { uid: "alice", emailVerified: false };
    await expect(updatePreferences("manchester", "Books")).rejects.toThrow(
      "Verify your email",
    );
    apiSession.currentUser = { uid: "alice", emailVerified: true };
    await updateDoc(doc(admin, "events/manchester"), { status: "archived" });
    await expect(updatePreferences("manchester", "Books")).rejects.toThrow(
      "archived event",
    );
  });

  it("requires atomic withdrawal and does not allow removing another participant", async () => {
    await assertFails(deleteDoc(doc(alice, "events/manchester/members/alice")));
    const withdraw = writeBatch(alice);
    withdraw.delete(doc(alice, "events/manchester/members/alice"));
    withdraw.update(doc(alice, "events/manchester"), { memberCount: 2 });
    await assertSucceeds(withdraw.commit());
    const impersonate = writeBatch(outsider);
    impersonate.delete(doc(outsider, "events/manchester/members/bob"));
    impersonate.update(doc(outsider, "events/manchester"), { memberCount: 1 });
    await assertFails(impersonate.commit());
  });

  it("allows the organiser to remove a member only before locking", async () => {
    const remove = writeBatch(admin);
    remove.delete(doc(admin, "events/manchester/members/bob"));
    remove.update(doc(admin, "events/manchester"), { memberCount: 2 });
    await assertSucceeds(remove.commit());
    await updateDoc(doc(admin, "events/manchester"), { status: "locked" });
    const lockedRemove = writeBatch(admin);
    lockedRemove.delete(doc(admin, "events/manchester/members/alice"));
    lockedRemove.update(doc(admin, "events/manchester"), { memberCount: 1 });
    await assertFails(lockedRemove.commit());
  });

  it("enforces the deadline using server time even with an old joinedAt value", async () => {
    await updateDoc(doc(admin, "events/manchester"), {
      signupDeadline: NOW - 60_000,
    });
    await assertFails(join(outsider, "dave"));
    await assertFails(
      updateDoc(doc(alice, "events/manchester/members/alice"), {
        name: "Too late",
      }),
    );
    const withdraw = writeBatch(alice);
    withdraw.delete(doc(alice, "events/manchester/members/alice"));
    withdraw.update(doc(alice, "events/manchester"), { memberCount: 2 });
    await assertFails(withdraw.commit());
  });

  it("rejects late joins after a manual lock and restricts reopening to admin", async () => {
    await updateDoc(doc(admin, "events/manchester"), { status: "locked" });
    await assertFails(join(outsider, "dave"));
    await assertFails(
      updateDoc(doc(alice, "events/manchester"), { status: "open" }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "events/manchester"), { status: "open" }),
    );
  });

  it("rejects malformed event fields and invalid date ordering", async () => {
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { exchangeAt: NOW }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { memberCount: -1 }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { budget: 0 }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { timezone: "UTC" }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { secretPairings: people }),
    );
  });

  it("requires a locked event and an atomic plan reservation to start drawing", async () => {
    await assertFails(
      setDoc(doc(admin, "events/manchester/runs/run-one"), plan),
    );
    await assertFails(
      updateDoc(doc(alice, "events/manchester"), { status: "locked" }),
    );
    await updateDoc(doc(admin, "events/manchester"), { status: "locked" });
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), {
        status: "drawing",
        activeRunId: "missing",
      }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { status: "drawn" }),
    );
  });

  it("makes the reserved plan immutable and rejects a competing run", async () => {
    await reserveDraw();
    await assertFails(
      updateDoc(doc(admin, "events/manchester/runs/run-one"), {
        recipients: { alice: "cara", bob: "alice", cara: "bob" },
      }),
    );
    await assertFails(getDoc(doc(alice, "events/manchester/runs/run-one")));
    const competing = writeBatch(admin);
    competing.set(doc(admin, "events/manchester/runs/run-two"), plan);
    competing.update(doc(admin, "events/manchester"), {
      activeRunId: "run-two",
    });
    await assertFails(competing.commit());
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { status: "open" }),
    );
  });

  it("keeps all staged results unreadable by participants", async () => {
    await reserveDraw();
    await setDoc(
      doc(admin, "events/manchester/runs/run-one/assignments/alice"),
      assignment,
    );
    await assertFails(
      getDoc(doc(alice, "events/manchester/runs/run-one/assignments/alice")),
    );
    await assertFails(
      getDocs(collection(alice, "events/manchester/runs/run-one/assignments")),
    );
    await assertFails(
      updateDoc(doc(alice, "events/manchester"), { status: "drawn" }),
    );
  });

  it("permits only planned non-self assignments and idempotent retries", async () => {
    await reserveDraw();
    const path = "events/manchester/runs/run-one/assignments/alice";
    await assertFails(
      setDoc(doc(admin, path), {
        ...assignment,
        recipientUid: "alice",
        recipientName: "Alice",
      }),
    );
    await assertFails(
      setDoc(doc(admin, path), { ...assignment, recipientName: "Wrong name" }),
    );
    await assertFails(setDoc(doc(alice, path), assignment));
    await assertSucceeds(setDoc(doc(admin, path), assignment));
    await assertSucceeds(setDoc(doc(admin, path), assignment));
    await assertFails(
      updateDoc(doc(admin, path), {
        recipientUid: "cara",
        recipientName: "Cara",
      }),
    );
  });

  it("allows only a giver to read their published result and denies lists", async () => {
    await publishDraw();
    await assertSucceeds(
      getDoc(doc(alice, "events/manchester/runs/run-one/assignments/alice")),
    );
    await assertFails(
      getDoc(doc(alice, "events/manchester/runs/run-one/assignments/bob")),
    );
    await assertFails(
      getDoc(
        doc(anonymous, "events/manchester/runs/run-one/assignments/alice"),
      ),
    );
    await assertFails(
      getDoc(doc(outsider, "events/manchester/runs/run-one/assignments/alice")),
    );
    await assertFails(
      getDocs(collection(alice, "events/manchester/runs/run-one/assignments")),
    );
    await assertSucceeds(
      getDocs(collection(admin, "events/manchester/runs/run-one/assignments")),
    );
  });

  it("keeps events isolated when one draw is published", async () => {
    await publishDraw();
    await reserveDraw("sheffield");
    await setDoc(
      doc(admin, "events/sheffield/runs/run-one/assignments/alice"),
      assignment,
    );
    await assertFails(
      getDoc(doc(alice, "events/sheffield/runs/run-one/assignments/alice")),
    );
    await assertSucceeds(
      getDoc(doc(alice, "events/manchester/runs/run-one/assignments/alice")),
    );
  });

  it("protects completed assignments and roster while allowing logistics updates", async () => {
    await publishDraw();
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { status: "drawing" }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { activeRunId: "another" }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), {
        signupDeadline: NOW + 3_600_000,
      }),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester/members/alice"), {
        name: "Different person",
      }),
    );
    await assertFails(
      deleteDoc(doc(admin, "events/manchester/runs/run-one/assignments/alice")),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "events/manchester"), {
        details: "New party venue",
        exchangeAt: NOW + 259_200_000,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "events/manchester"), { status: "archived" }),
    );
    await assertSucceeds(
      getDoc(doc(alice, "events/manchester/runs/run-one/assignments/alice")),
    );
    await assertFails(
      updateDoc(doc(admin, "events/manchester"), { status: "open" }),
    );
  });

  it("publishes a complete valid draw through the production API", async () => {
    const progress: string[] = [];
    await runDraw("manchester", (message) => progress.push(message));
    const event = (await getDoc(doc(admin, "events/manchester"))).data()!;
    expect(event.status).toBe("drawn");
    const saved = await getDocs(
      collection(
        admin,
        `events/manchester/runs/${event.activeRunId}/assignments`,
      ),
    );
    const members: Member[] = Object.entries(people).map(([uid, name]) => ({
      uid,
      name,
      joinedAt: NOW,
    }));
    expect(() =>
      validateAssignments(
        members,
        saved.docs.map((item) => item.data() as Assignment),
      ),
    ).not.toThrow();
    expect(progress.at(-1)).toContain("Everyone can reveal");
    await expect(runDraw("manchester")).rejects.toThrow(
      "already been completed",
    );
  });

  it("resumes an interrupted draw without replacing its planned or saved recipients", async () => {
    await reserveDraw();
    await setDoc(
      doc(admin, "events/manchester/runs/run-one/assignments/alice"),
      assignment,
    );
    await runDraw("manchester");
    const event = (await getDoc(doc(admin, "events/manchester"))).data()!;
    expect(event.status).toBe("drawn");
    expect(event.activeRunId).toBe("run-one");
    expect(
      (
        await getDoc(
          doc(admin, "events/manchester/runs/run-one/assignments/alice"),
        )
      ).data(),
    ).toEqual(assignment);
    const saved = await getDocs(
      collection(admin, "events/manchester/runs/run-one/assignments"),
    );
    expect(
      Object.fromEntries(
        saved.docs.map((item) => [item.id, item.data().recipientUid]),
      ),
    ).toEqual(plan.recipients);
  });

  it("concurrent API draw attempts cannot publish different runs", async () => {
    const outcomes = await Promise.allSettled([
      runDraw("manchester"),
      runDraw("manchester"),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );
    const event = (await getDoc(doc(admin, "events/manchester"))).data()!;
    const runs = await getDocs(collection(admin, "events/manchester/runs"));
    expect(runs.size).toBe(1);
    expect(event.status).toBe("drawn");
    expect(event.activeRunId).toBe(runs.docs[0].id);
    const saved = await getDocs(
      collection(
        admin,
        `events/manchester/runs/${event.activeRunId}/assignments`,
      ),
    );
    const members: Member[] = Object.entries(people).map(([uid, name]) => ({
      uid,
      name,
      joinedAt: NOW,
    }));
    expect(() =>
      validateAssignments(
        members,
        saved.docs.map((item) => item.data() as Assignment),
      ),
    ).not.toThrow();
  });

  it("a normal account can join through the API but cannot draw or read another result", async () => {
    apiSession.database = outsider;
    apiSession.currentUser = { uid: "dave", emailVerified: true };
    await joinEvent("sheffield", "  Dave  ");
    expect(
      (await getDoc(doc(outsider, "events/sheffield/members/dave"))).data()
        ?.name,
    ).toBe("Dave");
    await expect(runDraw("sheffield")).rejects.toMatchObject({
      code: "permission-denied",
    });
    await publishDraw();
    await expect(getAssignment("manchester", "alice")).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("can edit party details after an API draw without changing recipients", async () => {
    await runDraw("manchester");
    const before = await getAssignment("manchester", "alice");
    await saveEvent(
      {
        name: "Manchester Christmas",
        signupDeadline: eventData.signupDeadline,
        exchangeAt: eventData.exchangeAt + 86_400_000,
        timezone: "Europe/London",
        budget: 10,
        details: "Party in the new venue",
        guidelines: ["Wrap your gift"],
        giftIdeas: ["Books"],
      },
      "manchester",
    );
    expect(await getAssignment("manchester", "alice")).toEqual(before);
  });

  async function createPasswordFor(mode: "signup" | "issuer") {
    if (mode === "signup") {
      const joined = await joinWithEventPassword("manchester", "Guest");
      return { password: joined.password, memberUid: joined.member.uid };
    }
    return {
      password: await issueParticipantPassword("manchester", "alice"),
      memberUid: "alice",
    };
  }

  it.each(["signup", "issuer"] as const)(
    "%s retries a three-word password collision without reusing the existing account",
    async (mode) => {
      const collision = apiSession.passwordCandidates[0];
      const key = `manchester:${collision.replaceAll("-", "")}`;
      const previousAccount = {
        database: apiSession.guestDatabase!("previous-word-account"),
        user: { uid: "previous-word-account", emailVerified: false },
      };
      apiSession.accounts.set(key, previousAccount);
      const result = await createPasswordFor(mode);
      expect(result.password).toBe(apiSession.passwordCandidates[1]);
      expect(result.password).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
      expect(apiSession.creationAttempts).toEqual(
        apiSession.passwordCandidates.slice(0, 2),
      );
      expect(apiSession.accountCounter).toBe(1);
      expect(apiSession.accounts.get(key)).toBe(previousAccount);
      expect(apiSession.discarded).toEqual([]);
      expect(await getMemberPassword("manchester", result.memberUid)).toBe(
        result.password,
      );
      expect(
        (
          await getDoc(doc(admin, "participantAccess/previous-word-account"))
        ).exists(),
      ).toBe(false);
      expect(
        (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
      ).toBe(mode === "signup" ? 4 : 3);
    },
  );

  it.each(["signup", "issuer"] as const)(
    "%s stops after three password collisions without storing partial access",
    async (mode) => {
      apiSession.creationErrors = Array(4).fill("auth/email-already-in-use");
      await expect(createPasswordFor(mode)).rejects.toMatchObject({
        code: "auth/email-already-in-use",
      });
      expect(apiSession.creationAttempts).toEqual(
        apiSession.passwordCandidates.slice(0, 3),
      );
      expect(apiSession.passwordCounter).toBe(3);
      expect(apiSession.creationErrors).toHaveLength(1);
      expect(apiSession.accountCounter).toBe(0);
      expect(apiSession.discarded).toEqual([]);
      expect(await getMemberPassword("manchester", "alice")).toBeNull();
      expect(
        (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
      ).toBe(3);
    },
  );

  it.each([
    { mode: "signup" as const, code: "auth/network-request-failed" },
    { mode: "issuer" as const, code: "auth/network-request-failed" },
    { mode: "signup" as const, code: "auth/too-many-requests" },
    { mode: "issuer" as const, code: "auth/too-many-requests" },
  ])("$mode does not retry $code", async ({ mode, code }) => {
    apiSession.creationErrors = [code];
    await expect(createPasswordFor(mode)).rejects.toMatchObject({ code });
    expect(apiSession.creationAttempts).toHaveLength(1);
    expect(apiSession.passwordCounter).toBe(1);
    expect(apiSession.accountCounter).toBe(0);
    expect(apiSession.accounts.size).toBe(0);
    expect(apiSession.currentUser?.uid).toBe("organiser");
  });

  it.each(["signup", "issuer"] as const)(
    "%s stops if a collision is followed by a different authentication failure",
    async (mode) => {
      apiSession.creationErrors = [
        "auth/email-already-in-use",
        "auth/operation-not-allowed",
      ];
      await expect(createPasswordFor(mode)).rejects.toMatchObject({
        code: "auth/operation-not-allowed",
      });
      expect(apiSession.creationAttempts).toHaveLength(2);
      expect(apiSession.passwordCounter).toBe(2);
      expect(apiSession.accountCounter).toBe(0);
      expect(apiSession.discarded).toEqual([]);
    },
  );

  it("creates an unverified event-password participant with atomic private access records", async () => {
    const result = await joinWithEventPassword(
      "manchester",
      "  Guest  Person  ",
      "  Books  ",
    );
    expect(result.member.name).toBe("Guest Person");
    expect(result.member.preferences).toBe("Books");
    expect(apiSession.currentUser?.uid).toBe("organiser");
    expect(
      apiSession.eventSessions.get("manchester")?.currentUser?.emailVerified,
    ).toBe(false);
    expect(await getParticipantMembership("manchester")).toEqual(result.member);
    expect(await getParticipantPassword("manchester")).toBe(result.password);
    expect(await getMemberPassword("manchester", result.member.uid)).toBe(
      result.password,
    );
    const member = (
      await getDoc(doc(admin, `events/manchester/members/${result.member.uid}`))
    ).data();
    expect(Object.keys(member!).sort()).toEqual([
      "joinedAt",
      "name",
      "preferences",
      "uid",
    ]);
    expect(
      (
        await getDoc(doc(admin, `participantAccess/${result.member.uid}`))
      ).data(),
    ).toEqual({
      eventId: "manchester",
      memberUid: result.member.uid,
    });
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
  });

  it("deduplicates simultaneous joins in one session and keeps event passwords independent", async () => {
    const [first, duplicate] = await Promise.all([
      joinWithEventPassword("manchester", "Same name"),
      joinWithEventPassword("manchester", "Same name"),
    ]);
    expect(duplicate).toEqual(first);
    expect(apiSession.accountCounter).toBe(1);
    const second = await joinWithEventPassword("sheffield", "Same name");
    expect(second.member.uid).not.toBe(first.member.uid);
    expect(second.password).not.toBe(first.password);
    expect(await getParticipantPassword("manchester")).toBe(first.password);
    expect(await getParticipantPassword("sheffield")).toBe(second.password);
    expect(await signOutParticipant("manchester")).toBe(true);
    expect(await getParticipantMembership("manchester")).toBeNull();
    expect(await getParticipantMembership("sheffield")).toEqual(second.member);
    expect(apiSession.currentUser?.uid).toBe("organiser");
    await expect(
      signInParticipant("manchester", second.password),
    ).rejects.toThrow("does not match this event");
    expect(
      await signInParticipant(
        "manchester",
        first.password.toUpperCase().replaceAll("-", " "),
      ),
    ).toEqual(first.member);
  });

  it("withdraws guest membership, password and access together and rejects returning with the old password", async () => {
    const joined = await joinWithEventPassword("manchester", "Guest");
    await leaveParticipant("manchester");
    expect(
      (
        await getDoc(
          doc(admin, `events/manchester/members/${joined.member.uid}`),
        )
      ).exists(),
    ).toBe(false);
    expect(
      (
        await getDoc(
          doc(admin, `events/manchester/credentials/${joined.member.uid}`),
        )
      ).exists(),
    ).toBe(false);
    expect(
      (
        await getDoc(doc(admin, `participantAccess/${joined.member.uid}`))
      ).exists(),
    ).toBe(false);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(3);
    expect(apiSession.eventSessions.get("manchester")?.currentUser).toBeNull();
    await expect(
      signInParticipant("manchester", joined.password),
    ).rejects.toThrow("No registration");
  });

  it("removes guest access when the organiser removes a participant", async () => {
    const joined = await joinWithEventPassword("manchester", "Guest");
    await leaveEvent("manchester", joined.member.uid);
    expect(await getParticipantMembership("manchester")).toBeNull();
    expect(await getMemberPassword("manchester", joined.member.uid)).toBeNull();
    expect(
      (
        await getDoc(doc(admin, `participantAccess/${joined.member.uid}`))
      ).exists(),
    ).toBe(false);
  });

  it("issues event access for a legacy member without changing their completed draw", async () => {
    await publishDraw();
    const originalMember = (
      await getDoc(doc(admin, "events/manchester/members/alice"))
    ).data();
    apiSession.database = alice;
    apiSession.currentUser = { uid: "alice", emailVerified: true };
    expect(await getParticipantMembership("manchester")).toEqual(
      originalMember,
    );
    const password = await issueParticipantPassword("manchester", "alice");
    expect(await issueParticipantPassword("manchester", "alice")).toBe(
      password,
    );
    expect(apiSession.accountCounter).toBe(1);
    expect(apiSession.currentUser?.uid).toBe("alice");
    expect(apiSession.eventSessions.get("manchester")).toBeUndefined();
    expect(await signInParticipant("manchester", password)).toEqual(
      originalMember,
    );
    expect(
      apiSession.eventSessions.get("manchester")?.currentUser?.uid,
    ).not.toBe("alice");
    expect(await getParticipantRecipient("manchester")).toEqual({
      ...assignment,
      preferences: "",
    });
    expect(await getAssignment("manchester", "alice")).toEqual(assignment);
    expect(
      (await getDoc(doc(admin, "events/manchester/members/alice"))).data(),
    ).toEqual(originalMember);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.activeRunId,
    ).toBe("run-one");
  });

  it("allows organiser issuance after archive while denying issuance for another participant", async () => {
    await publishDraw();
    await updateDoc(doc(admin, "events/manchester"), { status: "archived" });
    const password = await issueParticipantPassword("manchester", "alice");
    expect((await signInParticipant("manchester", password)).uid).toBe("alice");
    expect(await getParticipantRecipient("manchester")).toEqual({
      ...assignment,
      preferences: "",
    });
    apiSession.database = bob;
    apiSession.currentUser = { uid: "bob", emailVerified: true };
    await expect(
      issueParticipantPassword("manchester", "alice"),
    ).rejects.toThrow("Only the organiser");
    await expect(getMemberPassword("manchester", "alice")).rejects.toThrow(
      "Only the organiser",
    );
  });

  it("makes concurrent password issuance idempotent and discards only the unused temporary account", async () => {
    const [first, second] = await Promise.all([
      issueParticipantPassword("manchester", "alice"),
      issueParticipantPassword("manchester", "alice"),
    ]);
    expect(first).toBe(second);
    expect(apiSession.accounts.size).toBe(1);
    const credential = (
      await getDoc(doc(admin, "events/manchester/credentials/alice"))
    ).data()!;
    expect(apiSession.discarded).not.toContain(credential.authUid);
    expect(
      (
        await getDoc(doc(admin, `participantAccess/${credential.authUid}`))
      ).data()?.memberUid,
    ).toBe("alice");
  });

  it("never exposes passwords to assigned givers, anonymous users or roster listings", async () => {
    await issueParticipantPassword("manchester", "bob");
    await publishDraw();
    await assertSucceeds(getDoc(doc(alice, "events/manchester/members/bob")));
    for (const database of [alice, outsider, anonymous]) {
      await assertFails(
        getDoc(doc(database, "events/manchester/credentials/bob")),
      );
      await assertFails(
        getDocs(collection(database, "events/manchester/credentials")),
      );
      await assertFails(getDocs(collection(database, "participantAccess")));
    }
    await assertSucceeds(getDoc(doc(bob, "events/manchester/credentials/bob")));
    await assertFails(
      getDocs(collection(admin, "events/manchester/credentials")),
    );
    await assertFails(getDocs(collection(admin, "participantAccess")));
    const unverifiedBob = environment
      .authenticatedContext("bob", { email_verified: false })
      .firestore();
    await assertFails(
      getDoc(doc(unverifiedBob, "events/manchester/credentials/bob")),
    );
  });

  it("rejects guest access without a password-provider account and complete atomic join", async () => {
    const guest = apiSession.guestDatabase!("guest-direct");
    await assertFails(join(guest, "guest-direct"));
    await assertFails(
      setDoc(doc(guest, "participantAccess/guest-direct"), {
        eventId: "manchester",
        memberUid: "alice",
      }),
    );
    for (const claims of [
      {
        email: "person@example.com",
        email_verified: false,
        firebase: { sign_in_provider: "password" },
      },
      {
        email: `${"a".repeat(64)}@event.santa.invalid`,
        email_verified: false,
        firebase: { sign_in_provider: "anonymous" },
      },
    ] as const) {
      const database = environment
        .authenticatedContext("invalid-guest", claims)
        .firestore();
      const batch = writeBatch(database);
      batch.set(doc(database, "events/manchester/members/invalid-guest"), {
        uid: "invalid-guest",
        name: "Guest",
        joinedAt: NOW,
      });
      batch.set(doc(database, "participantAccess/invalid-guest"), {
        eventId: "manchester",
        memberUid: "invalid-guest",
      });
      batch.set(doc(database, "events/manchester/credentials/invalid-guest"), {
        authUid: "invalid-guest",
        password: "holly-cocoa-0123456789a",
        createdAt: NOW,
      });
      batch.update(doc(database, "events/manchester"), { memberCount: 4 });
      await assertFails(batch.commit());
    }
  });

  it("prevents binding forgery, cross-event reuse, credential replacement and partial removal", async () => {
    const joined = await joinWithEventPassword("manchester", "Guest");
    const guest = apiSession.eventSessions.get("manchester")!.database;
    const accessPath = `participantAccess/${joined.member.uid}`;
    const credentialPath = `events/manchester/credentials/${joined.member.uid}`;
    await assertFails(
      updateDoc(doc(guest, accessPath), { memberUid: "alice" }),
    );
    await assertFails(
      updateDoc(doc(admin, accessPath), { eventId: "sheffield" }),
    );
    await assertFails(
      updateDoc(doc(guest, credentialPath), {
        password: "different-password-123456",
      }),
    );
    await assertFails(deleteDoc(doc(guest, credentialPath)));
    await assertFails(deleteDoc(doc(guest, accessPath)));
    await assertFails(getDoc(doc(guest, "events/sheffield/members/alice")));
    const forged = writeBatch(guest);
    forged.set(doc(guest, "participantAccess/another-guest"), {
      eventId: "manchester",
      memberUid: "alice",
    });
    forged.set(doc(guest, "events/manchester/credentials/alice"), {
      authUid: "another-guest",
      password: joined.password,
      createdAt: NOW,
    });
    await assertFails(forged.commit());
    const reuse = writeBatch(guest);
    reuse.set(
      doc(guest, `events/sheffield/members/${joined.member.uid}`),
      joined.member,
    );
    reuse.set(doc(guest, accessPath), {
      eventId: "sheffield",
      memberUid: joined.member.uid,
    });
    reuse.set(doc(guest, `events/sheffield/credentials/${joined.member.uid}`), {
      authUid: joined.member.uid,
      password: joined.password,
      createdAt: NOW,
    });
    reuse.update(doc(guest, "events/sheffield"), { memberCount: 4 });
    await assertFails(reuse.commit());
    const partialRemoval = writeBatch(guest);
    partialRemoval.delete(
      doc(guest, `events/manchester/members/${joined.member.uid}`),
    );
    partialRemoval.update(doc(guest, "events/manchester"), { memberCount: 3 });
    await assertFails(partialRemoval.commit());
  });

  it("lets guest participants update hints after the draw while keeping names and assignments fixed", async () => {
    const joined = await joinWithEventPassword("manchester", "Guest", "Books");
    await updateParticipant("manchester", "Guest B.", "Tea");
    await runDraw("manchester");
    const recipient = await getParticipantRecipient("manchester");
    expect(recipient?.giverUid).toBe(joined.member.uid);
    await updateParticipantPreferences("manchester", "  Decaf tea  ");
    expect((await getParticipantMembership("manchester"))?.preferences).toBe(
      "Decaf tea",
    );
    await expect(
      updateParticipant("manchester", "Another name", "Books"),
    ).rejects.toThrow("closed");
    await expect(leaveParticipant("manchester")).rejects.toThrow("closed");
    expect(await getParticipantRecipient("manchester")).toEqual(recipient);
    await updateDoc(doc(admin, "events/manchester"), { status: "archived" });
    await expect(
      updateParticipantPreferences("manchester", "New hints"),
    ).rejects.toThrow("archived");
  });

  it("discards a newly-created account only when registration is known not to have committed", async () => {
    apiSession.afterAccountCreated = async () => {
      await updateDoc(doc(admin, "events/manchester"), { status: "locked" });
    };
    await expect(joinWithEventPassword("manchester", "Guest")).rejects.toThrow(
      "closed",
    );
    expect(apiSession.discarded).toEqual(["guest-1"]);
    expect(
      (await getDoc(doc(admin, "participantAccess/guest-1"))).exists(),
    ).toBe(false);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(3);
  });

  it("recovers a committed registration when the commit acknowledgement is lost", async () => {
    apiSession.throwAfterCommit = true;
    const joined = await joinWithEventPassword("manchester", "Guest");
    expect(await getParticipantMembership("manchester")).toEqual(joined.member);
    expect(await getParticipantPassword("manchester")).toBe(joined.password);
    expect(apiSession.discarded).toEqual([]);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
  });

  it("retains an uncertain account and retries without creating a duplicate participant", async () => {
    apiSession.throwAfterCommit = true;
    apiSession.blockServerReads = true;
    await expect(joinWithEventPassword("manchester", "Guest")).rejects.toThrow(
      "could not be confirmed",
    );
    expect(apiSession.discarded).toEqual([]);
    apiSession.blockServerReads = false;
    const retried = await joinWithEventPassword("manchester", "Guest");
    expect(retried.member.uid).toBe("guest-1");
    expect(apiSession.accountCounter).toBe(1);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
  });

  it("does not delete an uncertain account merely because server reads currently show no registration", async () => {
    apiSession.uncertainCommitWithoutWrite = true;
    await expect(joinWithEventPassword("manchester", "Guest")).rejects.toThrow(
      "could not be confirmed",
    );
    expect(
      (await getDoc(doc(admin, "events/manchester/members/guest-1"))).exists(),
    ).toBe(false);
    expect(apiSession.discarded).toEqual([]);
    const retried = await joinWithEventPassword("manchester", "Guest");
    expect(retried.member.uid).toBe("guest-1");
    expect(apiSession.accountCounter).toBe(1);
    expect(
      (await getDoc(doc(admin, "events/manchester"))).data()?.memberCount,
    ).toBe(4);
  });

  it("publishes 100 participants across bounded batches within rule access limits", async () => {
    const members: Member[] = Array.from({ length: 100 }, (_, index) => ({
      uid: `person-${index}`,
      name: `Colleague ${index}`,
      joinedAt: NOW,
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      const batch = writeBatch(database);
      batch.set(doc(database, "events/large"), {
        ...eventData,
        name: "Large event",
        memberCount: members.length,
      });
      for (const member of members)
        batch.set(doc(database, `events/large/members/${member.uid}`), member);
      await batch.commit();
    });
    await runDraw("large");
    const event = (await getDoc(doc(admin, "events/large"))).data()!;
    const saved = await getDocs(
      collection(admin, `events/large/runs/${event.activeRunId}/assignments`),
    );
    expect(event.status).toBe("drawn");
    expect(saved.size).toBe(members.length);
    expect(() =>
      validateAssignments(
        members,
        saved.docs.map((item) => item.data() as Assignment),
      ),
    ).not.toThrow();
  }, 60_000);
});
