import { useCallback, useEffect, useRef, useState } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { getEventServices } from "./firebase";
import { getParticipantMembership } from "./api";
import { friendlyError } from "./ui";
import type { Member } from "../types";

export interface ParticipantSession {
  userUid: string | null;
  member: Member | null;
  loading: boolean;
  error: string;
  generation: number;
}

export function useParticipants(eventIds: string[]) {
  const [sessions, setSessions] = useState<Record<string, ParticipantSession>>(
    {},
  );
  const sequences = useRef(new Map<string, number>());
  const active = useRef(new Set<string>());
  const eventKey = JSON.stringify([...eventIds].sort());

  const reloadParticipant = useCallback(async (eventId: string) => {
    if (!active.current.has(eventId)) return;
    const { auth } = getEventServices(eventId);
    const userUid = auth.currentUser?.uid ?? null;
    const generation = (sequences.current.get(eventId) || 0) + 1;
    sequences.current.set(eventId, generation);
    const pending: ParticipantSession = {
      userUid,
      member: null,
      loading: !!userUid,
      error: "",
      generation,
    };
    setSessions((current) => ({ ...current, [eventId]: pending }));
    if (!userUid) return;
    const current = () =>
      active.current.has(eventId) &&
      sequences.current.get(eventId) === generation &&
      auth.currentUser?.uid === userUid;
    try {
      const member = await getParticipantMembership(eventId);
      if (current())
        setSessions((previous) => ({
          ...previous,
          [eventId]: { ...pending, member, loading: false },
        }));
    } catch (error) {
      if (current())
        setSessions((previous) => ({
          ...previous,
          [eventId]: {
            ...pending,
            loading: false,
            error: friendlyError(error),
          },
        }));
    }
  }, []);

  useEffect(() => {
    const ids = JSON.parse(eventKey) as string[];
    active.current = new Set(ids);
    const unsubscribe = ids.map((eventId) =>
      onIdTokenChanged(getEventServices(eventId).auth, () => {
        void reloadParticipant(eventId);
      }),
    );
    return () => {
      active.current.clear();
      for (const eventId of ids) {
        sequences.current.set(
          eventId,
          (sequences.current.get(eventId) || 0) + 1,
        );
      }
      unsubscribe.forEach((stop) => stop());
    };
  }, [eventKey, reloadParticipant]);

  return { participantSessions: sessions, reloadParticipant };
}
