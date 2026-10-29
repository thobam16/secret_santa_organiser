import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from "firebase/firestore";
import { deleteUser, type User } from "firebase/auth";
import { auth, db, getEventServices } from "./firebase";
import {
  createEventAccount,
  createTemporaryEventAccount,
  generateEventPassword,
  signInEvent,
  signOutEvent,
} from "./event-auth";
import { makeAssignments, validateAssignments } from "./draw";
import { validateEventInput } from "./dates";
import type {
  Assignment,
  EventInput,
  Member,
  ParticipantAccess,
  ParticipantCredential,
  Recipient,
  SantaEvent,
} from "../types";

const eventRef = (id: string) => doc(db, "events", id);
const memberRef = (eventId: string, uid: string) =>
  doc(db, "events", eventId, "members", uid);
const runRef = (eventId: string, runId: string) =>
  doc(db, "events", eventId, "runs", runId);
const assignmentRef = (eventId: string, runId: string, uid: string) =>
  doc(db, "events", eventId, "runs", runId, "assignments", uid);

interface DrawPlan {
  members: Record<string, string>;
  recipients: Record<string, string>;
  count: number;
  createdAt: number;
}

function eventFrom(snapshot: DocumentSnapshot<DocumentData>): SantaEvent {
  if (!snapshot.exists())
    throw new Error("This Secret Santa could not be found.");
  return { ...snapshot.data(), id: snapshot.id } as SantaEvent;
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in to continue.");
  return user;
}

function cleanName(name: string) {
  const value = name.trim().replace(/\s+/g, " ");
  if (!value || value.length > 100)
    throw new Error("Please enter a name between 1 and 100 characters.");
  return value;
}

function cleanPreferences(preferences: string) {
  const value = preferences.trim();
  if (value.length > 500)
    throw new Error("Keep gift preferences to 500 characters or fewer.");
  return value;
}

export function subscribeEvents(
  next: (events: SantaEvent[]) => void,
  error: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, "events"),
    (snapshot) => {
      const events = snapshot.docs
        .map(eventFrom)
        .sort(
          (a, b) => a.exchangeAt - b.exchangeAt || a.name.localeCompare(b.name),
        );
      next(events);
    },
    error,
  );
}

export async function getIsAdmin(uid: string): Promise<boolean> {
  if (!auth.currentUser?.emailVerified || auth.currentUser.uid !== uid)
    return false;
  const snapshot = await getDoc(doc(db, "config", "admin"));
  return snapshot.exists() && snapshot.data().uid === uid;
}

export async function getMyMemberships(
  uid: string,
  eventIds: string[],
): Promise<Record<string, Member>> {
  const result: Record<string, Member> = {};
  // Bound concurrent reads so returning to a busy site does not create a burst.
  for (let start = 0; start < eventIds.length; start += 10) {
    await Promise.all(
      eventIds.slice(start, start + 10).map(async (eventId) => {
        const snapshot = await getDoc(memberRef(eventId, uid));
        if (snapshot.exists()) result[eventId] = snapshot.data() as Member;
      }),
    );
  }
  return result;
}

export async function getMembers(eventId: string): Promise<Member[]> {
  const snapshot = await getDocs(collection(db, "events", eventId, "members"));
  return snapshot.docs
    .map((item) => item.data() as Member)
    .sort((a, b) => a.name.localeCompare(b.name) || a.uid.localeCompare(b.uid));
}

export async function saveEvent(
  input: EventInput,
  eventId?: string,
): Promise<string> {
  validateEventInput(input);
  requireUser();
  const reference = eventId ? eventRef(eventId) : doc(collection(db, "events"));
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (eventId) {
      const event = eventFrom(snapshot);
      if (
        ["drawing", "drawn", "archived"].includes(event.status) &&
        input.signupDeadline !== event.signupDeadline
      ) {
        throw new Error(
          "The signup deadline is fixed once the draw has started.",
        );
      }
      transaction.update(reference, {
        ...input,
        name: input.name.trim(),
        details: input.details.trim(),
      });
    } else {
      transaction.set(reference, {
        ...input,
        name: input.name.trim(),
        details: input.details.trim(),
        status: "open",
        memberCount: 0,
        activeRunId: null,
        createdAt: Date.now(),
      });
    }
  });
  return reference.id;
}

