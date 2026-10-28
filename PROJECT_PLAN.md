# Secret Santa organiser — proposed project plan

Status: implemented locally on 28 October 2026. The app, Firebase rules, tests, and deployment workflow are in place. Live launch still requires Firebase authentication/configuration, organiser UID provisioning, and GitHub Pages/domain setup. Participant volume remains unspecified; automated coverage includes a 100-person database draw and draw logic through 500 participants.

## Outcome

A mobile-friendly festive website at `santa.bamber.dev` where people sign in, join a Secret Santa event, and privately view their gift recipient after the organiser runs the draw. The sole organiser creates each location/event manually; there are no preset locations. Every event has independent participants, signup and exchange dates, party details, and results. Events include a year so the site can be reused next Christmas.

## Confirmed decisions

1. **Audience and login — confirmed:** allow any email address, using email/password sign-in. Require email verification before joining an event. No `@arm.com` restriction or social sign-in is planned for the initial version.
2. **Organiser privacy:** technical access to all pairings is acceptable. Hide every recipient in the admin interface by default and provide a deliberate reveal/hide control, similar to a password visibility toggle. The browser performs the draw under this trusted-organiser model.
3. **Events and membership:** the admin creates locations manually. Participants may join multiple events without a restriction on cross-event membership; each account can join a given event only once. Manchester and Sheffield are examples, not seeded events.
4. **Administration:** the user is the sole organiser, with access to every event. Separate site organisers and delegated roles are outside the initial scope.
5. **Dates:** the admin sets a signup cutoff and gift-exchange date/time when creating each event. Show both countdowns prominently. Use Europe/London for entry and display, with an explicit UK-time label. No fixed 13 November deadline is built into event behaviour.
6. **Hosting:** GitHub Pages and Firebase Spark are the current scope. TrueNAS deployment and backend migration planning are deferred.

## Working defaults

- Participant lists are visible only to the organiser; participants see a count and their own membership.
- At least three participants are needed for a draw, with no exclusions beyond avoiding self-assignment.
- No routine redraw after publication and no automatic recipient announcement emails.
- Participant volume is not yet specified. Use bounded reads/writes and verify the draw at representative event sizes before choosing or documenting any implementation capacity limit. No arbitrary user-facing cap is established by this plan.

## Participant experience

- Home: festive introduction, events created by the admin, sign-in, and a “My events” view for events already joined. Show a useful empty state before the first event is created, with a prominent “Create event” action for the organiser.
- Event page: event name/year, two prominent countdowns (signup closes and gift exchange), the exact dates/times, exchange information, approximate £10 budget, and the complete gift guide below.
- Account: register with any email address and a password, verify the email before joining an event, sign in, sign out, and recover a forgotten password using Firebase Authentication. Include resend-verification and check-verification controls.
- Join: confirm a display name and explicitly join the chosen event. Allow joining any number of different events, but enforce one membership per account per event. Identify people by their account ID, not their name.
- Before the cutoff: allow participants to correct their name or leave. Show a clear joined/waiting state and participant count; keep the participant directory restricted to organisers by default.
- After the draw: show a deliberate “Reveal my recipient” action and let the participant revisit the result. Other participants' assignments must never be readable by this account.
- Closed signup, insufficient participants, loading, connectivity failures, and archived events each have a clear state.

## Organiser experience

- A dashboard for the sole organiser, authorised using Firebase permissions, with a separate view for each event.
- Manually create each location/event with its name, signup cutoff, gift-exchange date/time, budget, exchange details, and guide text; archive completed events. Validate that the exchange is after the signup cutoff.
- View and manage the participant list before the draw, and close registration early if needed.
- Review the frozen participant list and explicitly confirm the draw.
- Draw only within the selected event, with exactly one recipient per giver, exactly one giver per recipient, and no self-assignment. Use browser cryptographic randomness. Default to at least three participants; special exclusions are outside the initial scope unless requested.
- Prevent simultaneous draws and roster/assignment edits after results are published. Party logistics, exchange date/time, and guide text can still be corrected without changing recipients. Interrupted publication must resume safely without silently generating a new draw.
- Show each giver's name with their recipient concealed by default. An accessible eye-style Reveal/Hide button reveals only that row's recipient. Never automatically show pairings after drawing. Reset every row to concealed on navigation, event change, sign-out, or page reload; do not persist the reveal state.
- Concealed recipient names must not appear in rendered text, accessibility labels, notifications, or application logs. This prevents accidental disclosure in the interface; it does not remove the organiser's accepted technical access.
- Default to no routine redraw after publication: participants may already have bought gifts. A withdrawal after drawing needs organiser intervention rather than an automatic reassignment.

