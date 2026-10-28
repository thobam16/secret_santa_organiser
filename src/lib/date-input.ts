import { Temporal } from "@js-temporal/polyfill";
import { EVENT_TIMEZONE, requireTimestamp } from "./dates";

// Only organiser date inputs need Temporal. Public formatting/countdowns use Intl.
/** A datetime-local field always represents UK time, irrespective of the device timezone. */
export function toLondonInput(timestampMs: number): string {
  requireTimestamp(timestampMs);
  return Temporal.Instant.fromEpochMilliseconds(timestampMs)
    .toZonedDateTimeISO(EVENT_TIMEZONE)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute", roundingMode: "trunc" });
}

export function fromLondonInput(value: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  ) {
    throw new Error("Please enter a date and time, using UK time.");
  }
  let local: Temporal.PlainDateTime;
  try {
    local = Temporal.PlainDateTime.from(value, { overflow: "reject" });
  } catch {
    throw new Error("Please enter a valid date and time.");
  }

  let timestamp: number;
  try {
    timestamp = local.toZonedDateTime(EVENT_TIMEZONE, {
      disambiguation: "reject",
    }).epochMilliseconds;
  } catch {
    const earlier = local.toZonedDateTime(EVENT_TIMEZONE, {
      disambiguation: "earlier",
    });
    const repeated = earlier.toPlainDateTime().equals(local);
    throw new Error(
      repeated
        ? "This UK time occurs twice when the clocks go back. Please choose a different time."
        : "This UK time does not exist when the clocks go forward. Please choose a different time.",
    );
  }
  requireTimestamp(timestamp);
  return timestamp;
}
