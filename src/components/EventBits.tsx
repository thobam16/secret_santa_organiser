import { CalendarDays, Clock3, Gift, LockKeyhole } from "lucide-react";
import type { SantaEvent } from "../types";
import { countdown, formatDate, formatDay } from "../lib/dates";
import { useNow } from "../lib/ui";

export function StatusPill({
  event,
  joined = false,
}: {
  event: SantaEvent;
  joined?: boolean;
}) {
  const now = useNow();
  const status =
    event.status === "open" && now >= event.signupDeadline
      ? "locked"
      : event.status;
  const labels = {
    open: "Registration open",
    locked: "Registration closed",
    drawing: "Draw in progress",
    drawn: "Recipients ready",
    archived: "Archived",
  };
  return (
    <span className={`pill ${status}`}>
      <span className="status-dot" />
      {joined && status === "open" ? "Registered" : labels[status]}
    </span>
  );
}
export function Countdown({
  target,
  title,
  endedLabel,
  stopped = false,
  variant = "",
}: {
  target: number;
  title: string;
  endedLabel: string;
  stopped?: boolean;
  variant?: string;
}) {
  const now = useNow();
  const time = countdown(target, now);
  return (
    <div className={`countdown-card ${variant}`}>
      <div className="countdown-label">
        {variant === "exchange" ? <Gift size={17} /> : <Clock3 size={17} />}
        {title}
      </div>
      {time.ended || stopped ? (
        <p className="countdown-value ended">{endedLabel}</p>
      ) : (
        <div
          className="countdown-digits"
          aria-label={`${time.days} days, ${time.hours} hours and ${time.minutes} minutes`}
        >
          <span className="countdown-part">
            <strong>{String(time.days).padStart(2, "0")}</strong>
            <span>days</span>
          </span>
          <span className="countdown-separator" aria-hidden="true">
            :
          </span>
          <span className="countdown-part">
            <strong>{String(time.hours).padStart(2, "0")}</strong>
            <span>hours</span>
          </span>
          <span className="countdown-separator" aria-hidden="true">
            :
          </span>
          <span className="countdown-part">
            <strong>{String(time.minutes).padStart(2, "0")}</strong>
            <span>mins</span>
          </span>
        </div>
      )}
      <p className="countdown-date">
        <CalendarDays size={13} />
        {formatDate(target)}
      </p>
    </div>
  );
}
export function GiftGuide({ event }: { event: SantaEvent }) {
  return (
    <section className="panel gift-guide" aria-labelledby="gift-guide-heading">
      <div className="panel-heading">
        <h2 id="gift-guide-heading">Gift guide</h2>
        <span className="budget-badge">
          £{event.budget}
          <small>roughly</small>
        </span>
      </div>
      <p>
        <strong>Sign up by {formatDay(event.signupDeadline)}.</strong> Gift
        exchange will take place during the Christmas parties.
      </p>
      <div className="notice info">
        <LockKeyhole size={18} />
        <strong>Keep your recipient secret.</strong>
      </div>
      <div className="guide-grid">
        <div>
          <h3>Guidelines</h3>
          <ul className="guide-list">
            {event.guidelines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Gift ideas</h3>
          <div className="idea-tags">
            {event.giftIdeas.map((idea, index) => (
              <span className="idea-tag" key={index}>
                {idea}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
