import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

export function navigate(path: string) {
  location.hash = path;
}
export function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => {
      setRoute(location.hash.slice(1) || "/");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}
export function friendlyError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    "auth/invalid-credential":
      "That email and password combination was not recognised.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/email-already-in-use":
      "There’s already an account with that email. Sign in or reset your password.",
    "auth/weak-password":
      "Please choose a stronger password with at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/network-request-failed":
      "We couldn’t connect. Check your internet connection and try again.",
    "auth/operation-not-allowed":
      "Sign-in is not available yet. Please contact the organiser.",
    "permission-denied":
      "This action is not available. Registration may have closed, or you may need to verify your email. Refresh and try again.",
    unavailable:
      "We couldn’t connect. Check your internet connection and try again.",
    "resource-exhausted": "The service is busy. Please try again later.",
  };
  return (
    (code && messages[code]) ||
    (error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.")
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const run = async (work: () => Promise<unknown>, message = "") => {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      await work();
      setSuccess(message);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, success, run, setError, setSuccess };
}
export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="notice success" role="status">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      )}
    </>
  );
}
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" size={24} />
      <span>{text}</span>
    </div>
  );
}
