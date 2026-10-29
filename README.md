# Secret Santa

A festive Secret Santa organiser for `santa.bamber.dev`. The static React/TypeScript app is ready for GitHub Pages; Firebase Authentication and Firestore provide accounts, event data, and protected gift assignments on the **Spark plan**. The app uses no Cloud Functions, Firebase Storage, or custom email service. Follow the production setup steps below before going live.

## What people can do

- Join an event with a name and optional gift preferences. Each person receives their own randomly generated three-word password for that signup, starting with a Christmas word; no email or verification step is required.
- Return to the event and enter that password. Each event has a separate sign-in session, so joining another event does not replace existing sessions. Names can change without changing the password.
- Follow separate signup and gift-exchange countdowns, with exact dates shown in UK time.
- Change their name or leave before registration closes. Once the organiser draws names, privately reveal their own recipient and revisit it later.
- Optionally add gift preferences or interests for each event (up to 500 characters). These can be updated until the event is archived and are visible only to that participant, their assigned gift giver after the draw, and the organiser.
- Read the supplied gift guide, including the approximate £10 budget, wrapping and labelling advice, and gift ideas. The signup date is generated from each event's settings.

The sole organiser keeps their existing verified email/password account and creates every location manually. The organiser dashboard manages dates, participants, the draw, and archiving. Passwords and recipients start concealed behind separate Reveal/Hide controls. A participant who forgets their generated password can ask the organiser to look it up. The organiser can technically access all pairings and generated participant passwords: this is a trusted-organiser design, not cryptographic secrecy from the person running the draw.

Previously registered email accounts can still sign in through the event's **Previously joined with email?** link. The participant or organiser can create a password for that existing signup. This preserves the participant ID, preferences, and any completed draw; no one needs to join twice or be redrawn.

Production starts without preset locations. Manchester and Sheffield are optional emulator fixtures only.

## Local development

Install **Node.js 24** and **Java 21** (needed by the Firestore emulator). Run commands from the repository root. The examples use PowerShell; `npm.cmd`/`npx.cmd` avoid PowerShell execution-policy issues. On macOS/Linux, use `npm`/`npx` and your shell's environment-variable syntax.

```powershell
npm.cmd ci
npm.cmd run emulators
```

Leave the emulator terminal running. It starts Authentication at `127.0.0.1:9099` and Firestore at `127.0.0.1:8080`, using the non-production project `demo-secret-santa`. The optional emulator UI is disabled to avoid an extra download; enable `emulators.ui.enabled` in `firebase.json` if you want it.

In a second terminal, seed local test data and start the app:

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
npm.cmd run seed:emulators -- --project demo-secret-santa
$env:VITE_USE_EMULATORS = 'true'
npm.cmd run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Connecting to emulators requires **both Vite development mode and `VITE_USE_EMULATORS=true`**. Simply running `npm run dev` without that flag connects to the configured real Firebase project. Production builds and `npm run preview` use the real project, even if the flag is set.

The seed script refuses every project except `demo-secret-santa` and requires both local emulator hosts. It creates verified test accounts and two sample events, preserving existing sample events when rerun:

| Role | Email |
| --- | --- |
| Organiser | `organiser@example.test` |
| Participants | `alex@example.test`, `jamie@example.test`, `sam@example.test`, `riley@example.test` |

