import type { EventInput } from "../types";

export const EVENT_TIMEZONE = "Europe/London";

function validTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) && value > 0 && value <= 253_402_300_799_999
  );
}

export function requireTimestamp(value: number): void {
  if (!validTimestamp(value))
    throw new Error("Please enter a valid date and time.");
}

export function formatDate(timestampMs: number): string {
  requireTimestamp(timestampMs);
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hourCycle: "h23",
  }).format(timestampMs)} (UK)`;
}

export function formatDay(timestampMs: number): string {
  requireTimestamp(timestampMs);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(timestampMs);
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  ended: boolean;
}

export function countdown(targetMs: number, nowMs = Date.now()): Countdown {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) {
    throw new Error("The countdown requires valid dates.");
  }
  const remaining = targetMs - nowMs;
  if (remaining <= 0) return { days: 0, hours: 0, minutes: 0, ended: true };

  // Round up so the last seconds never say zero minutes while registration is open.
  const totalMinutes = Math.ceil(remaining / 60_000);
  return {
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
    ended: false,
  };
}

function validateList(
  value: string[],
  label: string,
  maximumItems: number,
  maximumLength: number,
): void {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${label} can contain up to ${maximumItems} items.`);
  }
  if (
    value.some(
      (item) =>
        typeof item !== "string" || !item.trim() || item.length > maximumLength,
    )
  ) {
    throw new Error(
      `Each item in ${label.toLowerCase()} must contain 1–${maximumLength} characters.`,
    );
  }
}

export function validateEventInput(input: EventInput): void {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100
  ) {
    throw new Error("Give this event a name of between 1 and 100 characters.");
  }
  if (input.timezone !== EVENT_TIMEZONE) {
    throw new Error("Event dates must use UK time (Europe/London).");
  }
  requireTimestamp(input.signupDeadline);
  requireTimestamp(input.exchangeAt);
  if (input.exchangeAt <= input.signupDeadline) {
    throw new Error("The gift exchange must be after the signup deadline.");
  }
  if (
    typeof input.budget !== "number" ||
    !Number.isFinite(input.budget) ||
    input.budget <= 0 ||
    input.budget > 100_000 ||
    Math.abs(input.budget * 100 - Math.round(input.budget * 100)) > 1e-7
  ) {
    throw new Error(
      "Enter a gift budget between £0.01 and £100,000, using at most two decimal places.",
    );
  }
  if (typeof input.details !== "string" || input.details.length > 2_000) {
    throw new Error(
      "Exchange details must be no longer than 2,000 characters.",
    );
  }
  validateList(input.guidelines, "Guidelines", 12, 500);
  validateList(input.giftIdeas, "Gift ideas", 20, 120);
}
