import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PASSPHRASE_WORDS from "../src/lib/data/passphrase-words.json";

const sdk = vi.hoisted(() => {
  type App = { name: string; options: Record<string, unknown> };
  type User = { uid: string; auth: Auth };
  type Auth = { app: App; currentUser: User | null };
  const apps = new Map<string, App>();
  const auths = new Map<string, Auth>();
  const databases = new Map<string, { app: App }>();
  const getAuth = vi.fn((app: App) => {
    if (!auths.has(app.name)) auths.set(app.name, { app, currentUser: null });
    return auths.get(app.name)!;
  });
  return {
    apps,
    auths,
    databases,
    initializeApp: vi.fn((options: App["options"], name = "[DEFAULT]") => {
      if (!apps.has(name)) apps.set(name, { name, options });
      return apps.get(name)!;
    }),
    deleteApp: vi.fn(async (app: App) => {
      apps.delete(app.name);
    }),
    getAuth,
    initializeAuth: vi.fn((app: App, _options: unknown) => getAuth(app)),
    inMemoryPersistence: { type: "NONE" },
    connectAuthEmulator: vi.fn(),
    connectFirestoreEmulator: vi.fn(),
    getFirestore: vi.fn((app: App) => {
      if (!databases.has(app.name)) databases.set(app.name, { app });
      return databases.get(app.name)!;
    }),
    createUser: vi.fn(async (auth: Auth, email: string, _password: string) => {
      const user = { uid: `created:${email}`, auth };
      auth.currentUser = user;
      return { user };
    }),
    signIn: vi.fn(async (auth: Auth, email: string, _password: string) => {
      const user = { uid: `signed-in:${email}`, auth };
      auth.currentUser = user;
      return { user };
    }),
    signOut: vi.fn(async (auth: Auth) => {
      auth.currentUser = null;
    }),
    deleteUser: vi.fn(async (user: User) => {
      if (user.auth.currentUser === user) user.auth.currentUser = null;
    }),
  };
});

