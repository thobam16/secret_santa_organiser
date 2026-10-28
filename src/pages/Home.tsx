import {
  ArrowRight,
  ArrowUpRight,
  MapPin,
  Users,
  CalendarDays,
  Plus,
} from "lucide-react";
import { useSite } from "../context";
import { Loading } from "../lib/ui";
import { formatDay } from "../lib/dates";
import { StatusPill } from "../components/EventBits";

export default function Home({ onlyMine }: { onlyMine: boolean }) {
  const {
    events,
    eventsLoading,
    eventsError,
    memberships,
    membershipsLoading,
    user,
    isAdmin,
  } = useSite();
  const shown = events.filter((event) =>
    onlyMine ? !!memberships[event.id] : event.status !== "archived",
  );
  return (
    <div className="container">
      <section id="events" className="section events-section">
        <div className="section-heading">
          <div>
            <h1 className="page-title">{onlyMine ? "My events" : "Events"}</h1>
            {!onlyMine && (
              <p className="page-subtitle">Choose an event to join.</p>
            )}
          </div>
          {isAdmin && (
            <a className="button primary small" href="#/admin/new">
              <Plus size={16} />
              Create event
            </a>
          )}
        </div>
        {eventsLoading || (onlyMine && membershipsLoading) ? (
          <Loading text="Loading events…" />
        ) : eventsError ? (
          <div className="empty-state error-state">
            <h2>Couldn’t load events</h2>
            <p>{eventsError}</p>
            <button
              className="button secondary"
              onClick={() => location.reload()}
            >
              Try again
            </button>
          </div>
        ) : onlyMine && !user ? (
          <div className="empty-state">
            <p>Sign in to view your events.</p>
            <a className="button primary" href="#/login">
              Sign in <ArrowRight size={16} />
            </a>
          </div>
        ) : !shown.length ? (
          <div className="empty-state">
            <p>
              {onlyMine
                ? "You haven’t joined any events."
                : "No events are available yet."}
            </p>
            {isAdmin ? (
              <a className="button primary" href="#/admin/new">
                <Plus size={17} />
                Create event
              </a>
            ) : (
              onlyMine && (
                <a className="button secondary" href="#/">
                  View events <ArrowRight size={17} />
                </a>
              )
            )}
          </div>
        ) : (
          <div className="event-grid">
            {shown.map((event, index) => (
              <a
                key={event.id}
                className={`event-card event-colour-${index % 3}`}
                href={`#/events/${event.id}`}
              >
                <div className="event-card-top">
                  <span className="event-card-icon">
                    <MapPin size={23} strokeWidth={1.5} />
                  </span>
                  <StatusPill event={event} joined={!!memberships[event.id]} />
                </div>
                <h2 className="event-name">{event.name}</h2>
                <p className="event-meta">
                  <CalendarDays size={15} />
                  Gift exchange · {formatDay(event.exchangeAt)}
                </p>
                <div className="event-card-footer">
                  <span>
                    <Users size={16} />
                    {event.memberCount}{" "}
                    {event.memberCount === 1 ? "participant" : "participants"}
                  </span>
                  <span className="event-card-arrow" aria-label="View event">
                    <ArrowUpRight size={21} />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
