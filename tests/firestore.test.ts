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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getAssignment, joinEvent, runDraw, saveEvent } from "../src/lib/api";
import { validateAssignments } from "../src/lib/draw";
import type { Assignment, Member } from "../src/types";

const apiSession = vi.hoisted(() => ({
  database: null as Firestore | null,
  currentUser: null as { uid: string; emailVerified: boolean } | null,
}));
vi.mock("../src/lib/firebase", () => ({
  get db() {
    return apiSession.database;
  },
  auth: {
    get currentUser() {
      return apiSession.currentUser;
    },
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
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  function join(
    database: Firestore,
    uid: string,
    eventId = "manchester",
    count = 4,
  ) {
    const batch = writeBatch(database);
    batch.set(doc(database, `events/${eventId}/members/${uid}`), {
      uid,
      name: "New person",
      joinedAt: NOW,
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