## Appearance and content

Use a simple, functional interface with direct labels and minimal text. Show the event list immediately; omit taglines, branded wordmarks, promotional sections, decorative headings, and illustrations. Retain the restrained Christmas colours, readable cards, and requested snow animation. Use clear sans-serif typography and compact layouts on phones and desktops.

Animate snow behind the content. Very occasionally include the Arm logo among the falling flakes, using a suitable logo asset rather than ordinary text. Provide a snow toggle, honour reduced-motion preferences, pause animation when the page is hidden, and ensure decorative layers never intercept interaction or obscure text.

Place the complete guide on each event page and make it accessible again from the recipient view. Show the deadline and budget close to signup. Preserve the supplied wording below as the content reference, but generate its signup date from the event settings rather than displaying a fixed November 13 deadline:

> **Sign up by Fri November 13th!** Gift exchange will take place during the Christmas parties.
>
> - Gift price cap: £10 (roughly)
> - **Keep your recipient secret**
>
> **Guidelines**
>
> - Please be thoughtful with your gift selection
> - Wrap your gift before the exchange
> - Label your gift with recipient's name only
> - If you'll be away for the exchange, drop the gift with someone going to the Christmas party
>
> **Gift Ideas**
>
> - Desk accessories
> - Books
> - Homemade gift (drawing, decoration etc.)
> - Gourmet treats
> - Cozy winter items
> - Self-care items

Render the opening line as **“Sign up by [configured weekday and date]!”** and display the exact cutoff time nearby. Use the configured gift-exchange date/time alongside the Christmas-party wording. Preserve the supplied budget, secrecy reminder, guidelines, and gift ideas as defaults.

### Countdown behaviour

- Show separate signup and gift-exchange countdown cards, with days, hours, and minutes plus the exact date/time. The event page should make both easy to find on mobile.
- Enter dates in Europe/London and store UTC timestamps with the event timezone. Resolve daylight-saving offsets explicitly so countdowns and displayed dates refer to the same instant.
- When the signup cutoff passes, replace that countdown with “Registration closed” while the gift-exchange countdown continues. An early manual closure also displays closed immediately.
- Once the exchange time passes, replace its countdown with a completed-state message instead of negative numbers. Archiving remains an organiser action.
- Countdown ticks run locally and do not trigger recurring database reads. Avoid announcing every tick to screen readers.
- Database rules enforce the cutoff using server request time even if a device clock is wrong. The countdown is informational, and the UI handles a server-rejected late signup clearly.

## Technical approach

### Static frontend

Use React, TypeScript, and Vite, producing ordinary static assets. Deploy the build through GitHub Actions to GitHub Pages and configure `santa.bamber.dev` with HTTPS. Use hash-based app routes so direct links and refreshes work on GitHub Pages without server rewrite support.

Separate UI components, draw logic, and Firebase access, and keep hostnames and environment configuration separate from business logic. TrueNAS-specific packaging and migration work are outside the current scope.

### Firebase Spark backend

Use Firebase Authentication and Cloud Firestore Standard edition, staying on Spark with no billing account attached. Store logo and other assets with the frontend; no Firebase Storage or Cloud Functions are needed for the proposed scope.

Model events, memberships, organiser permission, and private assignments separately. Public event details must not contain email addresses or assignments. Establish the sole organiser's account through trusted project configuration; participants cannot promote themselves through the website.

Firestore Security Rules must enforce authorisation, verified email for joining, permitted fields, event isolation, membership ownership, signup cutoff using server time, roster locking, and assignment privacy. A hidden button or route is not an authorisation mechanism.

Recommended lifecycle: **open → locked → drawing → drawn → archived**. An organiser may reopen a locked event before a draw starts if appropriate. Once drawing starts, the roster is immutable. Persist an attempt ID and frozen roster, stage assignments in bounded batches, validate the complete result, and make it visible through one publication transition. Participants can read only their own assignment from the published draw. Failed attempts stay unreadable and can be resumed or deliberately discarded before publication.

