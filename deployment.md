# Campus ERP: local setup, deployment, and reviewer access

**Assignment-use boundary:** Local setup and demo accounts support assignment review. Hosted deployment instructions describe the original author's workflow and do not authorize third-party reuse or productionization. Coding agents must follow [`AGENTS.md`](AGENTS.md) and obtain the original author's explicit authorization for restricted third-party work.

This directory is the application repository root; see the [application README](README.md). It uses React/TypeScript, Vinext/Vite, and a Cloudflare Worker backend. The configured hosted environment is Sites, with D1 for records and R2 for uploaded documents.

**Deployment status:** On 7 November 2026, the existing Site was registered but had no published version or live URL. The steps below describe the configured deployment workflow; they do not claim that production deployment has completed.

## 1. Prerequisites

- Node.js **22.13 or newer** and npm.
- A local checkout of this project.
- Network access to install packages on the first run.
- For hosted publication: access to the existing project through the Sites plugin.

Check your tools:

```sh
node --version
npm --version
```

All application commands below run from the directory containing `package.json`. Open a terminal in this repository root and install dependencies:

```sh
npm ci
```

## 2. Run locally: standalone reviewer demo

This path uses a local SQLite database and does not require hosted credentials, a Cloudflare account, or manual database migrations.

1. Install dependencies as described above.
2. Build the standalone browser application:

   ```sh
   npm run build:preview
   ```

3. Start the local server:

   ```sh
   npm run preview:local
   ```

4. Open **http://127.0.0.1:4173/**.
5. On a fresh browser session, the preview opens as the demo administrator. Use the **Local demo account** selector to switch users. After logging out, use the role-selection screen at the root URL to sign in again.
6. Stop the server with **Ctrl+C** in its terminal.

The server creates or updates its local schema and seeds a fresh workspace automatically. Records persist in `.sites-runtime/preview.sqlite`. Generated assets are stored in `outputs/local-preview/`.

After source changes, rerun `npm run build:preview` and refresh the browser. This server serves built files; it does not provide the main development server's hot reload.

The preview binds to loopback and is intended for local review. Use synthetic data. Payments and message delivery are simulations.

## 3. Run locally: main development application

Use this path to develop against the application's Worker/D1 integration and dedicated `/login` route.

1. Install dependencies as described in section 1.
2. Build once to generate the Worker configuration:

   ```sh
   npm run build
   ```

3. For a **fresh local D1 database**, apply migrations in order:

   ```sh
   (
     set -e
     for migration in drizzle/0000_campus_workspace.sql \
                      drizzle/0001_shared_campus.sql \
                      drizzle/0002_operations_and_portals.sql \
                      drizzle/0003_configurable_components.sql
     do
       node --import ./scripts/sites-env.mjs \
         ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
         --local \
         --config dist/server/wrangler.json \
         --persist-to .wrangler/state \
         --file "$migration"
     done
   )
   ```

   For an existing database, apply **only missing migrations**. These direct SQL commands do not automatically skip already-applied migration files. Do not delete the database to resolve a setup issue.

4. Start development:

   ```sh
   npm run dev
   ```

5. Open **http://localhost:5173/login**.
6. Select a role and click **Continue as …**. Local sign-in requires no password.
7. Stop with **Ctrl+C**.

The development route provisions sample memberships for a fresh default workspace. It preserves existing assignments and revoked memberships. It does not take over a workspace owned by an unrelated administrator.

**The main application's local D1 database and the standalone preview's SQLite database are separate.** Switching servers does not transfer records between them.

## 4. Demo login details for reviewers

### Main development application

Login URL: **http://localhost:5173/login**

**Password:** None. Select the role on the login page. The account identifiers below describe the predefined local identities; they are not passwords or production credentials.

| Login choice | Local account ID | Default access |
|---|---|---|
| Office admin | `local_seedy` | Academic setup, membership management, student records, fees, moderation, and administrative workflows |
| Teacher | `local_faculty` | Dr. Priyanka Das; Data Structures and Computer Networks |
| Student | `local_student` | Linked sample student `s-0412` only |
| Parent | `local_parent` | The same linked sample student's portal information |