export async function joinEvent(
  eventId: string,
  name: string,
  preferences = "",
): Promise<void> {
  const user = requireUser();
  if (!user.emailVerified)
    throw new Error("Verify your email address before joining.");
  const clean = cleanName(name);
  const cleanNotes = cleanPreferences(preferences);
  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventRef(eventId)),
      transaction.get(memberRef(eventId, user.uid)),
    ]);
    const event = eventFrom(eventSnapshot);
    if (event.status !== "open" || event.signupDeadline <= Date.now())
      throw new Error("Registration for this event has closed.");
    if (memberSnapshot.exists()) {
      transaction.update(memberRef(eventId, user.uid), {
        name: clean,
        preferences: cleanNotes,
      });
    } else {
      transaction.set(memberRef(eventId, user.uid), {
        uid: user.uid,
        name: clean,
        joinedAt: Date.now(),
        preferences: cleanNotes,
      });
      transaction.update(eventRef(eventId), {
        memberCount: event.memberCount + 1,
      });
    }
  });
}

export async function updatePreferences(
  eventId: string,
  preferences: string,
): Promise<void> {
  const user = requireUser();
  if (!user.emailVerified)
    throw new Error("Verify your email address before saving preferences.");
  const clean = cleanPreferences(preferences);
  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventRef(eventId)),
      transaction.get(memberRef(eventId, user.uid)),
    ]);
    const event = eventFrom(eventSnapshot);
    if (event.status === "archived")
      throw new Error("Preferences cannot change for an archived event.");
    if (!memberSnapshot.exists())
      throw new Error("Join this event before saving preferences.");
    transaction.update(memberRef(eventId, user.uid), { preferences: clean });
  });
}

export async function leaveEvent(eventId: string, uid: string): Promise<void> {
  const user = requireUser();
  const admin = await getIsAdmin(user.uid);
  if (!admin && uid !== user.uid)
    throw new Error("You can only change your own membership.");
  await withdrawMember(db, eventId, uid, admin);
}

async function withdrawMember(
  database: Firestore,
  eventId: string,
  memberUid: string,
  admin = false,
): Promise<void> {
  const eventDocument = doc(database, "events", eventId);
  const memberDocument = doc(database, "events", eventId, "members", memberUid);
  const credentialDocument = doc(
    database,
    "events",
    eventId,
    "credentials",
    memberUid,
  );
  await runTransaction(database, async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventDocument),
      transaction.get(memberDocument),
    ]);
    const event = eventFrom(eventSnapshot);
    if (
      event.status !== "open" ||
      (!admin && event.signupDeadline <= Date.now())
    ) {
      throw new Error(
        "The participant list is closed. Contact the organiser if you need help.",
      );
    }
    if (!memberSnapshot.exists()) return;
    const credential = await transaction.get(credentialDocument);
    if (credential.exists()) {
      transaction.delete(
        doc(database, "participantAccess", credential.data().authUid),
      );
      transaction.delete(credentialDocument);
    }
    transaction.delete(memberDocument);
    transaction.update(eventDocument, {
      memberCount: event.memberCount - 1,
    });
  });
}

export async function setRegistration(
  eventId: string,
  open: boolean,
): Promise<void> {
  requireUser();
  await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (!["open", "locked"].includes(event.status))
      throw new Error("Registration cannot change after the draw has started.");
    if (open && event.signupDeadline <= Date.now())
      throw new Error(
        "Set a future signup deadline before reopening registration.",
      );
    transaction.update(eventRef(eventId), { status: open ? "open" : "locked" });
  });
}

function plannedAssignments(plan: DrawPlan): Assignment[] {
  return Object.entries(plan.recipients).map(([giverUid, recipientUid]) => ({
    giverUid,
    recipientUid,
    recipientName: plan.members[recipientUid],
  }));
}