The password for these **emulator-only** accounts is `Santa-Local-Only-2026!`. Restart the emulators without importing saved data for a fresh start. Newly registered emulator accounts can verify using the link printed by the Auth emulator; no real email is sent. [Firebase emulator connection](https://firebase.google.com/docs/emulator-suite/connect_auth)

## Tests and production build

```powershell
npm.cmd test
npm.cmd run test:rules
npm.cmd run build
```

`npm test` checks draw invariants, password generation and normalisation, malformed assignments, validation, and UK daylight-saving boundaries. `test:rules` starts its own Firestore emulator and verifies account permissions, event isolation, signup cutoffs, assignment and password privacy, and existing-participant migration. Stop another Firestore emulator before running it to avoid a port conflict. The build typechecks the app and writes static files to `dist/`.

`npm.cmd run test:e2e` uses installed Google Chrome with a separate test server and isolated Firebase emulators. It exercises generated passwords, returning sign-in, independent event sessions, organiser recovery, legacy participants, draw privacy, and mobile layout. The script refuses the normal development emulator ports, so it cannot reset your local preview data. Screenshots are saved in the ignored `artifacts/` directory. See the script's setup checks for the required test ports.

Start `npm.cmd run emulators:passwords-test` in one terminal. In a second terminal start the isolated preview:

```powershell
$env:VITE_USE_EMULATORS = 'true'
$env:VITE_AUTH_EMULATOR_PORT = '9299'
$env:VITE_FIRESTORE_EMULATOR_PORT = '8280'
npm.cmd run dev -- --port 5174 --strictPort
```

Run the browser suite in a third terminal. It resets only this dedicated test database and its test accounts:

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9299'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8280'
$env:TEST_BASE_URL = 'http://127.0.0.1:5174'
npm.cmd run test:e2e
```

With the dev server running, `npm.cmd run test:auth-races` checks delayed account changes, stale role/membership responses, and verification finishing after sign-out. It uses isolated mocked service responses in a fresh Chrome context and does not change emulator data.

`npm.cmd run test:preferences` checks optional gift preferences, editing after the draw, recipient reveal/hide, archived events, and desktop/mobile layout with isolated mocked services. It does not change emulator data. The Firestore rules suite separately checks preference validation, updates, and private access through the real client API.

`npm.cmd run test:snow` checks visible snow, the rare Arm-logo particle, occasional sleigh flights, viewport sizing, and the animation toggle and reduced-motion behaviour using simulated time in a fresh anonymous browser context. It does not change account or event data. Turning snow off stops the sleigh too; all motion pauses while the tab is hidden.

The dependency override for Firestore's Node-only `@grpc/grpc-js` pins the patched compatible version `1.14.6`; it avoids the vulnerable `1.9.x` transitive range. The browser build does not use gRPC. Recheck this override when upgrading Firebase.

## Firebase production setup

The default public web configuration points to **`secret-santa-organiser`**. Optional overrides are documented in `.env.example`; copy it to `.env.local` for local settings. Firebase web API keys identify the app and are not service-account secrets. Security comes from Authentication and the deployed Firestore rules. Never put Admin SDK keys, passwords, or service-account JSON in the browser bundle, a `VITE_` variable, or this repository.

1. In the Firebase console, select `secret-santa-organiser` and keep it on **Spark**, without attaching a billing account. If needed, create the default Firestore database in Standard edition.
2. Under **Authentication → Sign-in method**, enable **Email/Password**. Email-link login is not used.
3. Under Authentication's authorised domains, add `santa.bamber.dev` and, if using the default Pages URL, `thobam16.github.io`. Add `localhost`/`127.0.0.1` only when you intentionally test real-project authentication locally. Check the verification and password-reset email templates.
4. Review the rules against the existing project, then deploy them and the index definition:

```powershell
npx.cmd firebase login
npx.cmd firebase deploy --only firestore:rules,firestore:indexes --project secret-santa-organiser
```

Deploying rules replaces the project's active ruleset. This app uses `events`, `participantAccess`, and `config`; unspecified collections, including the previous implementation's data, are denied by the new rules. Check any other applications using this Firebase project before deploying. This does not delete existing data.

### Set the sole organiser

Keep the existing verified **`thomas.bamber16@gmail.com`** account. For a fresh project, create the organiser's email/password account in the Firebase Authentication console, then use the site's organiser sign-in and email verification controls. Public participant signup does not create organiser accounts. The organiser role is attached to the Firebase **UID**, so an email address alone does not grant admin access.

The simplest setup is through the Firebase console: find this verified account under Authentication, copy its UID, and create the Firestore document **`config/admin`** with one string field, **`uid`**, containing that exact UID. Refresh the signed-in website. Client-side writes to this role document are forbidden.

Alternatively, the provisioning script uses Application Default Credentials with permission to read Firebase Authentication users and create the Firestore role document:

```powershell
node scripts/provision-admin.mjs --project secret-santa-organiser --email thomas.bamber16@gmail.com
node scripts/provision-admin.mjs --project secret-santa-organiser --email thomas.bamber16@gmail.com --apply
```

The first command is read-only and prints the UID and destination. The second creates `config/admin` only if no other organiser is configured. It requires an existing, verified, enabled account; it never creates accounts, changes passwords, or replaces another organiser.

Use a separate terminal without emulator variables. Follow the [Admin SDK credential setup](https://firebase.google.com/docs/admin/setup#test_with_gcloud_end_user_credentials): standard `gcloud auth application-default login` credentials use a client that Firebase Auth does not accept. Local end-user ADC requires your own Desktop OAuth client, for example `gcloud auth application-default login --client-id-file=PATH_OUTSIDE_THIS_REPO`, or another supported privileged ADC environment. Keep credential files outside the repository. Console setup avoids this additional credential configuration.

## GitHub Pages and the domain

The workflow in `.github/workflows/deploy.yml` installs dependencies with `npm ci`, runs unit and Firestore rules tests, typechecks/builds, and deploys `dist/`. It publishes pushes to `main` and manual runs on `main`; pull requests are tested without publishing. It does **not** deploy live Firebase rules or change Firebase accounts.

1. In the GitHub repository, set **Settings → Pages → Source → GitHub Actions**.
2. Verify ownership of `bamber.dev` in GitHub. Set the Pages custom domain to **`santa.bamber.dev`**.
3. At the domain's DNS provider, set a CNAME for **`santa` → `thobam16.github.io`**. Use the hostname only, without a scheme or repository path.
4. Once DNS resolves and the certificate is ready, enable **Enforce HTTPS** in Pages settings.
5. Push the tested implementation to `main`, or manually run the workflow there. Smoke-test organiser sign-in, creating an event, participant signup and password return, organiser password recovery, and a small test draw before inviting participants.

GitHub's [custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) cover verification and DNS. A custom Actions workflow uses the Pages domain setting; a `CNAME` file is not required.

Assets use relative paths (`./`) by default, so the same build works at both `https://thobam16.github.io/secret_santa_organiser/` and `santa.bamber.dev`. No Actions variable is needed. An explicit **`VITE_BASE_PATH`** in the build environment or Actions variables can still override this; remove an old `/` override when using the repository URL. The optional `VITE_FIREBASE_*` Actions variables override the public Firebase defaults. Hash routes make event/admin links survive refreshes without server rewrites.

## Running an event

1. Sign in as the organiser and create a location. Set its signup cutoff and gift-exchange date/time in **Europe/London**, plus the budget and party details. Create additional events independently.
2. Share the event link. People enter their name, optionally add gift preferences, and receive their own Christmas password. They should save it for returning to that event. A person can join several events with a separate password for each signup.
3. Review the roster. Close registration early if needed, or let the server-enforced cutoff pass. At least three participants are required.
4. Confirm the draw. The roster is locked; names are shuffled using cryptographic randomness with self-matches rejected. Every participant gives and receives exactly once.
5. Tell participants that results are available on the site. Each account can read only its own published recipient. No custom announcement or reminder email is sent automatically.
6. Open **Gift preferences** beneath a participant's name to view their hints. Use the appropriate row's eye control to reveal a password or pairing. Passwords are fetched individually when requested and hidden on tab changes, navigation, account changes, or page reload. Existing email signups show a separate **Create password** action if they do not yet have one. After publication, party details can change without altering assignments.
7. Archive the event when finished. Published assignments are not routinely redrawn, because someone may already have bought a gift.

Signup and exchange dates are stored as UTC timestamps and shown in UK time. The form rejects the skipped or duplicated hour when UK clocks change. Countdown updates do not make repeated database reads. A countdown reaching zero becomes a status message; Firestore's server time controls whether a signup is accepted.

## Draw recovery and data protection

The browser freezes the roster, saves one immutable private draw plan, writes assignments in small batches, verifies them, and publishes the saved run. No participant can read an incomplete run. If connectivity fails or a tab closes during saving, reopen the organiser dashboard and resume the same draw. Avoid deleting the saved run or editing its documents manually; that can prevent recovery. If the interruption happened before a plan was saved, the locked event can start its draw normally.

The current recovery plan is stored in one document, with an 850 KB preflight bound below Firestore's 1 MiB document limit. Large events must fit this bound; ordinary office-sized rosters require much less space. Security Rules enforce ownership, event-specific access, deadline checks, roster locking, and assignment isolation. They do not establish that a malicious organiser used unbiased randomness.

Firestore Spark includes a daily usage allowance; crossing its limits can interrupt service until the quota resets. Keep reads modest and review usage in the Firebase console. Cloud Functions, automated reminders, and paid backup features are outside this version. See [Firebase pricing](https://firebase.google.com/pricing) and [Firestore limits](https://firebase.google.com/docs/firestore/quotas).

Participant names, optional gift preferences, and membership data are stored in Firestore. Firebase Authentication verifies generated passwords against internal addresses derived from the event ID and password; these addresses are not user emails and receive no mail. New passwords contain three words: one of 64 Christmas words followed by two independently selected words from a 6,296-word list. Choices use cryptographic randomness and unbiased sampling, giving approximately 31 bits before normalisation. This is less resistant to guessing than the previous random suffix; Firebase Auth handles verification and request throttling. Generated account collisions are retried with a new phrase. The word list is adapted from [EFF's Long Wordlist](https://www.eff.org/dice); attribution and changes are in `public/THIRD-PARTY-NOTICES.txt`.

Passwords accept case/spacing/hyphen variations, and previously issued passwords continue to work. They are not placed in URLs or logs. Temporary signup retries retain the generated password in memory only; persisted sign-in sessions are handled by Firebase.

To support the requested organiser recovery, a recoverable copy of each generated password is stored in a separate private `events/{eventId}/credentials/{memberUid}` document. Only the participant and verified organiser can read it; the assigned gift giver cannot. `participantAccess/{authUid}` binds the password account to one event and a stable participant ID, preserving existing draw assignments. Removing a participant also removes these access records atomically. Firebase account creation and Firestore registration are separate operations; uncertain commits are checked before account cleanup so a successful signup is not destroyed.

The organiser sees the roster, while participants can read their own membership and their assigned recipient's membership after the draw is published. The recipient reveal fetches the latest saved preferences; preferences are not copied into the immutable draw. Archived data remains stored until deliberately removed through trusted project administration. The browser stores sign-in state and the snow preference; password and recipient reveal state is not retained across navigation or reloads. Deploy the updated Firestore rules before publishing this frontend, and keep the existing organiser UID unchanged.
