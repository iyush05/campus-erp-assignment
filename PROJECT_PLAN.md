# Campus ERP — Phase 1 delivery plan

Build an eight-week pilot for the engineering campus, initially covering B.Tech CSE. Deliver one shared student record, programme masters, reliable offline attendance, moderated internal marks, fee dues and explainable at-risk flags. Use two roles: faculty and office admin. Keep the product to eight main screens.

This is a delivery proposal for a new project. At planning kickoff, the workspace had no application; implementation checkpoints appear below. Budget is not a planning constraint. The eight-week timeline and core-build requirements define the pilot; broader ERP modules and live external integrations remain in a later phase to allow focused implementation, validation and rollout.

**1. Scope and priorities**

| Deliver in Phase 1 | Exact boundary |
| --- | --- |
| Foundation | Campus, department, programme, batch, semester, section, subjects, faculty assignments, academic calendar and manual period register |
| Student record | Validated CSV import, stable student ID, unique roll number per campus, enrolment and student detail view |
| Attendance | Period-wise mobile marking, offline roster and drafts, durable sync queue, conflict handling, below-75% alerts |
| Internal marks | Configurable components totalling 40 for the pilot, draft entry, submission, moderation lock, mark sheet and one university export format |
| Fees | Programme/category fee configuration, opening balances, scholarships/concessions, dues ledger, mock payment link and explicitly labelled test receipt |
| Operations | Faculty/admin dashboards, attendance shortage list, dues export, mentor tasks, audit history and scheduled mock reminders |
| AI | Evidence-based at-risk triage using attendance and marks history; mentor task is its only operational effect |

Phase 2: full application/document/confirmation workflow; student and parent portals; English/Odia parent messaging; staff leave; live payments and bank reconciliation; production Tally integration; trust dashboards and remaining campuses; institution-specific AICTE/NAAC reports; plain-English analytics.

Timetable generation, payroll, hostel, transport and library remain outside the project. Manual scheduled-period entry/import is included because attendance completeness needs a denominator.

Optional depth only after core acceptance: mock bank-statement reconciliation and a sample Tally export. Neither is a committed production integration.

**2. Eight-screen product map**

Login is a utility route. Forms, previews and audit details use drawers or tabs within these eight main screens.

| Screen | Principal user | Main action |
| --- | --- | --- |
| 1. Overview | Both | Faculty: today's classes, pending sync and mentor tasks. Admin: missing attendance, marks awaiting moderation and dues |
| 2. Academic setup | Admin | Configure programme, batches, subjects, faculty assignments, calendar and scheduled periods |
| 3. Students | Admin; scoped faculty access | Import/search students, inspect one record and view attendance/marks history; financial tab restricted to admin |
| 4. Take attendance | Faculty | Open assigned class, mark all present, toggle exceptions, review and save |
| 5. Attendance register | Both | Filter by date/subject/section, review shortages, resolve sync conflicts and audit corrections |
| 6. Internal marks | Both | Enter component marks, submit, moderate/lock and export |
| 7. Fees and dues | Admin | Inspect ledger, record approved adjustments, simulate payment and export dues |
| 8. Student support | Both, within scope | Review risk evidence, assign mentor, acknowledge/dismiss/close task |

Use a single navigation pattern, white backgrounds, restrained teal/blue accents, clear typography and consistent table/filter/action placement. Use colour with text labels. Mobile attendance gets large tap targets, a sticky save bar and a visible sync state. Tables need search, useful empty states, readable column alignment and keyboard support. Put secondary actions in row menus; avoid charts that do not inform an action.

Attendance usability target: a trained faculty member records a preloaded class of 60 with up to five absences in under 30 seconds. This measures entry after identifying attendees, not the time needed to call roll.

**3. Recommended architecture**