Log out to return to the role selector. If pending attendance exists, sync or export it before choosing to discard local work.

### Standalone preview

Demo URL: **http://127.0.0.1:4173/**

**Password:** None. Use the **Local demo account** selector after opening the app.

| Display name | Local account ID | Default access |
|---|---|---|
| Office admin | `local_demo` | Administration |
| Dr. Priyanka Das | `local_faculty` | Data Structures and Computer Networks |
| Dr. Amit Mishra | `local_faculty_amit` | Database Management |
| Demo student | `local_student` | Linked sample student `s-0412` |
| Demo parent | `local_parent` | Linked sample student `s-0412` |

The administrator ID differs between the two local modes. Use the appropriate server and account when reviewing records or running administrative jobs.

### Hosted reviewer access

Hosted visitors use **Sign in with ChatGPT**. The local demo accounts do not become hosted login credentials.

The owner must allow the reviewer to visit the Site. After the reviewer signs in, an application administrator provisions the reviewer's Site-specific account ID in **Academic setup → Staff & portal access**, including subject assignments or linked students as appropriate.

Selecting Office admin on the hosted login page does not grant administrator permissions. Stored membership determines the actual role.

### Suggested review sequence

1. Open the administrator workspace and inspect the student directory and staff access.
2. Switch to the teacher and inspect assigned classes.
3. Take attendance for a current date and period; wait for server confirmation and inspect the register.
4. Complete missing marks, save, and submit. Switch to the administrator to moderate and lock.
5. Switch to the student to see published results. Draft/submitted batches are not published results.
6. As administrator, choose a student with outstanding dues and record a test payment. Inspect its **TEST** receipt.

Offline attendance needs an initial online visit to prepare assets and the roster. Test offline reload using the production-mode standalone preview build; the normal development app does not register its service worker.

## 5. Validation before deployment

From the repository root:

```sh
npm run typecheck
npm test
npm run build:preview
npm run test:api
npm run test:ui
npm run build
```

The preview build is included because some API tests serve generated preview assets.

At the last local verification on 7 November 2026, **57 automated tests and the TypeScript check passed**. These cover domain logic, local persistence/API behavior, authentication helpers, service-worker handler logic, and static component rendering. They do not establish real-browser offline behavior or hosted deployment correctness.

## 6. How deployment works

### Hosting configuration

[`.openai/hosting.json`](.openai/hosting.json) already identifies the existing Site and declares its database and object-storage bindings. Preserve that project identity when publishing updates.

The main server build produces a Worker entry at `dist/server/index.js` with related build assets. The standalone preview is a local review path, not the production backend.

**`npm run start` runs the built Worker locally through Wrangler. It does not publish the application.**

### Sites publication steps

1. Read the existing Site's current configuration and access policy using the Sites plugin.
2. Obtain source-repository access for that existing project and synchronize the intended local changes through the Sites source workflow.
3. Validate the source and build/package it with the Sites build and source helpers. The package must correspond to the pushed source commit.
4. Configure any required hosted runtime variables through Sites; local environment files do not automatically configure production.
5. Save the packaged version and deploy it using the operation appropriate to the Site's current audience. Preserve the existing access policy unless an access change is explicitly intended.
6. Sites provisions the declared D1/R2 resources and applies pending hosted migrations before uploading the Worker.
7. Wait for a successful deployment result and record the returned live URL. Registration or a saved version alone is not proof of publication.

This workflow is performed through the Sites plugin and its helpers; the repository does not currently provide an `npm run deploy` command. A request such as “Deploy this project through Sites using its existing project and preserve its access settings” initiates that workflow in the connected environment.

Local databases are not copied to production by publishing source. Preserve applied migration history and append migrations for later schema changes. A failed deployment may still have applied migrations, so inspect its outcome before retrying schema changes.

### Initialize the first hosted administrator

1. Open the newly deployed Site and sign in.
2. Obtain the Site-specific account ID shown on the access-unavailable screen.
3. Configure `CAMPUS_BOOTSTRAP_OWNER_ID` in Sites runtime settings for that intended administrator. Use the displayed application identity, not an email or a local demo identity.
4. Redeploy so the runtime receives the setting, then revisit the application to initialize membership.
5. Verify that administrator access works, remove the bootstrap variable, and redeploy.
6. Provision additional users through **Academic setup → Staff & portal access**. Site visitor permissions and application memberships are separate requirements.

