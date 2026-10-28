import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      email: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/provision-admin.mjs --project PROJECT_ID --email EXISTING_VERIFIED_EMAIL [--apply]",
    );
    console.log(
      "Uses Application Default Credentials. Without --apply, this only reads and displays the proposed organiser.",
    );
    return;
  }
  if (
    !values.project ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project) ||
    values.project.startsWith("demo-")
  ) {
    throw new Error(
      "Provide the real target project explicitly with --project PROJECT_ID.",
    );
  }
  if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    throw new Error(
      "Provide the existing verified account using --email EMAIL_ADDRESS.",
    );
  }
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "Emulator variables are set. Open a separate terminal for production provisioning.",
    );
  }
  const { initializeApp, applicationDefault, deleteApp } =
    await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp(
    { projectId: values.project, credential: applicationDefault() },
    "provision-santa-admin",
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    const user = await auth.getUserByEmail(values.email);
    if (!user.emailVerified)
      throw new Error(
        "This account must verify its email address before becoming the organiser.",
      );
    if (user.disabled)
      throw new Error(
        "This account is disabled and cannot become the organiser.",
      );
    const reference = db.doc("config/admin");
    const existing = await reference.get();
    if (existing.exists && existing.data()?.uid !== user.uid) {
      throw new Error(
        "A different sole organiser is already configured. This script will not replace them. Review an intentional replacement in the Firebase console.",
      );
    }
    console.log(`Project: ${values.project}`);
    console.log("Document: (default)/config/admin");
    console.log(`Existing verified account: ${user.email}`);
    console.log(`UID: ${user.uid}`);
    if (existing.exists) {
      console.log(
        "This account is already the sole organiser. No changes needed.",
      );
      return;
    }
    if (!values.apply) {
      console.log(
        "Read-only preview. Add --apply to write the organiser UID to this document.",
      );
      return;
    }
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && snapshot.data()?.uid !== user.uid) {
        throw new Error(
          "The organiser changed after the preview. No changes were made.",
        );
      }
      if (!snapshot.exists) transaction.create(reference, { uid: user.uid });
    });
    console.log(
      "Sole organiser configured. Refresh the signed-in website to open the organiser dashboard.",
    );
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(`Organiser setup failed: ${error.message}`);
  process.exitCode = 1;
});