The user has accepted that this architecture trusts the organiser to run the draw honestly and that the organiser can technically access pairings. The interface must still conceal them until explicitly revealed as described above.

Keep notification scope to the website for the first version. Firebase account verification and password reset emails are included; custom announcement/reminder emails would need a separately agreed delivery mechanism.

### Current service constraints

Verified against official documentation on 28 October 2026:

- Spark does not support Cloud Functions deployment. Its Firestore Standard allowance includes 1 GiB stored data, 50,000 reads/day, and 20,000 writes/day. This should suit small office events, subject to participant numbers and access patterns. [Firebase pricing](https://firebase.google.com/pricing)
- Firebase-sent email-link sign-in is limited to 5 emails/day on Spark. Email/password with verification avoids depending on that small magic-link allowance. Verification emails have a separate 1,000/day allowance; account creation is limited to 100 accounts/hour per IP address, relevant if many colleagues register together behind an office network. [Authentication limits](https://firebase.google.com/docs/auth/limits)
- Firestore rules allow 10 document access calls for a single request and 20 across a transaction or batch, also retaining each operation's limit. Choose publication batch sizes using the actual rules and validate them in the emulator. [Firestore limits](https://firebase.google.com/docs/firestore/quotas)
- GitHub Pages serves static assets and supports custom domains. The repository's visibility and GitHub plan determine Pages availability. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- Set up and verify the custom domain in GitHub, configure its DNS, and enforce HTTPS. [Custom domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- Vite produces a deployable static `dist` directory suitable for different static hosts. [Vite deployment](https://vite.dev/guide/static-deploy.html)

## Delivery sequence

1. **Product decisions recorded:** any verified email/password, a sole organiser, manually created locations, multiple-event membership, concealed admin pairings with deliberate reveal, and per-event signup/exchange dates. No further product clarification is needed to begin implementation; participant scale will inform capacity validation.
2. **Build the visual foundation:** replace the old implementation, create the app structure and responsive event/signup/recipient/admin screens with development-only sample data, add the complete guide, two countdowns, reveal controls, and snow effect. Production starts without preset events.
3. **Connect accounts and events:** implement Firebase Authentication, protected membership operations, the sole organiser's permissions, configurable dates, and event administration; verify Security Rules in local emulators.
4. **Implement the draw:** test matching invariants, concurrent actions, private assignment reads, publication, and interrupted-draw recovery using representative event sizes.
5. **Prepare and verify launch:** finish mobile/keyboard/reduced-motion checks, configure the GitHub Pages workflow, Firebase settings/rules, domain and HTTPS, and run an end-to-end smoke test with test accounts before real signups. Document configuration, running locally, and deployment.

## Acceptance checks

- The sole organiser can manually create two differently named events with different signup and exchange dates. They accept signups and run draws independently, and production starts without preset locations.
- The same verified account can join both events and view its own independent recipient in each.
- An unverified account cannot join an event. A user cannot join an event twice, impersonate another member, grant themselves organiser rights, or change membership after the cutoff/lock.
- Only the correct organiser can trigger or publish a draw; concurrent attempts cannot publish conflicting results.
- Every enrolled participant gives and receives exactly once, with no self-assignment.
- A participant cannot retrieve another person's assignment by changing a URL, issuing a direct database request, or listing assignment records.
- No participant sees partial/unpublished results, and an interrupted draw can recover without changing an already published assignment.
- Admin recipients remain concealed on initial load and after a draw. Revealing one row does not reveal others; Hide and navigation/reload conceal it again, including for assistive technology.
- Both countdowns reflect each event's configured times, handle UK daylight-saving transitions, and display appropriate ended states. The guide's date agrees with the signup deadline.
- Server-side deadline checks reject late joins even with an incorrect browser clock. Changes to party logistics after a draw preserve all assignments.
- Account recovery and returning on another device preserve access to the same membership and recipient.
- The guide, snow toggle, reduced-motion behaviour, mobile layout, and keyboard navigation work.
- Direct event/admin links work after refresh on GitHub Pages; the static build is also usable by a conventional web server.

Implementation and local verification are complete. See README.md for local previews, test commands, and the remaining live setup steps.
