import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { auth } from "../lib/firebase";
import { useSite } from "../context";
import { Feedback, Loading, navigate, useAction } from "../lib/ui";

export default function AuthPage() {
  const { user, authReady, refreshIdentity } = useSite();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const action = useAction();
  const search = new URLSearchParams(location.hash.split("?")[1] || "");
  const requestedNext = search.get("next");
  const next =
    requestedNext?.startsWith("/events/") ||
    requestedNext === "/my-events" ||
    requestedNext === "/admin"
      ? requestedNext
      : "/";
  const switchMode = (value: typeof mode) => {
    setMode(value);
    action.setError("");
    action.setSuccess("");
    setPassword("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(
      async () => {
        if (mode === "reset") {
          await sendPasswordResetEmail(auth, email.trim());
          return;
        }
        if (mode === "signup") {
          const credential = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          setPassword("");
          await sendEmailVerification(credential.user);
        } else {
          const credential = await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          setPassword("");
          if (credential.user.emailVerified) navigate(next);
        }
      },
      mode === "reset"
        ? "If an account exists for that email, a reset link has been sent. Check your inbox and spam folder."
        : mode === "signup"
          ? "Verification email sent. Check your inbox and spam folder."
          : "",
    );
  };
  return (
    <div className="container">
      <a className="back-link" href="#/">
        <ArrowLeft size={16} />
        Back to events
      </a>
      <div className="auth-layout">
        <section className="panel auth-card">
          {!authReady ? (
            <Loading />
          ) : user ? (
            <>
              <h1>{user.emailVerified ? "Signed in" : "Verify your email"}</h1>
              {!user.emailVerified && (
                <p>
                  Open the verification link in your email, then return here.
                </p>
              )}
              <p className="account-email">{user.email}</p>
              <Feedback error={action.error} success={action.success} />
              {user.emailVerified ? (
                <a className="button primary" href={`#${next}`}>
                  Continue <ArrowRight size={17} />
                </a>
              ) : (
                <div className="stack">
                  <button
                    className="button primary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await refreshIdentity();
                        if (!auth.currentUser?.emailVerified)
                          throw new Error(
                            "Your email hasn’t been verified yet. Open the link in your email, then check again.",
                          );
                      }, "Email verified.")
                    }
                  >
                    <CheckCircle2 size={17} />
                    {action.busy ? "Checking…" : "Check verification"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        () => sendEmailVerification(user),
                        "Verification email sent.",
                      )
                    }
                  >
                    Resend verification email
                  </button>
                  <p className="field-help">
                    Check your spam folder if the email hasn’t arrived.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <h1>
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Reset password"}
              </h1>
              {mode !== "reset" && (
                <div className="tabs" aria-label="Account options">
                  <button
                    className={`tab ${mode === "signin" ? "active" : ""}`}
                    onClick={() => switchMode("signin")}
                    disabled={action.busy}
                  >
                    Sign in
                  </button>
                  <button
                    className={`tab ${mode === "signup" ? "active" : ""}`}
                    onClick={() => switchMode("signup")}
                    disabled={action.busy}
                  >
                    Create account
                  </button>
                </div>
              )}
              <Feedback error={action.error} success={action.success} />
              <form onSubmit={submit}>
                <label className="field">
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={action.busy}
                  />
                </label>
                {mode !== "reset" && (
                  <label className="field">
                    Password
                    <div className="password-field">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          mode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        minLength={mode === "signup" ? 8 : undefined}
                        maxLength={128}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={action.busy}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>
                    {mode === "signup" && (
                      <span className="field-help">At least 8 characters.</span>
                    )}
                  </label>
                )}
                <button
                  className="button primary full-width"
                  disabled={action.busy}
                >
                  {action.busy
                    ? "Please wait…"
                    : mode === "signin"
                      ? "Sign in"
                      : mode === "signup"
                        ? "Create account"
                        : "Send reset link"}
                  <ArrowRight size={17} />
                </button>
              </form>
              {mode === "signin" ? (
                <button
                  className="inline-link auth-help"
                  onClick={() => switchMode("reset")}
                >
                  Forgot your password?
                </button>
              ) : mode === "reset" ? (
                <button
                  className="inline-link auth-help"
                  onClick={() => switchMode("signin")}
                >
                  Back to sign in
                </button>
              ) : (
                <p className="field-help auth-help">
                  Verify your email before joining an event.
                </p>
              )}
              <p className="privacy-note">
                Your email is used for your account. Your name is visible to the
                organiser and the person buying your gift.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
