import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { createTemporaryServices, getEventServices } from "./firebase";
import PASSPHRASE_WORDS from "./data/passphrase-words.json";

const FESTIVE_WORDS = [
  "angel",
  "bauble",
  "bells",
  "berry",
  "blitzen",
  "bow",
  "candle",
  "candy",
  "carol",
  "cedar",
  "chestnut",
  "chimney",
  "cinnamon",
  "clove",
  "cocoa",
  "comet",
  "cookie",
  "cranberry",
  "dancer",
  "dasher",
  "december",
  "donner",
  "elf",
  "evergreen",
  "fairy",
  "feast",
  "fir",
  "frost",
  "garland",
  "ginger",
  "glitter",
  "gold",
  "holly",
  "icicle",
  "ivy",
  "jingle",
  "joy",
  "lantern",
  "merry",
  "mistletoe",
  "mitten",
  "noel",
  "nutmeg",
  "ornament",
  "parcel",
  "peppermint",
  "pine",
  "pudding",
  "ribbon",
  "robin",
  "rudolph",
  "santa",
  "scarf",
  "silver",
  "sleigh",
  "snow",
  "snowball",
  "snowflake",
  "sparkle",
  "star",
  "stocking",
  "tinsel",
  "winter",
  "wreath",
] as const;

function randomWord(words: readonly string[]): string {
  // Reject the incomplete range so every word is equally likely.
  const limit = Math.floor(0x100000000 / words.length) * words.length;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return words[value % words.length];
}

export function generateEventPassword(): string {
  if (!globalThis.crypto?.getRandomValues)
    throw new Error(
      "Secure passwords are unavailable. Open the site using HTTPS.",
    );
  // Keep a Christmas word first; the larger list gives the other two choices
  // more variety. Six-letter minimums also satisfy existing Auth/rule limits.
  return [
    randomWord(FESTIVE_WORDS),
    randomWord(PASSPHRASE_WORDS),
    randomWord(PASSPHRASE_WORDS),
  ].join("-");
}

export function normalizeEventPassword(password: string): string {
  return password
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-\u2010-\u2015\u2212]/g, "");
}

function canonicalPassword(password: string): string {
  const canonical = normalizeEventPassword(password);
  if (
    canonical.length < 12 ||
    canonical.length > 128 ||
    !/^[a-z0-9]+$/.test(canonical)
  )
    throw new Error("Enter the event password you were given.");
  return canonical;
}

export async function eventLoginEmail(
  eventId: string,
  password: string,
): Promise<string> {
  if (!eventId || eventId.includes("/") || eventId.includes("\0"))
    throw new Error("This event could not be found.");
  const canonical = canonicalPassword(password);
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Secure sign-in is unavailable. Open the site using HTTPS.",
    );
  const bytes = new TextEncoder().encode(`${eventId}\0${canonical}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const localPart = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${localPart}@event.santa.invalid`;
}

export async function createEventAccount(
  eventId: string,
  password: string,
): Promise<User> {
  const email = await eventLoginEmail(eventId, password);
  const result = await createUserWithEmailAndPassword(
    getEventServices(eventId).auth,
    email,
    canonicalPassword(password),
  );
  return result.user;
}

export async function signInEvent(
  eventId: string,
  password: string,
): Promise<User> {
  const email = await eventLoginEmail(eventId, password);
  const result = await signInWithEmailAndPassword(
    getEventServices(eventId).auth,
    email,
    canonicalPassword(password),
  );
  return result.user;
}

export function signOutEvent(eventId: string): Promise<void> {
  return signOut(getEventServices(eventId).auth);
}

export interface TemporaryEventAccount {
  uid: string;
  dispose: () => Promise<void>;
  discard: () => Promise<void>;
}

export async function createTemporaryEventAccount(
  eventId: string,
  password: string,
): Promise<TemporaryEventAccount> {
  const email = await eventLoginEmail(eventId, password);
  const services = createTemporaryServices();
  let user: User;
  try {
    user = (
      await createUserWithEmailAndPassword(
        services.auth,
        email,
        canonicalPassword(password),
      )
    ).user;
  } catch (error) {
    await services.dispose().catch(() => undefined);
    throw error;
  }

  let settled: "disposed" | "discarded" | undefined;
  let cleanup: Promise<void> | undefined;
  return {
    uid: user.uid,
    dispose() {
      // Once issued, this helper must never delete an account on a later retry.
      if (!settled) {
        settled = "disposed";
        cleanup = services.dispose();
      }
      return cleanup!;
    },
    discard() {
      if (!settled) {
        settled = "discarded";
        cleanup = (async () => {
          try {
            await deleteUser(user);
          } catch {
            // Cleanup cannot replace the error that prevented registration.
          } finally {
            await services.dispose();
          }
        })();
      }
      return cleanup!;
    },
  };
}
