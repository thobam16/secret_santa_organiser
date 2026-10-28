import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

// Firebase web configuration is public. Authentication and Security Rules grant access.
export const emulatorMode =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";
const app = initializeApp({
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
});

export const auth = getAuth(app);
export const db = getFirestore(app);

if (emulatorMode) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