vi.mock("firebase/app", () => ({
  initializeApp: sdk.initializeApp,
  deleteApp: sdk.deleteApp,
}));
vi.mock("firebase/auth", () => ({
  getAuth: sdk.getAuth,
  initializeAuth: sdk.initializeAuth,
  inMemoryPersistence: sdk.inMemoryPersistence,
  connectAuthEmulator: sdk.connectAuthEmulator,
  createUserWithEmailAndPassword: sdk.createUser,
  signInWithEmailAndPassword: sdk.signIn,
  signOut: sdk.signOut,
  deleteUser: sdk.deleteUser,
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: sdk.getFirestore,
  connectFirestoreEmulator: sdk.connectFirestoreEmulator,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.apps.clear();
  sdk.auths.clear();
  sdk.databases.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_USE_EMULATORS", "false");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const examplePassword = "Merry-Snow-0a2b3c4d5e6";

describe("event password encoding", () => {
  it("generates three-word passwords with a festive first word and no numbers", async () => {
    const { generateEventPassword, normalizeEventPassword } =
      await import("../src/lib/event-auth");
    let value = 0;
    const random = vi.fn((bytes: Uint32Array) => {
      bytes.fill(value);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues: random });
    const words = new Map<string, number>();
    for (value = 0; value < 256; value++) {
      const password = generateEventPassword();
      expect(password).toMatch(/^[a-z]+-[a-z]{6,10}-[a-z]{6,10}$/);
      const [first, second, third] = password.split("-");
      expect(second).toBe(PASSPHRASE_WORDS[value]);
      expect(third).toBe(second);
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(normalizeEventPassword(password).length).toBeGreaterThanOrEqual(
        12,
      );
      words.set(first, (words.get(first) || 0) + 1);
    }
    expect(words.size).toBe(64);
    expect(new Set(words.values())).toEqual(new Set([4]));
    expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(6000);
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length);
    expect(PASSPHRASE_WORDS.every((word) => /^[a-z]{6,10}$/.test(word))).toBe(
      true,
    );
  });

  it("samples each word independently and rejects biased values outside the complete range", async () => {
    const { generateEventPassword } = await import("../src/lib/event-auth");
    const values = [63, 0xffffffff, PASSPHRASE_WORDS.length - 1, 2];
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint32Array) => {
        bytes[0] = values.shift()!;
        return bytes;
      },
    });
    expect(generateEventPassword()).toBe(
      `wreath-${PASSPHRASE_WORDS.at(-1)}-${PASSPHRASE_WORDS[2]}`,
    );
    expect(values).toEqual([]);
  });

  it("accepts the shortest generated phrases and normalizes them for returning sign-in", async () => {
    const { eventLoginEmail, signInEvent } =
      await import("../src/lib/event-auth");
    const email = await eventLoginEmail("manchester", "fir-abacus-abacus");
    await signInEvent("manchester", " FIR ABACUS ABACUS ");
    expect(sdk.signIn).toHaveBeenCalledWith(
      expect.anything(),
      email,
      "firabacusabacus",
    );
  });

  it("normalizes case, spaces, line breaks, copied dashes and fullwidth input consistently", async () => {
    const { normalizeEventPassword } = await import("../src/lib/event-auth");
    const canonical = "merrysnow0a2b3c4d5e6";
    for (const value of [
      examplePassword,
      "  merry snow 0a2b3c4d5e6\n",
      "MERRY\u2011SNOW\u20140A2B3C4D5E6",
      "merry\u2212snow\u20130a2b3c4d5e6",
      "Ｍｅｒｒｙ－Ｓｎｏｗ－０ａ２ｂ３ｃ４ｄ５ｅ６",
      canonical,
    ]) {
      expect(normalizeEventPassword(value)).toBe(canonical);
      expect(normalizeEventPassword(normalizeEventPassword(value))).toBe(
        canonical,
      );
    }
  });

  it("derives a stable event-scoped SHA-256 address without putting the password in the address", async () => {
    const { eventLoginEmail } = await import("../src/lib/event-auth");
    const expected =
      createHash("sha256")
        .update("manchester\0merrysnow0a2b3c4d5e6")
        .digest("hex") + "@event.santa.invalid";
    expect(await eventLoginEmail("manchester", examplePassword)).toBe(expected);
    expect(await eventLoginEmail("manchester", "merry snow 0a2b3c4d5e6")).toBe(
      expected,
    );
    expect(await eventLoginEmail("sheffield", examplePassword)).not.toBe(
      expected,
    );
    expect(
      await eventLoginEmail("manchester", "Merry-Snow-0a2b3c4d5e7"),
    ).not.toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}@event\.santa\.invalid$/);
  });

  it("rejects missing secure randomness or hashing rather than falling back to weak credentials", async () => {
    const { generateEventPassword, eventLoginEmail } =
      await import("../src/lib/event-auth");
    vi.stubGlobal("crypto", undefined);
    expect(() => generateEventPassword()).toThrow("HTTPS");
    await expect(
      eventLoginEmail("manchester", examplePassword),
    ).rejects.toThrow("HTTPS");
  });

  it("rejects invalid event identifiers and malformed credentials before contacting Firebase Auth", async () => {
    const { createEventAccount, signInEvent } =
      await import("../src/lib/event-auth");
    for (const eventId of ["", "manchester/members", "manchester\0secret"]) {
      await expect(
        createEventAccount(eventId, examplePassword),
      ).rejects.toThrow("event");
    }
    for (const password of [
      "",
      "tiny",
      "x".repeat(129),
      "merry-snow-<script>",
    ]) {
      await expect(signInEvent("manchester", password)).rejects.toThrow(
        "password",
      );
    }
    expect(sdk.createUser).not.toHaveBeenCalled();
    expect(sdk.signIn).not.toHaveBeenCalled();
  });
});

