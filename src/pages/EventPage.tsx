import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Settings2,
  Users,
} from "lucide-react";
import { useSite } from "../context";
import { getAssignment, joinEvent, leaveEvent } from "../lib/api";
import { Feedback, Loading, useAction, useNow } from "../lib/ui";
import { Countdown, GiftGuide, StatusPill } from "../components/EventBits";
import type { Assignment } from "../types";

export default function EventPage({ id }: { id: string }) {
  const {
    events,
    eventsLoading,
    eventsError,
    user,
    authReady,
    isAdmin,
    memberships,
    membershipsLoading,
    reloadMemberships,
  } = useSite();
  const event = events.find((item) => item.id === id);
  const member = memberships[id];
  const [name, setName] = useState(member?.name || user?.displayName || "");
  const [leaving, setLeaving] = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const action = useAction();
  const now = useNow();
  useEffect(() => {
    if (member) setName(member.name);
  }, [member?.name]);
  useEffect(() => {
    setAssignment(null);
  }, [event?.activeRunId, user?.uid]);
  if (eventsLoading || !authReady) return <Loading text="Loading event…" />;
  if (!event)
    return (
      <div className="container empty-state">
        <h1>
          {eventsError
            ? "We couldn’t load this event."
            : "This event couldn’t be found."}
        </h1>
        <p>{eventsError || "It may no longer be available."}</p>
        <a className="button secondary" href="#/">
          Back to events
        </a>
      </div>
    );
  const open = event.status === "open" && now < event.signupDeadline;
  const drawn =
    ["drawn", "archived"].includes(event.status) && !!event.activeRunId;
  const loginUrl = `#/login?next=${encodeURIComponent(`/events/${id}`)}`;
  const submit = (form: FormEvent) => {
    form.preventDefault();
    void action.run(
      async () => {
        await joinEvent(id, name);
        await reloadMemberships();
      },
      member ? "Your name has been updated." : "You’re registered.",
    );
  };
  return (
    <div className="container event-page">
      <a className="back-link" href="#/">
        <ArrowLeft size={16} />
        All events
      </a>
      <div className="page-heading">
        <div className="page-heading-top">
          {isAdmin && (
            <a className="button secondary small" href={`#/admin/${id}`}>
              <Settings2 size={15} />
              Manage event
            </a>
          )}
        </div>
        <h1 className="page-title">{event.name}</h1>
        <div className="page-subtitle event-subtitle">
          <StatusPill event={event} joined={!!member} />
          <span>
            <Users size={16} />
            {event.memberCount}{" "}
            {event.memberCount === 1 ? "participant" : "participants"}
          </span>
        </div>
      </div>
      <div className="countdown-grid">
        <Countdown
          target={event.signupDeadline}
          title="Signup deadline"
          endedLabel="Registration closed"
          stopped={event.status !== "open"}
        />
        <Countdown
          target={event.exchangeAt}
          title="Gift exchange"
          endedLabel={
            event.status === "archived"
              ? "Event archived"
              : "Exchange date reached"
          }
          stopped={event.status === "archived"}
          variant="exchange"
        />
      </div>
      <div className="split-layout">
        <div className="stack">
          <section className="panel">
            <h2>Gift exchange</h2>
            <p className="preserve-lines">
              {event.details ||
                "Gift exchange will take place during the Christmas party."}
            </p>
          </section>
          <GiftGuide event={event} />
        </div>
        <aside className="stack">
          <section className={`panel join-panel ${member ? "joined" : ""}`}>
            <h2>
              {member
                ? "You’re registered"
                : open
                  ? "Join event"
                  : "Registration closed"}
            </h2>
            {member && <p>{member.name}</p>}
            <Feedback error={action.error} success={action.success} />
            {membershipsLoading ? (
              <Loading text="Checking registration…" />
            ) : !user ? (
              <a className="button primary full-width" href={loginUrl}>
                {open
                  ? "Sign in to join"
                  : drawn
                    ? "Sign in to reveal"
                    : "Sign in to view registration"}{" "}
                <ArrowRight size={17} />
              </a>
            ) : !user.emailVerified ? (
              <div className="verification-banner">
                <p>Verify your email to join this event.</p>
                <a className="button secondary" href={loginUrl}>
                  Verify my email
                </a>
              </div>
            ) : open ? (
              <form onSubmit={submit}>
                <label className="field">
                  Your name
                  <input
                    autoComplete="name"
                    maxLength={100}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={action.busy}
                    placeholder="Your full name"
                  />
                </label>
                <p className="field-help">
                  Use a name your gift-giver will recognise.
                </p>
                <button
                  className="button primary full-width"
                  disabled={action.busy || !name.trim()}
                >
                  {action.busy
                    ? "Saving…"
                    : member
                      ? "Save my name"
                      : "Join event"}
                  {!member && <ArrowRight size={17} />}
                </button>
              </form>
            ) : (
              member &&
              !drawn && (
                <div className="notice info">
                  <LockKeyhole size={17} />
                  <span>
                    {event.status === "drawing"
                      ? "The draw is in progress. Your recipient will appear here when it’s ready."
                      : "Waiting for the organiser to make the draw."}
                  </span>
                </div>
              )
            )}
            {member && open && (
              <div className="leave-event">
                {leaving ? (
                  <div className="confirmation">
                    <p>
                      Leave this event? You can join again before registration
                      closes.
                    </p>
                    <div className="form-actions">
                      <button
                        className="button danger small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            await leaveEvent(id, member.uid);
                            await reloadMemberships();
                            setLeaving(false);
                          }, "You’ve left this event.")
                        }
                      >
                        Yes, leave event
                      </button>
                      <button
                        className="button ghost small"
                        disabled={action.busy}
                        onClick={() => setLeaving(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="inline-link"
                    onClick={() => setLeaving(true)}
                  >
                    Leave event
                  </button>
                )}
              </div>
            )}
          </section>
          {member && drawn && (
            <section className="recipient-card">
              <h2>Your recipient</h2>
              {assignment ? (
                <>
                  <p className="recipient-name" data-testid="recipient-name">
                    {assignment.recipientName}
                  </p>
                  <p>Keep your recipient secret.</p>
                  <button
                    className="button secondary"
                    onClick={() => setAssignment(null)}
                  >
                    <EyeOff size={17} />
                    Hide my recipient
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button primary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const result = await getAssignment(id, member.uid);
                        if (!result)
                          throw new Error(
                            "Your recipient isn’t ready yet. Please try again shortly.",
                          );
                        setAssignment(result);
                      })
                    }
                  >
                    <Eye size={17} />
                    Reveal my recipient
                  </button>
                </>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