export async function runDraw(
  eventId: string,
  onProgress: (message: string) => void = () => {},
): Promise<void> {
  requireUser();
  onProgress("Securing the participant list…");
  await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (event.status === "drawn" || event.status === "archived")
      throw new Error("This draw has already been completed.");
    if (event.memberCount < 3)
      throw new Error("At least three participants are needed for a draw.");
    if (event.status === "open")
      transaction.update(eventRef(eventId), { status: "locked" });
  });

  // The lock freezes names and membership before any random choices are made.
  const members = await getMembers(eventId);
  const candidate = makeAssignments(members);
  const plan: DrawPlan = {
    members: Object.fromEntries(
      members.map((member) => [member.uid, member.name]),
    ),
    recipients: Object.fromEntries(
      candidate.map((item) => [item.giverUid, item.recipientUid]),
    ),
    count: members.length,
    createdAt: Date.now(),
  };
  // A plan is one immutable recovery document. Leave headroom below Firestore's 1 MiB limit.
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > 850_000) {
    throw new Error(
      "This participant list is too large for one draw. Split it into smaller events before drawing.",
    );
  }
  const candidateId = crypto.randomUUID();
  const reserved = await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (event.status === "drawn" || event.status === "archived")
      throw new Error("This draw has already been completed.");
    if (event.status === "drawing" && event.activeRunId) {
      const snapshot = await transaction.get(
        runRef(eventId, event.activeRunId),
      );
      if (!snapshot.exists())
        throw new Error(
          "The saved draw needs organiser support. No results have been published.",
        );
      return { runId: event.activeRunId, plan: snapshot.data() as DrawPlan };
    }
    if (event.status !== "locked" || event.memberCount !== members.length)
      throw new Error("The participant list changed. Please try again.");
    const currentMembers = await Promise.all(
      members.map((member) => transaction.get(memberRef(eventId, member.uid))),
    );
    if (
      currentMembers.some(
        (snapshot, index) =>
          !snapshot.exists() || snapshot.data().name !== members[index].name,
      )
    ) {
      throw new Error(
        "The participant list changed. Please review it and try again.",
      );
    }
    transaction.set(runRef(eventId, candidateId), plan);
    transaction.update(eventRef(eventId), {
      status: "drawing",
      activeRunId: candidateId,
    });
    return { runId: candidateId, plan };
  });

  const assignments = plannedAssignments(reserved.plan);
  validateAssignments(members, assignments);
  if (reserved.plan.count !== assignments.length)
    throw new Error(
      "The saved draw is incomplete. No results have been published.",
    );

  // Creates are immutable and idempotent. A second tab can resume exactly the same plan.
  const existing = await getDocs(
    collection(db, "events", eventId, "runs", reserved.runId, "assignments"),
  );
  const existingIds = new Set(existing.docs.map((item) => item.id));
  const remaining = assignments.filter(
    (item) => !existingIds.has(item.giverUid),
  );
  for (let offset = 0; offset < remaining.length; offset += 5) {
    const batch = writeBatch(db);
    for (const assignment of remaining.slice(offset, offset + 5)) {
      batch.set(
        assignmentRef(eventId, reserved.runId, assignment.giverUid),
        assignment,
      );
    }
    await batch.commit();
    onProgress(
      `Saving the draw… ${Math.min(existing.size + offset + 5, assignments.length)} of ${assignments.length}`,
    );
  }

  onProgress("Checking every gift before revealing the draw…");
  const persisted = await getDocs(
    collection(db, "events", eventId, "runs", reserved.runId, "assignments"),
  );
  validateAssignments(
    members,
    persisted.docs.map((item) => item.data() as Assignment),
  );
  await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (event.status === "drawn" && event.activeRunId === reserved.runId)
      return;
    if (event.status !== "drawing" || event.activeRunId !== reserved.runId)
      throw new Error("The draw changed in another window. Please refresh.");
    transaction.update(eventRef(eventId), { status: "drawn" });
  });
  onProgress("The draw is ready. Everyone can reveal their own recipient.");
}

export async function getAssignment(
  eventId: string,
  uid: string,
): Promise<Assignment | null> {
  requireUser();
  const event = eventFrom(await getDoc(eventRef(eventId)));
  if (!["drawn", "archived"].includes(event.status) || !event.activeRunId)
    return null;
  const snapshot = await getDoc(assignmentRef(eventId, event.activeRunId, uid));
  return snapshot.exists() ? (snapshot.data() as Assignment) : null;
}

