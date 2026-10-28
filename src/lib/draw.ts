import type { Assignment, Member } from "../types";

const UINT32_RANGE = 0x1_0000_0000;

function rosterByUid(members: Member[]): Map<string, Member> {
  if (!Array.isArray(members) || members.length < 3) {
    throw new Error("At least three participants are needed to draw names.");
  }

  const roster = new Map<string, Member>();
  for (const member of members) {
    if (
      !member ||
      typeof member.uid !== "string" ||
      !member.uid.trim() ||
      member.uid.length > 128 ||
      member.uid.includes("/")
    ) {
      throw new Error(
        "A participant has an invalid account ID. Refresh the participant list and try again.",
      );
    }
    if (roster.has(member.uid)) {
      throw new Error(
        "The participant list contains the same account more than once.",
      );
    }
    if (
      typeof member.name !== "string" ||
      !member.name.trim() ||
      member.name.length > 100
    ) {
      throw new Error(
        "Each participant needs a name of between 1 and 100 characters.",
      );
    }
    roster.set(member.uid, member);
  }
  return roster;
}

/** Discard the incomplete tail of the uint32 range so every index is equally likely. */
function randomBelow(bound: number): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "Secure randomness is unavailable. Open the site using HTTPS and try again.",
    );
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  const value = new Uint32Array(1);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    globalThis.crypto.getRandomValues(value);
    if (value[0] < limit) return value[0] % bound;
  }
  throw new Error(
    "Secure randomness could not produce a draw. Please try again.",
  );
}

/**
 * Uniformly shuffle all permutations, rejecting any that contain self-matches.
 * This includes valid reciprocal pairs and does not force a single gift cycle.
 */
export function makeAssignments(members: Member[]): Assignment[] {
  rosterByUid(members);

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const recipients = [...members];
    for (let index = recipients.length - 1; index > 0; index -= 1) {
      const other = randomBelow(index + 1);
      [recipients[index], recipients[other]] = [
        recipients[other],
        recipients[index],
      ];
    }
    if (members.some((member, index) => member.uid === recipients[index].uid))
      continue;

    const assignments = members.map((giver, index) => ({
      giverUid: giver.uid,
      recipientUid: recipients[index].uid,
      recipientName: recipients[index].name,
    }));
    validateAssignments(members, assignments);
    return assignments;
  }

  throw new Error("A valid draw could not be generated. Please try again.");
}

/** Check a complete stored draw against the frozen roster before publishing it. */
export function validateAssignments(
  members: Member[],
  assignments: Assignment[],
): void {
  const roster = rosterByUid(members);
  if (!Array.isArray(assignments) || assignments.length !== roster.size) {
    throw new Error(
      "The draw is incomplete. Every participant must have one recipient.",
    );
  }

  const givers = new Set<string>();
  const recipients = new Set<string>();
  for (const assignment of assignments) {
    if (
      !assignment ||
      !roster.has(assignment.giverUid) ||
      !roster.has(assignment.recipientUid)
    ) {
      throw new Error("The draw contains an account outside this event.");
    }
    if (assignment.giverUid === assignment.recipientUid) {
      throw new Error("A participant cannot draw themselves.");
    }
    if (
      givers.has(assignment.giverUid) ||
      recipients.has(assignment.recipientUid)
    ) {
      throw new Error("Every participant must give and receive exactly once.");
    }
    if (
      assignment.recipientName !== roster.get(assignment.recipientUid)!.name
    ) {
      throw new Error(
        "A recipient name does not match the frozen participant list.",
      );
    }
    givers.add(assignment.giverUid);
    recipients.add(assignment.recipientUid);
  }
}
