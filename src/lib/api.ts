import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { makeAssignments, validateAssignments } from "./draw";
import { validateEventInput } from "./dates";
import type { Assignment, EventInput, Member, SantaEvent } from "../types";

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

export async function joinEvent(eventId: string, name: string): Promise<void> {
  const user = requireUser();
  if (!user.emailVerified)
    throw new Error("Verify your email address before joining.");
  const clean = cleanName(name);
  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventRef(eventId)),
      transaction.get(memberRef(eventId, user.uid)),
    ]);
    const event = eventFrom(eventSnapshot);
    if (event.status !== "open" || event.signupDeadline <= Date.now())
      throw new Error("Registration for this event has closed.");
    if (memberSnapshot.exists()) {
      transaction.update(memberRef(eventId, user.uid), { name: clean });
    } else {
      transaction.set(memberRef(eventId, user.uid), {
        uid: user.uid,
        name: clean,
        joinedAt: Date.now(),
      });
      transaction.update(eventRef(eventId), {
        memberCount: event.memberCount + 1,
      });
    }
  });
}

export async function leaveEvent(eventId: string, uid: string): Promise<void> {
  const user = requireUser();
  const admin = await getIsAdmin(user.uid);
  if (!admin && uid !== user.uid)
    throw new Error("You can only change your own membership.");
  await runTransaction(db, async (transaction) => {
    const [eventSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(eventRef(eventId)),
      transaction.get(memberRef(eventId, uid)),
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
    transaction.delete(memberRef(eventId, uid));
    transaction.update(eventRef(eventId), {
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

export async function archiveEvent(eventId: string): Promise<void> {
  requireUser();
  await runTransaction(db, async (transaction) => {
    const event = eventFrom(await transaction.get(eventRef(eventId)));
    if (event.status === "drawing")
      throw new Error("Finish the saved draw before archiving this event.");
    transaction.update(eventRef(eventId), { status: "archived" });
  });
}