export async function getRecipient(
  eventId: string,
  uid: string,
): Promise<Recipient | null> {
  const assignment = await getAssignment(eventId, uid);
  if (!assignment) return null;
  const recipient = await getDoc(memberRef(eventId, assignment.recipientUid));
  return { ...assignment, preferences: recipient.data()?.preferences ?? "" };
}

interface ParticipantSession {
  database: Firestore;
  member: Member;
  user: User;
  source: "event" | "legacy";
}

async function participantSession(
  eventId: string,
): Promise<ParticipantSession | null> {
  const services = getEventServices(eventId);
  await services.auth.authStateReady();
  const eventUser = services.auth.currentUser;
  if (eventUser) {
    const access = await getDoc(
      doc(services.db, "participantAccess", eventUser.uid),
    );
    if (services.auth.currentUser?.uid !== eventUser.uid)
      throw new Error("Your event session changed. Try again.");
    if (!access.exists()) return null;
    const binding = access.data() as ParticipantAccess;
    if (binding.eventId !== eventId) return null;
    const member = await getDoc(
      doc(services.db, "events", eventId, "members", binding.memberUid),
    );
    if (services.auth.currentUser?.uid !== eventUser.uid)
      throw new Error("Your event session changed. Try again.");
    return member.exists()
      ? {
          database: services.db,
          member: member.data() as Member,
          user: eventUser,
          source: "event",
        }
      : null;
  }
  const legacyUser = auth.currentUser;
  if (!legacyUser?.emailVerified) return null;
  const member = await getDoc(memberRef(eventId, legacyUser.uid));
  if (auth.currentUser?.uid !== legacyUser.uid || services.auth.currentUser)
    throw new Error("Your event session changed. Try again.");
  return member.exists()
    ? {
        database: db,
        member: member.data() as Member,
        user: legacyUser,
        source: "legacy",
      }
    : null;
}

async function requireParticipant(
  eventId: string,
): Promise<ParticipantSession> {
  const session = await participantSession(eventId);
  if (!session)
    throw new Error("Join this event or enter your event password.");
  return session;
}

function assertParticipantSession(
  eventId: string,
  session: ParticipantSession,
) {
  const current =
    session.source === "event"
      ? getEventServices(eventId).auth.currentUser
      : auth.currentUser;
  if (current?.uid !== session.user.uid)
    throw new Error("Your event session changed. Try again.");
}

export async function getParticipantMembership(
  eventId: string,
): Promise<Member | null> {
  return (await participantSession(eventId))?.member ?? null;
}

export async function getParticipantPassword(
  eventId: string,
): Promise<string | null> {
  const session = await participantSession(eventId);
  if (!session) return null;
  const credential = await getDoc(
    doc(session.database, "events", eventId, "credentials", session.member.uid),
  );
  assertParticipantSession(eventId, session);
  return credential.exists()
    ? (credential.data() as ParticipantCredential).password
    : null;
}

export async function getMemberPassword(
  eventId: string,
  memberUid: string,
): Promise<string | null> {
  const user = requireUser();
  if (!(await getIsAdmin(user.uid)))
    throw new Error(
      "Only the organiser can view another participant’s password.",
    );
  const credential = await getDoc(
    doc(db, "events", eventId, "credentials", memberUid),
  );
  if (auth.currentUser?.uid !== user.uid)
    throw new Error("Your session changed. Try again.");
  return credential.exists()
    ? (credential.data() as ParticipantCredential).password
    : null;
}

// Retain uncertain attempts only in memory. Retrying in this tab reuses the same
// account and password rather than creating another participant.
const pendingJoins = new Map<string, { user: User; password: string }>();
const joiningEvents = new Map<
  string,
  Promise<{ member: Member; password: string }>
>();

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function definitiveWriteRejection(error: unknown): boolean {
  return [
    "permission-denied",
    "invalid-argument",
    "failed-precondition",
    "aborted",
    "already-exists",
    "not-found",
  ].includes(errorCode(error) ?? "");
}

export function joinWithEventPassword(
  eventId: string,
  name: string,
  preferences = "",
): Promise<{ member: Member; password: string }> {
  const pending = joiningEvents.get(eventId);
  if (pending) return pending;
  const operation = registerParticipant(eventId, name, preferences);
  joiningEvents.set(eventId, operation);
  void operation
    .finally(() => {
      if (joiningEvents.get(eventId) === operation)
        joiningEvents.delete(eventId);
    })
    .catch(() => {});
  return operation;
}

