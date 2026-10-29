import { useEffect, useRef, useState, type FormEvent } from "react";
import { signOut } from "firebase/auth";
import {
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import { useSite } from "../context";
import { auth, getEventServices } from "../lib/firebase";
import {
  getParticipantPassword,
  issueParticipantPassword,
  joinWithEventPassword,
  leaveParticipant,
  signInParticipant,
  signOutParticipant,
  updateParticipant,
  updateParticipantPreferences,
} from "../lib/api";
import { Feedback, Loading, useAction, useNow } from "../lib/ui";
import type { SantaEvent } from "../types";

export default function EventRegistration({ event }: { event: SantaEvent }) {
  const {
    user,
    memberships,
    membershipsLoading,
    reloadMemberships,
    participantSessions,
    reloadParticipant,
  } = useSite();
  const member = memberships[event.id];
  const session = participantSessions[event.id];
  const uid = session?.userUid || user?.uid || "guest";
  const identity = `${uid}:${session?.generation || 0}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const request = useRef(0);
  const concealEpoch = useRef(0);
  const mounted = useRef(true);
  const [mode, setMode] = useState<"join" | "signin">("join");
  const [name, setName] = useState(member?.name || "");
  const [preferences, setPreferences] = useState(member?.preferences || "");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [password, setPassword] = useState<{
    identity: string;
    value: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<{
    uid: string;
    memberUid: string;
    value: string;
  } | null>(null);
  const [legacyPassword, setLegacyPassword] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const action = useAction();
  const now = useNow();
  const open = event.status === "open" && now < event.signupDeadline;
  const drawn =
    ["drawn", "archived"].includes(event.status) && !!event.activeRunId;
  const loading =
    !session || session.loading || (!session.userUid && membershipsLoading);
  const signingIn = mode === "signin" || !open;
  const visiblePassword =
    receipt?.uid === uid && receipt.memberUid === member?.uid
      ? receipt.value
      : password?.identity === identity
        ? password.value
        : null;
  const legacyUrl = `#/login?next=${encodeURIComponent(`/events/${event.id}`)}`;

  useEffect(() => {
    setName(member?.name || "");
  }, [member?.name]);
  useEffect(() => {
    setPreferences(member?.preferences || "");
  }, [member?.preferences]);
  useEffect(() => {
    ++request.current;
    setPassword(null);
    setLegacyPassword(false);
    setReceipt((current) => (current?.uid === uid ? current : null));
  }, [identity, uid]);
  useEffect(() => {
    mounted.current = true;
    const conceal = () => {
      if (document.hidden) {
        ++concealEpoch.current;
        ++request.current;
        setPassword(null);
        setReceipt(null);
        setShowLoginPassword(false);
      }
    };
    document.addEventListener("visibilitychange", conceal);
    return () => {
      mounted.current = false;
      ++request.current;
      document.removeEventListener("visibilitychange", conceal);
    };
  }, []);

  const refresh = async () => {
    await Promise.all([reloadParticipant(event.id), reloadMemberships()]);
  };
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setLoginPassword("");
    setShowLoginPassword(false);
    action.setError("");
    action.setSuccess("");
  };
  const save = (form: FormEvent) => {
    form.preventDefault();
    void action.run(
      async () => {
        if (member) {
          if (open) await updateParticipant(event.id, name, preferences);
          else await updateParticipantPreferences(event.id, preferences);
          await refresh();
        } else if (signingIn) {
          await signInParticipant(event.id, loginPassword);
          setLoginPassword("");
          setShowLoginPassword(false);
          await refresh();
        } else {
          const expectedConcealEpoch = concealEpoch.current;
          const result = await joinWithEventPassword(
            event.id,
            name,
            preferences,
          );
          const joinedAccount = getEventServices(event.id).auth.currentUser;
          await refresh();
          if (
            mounted.current &&
            !document.hidden &&
            concealEpoch.current === expectedConcealEpoch &&
            joinedAccount?.uid === result.member.uid &&
            getEventServices(event.id).auth.currentUser === joinedAccount
          )
            setReceipt({
              uid: getEventServices(event.id).auth.currentUser?.uid || "",
              memberUid: result.member.uid,
              value: result.password,
            });
        }
      },
      member ? "Saved." : signingIn ? "" : "You’re registered.",
    );
  };
  const revealPassword = () =>
    void action.run(async () => {
      const sequence = ++request.current;
      const expected = identityRef.current;
      const account =
        getEventServices(event.id).auth.currentUser || auth.currentUser;
      const result = await getParticipantPassword(event.id);
      if (
        !mounted.current ||
        sequence !== request.current ||
        expected !== identityRef.current ||
        account !==
          (getEventServices(event.id).auth.currentUser || auth.currentUser) ||
        document.hidden
      )
        return;
      if (result) setPassword({ identity: expected, value: result });
      else setLegacyPassword(true);
    });

  return (
    <section className={`panel join-panel ${member ? "joined" : ""}`}>
      <h2>
        {member
          ? "You’re registered"
          : signingIn
            ? "Sign in to this event"
            : "Join event"}
      </h2>
      {member && <p>{member.name}</p>}
      <Feedback
        error={action.error || session?.error}
        success={action.success}
      />
      {loading ? (
        <Loading text="Checking registration…" />
      ) : member ? (
        <>
          <div className="event-password-card">
            <h3>Your password</h3>
            {visiblePassword ? (
              <>
                <p
                  className="event-password-value"
                  data-testid="event-password"
                >
                  {visiblePassword}
                </p>
                <p className="field-help">
                  Save this password to return to this event. The organiser can
                  look it up if you forget.
                </p>
                <div className="form-actions">
                  <button
                    className="button secondary small"
                    onClick={() =>
                      void action.run(async () => {
                        await navigator.clipboard.writeText(visiblePassword);
                      }, "Password copied.")
                    }
                  >
                    <Copy size={15} />
                    Copy password
                  </button>
                  <button
                    className="button ghost small"
                    onClick={() => {
                      ++request.current;
                      setPassword(null);
                      setReceipt(null);
                    }}
                  >
                    <EyeOff size={15} />
                    Hide password
                  </button>
                </div>
              </>
            ) : legacyPassword ? (
              <>
                <p className="field-help">
                  Create your password to use instead of email sign-in.
                </p>
                <button
                  className="button secondary small"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const sequence = ++request.current;
                      const expected = identityRef.current;
                      const result = await issueParticipantPassword(
                        event.id,
                        member.uid,
                      );
                      if (
                        mounted.current &&
                        sequence === request.current &&
                        expected === identityRef.current &&
                        !document.hidden
                      ) {
                        setPassword({ identity: expected, value: result });
                        setLegacyPassword(false);
                      }
                    })
                  }
                >
                  Create my password
                </button>
              </>
            ) : (
              <button
                className="button secondary small"
                disabled={action.busy}
                onClick={revealPassword}
              >
                <Eye size={15} />
                Show my password
              </button>
            )}
          </div>
          {event.status !== "archived" ? (
            <form onSubmit={save}>
              {open && (
                <label className="field">
                  Your name
                  <input
                    autoComplete="name"
                    maxLength={100}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={action.busy}
                  />
                </label>
              )}
              <PreferencesField
                value={preferences}
                onChange={setPreferences}
                disabled={action.busy}
              />
              <button
                className="button primary full-width"
                disabled={action.busy || (open && !name.trim())}
              >
                {action.busy
                  ? "Saving…"
                  : open
                    ? "Save changes"
                    : "Save preferences"}
              </button>
            </form>
          ) : member.preferences ? (
            <div className="gift-preferences">
              <h3>Gift preferences</h3>
              <p className="preserve-lines">{member.preferences}</p>
            </div>
          ) : null}
          {!open && !drawn && event.status !== "archived" && (
            <div className="notice info">
              <LockKeyhole size={17} />
              <span>
                {event.status === "drawing"
                  ? "The draw is in progress."
                  : "Waiting for the organiser to make the draw."}
              </span>
            </div>
          )}
          <div className="event-session-actions">
            <button
              className="button ghost small"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  ++request.current;
                  setPassword(null);
                  setReceipt(null);
                  setLoginPassword("");
                  if (!(await signOutParticipant(event.id)))
                    await signOut(auth);
                  setMode("signin");
                  await refresh();
                })
              }
            >
              <LogOut size={15} />
              {session?.userUid
                ? "Sign out of event"
                : "Sign out of email account"}
            </button>
            {open && !leaving && (
              <button className="inline-link" onClick={() => setLeaving(true)}>
                Leave event
              </button>
            )}
          </div>
          {open && leaving && (
            <div className="confirmation">
              <p>
                Leave this event? You can join again before registration closes.
              </p>
              <div className="form-actions">
                <button
                  className="button danger small"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      ++request.current;
                      setPassword(null);
                      setReceipt(null);
                      await leaveParticipant(event.id);
                      await refresh();
                      setLeaving(false);
                      setMode("join");
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
          )}
        </>
      ) : (
        <>
          {open && (
            <div className="tabs" aria-label="Event access">
              <button
                className={`tab ${!signingIn ? "active" : ""}`}
                disabled={action.busy}
                onClick={() => changeMode("join")}
              >
                Join event
              </button>
              <button
                className={`tab ${signingIn ? "active" : ""}`}
                disabled={action.busy}
                onClick={() => changeMode("signin")}
              >
                Sign in
              </button>
            </div>
          )}
          {!open && (
            <p className="field-help">
              Registration is closed. Enter your password to return.
            </p>
          )}
          <form onSubmit={save}>
            {signingIn ? (
              <label className="field">
                Your password
                <div className="password-field">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={128}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    disabled={action.busy}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowLoginPassword((value) => !value)}
                    aria-label={
                      showLoginPassword
                        ? "Hide entered password"
                        : "Show entered password"
                    }
                  >
                    {showLoginPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </label>
            ) : (
              <>
                <label className="field">
                  Your name
                  <input
                    autoComplete="name"
                    maxLength={100}
                    required
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={action.busy}
                  />
                </label>
                <PreferencesField
                  value={preferences}
                  onChange={setPreferences}
                  disabled={action.busy}
                />
                <p className="field-help">
                  You’ll receive your own Christmas password.
                </p>
              </>
            )}
            <button
              className="button primary full-width"
              disabled={
                action.busy ||
                (signingIn ? !loginPassword.trim() : !name.trim())
              }
            >
              {action.busy
                ? "Please wait…"
                : signingIn
                  ? "Sign in"
                  : "Join event"}
              <ArrowRight size={17} />
            </button>
          </form>
          {signingIn && (
            <p className="field-help auth-help">
              Forgot your password? Ask the organiser.
            </p>
          )}
          <a className="inline-link auth-help" href={legacyUrl}>
            Previously joined with email? Sign in here
          </a>
        </>
      )}
    </section>
  );
}

function PreferencesField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="field">
        Gift preferences (optional)
        <textarea
          rows={3}
          maxLength={500}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Interests, favourite treats, or things to avoid."
          aria-describedby="preferences-help"
        />
      </label>
      <p className="field-help" id="preferences-help">
        Visible to your gift giver and the organiser.
      </p>
    </>
  );
}
