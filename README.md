# Secret Santa

A festive Secret Santa organiser for `santa.bamber.dev`. The static React/TypeScript app is ready for GitHub Pages; Firebase Authentication and Firestore provide accounts, event data, and protected gift assignments on the **Spark plan**. The app uses no Cloud Functions, Firebase Storage, or custom email service. Follow the production setup steps below before going live.

## What people can do

- Register with any email address and password, verify the email, and join one or more events using a display name.
- Follow separate signup and gift-exchange countdowns, with exact dates shown in UK time.
- Change their name or leave before registration closes. Once the organiser draws names, privately reveal their own recipient and revisit it later.
- Read the supplied gift guide, including the approximate £10 budget, wrapping and labelling advice, and gift ideas. The signup date is generated from each event's settings.

The sole organiser creates every location manually. The organiser dashboard manages dates, participants, the draw, and archiving. Each recipient starts concealed behind a Reveal/Hide control, including after a draw or page reload. The organiser can technically access all pairings: this is a trusted-organiser design, not cryptographic secrecy from the person running the draw.

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

`npm test` checks draw invariants, malformed assignments, validation, and UK daylight-saving boundaries. `test:rules` starts its own Firestore emulator and verifies account permissions, event isolation, signup cutoffs, and assignment privacy. Stop another Firestore emulator before running it to avoid a port conflict. The build typechecks the app and writes static files to `dist/`.

Run `npm.cmd run test:e2e` with the dev server and local emulators running, and both emulator host variables set as shown above. It uses installed Google Chrome in headless mode and resets/reseeds only the explicitly named local `demo-secret-santa` Firestore database before each run. Do not use that demo database for work you want to keep. Browser checks cover registration, verification, multiple memberships, joining/editing/leaving, event creation, drawing, reveal privacy, refreshing routes, reduced motion, and desktop/mobile layout; screenshots are saved in the ignored `artifacts/` directory.

With the dev server running, `npm.cmd run test:auth-races` checks delayed account changes, stale role/membership responses, and verification finishing after sign-out. It uses isolated mocked service responses in a fresh Chrome context and does not change emulator data.

`npm.cmd run test:snow` checks rendered snow pixels, the rare Arm-logo particle using simulated time, the snow toggle, and reduced-motion behaviour in a fresh anonymous browser context. It does not change account or event data.

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

Deploying rules replaces the project's active ruleset. This app uses `events` and `config`; unspecified collections, including the previous implementation's data, are denied by the new rules. Check any other applications using this Firebase project before deploying. This does not delete existing data.

### Set the sole organiser

First register **`thomas.bamber16@gmail.com`** through the site and verify its email. The organiser role is attached to the Firebase **UID**, so an email address alone does not grant admin access.

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
5. Push the tested implementation to `main`, or manually run the workflow there. Smoke-test registration, email verification, creating an event, joining from a second account, and a small test draw before inviting participants.

GitHub's [custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) cover verification and DNS. A custom Actions workflow uses the Pages domain setting; a `CNAME` file is not required.

For the custom domain, the asset base path is `/`. To use only `https://thobam16.github.io/secret_santa_organiser/`, set the repository Actions variable **`VITE_BASE_PATH`** to `/secret_santa_organiser/`. The optional `VITE_FIREBASE_*` Actions variables override the public Firebase defaults. Hash routes make event/admin links survive refreshes without server rewrites.

## Running an event

1. Sign in as the organiser and create a location. Set its signup cutoff and gift-exchange date/time in **Europe/London**, plus the budget and party details. Create additional events independently.
2. Share the event link. People verify their email and join with a name. A person can join several events, once per event.
3. Review the roster. Close registration early if needed, or let the server-enforced cutoff pass. At least three participants are required.
4. Confirm the draw. The roster is locked; names are shuffled using cryptographic randomness with self-matches rejected. Every participant gives and receives exactly once.
5. Tell participants that results are available on the site. Each account can read only its own published recipient. No custom announcement or reminder email is sent automatically.
6. Use the row's eye control only when you intentionally want to see a pairing. Changing event, signing out, or reloading conceals it again. After publication, party details can change without altering assignments.
7. Archive the event when finished. Published assignments are not routinely redrawn, because someone may already have bought a gift.

Signup and exchange dates are stored as UTC timestamps and shown in UK time. The form rejects the skipped or duplicated hour when UK clocks change. Countdown updates do not make repeated database reads. A countdown reaching zero becomes a status message; Firestore's server time controls whether a signup is accepted.

## Draw recovery and data protection

The browser freezes the roster, saves one immutable private draw plan, writes assignments in small batches, verifies them, and publishes the saved run. No participant can read an incomplete run. If connectivity fails or a tab closes during saving, reopen the organiser dashboard and resume the same draw. Avoid deleting the saved run or editing its documents manually; that can prevent recovery. If the interruption happened before a plan was saved, the locked event can start its draw normally.

The current recovery plan is stored in one document, with an 850 KB preflight bound below Firestore's 1 MiB document limit. Large events must fit this bound; ordinary office-sized rosters require much less space. Security Rules enforce ownership, verified-email joins, deadline checks, roster locking, and assignment isolation. They do not establish that a malicious organiser used unbiased randomness.

Firestore Spark includes a daily usage allowance; crossing its limits can interrupt service until the quota resets. Keep reads modest and review usage in the Firebase console. Cloud Functions, automated reminders, and paid backup features are outside this version. See [Firebase pricing](https://firebase.google.com/pricing) and [Firestore limits](https://firebase.google.com/docs/firestore/quotas).

Participant names and membership data are stored in Firestore; login email/password handling is provided by Firebase Authentication. The organiser sees the roster, while participants see their own membership and event counts. Archived data remains stored until deliberately removed through trusted project administration. The browser stores sign-in state and the snow preference; recipient reveal state is not retained across navigation or reloads.