async function registerParticipant(
  eventId: string,
  name: string,
  preferences: string,
): Promise<{ member: Member; password: string }> {
  const clean = cleanName(name);
  const notes = cleanPreferences(preferences);
  const existing = await participantSession(eventId);
  if (existing) {
    const password =
      (await getParticipantPassword(eventId)) ??
      (await issueParticipantPassword(eventId, existing.member.uid));
    pendingJoins.delete(eventId);
    return { member: existing.member, password };
  }
  const services = getEventServices(eventId);
  let account = pendingJoins.get(eventId);
  if (account && services.auth.currentUser?.uid !== account.user.uid) {
    pendingJoins.delete(eventId);
    account = undefined;
  }
  const newlyCreated = !account;
  if (!account) {
    // Avoid creating an Auth account for an event that is already closed.
    const event = eventFrom(await getDoc(doc(services.db, "events", eventId)));
    if (event.status !== "open" || event.signupDeadline <= Date.now())
      throw new Error("Registration for this event has closed.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const password = generateEventPassword();
      try {
        account = {
          user: await createEventAccount(eventId, password),
          password,
        };
        break;
      } catch (error) {
        if (errorCode(error) !== "auth/email-already-in-use" || attempt === 2)
          throw error;
      }
    }
    if (!account)
      throw new Error("Could not create an event password. Try again.");
    pendingJoins.set(eventId, account);
  }
  const { user, password } = account;
  const eventDocument = doc(services.db, "events", eventId);
  const memberDocument = doc(
    services.db,
    "events",
    eventId,
    "members",
    user.uid,
  );
  const accessDocument = doc(services.db, "participantAccess", user.uid);
  const credentialDocument = doc(
    services.db,
    "events",
    eventId,
    "credentials",
    user.uid,
  );
  let attemptedCommit = false;
  try {
    const member = await runTransaction(services.db, async (transaction) => {
      const [eventSnapshot, memberSnapshot, accessSnapshot] = await Promise.all(
        [
          transaction.get(eventDocument),
          transaction.get(memberDocument),
          transaction.get(accessDocument),
        ],
      );
      if (services.auth.currentUser?.uid !== user.uid)
        throw new Error("Your event session changed. Try again.");
      if (memberSnapshot.exists() && accessSnapshot.exists()) {
        const binding = accessSnapshot.data() as ParticipantAccess;
        if (binding.eventId === eventId && binding.memberUid === user.uid) {
          const savedCredential = await transaction.get(credentialDocument);
          if (
            savedCredential.data()?.authUid === user.uid &&
            savedCredential.data()?.password === password
          )
            return memberSnapshot.data() as Member;
        }
        throw new Error(
          "This account already has a registration. Contact the organiser.",
        );
      }
      if (memberSnapshot.exists() || accessSnapshot.exists())
        throw new Error("This registration needs organiser support.");
      const event = eventFrom(eventSnapshot);
      if (event.status !== "open" || event.signupDeadline <= Date.now())
        throw new Error("Registration for this event has closed.");
      const member: Member = {
        uid: user.uid,
        name: clean,
        preferences: notes,
        joinedAt: Date.now(),
      };
      attemptedCommit = true;
      transaction.set(memberDocument, member);
      transaction.set(accessDocument, {
        eventId,
        memberUid: user.uid,
      } satisfies ParticipantAccess);
      transaction.set(credentialDocument, {
        authUid: user.uid,
        password,
        createdAt: Date.now(),
      } satisfies ParticipantCredential);
      transaction.update(eventDocument, { memberCount: event.memberCount + 1 });
      return member;
    });
    if (services.auth.currentUser?.uid !== user.uid)
      throw new Error("Your event session changed. Try again.");
    pendingJoins.delete(eventId);
    return { member, password };
  } catch (error) {
    let safeToDiscard = !attemptedCommit && newlyCreated;
    if (
      (attemptedCommit || !newlyCreated) &&
      services.auth.currentUser?.uid === user.uid
    ) {
      try {
        const [member, access] = await Promise.all([
          getDocFromServer(memberDocument),
          getDocFromServer(accessDocument),
        ]);
        safeToDiscard =
          !member.exists() &&
          !access.exists() &&
          definitiveWriteRejection(error);
        if (
          member.exists() &&
          access.exists() &&
          access.data().eventId === eventId &&
          access.data().memberUid === user.uid
        ) {
          const saved = await getDocFromServer(credentialDocument);
          if (
            saved.data()?.authUid === user.uid &&
            saved.data()?.password === password
          ) {
            pendingJoins.delete(eventId);
            return { member: member.data() as Member, password };
          }
        }
      } catch {
        // An unavailable read is not proof that the registration failed.
      }
    }
    if (safeToDiscard) {
      pendingJoins.delete(eventId);
      await deleteUser(user).catch(() => {});
      throw error;
    }
    throw new Error(
      "Registration could not be confirmed. Keep this browser open and try again before making another registration.",
    );
  }
}

