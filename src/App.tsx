import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { Snowflake, LogOut, ArrowUpRight } from "lucide-react";
import { auth, emulatorMode } from "./lib/firebase";
import { getIsAdmin, getMyMemberships, subscribeEvents } from "./lib/api";
import { SiteContext } from "./context";
import { friendlyError, useRoute, Loading } from "./lib/ui";
import type { Member, SantaEvent } from "./types";
import Snow from "./components/Snow";
import FestiveDecor from "./components/FestiveDecor";
import Home from "./pages/Home";
import EventPage from "./pages/EventPage";
const AuthPage = lazy(() => import("./pages/AuthPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));

function decodeEventId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export default function App() {
  const route = useRoute();
  const [identity, setIdentity] = useState<{
    user: User | null;
    isAdmin: boolean;
    authReady: boolean;
    generation: number;
  }>({ user: null, isAdmin: false, authReady: false, generation: 0 });
  const [events, setEvents] = useState<SantaEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [memberships, setMemberships] = useState<Record<string, Member>>({});
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const identitySequence = useRef(0);
  const membershipSequence = useRef(0);
  const [snow, setSnow] = useState(() => {
    try {
      return localStorage.getItem("santa-snow") !== "off";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      const sequence = ++identitySequence.current;
      // Unmount private views before awaiting a role, including on token refresh.
      ++membershipSequence.current;
      setIdentity({
        user: null,
        isAdmin: false,
        authReady: false,
        generation: sequence,
      });
      setMemberships({});
      setMembershipsLoading(false);
      setAccountError("");
      let isAdmin = false;
      if (user) {
        try {
          isAdmin = await getIsAdmin(user.uid);
        } catch {
          /* Failure to resolve a role never grants organiser access. */
        }
      }
      if (
        sequence === identitySequence.current &&
        (auth.currentUser?.uid ?? null) === (user?.uid ?? null)
      ) {
        setIdentity({ user, isAdmin, authReady: true, generation: sequence });
      }
    });
    return () => {
      ++identitySequence.current;
      ++membershipSequence.current;
      unsubscribe();
    };
  }, []);
  useEffect(
    () =>
      subscribeEvents(
        (items) => {
          setEvents(items);
          setEventsLoading(false);
          setEventsError("");
        },
        (error) => {
          setEventsError(friendlyError(error));
          setEventsLoading(false);
        },
      ),
    [],
  );
  const reloadMemberships = useCallback(async () => {
    const user = identity.user;
    // A previous account's completed mutation must not clear or cancel the next
    // account's membership request through an old reload callback.
    if (
      !identity.authReady ||
      (auth.currentUser?.uid ?? null) !== (user?.uid ?? null)
    )
      return;
    const sequence = ++membershipSequence.current;
    const identityGeneration = identitySequence.current;
    if (!user?.emailVerified) {
      setMemberships({});
      setMembershipsLoading(false);
      return;
    }
    const isCurrent = () =>
      sequence === membershipSequence.current &&
      identityGeneration === identitySequence.current &&
      auth.currentUser?.uid === user.uid;
    setMembershipsLoading(true);
    try {
      const items = await getMyMemberships(
        user.uid,
        events.map((event) => event.id),
      );
      if (isCurrent()) {
        setMemberships(items);
        setAccountError("");
      }
    } catch (e) {
      if (isCurrent()) setAccountError(friendlyError(e));
    } finally {
      if (isCurrent()) setMembershipsLoading(false);
    }
  }, [identity, events]);
  useEffect(() => {
    void reloadMemberships();
  }, [reloadMemberships]);
  const refreshIdentity = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await user.reload();
      if (auth.currentUser !== user) return;
      // onIdTokenChanged is the single guarded writer of account and role state.
      await user.getIdToken(true);
    } catch (error) {
      if (auth.currentUser === user) throw error;
    }
  };
  const signOutAccount = async () => {
    const sequence = identitySequence.current;
    const user = auth.currentUser;
    setAccountError("");
    try {
      await signOut(auth);
    } catch (error) {
      if (sequence === identitySequence.current && auth.currentUser === user) {
        setAccountError(friendlyError(error));
      }
    }
  };
  const toggleSnow = () => {
    setSnow((value) => {
      try {
        localStorage.setItem("santa-snow", value ? "off" : "on");
      } catch {
        /* Preference is optional. */
      }
      return !value;
    });
  };
  const page = route.split("?")[0];
  const context = {
    ...identity,
    events,
    eventsLoading,
    eventsError,
    memberships,
    membershipsLoading,
    reloadMemberships,
    refreshIdentity,
  };
  let content;
  if (page === "/" || page === "/my-events")
    content = <Home onlyMine={page === "/my-events"} />;
  else if (page === "/login") content = <AuthPage />;
  else if (page.startsWith("/events/"))
    content = (
      <EventPage
        key={`${page}:${identity.generation}:${identity.user?.uid || "guest"}`}
        id={decodeEventId(page.slice(8))}
      />
    );
  else if (page === "/admin" || page.startsWith("/admin/"))
    content = identity.authReady ? (
      <AdminPage
        key={`${page}:${identity.generation}:${identity.user?.uid || "guest"}`}
        id={page.slice(7)}
      />
    ) : (
      <Loading />
    );
  else
    content = (
      <div className="container empty-state">
        <h1>Page not found</h1>
        <a className="button primary" href="#/">
          View events
        </a>
      </div>
    );

  return (
    <SiteContext.Provider value={context}>
      <FestiveDecor />
      <Snow enabled={snow} />
      <div className="app-shell">
        <a
          className="skip-link"
          href="#main-content"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          Skip to content
        </a>
        {emulatorMode && (
          <div className="demo-banner">
            Local preview · test accounts and events only
          </div>
        )}
        <header className="site-header container">
          <a className="site-name" href="#/">
            Secret Santa
          </a>
          <nav className="nav-links" aria-label="Main navigation">
            <a className={`nav-link ${page === "/" ? "active" : ""}`} href="#/">
              Events
            </a>
            {identity.user && (
              <a
                className={`nav-link ${page === "/my-events" ? "active" : ""}`}
                href="#/my-events"
              >
                My events
              </a>
            )}
            {identity.isAdmin && (
              <a
                className={`nav-link ${page.startsWith("/admin") ? "active" : ""}`}
                href="#/admin"
              >
                Organiser
              </a>
            )}
          </nav>
          <div className="header-actions">
            <button
              className={`icon-button snow-toggle ${snow ? "active" : ""}`}
              onClick={toggleSnow}
              aria-label={snow ? "Turn snow off" : "Turn snow on"}
              aria-pressed={snow}
              title={snow ? "Turn snow off" : "Turn snow on"}
            >
              <Snowflake size={19} />
            </button>
            {identity.authReady &&
              (identity.user ? (
                <button
                  className="button ghost small"
                  onClick={() => void signOutAccount()}
                >
                  <LogOut size={16} />
                  <span>Sign out</span>
                </button>
              ) : (
                <a className="button primary small" href="#/login">
                  Sign in <ArrowUpRight size={16} />
                </a>
              ))}
          </div>
        </header>
        {accountError && (
          <div className="container">
            <div className="notice error" role="alert">
              {accountError}
              <button
                className="inline-link"
                onClick={() => void reloadMemberships()}
              >
                Try again
              </button>
            </div>
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>{content}</Suspense>
        </main>
      </div>
    </SiteContext.Provider>
  );
}
