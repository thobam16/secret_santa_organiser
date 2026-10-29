import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Gift,
  LockKeyhole,
  MapPin,
  Plus,
  Settings2,
  Shuffle,
  Trash2,
  Users,
} from "lucide-react";
import { useSite } from "../context";
import {
  archiveEvent,
  getAssignment,
  getMemberPassword,
  getMembers,
  issueParticipantPassword,
  leaveEvent,
  runDraw,
  saveEvent,
  setRegistration,
} from "../lib/api";
import { validateEventInput } from "../lib/dates";
import { fromLondonInput, toLondonInput } from "../lib/date-input";
import {
  Feedback,
  Loading,
  friendlyError,
  navigate,
  useAction,
} from "../lib/ui";
import { StatusPill, Countdown } from "../components/EventBits";
import {
  DEFAULT_GIFT_IDEAS,
  DEFAULT_GUIDELINES,
  type SantaEvent,
  type Member,
  type EventInput,
} from "../types";

function EventForm({
  event,
  onSaved,
}: {
  event?: SantaEvent;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(event?.name || "");
  const [signup, setSignup] = useState(
    event ? toLondonInput(event.signupDeadline) : "",
  );
  const [exchange, setExchange] = useState(
    event ? toLondonInput(event.exchangeAt) : "",
  );
  const [budget, setBudget] = useState(String(event?.budget ?? 10));
  const [details, setDetails] = useState(
    event?.details ??
      "Gift exchange will take place during the Christmas party.",
  );
  const [guidelines, setGuidelines] = useState(
    (event?.guidelines || DEFAULT_GUIDELINES).join("\n"),
  );
  const [ideas, setIdeas] = useState(
    (event?.giftIdeas || DEFAULT_GIFT_IDEAS).join("\n"),
  );
  const action = useAction();
  const signupLocked =
    !!event && ["drawing", "drawn", "archived"].includes(event.status);
  const submit = (form: FormEvent) => {
    form.preventDefault();
    void action.run(
      async () => {
        const input: EventInput = {
          name: name.trim(),
          signupDeadline: fromLondonInput(signup),
          exchangeAt: fromLondonInput(exchange),
          timezone: "Europe/London",
          budget: Number(budget),
          details: details.trim(),
          guidelines: guidelines
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          giftIdeas: ideas
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        };
        validateEventInput(input);
        if (!event && input.signupDeadline <= Date.now())
          throw new Error("Choose a future signup deadline.");
        const id = await saveEvent(input, event?.id);
        onSaved(id);
      },
      event ? "Event details saved." : "Event created.",
    );
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Event details</h2>
        </div>
        <Settings2 size={23} strokeWidth={1.5} />
      </div>
      <Feedback error={action.error} success={action.success} />
      <form onSubmit={submit}>
        <fieldset disabled={action.busy}>
          <label className="field">
            Location / event name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Manchester Christmas 2026"
            />
          </label>
          <div className="field-row">
            <label className="field">
              Signup deadline
              <input
                type="datetime-local"
                required
                value={signup}
                onChange={(e) => setSignup(e.target.value)}
                disabled={signupLocked}
              />
              <span className="field-help">
                UK time · Europe/London
                {signupLocked && " · Fixed after the draw starts"}
              </span>
            </label>
            <label className="field">
              Gift exchange
              <input
                type="datetime-local"
                required
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
              />
              <span className="field-help">UK time · Europe/London</span>
            </label>
          </div>
          <p className="field-help">
            Registration closes at the exact signup time shown.
          </p>
          <label className="field budget-input">
            Gift budget (£, roughly)
            <input
              type="number"
              min="0.01"
              max="100000"
              step="0.01"
              required
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label className="field">
            Exchange details
            <textarea
              rows={3}
              maxLength={2000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Venue and exchange instructions"
            />
          </label>
          <details className="guide-editor">
            <summary>Gift guide</summary>
            <p className="field-help">
              One item per line. The signup date updates automatically.
            </p>
            <label className="field">
              Guidelines
              <textarea
                rows={5}
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
              />
            </label>
            <label className="field">
              Gift ideas
              <textarea
                rows={6}
                value={ideas}
                onChange={(e) => setIdeas(e.target.value)}
              />
            </label>
          </details>
          <div className="form-actions">
            <button className="button primary" disabled={action.busy}>
              {action.busy
                ? "Saving…"
                : event
                  ? "Save event details"
                  : "Create event"}
              <ArrowRight size={17} />
            </button>
            {!event && (
              <a className="button ghost" href="#/admin">
                Cancel
              </a>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function MemberPassword({
  eventId,
  member,
}: {
  eventId: string;
  member: Member;
}) {
  const [password, setPassword] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);

  const conceal = () => {
    requestGeneration.current += 1;
    setPassword(undefined);
    setBusy(false);
    setError("");
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) conceal();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      requestGeneration.current += 1;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const loadPassword = async (create = false) => {
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError("");
    try {
      const value = await (create
        ? issueParticipantPassword(eventId, member.uid)
        : getMemberPassword(eventId, member.uid));
      if (requestGeneration.current === generation && !document.hidden)
        setPassword(value);
    } catch (cause) {
      if (requestGeneration.current === generation && !document.hidden)
        setError(friendlyError(cause));
    } finally {
      if (requestGeneration.current === generation) setBusy(false);
    }
  };

  const expanded = password !== undefined || busy;
  return (
    <div className="participant-password" aria-busy={busy}>
      <div className="participant-password-control">
        {typeof password === "string" ? (
          <code
            className="event-password-value"
            data-testid={`password-${member.uid}`}
          >
            {password}
          </code>
        ) : password === null ? (
          <span className="field-help">No password yet.</span>
        ) : (
          <span className="masked" aria-label="Password hidden">
            ••••••••
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`${expanded ? "Hide" : "Reveal"} password for ${member.name}`}
          aria-expanded={expanded}
          onClick={() => {
            if (expanded) conceal();
            else void loadPassword();
          }}
        >
          {expanded ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {busy && (
        <span className="field-help" role="status">
          Loading…
        </span>
      )}
      {password === null && (
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          aria-label={`Create password for ${member.name}`}
          onClick={() => void loadPassword(true)}
        >
          Create password
        </button>
      )}
      {error && (
        <span className="password-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function ManageEvent({ event }: { event: SantaEvent }) {
  const { user } = useSite();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<"draw" | "archive" | string | null>(
    null,
  );
  const [progress, setProgress] = useState("");
  const [tab, setTab] = useState<"people" | "details">("people");
  const action = useAction();
  const reloadMembers = async () => {
    setLoading(true);
    setListError("");
    try {
      setMembers(await getMembers(event.id));
    } catch {
      setListError("Couldn’t load participants. Try again.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setListError("");
    getMembers(event.id)
      .then((items) => {
        if (live) setMembers(items);
      })
      .catch(() => {
        if (live) setListError("Couldn’t load participants. Try again.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [event.id, event.memberCount, event.status]);
  useEffect(() => {
    setRevealed({});
  }, [event.id, tab, event.activeRunId]);
  const drawn =
    ["drawn", "archived"].includes(event.status) && !!event.activeRunId;
  const draw = () =>
    void action.run(async () => {
      setConfirm(null);
      setRevealed({});
      await runDraw(event.id, setProgress);
      await reloadMembers();
    }, "Draw complete. Participants can now view their recipients.");
  return (
    <>
      <div className="page-heading admin-event-heading">
        <div className="page-heading-top">
          <StatusPill event={event} />
          <a className="button secondary small" href={`#/events/${event.id}`}>
            View event <ArrowUpRightIcon />
          </a>
        </div>
        <h1 className="page-title">{event.name}</h1>
      </div>
      <div className="countdown-grid">
        <Countdown
          target={event.signupDeadline}
          title="Signup closes"
          endedLabel="Registration closed"
          stopped={event.status !== "open"}
        />
        <Countdown
          target={event.exchangeAt}
          title="Gift exchange"
          endedLabel={
            event.status === "archived"
              ? "Event archived"
              : "Exchange time reached"
          }
          stopped={event.status === "archived"}
          variant="exchange"
        />
      </div>
      <div className="tabs">
        <button
          className={`tab ${tab === "people" ? "active" : ""}`}
          disabled={action.busy}
          onClick={() => {
            setRevealed({});
            setTab("people");
          }}
        >
          <Users size={16} />
          Participants & draw
        </button>
        <button
          className={`tab ${tab === "details" ? "active" : ""}`}
          disabled={action.busy}
          onClick={() => {
            setRevealed({});
            setTab("details");
          }}
        >
          <Settings2 size={16} />
          Event details
        </button>
      </div>
      <Feedback error={action.error} success={action.success} />
      {tab === "details" ? (
        <EventForm key={event.id} event={event} onSaved={() => {}} />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                Participants{" "}
                <span className="count-badge">{event.memberCount}</span>
              </h2>
            </div>
            <Gift size={26} strokeWidth={1.4} />
          </div>
          {drawn && (
            <div className="notice info">
              <LockKeyhole size={18} />
              <span>
                Recipients are hidden. Use an eye button to reveal a pairing.
              </span>
            </div>
          )}
          {loading ? (
            <Loading text="Loading participants…" />
          ) : listError ? (
            <div className="notice error" role="alert">
              {listError}
              <button
                className="inline-link"
                onClick={() => void reloadMembers()}
              >
                Try again
              </button>
            </div>
          ) : !members.length ? (
            <div className="empty-state compact">
              <Users size={29} />
              <h3>No participants yet</h3>
              <p>Share the event link to invite participants.</p>
              <button
                className="button secondary small"
                onClick={() =>
                  void action.run(
                    () =>
                      navigator.clipboard.writeText(
                        `${location.origin}${location.pathname}#/events/${event.id}`,
                      ),
                    "Event link copied.",
                  )
                }
              >
                Copy event link
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="participant-table with-passwords">
                <thead>
                  <tr>
                    <th scope="col">Participant</th>
                    <th scope="col">Password</th>
                    <th scope="col">{drawn ? "Gift recipient" : "Status"}</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.uid}>
                      <td>
                        <span className="participant-name">
                          <span className="avatar" aria-hidden="true">
                            {member.name.slice(0, 1).toUpperCase()}
                          </span>
                          {member.name}
                        </span>
                        <details
                          className="participant-preferences"
                          data-testid={`participant-preferences-${member.uid}`}
                        >
                          <summary
                            aria-label={`Gift preferences for ${member.name}`}
                          >
                            Gift preferences
                          </summary>
                          <p className="preserve-lines">
                            {member.preferences?.trim()
                              ? member.preferences
                              : "No preferences provided."}
                          </p>
                        </details>
                      </td>
                      <td>
                        <MemberPassword
                          key={`${event.id}:${user?.uid}:${member.uid}`}
                          eventId={event.id}
                          member={member}
                        />
                      </td>
                      <td>
                        {drawn ? (
                          revealed[member.uid] ? (
                            <span data-testid={`pairing-${member.uid}`}>
                              {revealed[member.uid]}
                            </span>
                          ) : (
                            <span
                              className="masked"
                              aria-label="Recipient hidden"
                            >
                              ••••••••
                            </span>
                          )
                        ) : (
                          <span className="member-status">
                            <CheckCircle2 size={14} />
                            Confirmed
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {drawn ? (
                            <button
                              className="icon-button"
                              disabled={action.busy}
                              aria-label={`${revealed[member.uid] ? "Hide" : "Reveal"} recipient for ${member.name}`}
                              onClick={() => {
                                if (revealed[member.uid])
                                  setRevealed((previous) => {
                                    const next = { ...previous };
                                    delete next[member.uid];
                                    return next;
                                  });
                                else
                                  void action.run(async () => {
                                    const assignment = await getAssignment(
                                      event.id,
                                      member.uid,
                                    );
                                    if (!assignment)
                                      throw new Error(
                                        "This recipient is not available yet.",
                                      );
                                    setRevealed((previous) => ({
                                      ...previous,
                                      [member.uid]: assignment.recipientName,
                                    }));
                                  });
                              }}
                            >
                              {revealed[member.uid] ? (
                                <EyeOff size={18} />
                              ) : (
                                <Eye size={18} />
                              )}
                            </button>
                          ) : (
                            event.status === "open" && (
                              <button
                                className="icon-button"
                                disabled={action.busy}
                                aria-label={`Remove ${member.name}`}
                                onClick={() =>
                                  setConfirm(`remove:${member.uid}`)
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {confirm?.startsWith("remove:") && (
            <div className="confirmation">
              <h3>Remove this participant?</h3>
              <p>
                {
                  members.find((member) => member.uid === confirm.slice(7))
                    ?.name
                }{" "}
                will no longer take part in this event.
              </p>
              <div className="form-actions">
                <button
                  className="button danger small"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await leaveEvent(event.id, confirm.slice(7));
                      setConfirm(null);
                      await reloadMembers();
                    }, "Participant removed.")
                  }
                >
                  Remove participant
                </button>
                <button
                  className="button secondary small"
                  disabled={action.busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="divider" />
          {["open", "locked"].includes(event.status) && (
            <>
              <div className="draw-heading">
                <h3>Draw recipients</h3>
                <p>
                  Close registration and review the list. At least three
                  participants are required.
                </p>
              </div>
              <div className="form-actions">
                {event.status === "open" ? (
                  <button
                    className="button secondary"
                    disabled={action.busy || loading}
                    onClick={() =>
                      void action.run(
                        () => setRegistration(event.id, false),
                        "Registration closed. Review the participants before drawing.",
                      )
                    }
                  >
                    <LockKeyhole size={16} />
                    Close registration
                  </button>
                ) : (
                  <>
                    <button
                      className="button primary"
                      disabled={
                        action.busy ||
                        loading ||
                        !!listError ||
                        members.length < 3
                      }
                      onClick={() => setConfirm("draw")}
                    >
                      <Shuffle size={17} />
                      Draw recipients
                    </button>
                    <button
                      className="button ghost small"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          () => setRegistration(event.id, true),
                          "Registration reopened.",
                        )
                      }
                    >
                      Reopen registration
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {confirm === "draw" && (
            <div className="confirmation">
              <h3>Draw for {members.length} participants?</h3>
              <p>
                Each participant gets one recipient. The participant list and
                pairings cannot change afterwards.
              </p>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={action.busy}
                  onClick={draw}
                >
                  Confirm & draw
                </button>
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {event.status === "drawing" && (
            <div className="confirmation">
              <h3>{action.busy ? "Drawing recipients…" : "Draw incomplete"}</h3>
              <p>
                {action.busy
                  ? progress
                  : "Resume to publish the saved pairings."}
              </p>
              {!action.busy && (
                <button className="button primary" onClick={draw}>
                  Resume saved draw <ArrowRight size={17} />
                </button>
              )}
            </div>
          )}
          {action.busy && progress && event.status !== "drawing" && (
            <p role="status" className="field-help">
              {progress}
            </p>
          )}
          {drawn && (
            <div className="notice success">
              <CheckCircle2 size={18} />
              <span>
                Participants can now sign in to view their recipients.
              </span>
            </div>
          )}
        </section>
      )}
      {event.status !== "archived" && event.status !== "drawing" && (
        <div className="archive-section">
          {confirm === "archive" ? (
            <div className="confirmation">
              <h3>Archive this event?</h3>
              <p>
                It will leave the active event list. Participants keep access
                through My events.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await archiveEvent(event.id);
                      setConfirm(null);
                    }, "Event archived.")
                  }
                >
                  Archive event
                </button>
                <button
                  className="button ghost"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="inline-link"
              onClick={() => setConfirm("archive")}
            >
              <Archive size={15} />
              Archive event
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ArrowUpRightIcon() {
  return <ArrowRight size={15} style={{ transform: "rotate(-45deg)" }} />;
}

export default function AdminPage({ id }: { id?: string }) {
  const { user, isAdmin, events, eventsLoading, eventsError } = useSite();
  if (!user)
    return (
      <div className="container empty-state">
        <LockKeyhole size={32} />
        <h1>Organiser access</h1>
        <p>Sign in with your organiser account.</p>
        <a className="button primary" href="#/login?next=%2Fadmin">
          Sign in <ArrowRight size={17} />
        </a>
      </div>
    );
  if (!isAdmin)
    return (
      <div className="container empty-state">
        <LockKeyhole size={32} />
        <h1>Organiser access</h1>
        <p>
          {user.emailVerified
            ? "This account does not have organiser access."
            : "Verify your email to continue."}
        </p>
        <a
          className="button secondary"
          href={user.emailVerified ? "#/" : "#/login"}
        >
          {user.emailVerified ? "View events" : "Verify my email"}
        </a>
      </div>
    );
  const current = events.find((event) => event.id === id);
  return (
    <div className="container">
      <a className="back-link" href="#/">
        <ArrowLeft size={16} />
        All events
      </a>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <h2>Events</h2>
          <a className="button primary full-width" href="#/admin/new">
            <Plus size={17} />
            Create event
          </a>
          <nav aria-label="Managed events">
            {events.map((event) => (
              <a
                key={event.id}
                className={`admin-event-link ${id === event.id ? "active" : ""}`}
                href={`#/admin/${event.id}`}
              >
                <MapPin size={17} />
                <span>
                  {event.name}
                  <small>
                    {event.status === "archived"
                      ? "Archived"
                      : `${event.memberCount} participants`}
                  </small>
                </span>
                <ChevronRight size={16} />
              </a>
            ))}
          </nav>
        </aside>
        <div className="admin-main">
          {eventsLoading ? (
            <Loading />
          ) : eventsError ? (
            <Feedback error={eventsError} />
          ) : id === "new" ? (
            <>
              <div className="page-heading">
                <h1 className="page-title">Create event</h1>
              </div>
              <EventForm onSaved={(savedId) => navigate(`/admin/${savedId}`)} />
            </>
          ) : current ? (
            <ManageEvent key={current.id} event={current} />
          ) : (
            <>
              <div className="page-heading">
                <h1 className="page-title">Organiser</h1>
              </div>
              <div className="stats-row">
                <div className="stat">
                  <span>Active events</span>
                  <strong>
                    {
                      events.filter((event) => event.status !== "archived")
                        .length
                    }
                  </strong>
                </div>
                <div className="stat">
                  <span>Total signups</span>
                  <strong>
                    {events
                      .filter((event) => event.status !== "archived")
                      .reduce((total, event) => total + event.memberCount, 0)}
                  </strong>
                </div>
              </div>
              <section className="panel empty-state">
                <Gift size={42} strokeWidth={1.3} />
                <h2>{events.length ? "Select an event" : "No events yet"}</h2>
                <p>
                  {events.length
                    ? "Manage participants, dates and the draw."
                    : "Create an event to open registration."}
                </p>
                <a
                  className="button primary"
                  href={
                    events.length ? `#/admin/${events[0].id}` : "#/admin/new"
                  }
                >
                  {events.length ? "Manage event" : "Create event"}
                  <ArrowRight size={17} />
                </a>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