describe("isolated Firebase event sessions", () => {
  it("caches each event's auth and database separately from other events and the primary account", async () => {
    const { auth, db, getEventServices } = await import("../src/lib/firebase");
    const manchester = getEventServices("manchester");
    expect(getEventServices("manchester")).toBe(manchester);
    expect(manchester.auth).not.toBe(auth);
    expect(manchester.db).not.toBe(db);
    const sheffield = getEventServices("sheffield");
    expect(sheffield.auth).not.toBe(manchester.auth);
    expect(sheffield.db).not.toBe(manchester.db);
    expect(manchester.auth.app.name).toBe("event:manchester");
    expect(sdk.initializeAuth).not.toHaveBeenCalled();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  });

  it("connects all service types to the same demo emulators only when explicitly enabled in development", async () => {
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    const { auth, getEventServices, createTemporaryServices } =
      await import("../src/lib/firebase");
    const event = getEventServices("manchester");
    getEventServices("manchester");
    const temporary = createTemporaryServices();
    expect(sdk.connectAuthEmulator).toHaveBeenCalledTimes(3);
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledTimes(3);
    for (const eventAuth of [auth, event.auth, temporary.auth]) {
      expect(eventAuth.app.options.projectId).toBe("demo-secret-santa");
      expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(
        eventAuth,
        "http://127.0.0.1:9099",
        { disableWarnings: true },
      );
    }
    await temporary.dispose();
  });

  it("never enables the emulators in a production build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    const { emulatorMode, getEventServices, createTemporaryServices } =
      await import("../src/lib/firebase");
    expect(emulatorMode).toBe(false);
    getEventServices("manchester");
    const temporary = createTemporaryServices();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(temporary.auth.app.options.projectId).not.toBe("demo-secret-santa");
    await temporary.dispose();
  });

  it("creates and signs in using the same canonical secret without changing another event or the organiser", async () => {
    const { auth, getEventServices } = await import("../src/lib/firebase");
    const { createEventAccount, signInEvent, signOutEvent, eventLoginEmail } =
      await import("../src/lib/event-auth");
    const primary = { uid: "organiser", auth: sdk.auths.get("[DEFAULT]")! };
    sdk.auths.get("[DEFAULT]")!.currentUser = primary;
    const sheffieldUser = await createEventAccount(
      "sheffield",
      examplePassword,
    );
    const created = await createEventAccount("manchester", examplePassword);
    const manchester = getEventServices("manchester");
    expect(manchester.auth.currentUser).toBe(created);
    expect(sdk.createUser).toHaveBeenLastCalledWith(
      manchester.auth,
      await eventLoginEmail("manchester", examplePassword),
      "merrysnow0a2b3c4d5e6",
    );
    const returned = await signInEvent("manchester", "merry snow 0A2B3C4D5E6");
    expect(manchester.auth.currentUser).toBe(returned);
    expect(sdk.signIn).toHaveBeenCalledWith(
      manchester.auth,
      await eventLoginEmail("manchester", examplePassword),
      "merrysnow0a2b3c4d5e6",
    );
    await signOutEvent("manchester");
    expect(manchester.auth.currentUser).toBeNull();
    expect(getEventServices("sheffield").auth.currentUser).toBe(sheffieldUser);
    expect(auth.currentUser).toBe(primary);
  });

  it("propagates Firebase Auth rate limits without automatic retries", async () => {
    const { signInEvent } = await import("../src/lib/event-auth");
    const error = Object.assign(new Error("Rate limited"), {
      code: "auth/too-many-requests",
    });
    sdk.signIn.mockRejectedValueOnce(error);
    await expect(signInEvent("manchester", examplePassword)).rejects.toBe(
      error,
    );
    expect(sdk.signIn).toHaveBeenCalledTimes(1);
  });

  it("issues temporary accounts with memory-only persistence and disposes without deleting the account", async () => {
    const { auth, getEventServices } = await import("../src/lib/firebase");
    const { createEventAccount, createTemporaryEventAccount } =
      await import("../src/lib/event-auth");
    const participant = await createEventAccount("manchester", examplePassword);
    const temporary = await createTemporaryEventAccount(
      "manchester",
      "Holly-Star-0123456789z",
    );
    expect(temporary.uid).not.toBe(participant.uid);
    const temporaryAuth = sdk.createUser.mock.calls.at(-1)![0];
    expect(sdk.initializeAuth).toHaveBeenCalledWith(temporaryAuth.app, {
      persistence: sdk.inMemoryPersistence,
    });
    expect(temporaryAuth).not.toBe(auth);
    expect(temporaryAuth).not.toBe(getEventServices("manchester").auth);
    await Promise.all([temporary.dispose(), temporary.dispose()]);
    await temporary.discard();
    expect(sdk.deleteUser).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(sdk.deleteApp).toHaveBeenCalledExactlyOnceWith(temporaryAuth.app);
    expect(getEventServices("manchester").auth.currentUser).toBe(participant);
  });

  it("discards only the newly-created temporary user and performs cleanup once", async () => {
    const { createTemporaryEventAccount } =
      await import("../src/lib/event-auth");
    const temporary = await createTemporaryEventAccount(
      "manchester",
      examplePassword,
    );
    const temporaryAuth = sdk.createUser.mock.calls.at(-1)![0];
    const created = temporaryAuth.currentUser;
    await Promise.all([
      temporary.discard(),
      temporary.discard(),
      temporary.dispose(),
    ]);
    expect(sdk.deleteUser).toHaveBeenCalledExactlyOnceWith(created);
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith(temporaryAuth);
    expect(sdk.deleteApp).toHaveBeenCalledExactlyOnceWith(temporaryAuth.app);
  });

  it("still disposes when deleting an unissued account fails", async () => {
    const { createTemporaryEventAccount } =
      await import("../src/lib/event-auth");
    const temporary = await createTemporaryEventAccount(
      "manchester",
      examplePassword,
    );
    sdk.deleteUser.mockRejectedValueOnce(new Error("Network unavailable"));
    await temporary.discard();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(sdk.deleteApp).toHaveBeenCalledTimes(1);
  });

  it("cleans up failed temporary signups without hiding the original Firebase error", async () => {
    const { createTemporaryEventAccount } =
      await import("../src/lib/event-auth");
    const error = Object.assign(new Error("Account exists"), {
      code: "auth/email-already-in-use",
    });
    sdk.createUser.mockRejectedValueOnce(error);
    sdk.signOut.mockRejectedValueOnce(new Error("Cleanup failed"));
    await expect(
      createTemporaryEventAccount("manchester", examplePassword),
    ).rejects.toBe(error);
    expect(sdk.deleteApp).toHaveBeenCalledTimes(1);
    expect(sdk.deleteUser).not.toHaveBeenCalled();
  });
});
