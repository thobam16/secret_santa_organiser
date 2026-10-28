import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAssignments, validateAssignments } from "../src/lib/draw";
import type { Assignment, Member } from "../src/types";

const members = (size: number): Member[] =>
  Array.from({ length: size }, (_, index) => ({
    uid: `account-${index}`,
    name: `Person ${index}`,
    joinedAt: 1_793_000_000_000,
  }));

afterEach(() => vi.unstubAllGlobals());

describe("Secret Santa matching", () => {
  it.each([3, 4, 10, 100, 500])(
    "gives and receives exactly once for %i participants",
    (size) => {
      const roster = members(size);
      const snapshot = structuredClone(roster);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const result = makeAssignments(roster);
        expect(result).toHaveLength(size);
        expect(
          new Set(result.map((assignment) => assignment.giverUid)).size,
        ).toBe(size);
        expect(
          new Set(result.map((assignment) => assignment.recipientUid)).size,
        ).toBe(size);
        for (const assignment of result) {
          expect(assignment.recipientUid).not.toBe(assignment.giverUid);
          expect(assignment.recipientName).toBe(
            roster.find((member) => member.uid === assignment.recipientUid)
              ?.name,
          );
        }
        expect(() => validateAssignments(roster, result)).not.toThrow();
      }
      expect(roster).toEqual(snapshot);
    },
  );

  it("permits identical display names because accounts are distinct", () => {
    const roster = members(3).map((member) => ({ ...member, name: "Alex" }));
    expect(() =>
      validateAssignments(roster, makeAssignments(roster)),
    ).not.toThrow();
  });

  it("can draw reciprocal pairs rather than forcing a single cycle", () => {
    const values = [2, 2, 0];
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint32Array) => {
        array[0] = values.shift()!;
        return array;
      },
    });
    const result = makeAssignments(members(4));
    expect(result.map((assignment) => assignment.recipientUid)).toEqual([
      "account-1",
      "account-0",
      "account-3",
      "account-2",
    ]);
  });

  it("rejects the modulo-biased uint32 tail before selecting a shuffle index", () => {
    const values = [0xffff_ffff, 0, 0];
    const random = vi.fn((array: Uint32Array) => {
      array[0] = values.shift()!;
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues: random });
    expect(
      makeAssignments(members(3)).map((assignment) => assignment.recipientUid),
    ).toEqual(["account-1", "account-2", "account-0"]);
    expect(random).toHaveBeenCalledTimes(3);
  });

  it("fails closed if cryptographic randomness is unavailable or broken", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => makeAssignments(members(3))).toThrow("Secure randomness");
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint32Array) => {
        array[0] = 0xffff_ffff;
        return array;
      },
    });
    expect(() => makeAssignments(members(3))).toThrow("Secure randomness");
  });

  it.each([0, 1, 2])("refuses a draw with %i participants", (size) => {
    expect(() => makeAssignments(members(size))).toThrow("At least three");
  });

  it("rejects repeated accounts and blank names", () => {
    const roster = members(3);
    expect(() => makeAssignments([roster[0], roster[0], roster[2]])).toThrow(
      "same account",
    );
    expect(() =>
      makeAssignments([{ ...roster[0], name: "  " }, ...roster.slice(1)]),
    ).toThrow("Each participant needs a name");
  });

  it("rejects missing, duplicate, foreign, self, and mismatched-name assignments", () => {
    const roster = members(4);
    const result = makeAssignments(roster);
    expect(() => validateAssignments(roster, result.slice(1))).toThrow(
      "incomplete",
    );
    const duplicate = structuredClone(result);
    duplicate[1] = duplicate[0];
    expect(() => validateAssignments(roster, duplicate)).toThrow(
      "exactly once",
    );
    const foreign = structuredClone(result);
    foreign[0].recipientUid = "another-event-account";
    expect(() => validateAssignments(roster, foreign)).toThrow(
      "outside this event",
    );
    const self = structuredClone(result);
    self[0].recipientUid = self[0].giverUid;
    expect(() => validateAssignments(roster, self)).toThrow("themselves");
    const renamed = structuredClone(result);
    renamed[0].recipientName = "Different person";
    expect(() => validateAssignments(roster, renamed)).toThrow(
      "does not match",
    );
    expect(() =>
      validateAssignments(roster, [
        null,
        ...result.slice(1),
      ] as unknown as Assignment[]),
    ).toThrow("outside this event");
  });
});
