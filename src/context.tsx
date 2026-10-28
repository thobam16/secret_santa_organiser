import { createContext, useContext } from "react";
import type { User } from "firebase/auth";
import type { SantaEvent, Member } from "./types";

export interface SiteContextValue {
  user: User | null;
  isAdmin: boolean;
  authReady: boolean;
  events: SantaEvent[];
  eventsLoading: boolean;
  eventsError: string;
  memberships: Record<string, Member>;
  membershipsLoading: boolean;
  reloadMemberships: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}
export const SiteContext = createContext<SiteContextValue | null>(null);
export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error("The page could not be loaded.");
  return value;
}
