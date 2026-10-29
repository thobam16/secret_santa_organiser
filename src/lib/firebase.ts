import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

// Firebase web configuration is public. Authentication and Security Rules grant access.
export const emulatorMode =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";
const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyAdevrXnZ-rfHNxXHHh-R9_aDEKzqeU1mQ",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "secret-santa-organiser.firebaseapp.com",
  projectId: emulatorMode
    ? "demo-secret-santa"
    : import.meta.env.VITE_FIREBASE_PROJECT_ID || "secret-santa-organiser",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:851546467900:web:e81ee0bc4d6790bffa9d39",
};
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export interface EventServices {
  auth: Auth;
  db: Firestore;
}

function connectEmulators(services: EventServices) {
  if (!emulatorMode) return;
  const authPort = emulatorPort(import.meta.env.VITE_AUTH_EMULATOR_PORT, 9099);
  const firestorePort = emulatorPort(
    import.meta.env.VITE_FIRESTORE_EMULATOR_PORT,
    8080,
  );
  connectAuthEmulator(services.auth, `http://127.0.0.1:${authPort}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(services.db, "127.0.0.1", firestorePort);
}

function emulatorPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("The local emulator port is invalid.");
  return port;
}

connectEmulators({ auth, db });

const eventServices = new Map<string, EventServices>();

export function getEventServices(eventId: string): EventServices {
  if (!eventId || eventId.includes("/") || eventId.includes("\0"))
    throw new Error("This event could not be found.");
  const existing = eventServices.get(eventId);
  if (existing) return existing;

  // Firebase keys persisted sessions by app name, keeping each event separate.
  const eventApp = initializeApp(firebaseConfig, `event:${eventId}`);
  const services = { auth: getAuth(eventApp), db: getFirestore(eventApp) };
  connectEmulators(services);
  eventServices.set(eventId, services);
  return services;
}

export interface TemporaryServices extends EventServices {
  dispose: () => Promise<void>;
}

export function createTemporaryServices(): TemporaryServices {
  const temporaryApp = initializeApp(
    firebaseConfig,
    `temporary-event:${crypto.randomUUID()}`,
  );
  const services = {
    auth: initializeAuth(temporaryApp, { persistence: inMemoryPersistence }),
    db: getFirestore(temporaryApp),
  };
  connectEmulators(services);
  let disposing: Promise<void> | undefined;
  return {
    ...services,
    dispose() {
      disposing ??= (async () => {
        try {
          await signOut(services.auth);
        } finally {
          await deleteApp(temporaryApp);
        }
      })();
      return disposing;
    },
  };
}