Use a modular TypeScript application: Next.js/React UI and server endpoints, PostgreSQL for authoritative records, and a small background worker using a database-backed jobs table for alerts, exports and AI tasks. Use a responsive progressive web app rather than separate native apps. Keep schema migrations and shared validation in the repository. Next.js supports server route handlers for this application structure. [Official documentation](https://nextjs.org/docs/app/getting-started/route-handlers)

Use a service worker for the offline application shell and IndexedDB for assigned rosters and the attendance outbox. Retry when the app opens, regains focus or detects connectivity, and offer a manual Sync action. Background Sync is only an enhancement because browser support is limited. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

Use authenticated server sessions, server-side authorization and PostgreSQL row policies as defence in depth. Run application queries with a non-owner database role that cannot bypass these policies; pass trusted user scope per transaction. Policy absence should deny access. [PostgreSQL policy documentation](https://www.postgresql.org/docs/15/sql-createpolicy.html)

Use managed database backups, staging and production environments, structured logs and error monitoring. Prefer an India hosting region as a project choice; do not describe it as a universal DPDP localization requirement. Start with one deployable application plus worker, rather than microservices.

Suggested repository modules: identity, academics, students, attendance, assessments, fees, support, reporting and audit. Pin supported dependency versions at implementation kickoff.

**4. Data model and access**

One immutable `student_id` follows a student across admissions, enrolments and future graduation. Roll numbers and programme assignments are attributes, not the identity key. Do not merge people using names alone.

| Domain | Main records |
| --- | --- |
| Scope and identity | Trust, Campus, Department, User, RoleAssignment, FacultyAssignment |
| Academics | Programme, Batch, Term, Section, Subject, CourseOffering, CalendarDate, ScheduledPeriod |
| Student | Student, Enrolment, Guardian, ConsentRecord, ImportBatch, SourceRecordMapping |
| Attendance | AttendanceSession, AttendanceEntry, SyncOperation, AttendanceCorrection |
| Assessment | AssessmentComponent, MarkEntry, ModerationBatch, ExportSnapshot |
| Finance | FeeStructure, FeeAssessment, ScholarshipAdjustment, Payment, PaymentAllocation, Receipt |
| Operations | RiskAssessment, MentorTask, NotificationJob, AuditEvent |

Enforce uniqueness for a class session by course offering, section, date and period; for attendance by session/student; for marks by enrolment/component; and for payments by provider reference. Store money in integer paise and dates/times with explicit Asia/Kolkata reporting rules.

Faculty see assigned classes and student academic records only. Admin access is restricted to assigned campus/departments; moderation is an explicit permission within the admin role. Fees and guardian contacts are restricted to authorized office staff. Apply the same scope to exports, AI inputs and background jobs. Test attempted access using direct API calls, not just hidden navigation.

**5. Offline attendance: the critical engineering work**

1. While online, faculty sign in and download assigned rosters and upcoming periods. Show which classes are available offline. First use and initial roster download require connectivity.
2. On class selection, load the cached roster. Entries start unmarked; a deliberate “Mark all present” action fills them, then faculty toggle absences. Save requires review of totals.
3. Commit the draft and an outbox operation in one IndexedDB transaction before showing “Saved on this device.” Include operation ID, session ID, roster version, base server version, author, device ID and locally recorded time.
4. Sync using an authenticated request. The server rechecks the current role, faculty assignment, enrolments and correction window, then atomically writes attendance and its audit event.
5. An operation ID makes retries idempotent. Remove an outbox entry only after the server acknowledges that operation. A lost response must be safe to retry.
6. Use optimistic version checks. Conflicting edits produce a comparison of local/server values. Faculty or an authorized admin explicitly resolves it; never silently use last-write-wins.
7. Make states unmistakable: Draft, Saved on device, Syncing, Synced, Conflict, Needs sign-in and Rejected. Show the number of unsynced classes on the dashboard.
8. Retain queued changes after reload, browser restart and expired login. Re-authenticate as the original user before sync; reject revoked permissions and retain a recoverable local draft for review.

Cache only required roster data, not fees or guardian details. Isolate local data per user. Explicit logout clears sensitive local records after warning about unsynced entries and offering synchronization or deliberate discard. Unexpected session expiry must not silently discard work. Document that clearing browser storage can destroy unsynced data; never promise server durability before acknowledgement.

Test on actual Android Chrome and iOS Safari devices: airplane mode, reload offline, duplicate delivery, timeout after server commit, concurrent edits, changed roster, revoked access, expired session, storage failure and service-worker upgrade with queued records.

Attendance percentages use confirmed held periods and eligible enrolment dates. Cancelled classes do not count. Unsubmitted classes appear as missing data rather than automatically absent. Freeze rules for late/excused attendance in week 1. The shortage threshold is strictly below 75%; the AI cannot change it.

**6. Marks and fee integrity**

Marks follow `Draft → Submitted → Locked`. Faculty edit drafts for assigned subjects. Admins review submissions, return them for correction or lock a complete batch. Distinguish zero, absent and not entered. Validate component maxima, total weighting and the agreed rounding rule on the server.

Locking and writing must use the same transactional guard so a concurrent save cannot slip through a lock. Locked records reject normal edits. An authorized reopen requires a reason, creates an audit event and invalidates the prior export version; re-moderation creates a new locked version. Log actor, timestamp, old value, new value, reason and operation/version identifiers. Application users cannot modify audit records.

Export from a locked snapshot using one versioned university template. Validate headers, subject codes, roll numbers, required fields and rounding against the university's current sample. If a template is unavailable, provide a clearly labelled generic CSV and leave university-format acceptance pending.

Fee dues derive from assessments minus approved concessions and allocated payments. Do not maintain an independently editable “balance.” Preserve an adjustment trail and prevent duplicate mock callbacks from reducing dues twice. Test success, failure, cancellation and pending payments; issue test receipts only for confirmed mock success. Mark every simulated link, transaction and receipt as TEST.

Opening dues can be imported from the legacy system, with source date and reconciliation totals. This supports a dues pilot; it does not replace full historical accounting or prove bank/Tally reconciliation.

**7. AI and scheduled automation**

Keep fixed rules separate from AI: attendance shortage, marks validation, moderation and fee calculations are deterministic. Scheduled jobs generate shortage alerts and mock reminders, recording delivery state and deduplicating repeated runs. Suppress reminders when a balance is cleared or the underlying data is stale.

For the required AI feature, compute scoped attendance and assessment trends on the server. A constrained model classifies students for mentor review from those aggregates and returns a structured explanation with evidence references. It receives pseudonymous IDs and no names, contact details or fee history. Validate its output and reject invented evidence. Approved thresholds remain visible alongside the AI interpretation.

Suggested initial feature window: the last four teaching weeks versus the preceding four, plus the latest two comparable assessments. Flag insufficient history explicitly. No trained dropout model or statistical probability claim is justified by three sample records. Treat output as an unvalidated support signal and review it with faculty before operational use.

An AI flag can create one open mentor task per student/reason window; it cannot change attendance, marks, fees or send a punitive message. Store model/prompt version, evidence, timestamp and faculty disposition. On provider failure, show AI unavailable while fixed-rule alerts continue. Use a deterministic mocked model adapter for automated tests, visibly labelled in demonstrations; validate the real integration on synthetic data before any approved use of student data.

Plain-English analytics is Phase 2. Have the model propose a constrained query description, show filters/date range/row count, then compile it to parameterized queries over allowlisted reporting views. Use a read-only database role, campus/department policies, row limits, timeouts and allowlisted expressions/functions. A SELECT prefix alone is insufficient protection. Do not expose a general write-capable database tool to the model.

**8. Sample data and migration**

Preserve the three supplied records exactly as raw demo fixtures. Only Subhashree Mohanty's B.Tech CSE record belongs in the default pilot import. Keep Ankit Panda (Mechanical) and Farheen Ali (MBA) as out-of-scope import fixtures; reject or quarantine them with an explanation rather than silently changing their programme.

Create clearly labelled synthetic CSE students, faculty, periods, component marks, fee categories and attendance history for realistic demonstrations, including below-75%, unpaid-fee and insufficient-history cases. Do not invent historical records for the named students from their aggregate percentages: the supplied data lacks attendance denominators, dates and component breakdowns. Keep supplied percentages and totals as provenance-labelled legacy snapshots until detailed data is supplied.

Import workflow: upload → map fields → validate → preview duplicates/errors → confirm valid rows → save source mappings and totals. Support safe reruns without duplicate enrolments. Required client inputs include programme/batch lists, assigned faculty, period register, component rules, fee rules, current university template and agreed student-ID matching rules.

**9. Privacy and operations**

Build purpose-specific notices, age/guardian records, evidence of consent where applicable, restricted guardian access, retention settings, access/correction request handling and a breach response runbook. Keep personal data out of logs and analytics; encrypt transport and managed storage; minimize exports and audit their creation. Restore a backup in staging before launch.

The DPDP Rules were notified in 2025 with phased implementation, so use the final rules and commencement schedule when setting the production obligations. Confirm the institution's applicable child-consent requirements and education-specific exemptions rather than assuming a blanket exemption. [MeitY rules and enforcement documents](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025) [Government explanation for education platforms](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2202901&lang=2&reg=3)

**10. Eight-week execution schedule**

| Week | Work | Exit evidence |
| --- | --- | --- |
| 1 | Confirm scope/rules/templates, prototype screens, schema, identity and offline spike | Reviewed screen flow; attendance survives offline reload and later sync on target devices |
| 2 | Masters, class assignments, CSV import, student records, access controls, seeded demo | Admin imports CSE roster; faculty sees only assigned classes; scope-isolation tests pass |
| 3 | Complete attendance capture/outbox, server idempotency and version checks | Timed mobile workflow; duplicate requests and interrupted sync do not lose/corrupt attendance |
| 4 | Attendance register, conflicts, corrections, shortage jobs and first live pilot | One section uses attendance for a teaching week; missing-data and sync metrics visible |
| 5 | Component marks, submission, moderation lock, audit, mark sheet and export | Concurrent-write/lock tests pass; university sample validates without retyping |
| 6 | Fee ledger, concessions, mock payments/receipts, dues dashboard and risk triage | Balances reconcile to seed/import totals; duplicate callbacks safe; AI evidence and mentor flow reviewed |
| 7 | End-to-end UAT, device/accessibility checks, load test, backup restore and privacy review | No unresolved critical defects; staff complete agreed workflows independently |
| 8 | Migration rehearsal, final import, training, deployment and handover | Named owners accept pilot; runbook, source, deployment instructions and support backlog delivered |

Start a limited attendance pilot in week 4 to gather adoption evidence before the end of the project. Reserve weeks 7–8 for stabilization; do not add optional modules then. Secretary signs scope and commercial acceptance; nominated faculty, exam and accounts leads validate their workflows. A campus data owner signs off imports.

**11. Delivery team and ownership**

Staff the project for reliable delivery within eight weeks. Assign clear owners and run independent workstreams concurrently once the shared schema, permissions and API contracts are agreed in week 1.

| Role | Ownership |
| --- | --- |
| Technical lead/backend engineer | Architecture, student identity, authorization, transactional integrity and code review |
| Frontend/PWA engineer | Shared interface, mobile attendance, offline storage and sync experience |
| Full-stack engineer | Marks, moderation, fee ledger, exports and risk-triage integration |
| Product designer | Eight-screen prototype, design system, usability sessions and accessibility |
| QA engineer | Automated workflow tests, real-device failure testing, regression and UAT coordination |
| Delivery/business analyst | Academic rules, client dependencies, migration mapping, training and acceptance |
| Platform/security specialist, as needed | Deployment, monitoring, access review, load testing and backup recovery |

Provision staging, production, managed backups, monitoring and representative test devices from the start. Schedule faculty, exams and accounts reviewers throughout delivery. Additional staffing can accelerate independent modules, but client data, university templates and classroom validation remain schedule dependencies. Preserve weeks 7–8 for stabilization and acceptance.

**12. Acceptance and measurement**

| Outcome | Evidence required |
| --- | --- |
| Same-day attendance | At least 95% of held scheduled pilot periods reach the server by 23:59 IST over two consecutive teaching weeks. Track locally saved but late-synced sessions separately; exclude cancelled periods |
| Fast entry | Trained faculty complete the defined 60-student scenario in under 30 seconds on target devices |
| Offline reliability | No lost or duplicate attendance in the agreed failure tests; conflicts surface for resolution; pending work survives reload/restart |
| University export | All pilot marks accepted by the supplied validator or a university upload rehearsal without retyping. If external validation is unavailable, keep this criterion pending |
| Marks integrity | Locked writes, concurrent edits and unauthorized reopening rejected; approved corrections fully audited |
| Fee correctness | Per-student and aggregate ledger totals match signed-off import/test records to the paise; duplicate callbacks cannot duplicate allocation |
| Role isolation | API, export and background-job tests show no access outside campus/department/assignment scope |
| Risk triage | Flags show supporting history or insufficient-data status; only mentor tasks created; duplicate jobs do not duplicate open tasks |
| Recovery | Backup restored successfully; proposed pilot recovery targets: RPO ≤24 hours and RTO ≤4 hours, demonstrated in rehearsal |

Fee reconciliation from ten days to one is a later production acceptance target requiring real bank records, matching rules, exception handling and Tally acceptance. If the Secretary requires this within Phase 1, assign a dedicated integration workstream and confirm external access and acceptance dates before revising the delivery schedule; a mock does not establish the outcome.

Results-day demand is a future expansion gate because student access is outside this pilot. Seed 7,800 synthetic students now and load-test scoped read endpoints with authenticated, isolated traffic. Propose a 7,800-session arrival burst and separately define request rate/think time; measure error rate below 1% and p95 reads below 2 seconds on a recorded environment. Passing a backend simulation does not certify a future parent/student portal. Use indexed queries, pagination, pooled database connections and precomputed aggregates; never publicly cache personal records.

The supplied annual benefit is ₹124.8 lakh faculty time plus ₹34.56 lakh office time = ₹159.36 lakh, or ₹1.5936 crore. This is a trust-wide capacity estimate, not guaranteed cash savings or the benefit of a one-programme pilot. Measure actual adoption and time saved before extrapolating or presenting payback.

**13. Handover demonstration**

Admin imports the CSE roster and assigns faculty → faculty downloads a class → device goes offline → faculty marks attendance in under 30 seconds → reload preserves the draft → reconnect synchronizes once → shortage appears → faculty enters marks → admin moderates/locks → attempted edit is rejected → locked university export is generated → admin inspects dues and completes a test payment → AI shows evidence and creates a mentor task → audit history identifies every consequential change.

Deliver the application, schema/migrations, labelled seed fixtures, tests, environment-variable template, deployment guide, backup/recovery instructions, faculty/admin quick-start guides and a prioritized Phase 2 backlog. The first implementation milestone is the offline attendance spike and reviewed eight-screen prototype.

**Implementation checkpoint — 6 November 2026**

The first demo is implemented at this repository root, with all eight screens, seeded records, CSV import, subject setup, offline attendance drafts/outbox, conflict handling, moderated marks, fee dues/test payments and rule-based mentor tasks. A standalone client build and local SQLite server are included. The hosted path uses the Sites Vinext starter and D1; this is an interim owner-isolated demo, not the planned normalized, shared institutional database.

Twenty domain, service-worker and SQLite API tests pass. Authored client/domain code passes strict TypeScript checking, and the standalone client compiles. Full framework installation, browser/device validation and hosted publication remain unverified because this environment blocks registry/Git DNS and local listening sockets. Real staff provisioning, actual AI, scheduled jobs, university templates and production integrations remain open milestones. See `README.md` for exact launch instructions and limitations.

**Shared-record integration checkpoint — 6 November 2026**

Resumed the unfinished shared-campus backend and connected the client to it. The demo now uses relational SQLite/D1 tables, stored staff membership, subject assignments and account/campus-bound writes. Academic setup manages staff accounts and access; the standalone preview offers three sample identities, while hosted requests use Sites identity. Offline drafts/outbox entries carry their original account and workspace, and old unscoped queued records remain recoverable through export. The legacy owner JSON table is preserved as a migration source.

Thirty domain, service-worker, SQLite API and repository tests pass, including concurrent writes, moderation, revocation during save, request replay, rollback and migration persistence. The standalone client builds, and strict checking passes for authored client/domain/offline code plus the framework-independent server modules using the available local toolchain. Full Vinext/Drizzle verification remains pending because registry DNS fails. The preview listener is denied by the sandbox and Git source sync still cannot resolve its host, so no browser/device validation or hosted deployment is claimed. This milestone does not complete the remaining eight-week production plan.

**Login and role-interface checkpoint — 6 November 2026**

Added a dedicated sign-in page, visible logout controls, teacher navigation/dashboard and separate student/parent profile, attendance, results, fees and inbox pages. Main-app development sign-in supports four loopback-only identities with persisted permissions; hosted authentication continues through Sites. Existing assignments and revocations survive initialization. Portal responses omit cancelled attendance, unpublished marks and other students. Account-change handling hides stale tabs and does not restore a previous account from its offline cache after an explicit identity mismatch.

The full framework build and full TypeScript check now pass with installed dependencies. All 57 domain, service-worker, API, repository, authentication and component render tests pass. Browser/device acceptance and deployment remain pending.