export async function signInParticipant(
  eventId: string,
  password: string,
): Promise<Member> {
  try {
    await signInEvent(eventId, password);
  } catch (error) {
    if (
      [
        "auth/invalid-credential",
        "auth/user-not-found",
        "auth/wrong-password",
        "auth/user-disabled",
      ].includes(errorCode(error) ?? "")
    )
      throw new Error("That password does not match this event.");
    throw error;
  }
  const member = await getParticipantMembership(eventId);
  if (!member) {
    await signOutEvent(eventId);
    throw new Error(
      "No registration was found for that password. Contact the organiser.",
    );
  }
  return member;
}

export async function signOutParticipant(eventId: string): Promise<boolean> {
  const services = getEventServices(eventId);
  await services.auth.authStateReady();
  const hadEventSession = services.auth.currentUser !== null;
  await signOutEvent(eventId);
  pendingJoins.delete(eventId);
  return hadEventSession;
}

export async function updateParticipant(
  eventId: string,
  name: string,
  preferences = "",
): Promise<void> {
  const session = await requireParticipant(eventId);
  const clean = cleanName(name);
  const notes = cleanPreferences(preferences);
  await runTransaction(session.database, async (transaction) => {
    const eventDocument = doc(session.database, "events", eventId);
    const memberDocument = doc(
      session.database,
      "events",
      eventId,
      "members",
      session.member.uid,
    );
    const [eventSnapshot, member] = await Promise.all([
      transaction.get(eventDocument),
      transaction.get(memberDocument),
    ]);
    assertParticipantSession(eventId, session);
    const event = eventFrom(eventSnapshot);
    if (event.status !== "open" || event.signupDeadline <= Date.now())
      throw new Error("Registration for this event has closed.");
    if (!member.exists())
      throw new Error("You are no longer registered for this event.");
    transaction.update(memberDocument, { name: clean, preferences: notes });
  });
}

export async function updateParticipantPreferences(
  eventId: string,
  preferences: string,
): Promise<void> {
  const session = await requireParticipant(eventId);
  const clean = cleanPreferences(preferences);
  await runTransaction(session.database, async (transaction) => {
    const eventDocument = doc(session.database, "events", eventId);
    const memberDocument = doc(
      session.database,
      "events",
      eventId,
      "members",
      session.member.uid,
    );
    const [eventSnapshot, member] = await Promise.all([
      transaction.get(eventDocument),
      transaction.get(memberDocument),
    ]);
    assertParticipantSession(eventId, session);
    if (eventFrom(eventSnapshot).status === "archived")
      throw new Error("Preferences cannot change for an archived event.");
    if (!member.exists())
      throw new Error("You are no longer registered for this event.");
    transaction.update(memberDocument, { preferences: clean });
  });
}

export async function leaveParticipant(eventId: string): Promise<void> {
  const session = await requireParticipant(eventId);
  await withdrawMember(session.database, eventId, session.member.uid);
  if (
    session.source === "event" &&
    getEventServices(eventId).auth.currentUser?.uid === session.user.uid
  )
    await signOutEvent(eventId);
  pendingJoins.delete(eventId);
}

