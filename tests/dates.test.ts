import { describe, expect, it } from "vitest";
import {
  countdown,
  formatDate,
  formatDay,
  validateEventInput,
} from "../src/lib/dates";
import { fromLondonInput, toLondonInput } from "../src/lib/date-input";
import {
  DEFAULT_GIFT_IDEAS,
  DEFAULT_GUIDELINES,
  type EventInput,
} from "../src/types";

const event = (): EventInput => ({
  name: "Christmas in Manchester",
  signupDeadline: Date.parse("2026-11-13T23:59:00Z"),
  exchangeAt: Date.parse("2026-12-11T17:00:00Z"),
  timezone: "Europe/London",
  budget: 10,
  details: "Gift exchange will take place during the Christmas parties.",
  guidelines: [...DEFAULT_GUIDELINES],
  giftIdeas: [...DEFAULT_GIFT_IDEAS],
});

describe("UK event times", () => {
  it("interprets winter date inputs as GMT, regardless of host timezone", () => {
    expect(fromLondonInput("2026-11-13T23:59")).toBe(
      Date.parse("2026-11-13T23:59:00Z"),
    );
    expect(toLondonInput(Date.parse("2026-11-13T23:59:00Z"))).toBe(
      "2026-11-13T23:59",
    );
  });

  it("interprets summer date inputs as BST", () => {
    expect(fromLondonInput("2026-07-10T17:30")).toBe(
      Date.parse("2026-07-10T16:30:00Z"),
    );
    expect(toLondonInput(Date.parse("2026-07-10T16:30:00Z"))).toBe(
      "2026-07-10T17:30",
    );
  });

  it("rejects the skipped hour when UK clocks go forward", () => {
    expect(() => fromLondonInput("2026-03-29T01:30")).toThrow("does not exist");
    expect(fromLondonInput("2026-03-29T02:30")).toBe(
      Date.parse("2026-03-29T01:30:00Z"),
    );
  });

  it("rejects the ambiguous hour when UK clocks go back", () => {
    expect(() => fromLondonInput("2026-10-25T01:30")).toThrow("occurs twice");
    expect(fromLondonInput("2026-10-25T02:30")).toBe(
      Date.parse("2026-10-25T02:30:00Z"),
    );
  });

  it.each([
    "",
    "2026-02-30T12:00",
    "2026-11-13",
    "2026-11-13T24:00",
    "2026-11-13T12:00Z",
  ])("rejects malformed or impossible input %s", (value) => {
    expect(() => fromLondonInput(value)).toThrow();
  });

  it("formats both the local time and UK label", () => {
    expect(formatDate(Date.parse("2026-07-10T16:30:00Z"))).toContain("17:30");
    expect(formatDate(Date.parse("2026-07-10T16:30:00Z"))).toContain("BST");
    expect(formatDate(Date.parse("2026-11-13T23:59:00Z"))).toContain("GMT");
    expect(formatDate(Date.parse("2026-11-13T23:59:00Z"))).toContain("(UK)");
    expect(formatDay(Date.parse("2026-11-13T23:59:00Z"))).toBe(
      "Friday, 13 November 2026",
    );
  });
});

describe("countdowns", () => {
  it("splits remaining minutes into days, hours, and minutes", () => {
    expect(countdown((2 * 1_440 + 3 * 60 + 4) * 60_000, 0)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      ended: false,
    });
  });

  it("keeps the final partial minute open until the exact cutoff", () => {
    expect(countdown(60_000, 59_999)).toEqual({
      days: 0,
      hours: 0,
      minutes: 1,
      ended: false,
    });
    expect(countdown(60_000, 60_000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      ended: true,
    });
  });

  it("never displays negative countdowns", () => {
    expect(countdown(1, 1_000_000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      ended: true,
    });
    expect(() => countdown(NaN)).toThrow("valid dates");
  });
});

describe("event settings", () => {
  it("accepts valid settings with the supplied guide and optional empty lists", () => {
    expect(() => validateEventInput(event())).not.toThrow();
    expect(() =>
      validateEventInput({ ...event(), guidelines: [], giftIdeas: [] }),
    ).not.toThrow();
    expect(() =>
      validateEventInput({ ...event(), budget: 9.99 }),
    ).not.toThrow();
  });

  it("requires the gift exchange to follow registration", () => {
    expect(() =>
      validateEventInput({ ...event(), exchangeAt: event().signupDeadline }),
    ).toThrow("after the signup deadline");
    expect(() =>
      validateEventInput({
        ...event(),
        exchangeAt: event().signupDeadline - 1,
      }),
    ).toThrow("after the signup deadline");
  });

  it.each([0, -1, Infinity, NaN, 1.001, 100_001])(
    "rejects an invalid gift budget %s",
    (budget) => {
      expect(() => validateEventInput({ ...event(), budget })).toThrow(
        "gift budget",
      );
    },
  );

  it("validates names, details, timestamps, list content, and timezone", () => {
    expect(() => validateEventInput({ ...event(), name: " " })).toThrow("name");
    expect(() =>
      validateEventInput({ ...event(), details: "x".repeat(2_001) }),
    ).toThrow("2,000");
    expect(() =>
      validateEventInput({ ...event(), signupDeadline: NaN }),
    ).toThrow("date");
    expect(() => validateEventInput({ ...event(), guidelines: [""] })).toThrow(
      "Each item",
    );
    expect(() =>
      validateEventInput({ ...event(), giftIdeas: Array(21).fill("Book") }),
    ).toThrow("20 items");
    expect(() =>
      validateEventInput({ ...event(), timezone: "UTC" as "Europe/London" }),
    ).toThrow("UK time");
  });
});
