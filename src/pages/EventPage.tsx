import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Settings2, Users } from "lucide-react";
import { useSite } from "../context";
import { getParticipantRecipient } from "../lib/api";
import { auth, getEventServices } from "../lib/firebase";
import { Feedback, Loading, useAction } from "../lib/ui";
import { Countdown, GiftGuide, StatusPill } from "../components/EventBits";
import EventRegistration from "../components/EventRegistration";
import type { Recipient } from "../types";

export default function EventPage({ id }: { id: string }) {
  const {
    events,
    eventsLoading,
    eventsError,
    user,
    authReady,
    isAdmin,
    memberships,
    participantSessions,
  } = useSite();
  const event = events.find((item) => item.id === id);
  const member = memberships[id];
  const session = participantSessions[id];
  const identity = `${session?.userUid || user?.uid || "guest"}:${session?.generation || 0}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const request = useRef(0);
  const [recipient, setRecipient] = useState<{
    identity: string;
    value: Recipient;
  } | null>(null);
  const action = useAction();
  useEffect(() => {
    const conceal = () => {
      if (document.hidden) {
        ++request.current;
        setRecipient(null);
      }
    };
    document.addEventListener("visibilitychange", conceal);
    return () => {
      ++request.current;
      document.removeEventListener("visibilitychange", conceal);
    };
  }, []);
  useEffect(() => {
    ++request.current;
    setRecipient(null);
  }, [identity, event?.activeRunId]);

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
  const drawn =
    ["drawn", "archived"].includes(event.status) && !!event.activeRunId;
  const assignment = recipient?.identity === identity ? recipient.value : null;

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
          {member && drawn && !session?.loading && (
            <section className="recipient-card">
              <h2>Your recipient</h2>
              <Feedback error={action.error} />
              {assignment ? (
                <>
                  <p className="recipient-name" data-testid="recipient-name">
                    {assignment.recipientName}
                  </p>
                  {assignment.preferences && (
                    <div className="gift-preferences recipient-preferences">
                      <h3>Gift preferences</h3>
                      <p
                        className="preserve-lines"
                        data-testid="recipient-preferences"
                      >
                        {assignment.preferences}
                      </p>
                    </div>
                  )}
                  <p>Keep your recipient secret.</p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      ++request.current;
                      setRecipient(null);
                    }}
                  >
                    <EyeOff size={17} />
                    Hide my recipient
                  </button>
                </>
              ) : (
                <button
                  className="button primary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const sequence = ++request.current;
                      const expected = identityRef.current;
                      const account =
                        getEventServices(id).auth.currentUser ||
                        auth.currentUser;
                      const result = await getParticipantRecipient(id);
                      if (
                        sequence !== request.current ||
                        expected !== identityRef.current ||
                        account !==
                          (getEventServices(id).auth.currentUser ||
                            auth.currentUser) ||
                        document.hidden
                      )
                        return;
                      if (!result)
                        throw new Error(
                          "Your recipient isn’t ready yet. Please try again shortly.",
                        );
                      setRecipient({ identity: expected, value: result });
                    })
                  }
                >
                  <Eye size={17} />
                  Reveal my recipient
                </button>
              )}
            </section>
          )}
          <EventRegistration event={event} />
        </aside>
      </div>
    </div>
  );
}