export async function getParticipantRecipient(
  eventId: string,
): Promise<Recipient | null> {
  const session = await requireParticipant(eventId);
  const event = eventFrom(
    await getDoc(doc(session.database, "events", eventId)),
  );
  if (!["drawn", "archived"].includes(event.status) || !event.activeRunId)
    return null;
  const assignment = await getDoc(
    doc(
      session.database,
      "events",
      eventId,
      "runs",
      event.activeRunId,
      "assignments",
      session.member.uid,
    ),
  );
  if (!assignment.exists()) return null;
  const result = assignment.data() as Assignment;
  const recipient = await getDoc(
    doc(session.database, "events", eventId, "members", result.recipientUid),
  );
  assertParticipantSession(eventId, session);
  return { ...result, preferences: recipient.data()?.preferences ?? "" };
}

export async function issueParticipantPassword(
  eventId: string,
  memberUid: string,
): Promise<string> {
  const issuer = requireUser();
  if (
    !issuer.emailVerified ||
    (issuer.uid !== memberUid && !(await getIsAdmin(issuer.uid)))
  )
    throw new Error(
      "Only the organiser or the original participant can issue this password.",
    );
  const memberDocument = memberRef(eventId, memberUid);
  const credentialDocument = doc(
    db,
    "events",
    eventId,
    "credentials",
    memberUid,
  );
  const member = await getDoc(memberDocument);
  if (!member.exists()) throw new Error("This participant could not be found.");
  const existing = await getDoc(credentialDocument);
  if (auth.currentUser?.uid !== issuer.uid)
    throw new Error("Your session changed. Try again.");
  if (existing.exists())
    return (existing.data() as ParticipantCredential).password;
  let generated:
    | {
        password: string;
        account: Awaited<ReturnType<typeof createTemporaryEventAccount>>;
      }
    | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = generateEventPassword();
    try {
      generated = {
        password,
        account: await createTemporaryEventAccount(eventId, password),
      };
      break;
    } catch (error) {
      if (errorCode(error) !== "auth/email-already-in-use" || attempt === 2)
        throw error;
    }
  }
  if (!generated)
    throw new Error("Could not create an event password. Try again.");
  const { password, account } = generated;
  let attemptedCommit = false;
  let accountBound = false;
  try {
    const result = await runTransaction(db, async (transaction) => {
      const [currentMember, credential] = await Promise.all([
        transaction.get(memberDocument),
        transaction.get(credentialDocument),
      ]);
      if (auth.currentUser?.uid !== issuer.uid)
        throw new Error("Your session changed. Try again.");
      if (!currentMember.exists())
        throw new Error("This participant could not be found.");
      if (credential.exists())
        return {
          password: (credential.data() as ParticipantCredential).password,
          created: false,
        };
      attemptedCommit = true;
      transaction.set(doc(db, "participantAccess", account.uid), {
        eventId,
        memberUid,
      } satisfies ParticipantAccess);
      transaction.set(credentialDocument, {
        authUid: account.uid,
        password,
        createdAt: Date.now(),
      } satisfies ParticipantCredential);
      return { password, created: true };
    });
    accountBound = result.created;
    if (auth.currentUser?.uid !== issuer.uid)
      throw new Error("Your session changed. Try again.");
    if (!accountBound) await account.discard();
    return result.password;
  } catch (error) {
    let safeToDiscard = !attemptedCommit;
    if (attemptedCommit && auth.currentUser?.uid === issuer.uid) {
      try {
        const saved = await getDocFromServer(credentialDocument);
        if (saved.data()?.authUid === account.uid) {
          accountBound = true;
          return (saved.data() as ParticipantCredential).password;
        }
        if (saved.exists()) {
          // A competing issuer can win before the security-rule evaluation,
          // producing permission-denied rather than a transaction retry.
          // Return that immutable credential and discard only our unused account.
          await account.discard();
          return (saved.data() as ParticipantCredential).password;
        }
        // Absence after an unavailable/timed-out commit is not conclusive: the
        // original request may still arrive. Retain that account conservatively.
        safeToDiscard = definitiveWriteRejection(error);
      } catch {
        // Preserve the account if the commit outcome cannot be verified.
      }
    }
    if (safeToDiscard) await account.discard().catch(() => {});
    throw error;
  } finally {
    await account.dispose();
  }
}

export async function archiveEvent(eventId: string): Promise<void> {
  requireUser();
  await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (event.status === "drawing")
      throw new Error("Finish the saved draw before archiving this event.");
    transaction.update(eventRef(eventId), { status: "archived" });
  });
}
