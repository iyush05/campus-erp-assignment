# Campus

This application is an assignment submission. Read [`AGENTS.md`](AGENTS.md) before agent-assisted work: review and local evaluation are allowed; third-party reuse or productionization requires the original author's explicit authorization.

An eight-screen academic ERP pilot for one engineering campus and B.Tech CSE. The interface connects the dashboard, student directory, mobile attendance, attendance register, internal marks, fees, mentor support and academic setup.

See [deployment.md](deployment.md) for local setup, deployment, environment variable names, and reviewer accounts. The [project plan](PROJECT_PLAN.md) and [project overview](docs/PROJECT_OVERVIEW.md) are included here. The author’s interview study guide is intentionally kept outside this repository.

## Main application: login and role workspaces

The main application runs on **http://localhost:5173** with `npm run dev`. `/login` is the dedicated sign-in page. Anonymous visitors see the same sign-in screen at `/`. Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
```

For a **fresh** local D1 database, apply migrations once in order. For an existing database, apply only missing migrations; do not delete or reset its data.

```sh
(
  set -e
  for migration in drizzle/0000_campus_workspace.sql drizzle/0001_shared_campus.sql drizzle/0002_operations_and_portals.sql drizzle/0003_configurable_components.sql
  do
    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration"
  done
)
npm run dev
```

Choose Student, Teacher, Office admin or Parent at `/login`. **Development sign-in is simulated and requires no password.** It is restricted to loopback and disabled in hosted builds. The main development server provisions these stored memberships on first access when the default campus belongs to `local_seedy`:

| Sign-in | Account ID | Workspace access |
| --- | --- | --- |
| Office admin | `local_seedy` | Campus administration and account provisioning |
| Teacher | `local_faculty` | Data Structures and Computer Networks assignments |
| Student | `local_student` | The existing student `s-0412` only |
| Parent | `local_parent` | The same linked student's published information |

Existing role changes and revoked accounts are preserved. A database owned by a different admin is not taken over; that admin must provision these identities explicitly. No extra migration is required for this login/interface update if migrations 0000–0003 are already applied. The earlier `CAMPUS_BOOTSTRAP_OWNER_ID=local_seedy` local setting remains compatible but is no longer needed for a fresh development workspace.

- Teachers have a dedicated dashboard, assigned classes, attendance capture/register, internal marks, mentor support and a My leave page.
- Students have a dashboard, profile, recorded attendance, published results, fees/test receipts, messages and data requests. Parents get the same views scoped to their linked students.
- Log out is visible in the top bar and sidebar. It offers recovery/export for pending attendance before deliberate discard, clears this account's device data, and returns to sign-in. Other open tabs hide their prior workspace when notified of logout/account switching.
- Hosted sign-in remains **Sign in with ChatGPT**. The role choice is an entry point, not an authorization grant: stored membership determines the actual interface and API permissions. An unprovisioned visitor sees their account ID; an admin adds it in Academic setup → Staff & portal access, assigning subjects or linked students. The Site visitor policy must also allow that visitor.

If the dev server was running before these changes, stop it with Ctrl+C in its own terminal, restart `npm run dev`, and open `/login`. Already signed-in accounts can use Log out to return to the role selection screen.

## Open the current build

The client bundle is already generated in `outputs/local-preview`. Node.js 22.13+ is required. In a normal terminal, from this directory:

```sh
npm run preview:local
```

Open **http://127.0.0.1:4173**. This local-only demo uses SQLite at `.sites-runtime/preview.sqlite`, requires no installed packages to serve the existing bundle, and binds only to loopback. The local account picker provides one admin and two faculty identities sharing the same campus records. Their permissions come from stored membership and subject assignments. The picker exists only in this loopback server; hosted identity comes from Sites. Use synthetic data only. Stop with Ctrl+C.

To rebuild the standalone client after installing dependencies:

```sh
npm ci
npm run build:preview
npm run preview:local
```

The preview build helper also accepts an absolute path to an existing compatible `node_modules` directory containing Vite, React and React DOM. This was used to build the first bundle while registry DNS was unavailable. No files in the external toolchain were modified. Generated bundles and local database files are ignored by Git.

## Implemented

- Responsive dashboard and eight linked screens, shared tables, searchable student records and accessible labelled controls.
- 24 seeded CSE students; the supplied CSE sample is preserved without invented attendance periods or assessment components. Other-programme samples remain in `lib/seed.ts` as raw fixtures.
- CSV import with preview, strict programme/year checks, duplicate detection and all-or-nothing validation.
- Programme/batch/semester configuration display, subject creation and faculty assignments. Cohort settings and assessment components are editable with validation; new campus/cohort workspaces start empty.
- Period attendance, present/absent marking, IndexedDB drafts and transactional outbox, foreground/reconnect retries, server acknowledgement, operation idempotency, version conflict review and correction audit.
- Production service worker for the app shell and static assets; API responses and auth routes are never cached. Rosters are cached without fee balances or marks. Open online once before trying airplane mode; the development framework server does not install the worker.
- Internal marks with component limits, draft/save/submit/lock/reopen states, version checks, change audit and locked-version generic CSV export.
- Fee opening balances, partial/full simulated payments, overpayment prevention, idempotent payment commands, dues export and labelled TEST receipts. Failed/cancelled simulations do not change balances.
- Support evidence and mentor tasks using clearly labelled fixed demo thresholds. No trained model or LLM is connected.
- Stored staff membership and faculty subject assignments. Academic setup includes account provisioning, role changes and revocation; staff changes are audited and version checked. Faculty responses omit financial values, audit history and unassigned subjects. An account without subject assignments receives no student roster.
- Shared relational storage for students, subjects, attendance, marks, payments, mentor tasks, staff and audit events. Workspace-scoped keys and foreign keys isolate campuses/departments. Compare-and-swap revisions and atomic batches protect writes, including access changes racing a save.
- Account/campus-bound attendance queues and draft keys. Requests verify the original account before accepting queued writes. Legacy queue items without a campus ID are retained for export/manual review and never assigned to a campus automatically. Cached rosters cannot substitute for an explicit server denial.

## Hosted application

The main application uses React/TypeScript and the Sites Vinext starter. The production API at `app/api/workspace/route.ts` requires Sites identity and active membership in the selected campus workspace. The client cannot select its own role; `x-demo-role` is ignored. POST requests require `x-workspace-id` and `x-expected-user`, and the server rechecks membership and subject assignments before each atomic commit. Operation IDs are bound to the author and command content.

`lib/server/repository.ts` stores records in normalized D1/SQLite tables. `0001_shared_campus.sql` adds the shared schema without deleting the original owner-isolated `workspaces` table. At bootstrap, the configured owner's legacy workspace is copied transactionally, retaining student IDs, payments, audit history and processed operations. Other owners' legacy rows remain untouched. Each workspace represents one cohort, with multiple workspace memberships and application-enforced scope; PostgreSQL row policies, flexible enrolment histories, pagination and large-campus scaling remain future work.

For the first hosted admin, set runtime environment variable `CAMPUS_BOOTSTRAP_OWNER_ID` to the exact **Site-specific authenticated user ID** displayed after sign-in on the access-unavailable screen. Do not use an email or the Sites account-management ID. On that account's next request, the server creates the shared CSE workspace and initial admin, or migrates its existing demo. Remove the bootstrap variable once initialized. Other users receive no access until an admin provisions their account under **Academic setup → Staff access**. They also need permission to visit the Site under its existing Sites access policy. The application does not change that policy.

A private Site is registered in `.openai/hosting.json`. Registration is not publication. No deployment has been verified. Source publication was attempted but Git hostname resolution was blocked by the sandbox.

Once the complete starter dependencies can be installed:

```sh
npm ci
npm run typecheck
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_campus_workspace.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_shared_campus.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_operations_and_portals.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_configurable_components.sql
npm run dev
```

Apply each local migration only once, in order. The standalone SQLite preview applies missing schemas automatically. Set the bootstrap variable in local Worker configuration when testing the framework preview. The portable framework preview offers local sign-in at `/signin-with-chatgpt?return_to=/`. Hosted auth remains platform-owned. The D1 SQL and Drizzle snapshots were authored explicitly because the migration generator could not be installed; verify `npm run db:generate` produces no schema difference before the first hosted deployment.

## Checks

```sh
npm test
npm run test:api
npm run test:ui
npm run typecheck
```

`npm test` needs only Node and tests domain invariants plus service-worker cache boundaries. `test:api` tests the local SQLite adapter and serves the generated assets through its handler without opening a network socket; build the preview first. The full typecheck needs installed framework dependencies.

Verified after the login and role-interface update:

- 57 tests pass: 27 domain/service-worker tests, 26 API/repository/authentication tests and 4 component render tests.
- Full `npm run typecheck` and Vinext `npm run build` pass with the installed dependencies.
- Authentication tests cover all four local identities, cookie expiration on logout, forged headers, unsafe redirects, off-host requests and revocation persistence.
- Permission tests cover student-linked records, teacher assignments, direct API write denial and cancelled-period exclusion.

Interactive browser/device checks and hosted deployment remain unverified. A dev server was detected on port 5173, but the sandbox could not connect to it; its process was left untouched. Passing compilation and handler tests does not prove browser behavior.

## Demo walkthrough

1. Open the local demo as Office admin. In Academic setup, inspect the three provisioned accounts. Select Dr. Priyanka Das in the local account picker; only her two assigned subjects appear.
2. In Take attendance, choose Data Structures, mark all present, toggle two absences and save. Verify the queue clears and the register shows a server-confirmed record.
3. Reload online once to prepare the offline shell. Go offline, choose a different period, mark/save, reload, then reconnect and sync. Never clear browser storage with unsynced work.
4. In Internal marks, fill the supplied student's blank components, save and submit. Switch to the Office admin account, moderate and lock the same shared batch. Export the generic CSV; reopen only with a reason.
5. In Fees & dues, run a successful partial test payment and view its TEST receipt. Try a failed payment and verify the balance is unchanged.
6. In Student support, inspect the evidence, create a mentor task and update its status. Inspect the office-admin activity log.
7. As admin, remove a faculty subject assignment or revoke access. That account cannot read/write the revoked scope. Pending attendance remains on its device, with export available in Attendance sync.

Browser/device verification is still pending for account switching across tabs, offline reload after switching, denied-session cache behavior, transaction aborts and service-worker upgrades with existing queues. Old unsaved drafts remain in the original IndexedDB keys; they are not automatically reassigned or erased. Old queued saves can be exported for manual recovery.

## Remaining production work

- Hosted identity/provisioning validation, institution-approved staff permissions, flexible enrolments and multiple cohorts. The new membership and relational-storage paths are verified locally, not in deployed D1.
- Full fee structures, scholarships/adjustment workflows and production accounting integration.
- Actual university export template and upload validation.
- Real AI adapter with pseudonymous trend features, sufficient historical data and evaluation.
- Scheduled shortage/reminder jobs and delivery adapters; current alerts are calculated in the UI/domain.
- Full admissions, guardian/consent management, parent portal, Odia messages, HR and other campuses.
- Real-device offline testing, cache lifecycle/logout hardening, durable queue stress tests, load testing, security review, operational backups and recovery verification.

No real payments, outgoing messages or changes to external systems are performed.
