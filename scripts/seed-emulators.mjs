import { parseArgs } from "node:util";

const PROJECT = "demo-secret-santa";
const PASSWORD = "Santa-Local-Only-2026!";

function requireLocalEmulator(variable, port) {
  const value = process.env[variable];
  if (value !== `127.0.0.1:${port}` && value !== `localhost:${port}`) {
    throw new Error(
      `Set ${variable}=127.0.0.1:${port}. This script only seeds local emulators.`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: { project: { type: "string" }, help: { type: "boolean" } },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/seed-emulators.mjs --project demo-secret-santa",
    );
    console.log(
      "Requires local Auth (9099) and Firestore (8080) emulator host variables.",
    );
    return;
  }
  if (values.project !== PROJECT) {
    throw new Error(`Pass --project ${PROJECT}. No other project is accepted.`);
  }
  requireLocalEmulator("FIREBASE_AUTH_EMULATOR_HOST", 9099);
  requireLocalEmulator("FIRESTORE_EMULATOR_HOST", 8080);
  for (const variable of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) {
    if (process.env[variable] && process.env[variable] !== PROJECT) {
      throw new Error(
        `${variable} points to a different project. Use a dedicated emulator terminal.`,
      );
    }
  }

  // Load the privileged SDK only after the destination checks above have succeeded.
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: PROJECT }, "local-santa-seed");
  const auth = getAuth(app);
  const db = getFirestore(app);
  const accounts = [
    {
      uid: "demo-organiser",
      email: "organiser@example.test",
      displayName: "The Organiser",
    },
    {
      uid: "demo-alex",
      email: "alex@example.test",
      displayName: "Alex Morgan",
    },
    {
      uid: "demo-jamie",
      email: "jamie@example.test",
      displayName: "Jamie Taylor",
    },
    { uid: "demo-sam", email: "sam@example.test", displayName: "Sam Patel" },
    {
      uid: "demo-riley",
      email: "riley@example.test",
      displayName: "Riley Williams",
    },
  ];

  try {
    const adminRef = db.doc("config/admin");
    const existingAdmin = await adminRef.get();
    if (existingAdmin.exists && existingAdmin.data()?.uid !== accounts[0].uid) {
      throw new Error(
        "The emulator already has a different organiser. Start with a fresh emulator database.",
      );
    }
    for (const account of accounts) {
      let existing;
      try {
        existing = await auth.getUser(account.uid);
      } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
      }
      if (existing && existing.email !== account.email) {
        throw new Error(
          `Test account ${account.uid} has unexpected data. Start fresh emulators.`,
        );
      }
      if (existing) {
        await auth.updateUser(account.uid, {
          displayName: account.displayName,
          emailVerified: true,
          password: PASSWORD,
        });
      } else {
        await auth.createUser({
          ...account,
          emailVerified: true,
          password: PASSWORD,
        });
      }
    }
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(adminRef);
      if (snapshot.exists && snapshot.data()?.uid !== accounts[0].uid) {
        throw new Error(
          "The emulator organiser changed while seeding. Nothing was overwritten.",
        );
      }
      if (!snapshot.exists)
        transaction.create(adminRef, { uid: accounts[0].uid });
    });

    const now = Date.now();
    const day = 86_400_000;
    const guidelines = [
      "Please be thoughtful with your gift selection",
      "Wrap your gift before the exchange",
      "Label your gift with recipient’s name only",
      "If you’ll be away for the exchange, drop the gift with someone going to the Christmas party",
    ];
    const giftIdeas = [
      "Desk accessories",
      "Books",
      "Homemade gift (drawing, decoration etc.)",
      "Gourmet treats",
      "Cozy winter items",
      "Self-care items",
    ];
    const samples = [
      {
        id: "demo-manchester",
        name: "Manchester",
        people: accounts.slice(1),
        signupDays: 14,
        exchangeDays: 35,
      },
      {
        id: "demo-sheffield",
        name: "Sheffield",
        people: accounts.slice(1, 4),
        signupDays: 18,
        exchangeDays: 39,
      },
    ];
    for (const sample of samples) {
      const reference = db.doc(`events/${sample.id}`);
      const created = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) return false;
        transaction.create(reference, {
          name: sample.name,
          signupDeadline: now + sample.signupDays * day,
          exchangeAt: now + sample.exchangeDays * day,
          timezone: "Europe/London",
          budget: 10,
          details:
            "Bring your wrapped gift to the Christmas party.",
          guidelines,
          giftIdeas,
          status: "open",
          memberCount: sample.people.length,
          activeRunId: null,
          createdAt: now,
        });
        for (const person of sample.people) {
          transaction.create(reference.collection("members").doc(person.uid), {
            uid: person.uid,
            name: person.displayName,
            joinedAt: now,
          });
        }
        return true;
      });
      console.log(
        `${created ? "Created" : "Kept existing"} ${sample.name} (${sample.id}).`,
      );
    }
    console.log(
      `\nLocal emulators seeded for ${PROJECT}. Production was not contacted.`,
    );
    console.table(
      accounts.map((account) => ({
        role: account.uid === accounts[0].uid ? "Organiser" : "Participant",
        email: account.email,
      })),
    );
    console.log(`Test-only password for these emulator accounts: ${PASSWORD}`);
    console.log(
      "Existing sample events are preserved. Restart without an import to get a fresh database.",
    );
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(`Emulator setup failed: ${error.message}`);
  process.exitCode = 1;
});