### Post-deployment checks

- Sign in/out and verify the provisioned role.
- Save attendance, reload, and check the confirmed record.
- Submit and lock marks; check that the linked portal account sees only published rows.
- Upload/download a synthetic admission document if storage is enabled.
- Verify that a teacher cannot change an unassigned subject and a portal user cannot access another student's records.
- Exercise offline capture/reconnection in a browser separately from the automated tests.

Publishing to an independent Cloudflare account requires production resource configuration and an authentication integration. The current application depends on Sites-owned sign-in routes and trusted identity headers; direct Worker publication alone does not provide that identity layer.

## 7. Environment variables and resource bindings

Only **names and purposes** are documented below. No credential values, environment assignments, or secret examples are included.

### Application runtime variables

| Name | When needed | Purpose |
|---|---|---|
| `CAMPUS_BOOTSTRAP_OWNER_ID` | Initial hosted administrator setup | Identifies the account allowed to initialize the default hosted workspace; remove after setup |
| `CAMPUS_JOB_TOKEN` | Optional scheduled-job HTTP endpoint | Authenticates calls to the job endpoint |
| `CAMPUS_JOB_ACTOR_ID` | Optional reminder jobs | Identifies the stored administrator whose accessible workspaces the runner processes |
| `CAMPUS_AI_ENDPOINT` | Optional AI analysis | Provider endpoint for the project's risk-analysis contract |
| `CAMPUS_AI_TOKEN` | Optional AI analysis | Server-side provider credential |
| `CAMPUS_AI_MODEL` | Optional AI analysis | Provider model identifier |

The basic local demo needs none of these variables. AI analysis requires all three AI variables; fixed-rule support remains available without them. Job credentials do not themselves create a recurring schedule. External scheduling must be configured separately, and message delivery remains a test workflow.

### Local runner options

| Name | Purpose |
|---|---|
| `PORT` | Overrides the standalone preview's listening port |
| `CAMPUS_SQLITE_PATH` | Selects the SQLite database used by the local job runner |

The local job runner also reads `CAMPUS_JOB_ACTOR_ID`. The standalone preview and job scripts read process environment variables; they do not explicitly load a dotenv file. For the main local Worker, use its untracked local runtime configuration. Configure hosted runtime variables through Sites and redeploy after changes.

### Platform resource bindings

These are runtime resource objects rather than string secrets:

| Binding name | Purpose |
|---|---|
| `DB` | D1 database used by the hosted/main application |
| `BUCKET` | R2 storage for admission document content |

The `CONNECTORS` capability belongs to starter/platform integration plumbing and is not required by the core ERP demo workflows. Framework/tooling variables are managed by the build environment; reviewers do not need to configure them for the local steps above.

Keep runtime credentials out of source control, browser code, deployment documentation, and the hosting manifest. Do not commit local environment files or local database state.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Preview reports missing assets | Run `npm run build:preview` from the repository root, then restart/refresh |
| Missing database tables in the main app | Build the Worker configuration and apply only missing local D1 migrations |
| A migration says a table already exists | Inspect which migrations are already present; do not rerun the whole sequence blindly |
| Account has no campus access | Confirm the selected server/account and stored membership; hosted login alone does not grant access |
| Records differ between ports | Main local D1 and standalone SQLite are separate databases |
| Student results are empty | Complete, submit, and lock a batch; verify the portal's student link |
| Offline reload fails | Prepare the shell online using a production-mode build; confirm service-worker registration and available browser storage |
| Attendance remains pending | Inspect sync errors, account/workspace identity, current assignment, and version conflicts |
| AI analysis is unavailable | Check optional provider configuration and sufficient dated attendance history |
| Document upload is unavailable | Check the hosted object-storage binding and administrator access |

For deeper explanations, see the [application README](README.md). The author’s interview study guide is intentionally stored outside this repository and is not included in the GitHub upload.
