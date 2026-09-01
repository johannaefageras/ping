# SvelteKit migration plan

This document is the handoff plan for migrating Ping from FastAPI plus a vanilla
HTML/CSS/JavaScript frontend to SvelteKit with TypeScript. It is intentionally
split into small, ordered steps so a separate chat can complete exactly one
step at a time.

## How to use this plan

1. Read this entire document before editing anything.
2. Inspect the repository and run `git status --short`. Preserve unrelated work.
3. Select the first unchecked numbered step whose prerequisites are complete.
4. Implement only that step. Do not start later steps in the same chat unless
   the user explicitly asks for it.
5. Run every verification listed for the step.
6. Mark the step complete only when all of its completion criteria pass.
   Steps 4 and 5 added machinery every later step should use:
   - `src/lib/contract/routes.ts` holds the route contract as data. When your
     step implements a route, flip its `done` to `true` and its Playwright
     assertions start running. Never weaken an expectation to make a test
     pass — a genuine divergence is an entry in "Approved intentional
     differences", not an edited contract.
   - CI runs on every push (`.github/workflows/ci.yml`). A step is not
     complete while it is red.
   - Two-user tests use the fixtures in `e2e/fixtures/accounts.ts`. Never
     invent account setup; run `npm run test:fixtures:seed` if they are
     missing.
7. In the handoff, report changed files, commands run, test results, decisions,
   and any remaining risks. Do not commit or deploy unless explicitly asked.

Step 1 is complete. `docs/SVELTEKIT_PARITY_BASELINE.md` is the parity reference
that every later step compares against, and it records the approved intentional
differences. Read it alongside this plan.

Suggested prompt for a future chat:

> Read `docs/SVELTEKIT_MIGRATION_PLAN.md`, inspect the current repository, and
> implement only the first unchecked numbered migration step. Preserve existing
> behavior and unrelated changes. Run the listed verification, update the
> checkbox only after it passes, and provide a concise handoff.

## Migration rules

- Preserve the current Supabase project, schema, RLS policies, RPCs, storage
  rules, Auth configuration, and Realtime behavior throughout the migration.
- Never introduce a Supabase service-role key into browser or application code.
- Preserve the public URLs `/`, `/app`, `/config`, `/preview`,
  `/preview/image`, `/privacy`, and `/terms` until an explicitly documented
  cutover changes them.
- Preserve response shapes and relevant status codes for existing frontend
  calls. Record intentional differences in the baseline/parity document.
- Keep the FastAPI application runnable until the SvelteKit production build
  has passed parity testing and a rollback path exists.
- Do not combine the migration with a visual redesign, database redesign, or
  unrelated feature work.
- Keep security checks server-side. In particular, link previews must never
  become a browser-side fetch.
- Prefer TypeScript for new SvelteKit code and small focused modules over a new
  monolith.
- Preserve the existing Swedish user-facing strings verbatim. Command output,
  errors, empty states, and help text are part of the product; translating or
  rewording them is a redesign, not a migration.
- A step is not complete merely because it builds; its listed verification and
  completion criteria must pass.

## Current architecture to preserve

- `server.py` serves pages and static assets, exposes public Supabase config,
  applies security headers, and implements the two link-preview routes.
- `link_preview.py` contains URL/IP validation, metadata parsing, and the
  in-memory TTL cache.
- `static/app.js` talks directly to Supabase for Auth, Postgres, Storage, RPCs,
  and Realtime. There is no privileged application backend.
- `legacy/index.html` (moved out of `static/` by Step 2), `static/style.css`,
  `static/commands.js`, `static/keyboard.js`, and `static/sw.js` make up the
  legacy UI/PWA.
- `tests/test_link_preview.py` and `tests/test_preview_routes.py` define much of
  the current preview contract.
- `static/app.js` also opens a second Realtime channel for presence, keyed by
  user id. It drives the online dots in the contact list and `/who`, and writes
  nothing to the database.
- The UI includes camera photo capture and video recording through
  `getUserMedia`/`MediaRecorder` (`capture-modal`, `record-modal`), an image
  lightbox, and an emoji picker backed by `static/data/emoji-data.json` and the
  emoji SVG set. The `Permissions-Policy` header grants `camera=(self)` and
  `microphone=(self)` for these.
- All user-facing strings are Swedish.
- There is no automated test coverage for the frontend. The 38 Python tests
  cover link previews only, so every UI parity claim rests on the manual
  checklist in `docs/SVELTEKIT_PARITY_BASELINE.md`.
- `render.yaml` deploys FastAPI to Render and must remain the production path
  until the cutover step.

## Ordered implementation steps

1. [x] **Capture the current behavior and establish the parity baseline**

   **Goal:** Create a reliable reference for deciding whether the SvelteKit
   implementation behaves like the existing application.

   **Changes:**

   - Add `docs/SVELTEKIT_PARITY_BASELINE.md`.
   - Document every public route, response shape, important status code,
     redirect, cache header, and security header.
   - Derive the mechanical parts of the contract from the code rather than by
     hand where possible: capture real responses from a running FastAPI process
     (status, headers, JSON keys) into the document with a small script, and
     reserve hand-written prose for behavior a request cannot show. This
     document is load-bearing for every later step, so transcription errors are
     expensive.
   - Document the environment-variable names and state clearly that both
     Supabase values are public client configuration, not service-role secrets.
   - Add a manual smoke checklist covering sign-up/login, password recovery,
     contacts, invites, text/link/file sending, Realtime delivery, receipts,
     history, disappearing messages, archive access, settings, commands,
     keyboard shortcuts, legal pages, and offline/PWA behavior.
   - Open an "approved intentional differences" section and pre-authorize the
     link-preview security hardening from Step 7: per-hop redirect
     revalidation will reject redirect chains that the current
     `follow_redirects=True` implementation accepts, and incremental body
     reads will reject oversized responses earlier. These are deliberate
     improvements, not parity failures, and later contract tests must assert
     the new behavior rather than the old.
   - Run the current Python test suite and record the command and result in the
     baseline document. Do not change runtime behavior in this step.

   **Verification:** Run the existing tests and manually start FastAPI far
   enough to verify `/`, `/app`, `/config`, `/privacy`, and `/terms` respond.

   **Complete when:** The baseline document is detailed enough that another
   chat can test a replacement without reverse-engineering expected behavior,
   and its intentional-differences section already covers the known preview
   hardening.

2. [x] **Relocate the legacy HTML entry point to avoid a SvelteKit asset conflict**

   **Prerequisite:** Step 1.

   **Goal:** Free `static/index.html`, because SvelteKit uses `static/` for
   public assets and will own the generated page at `/`.

   **Changes:**

   - Move the legacy HTML shell to a clearly named location such as
     `legacy/index.html`.
   - Update FastAPI's `/` and `/app` handlers to serve the relocated file.
   - Keep legacy CSS, JavaScript, fonts, icons, audio, manifest, service worker,
     and data files under `static/`.
   - Update tests or documentation that refer to the old HTML path.
   - Make no user-visible changes.

   **Verification:** Run the Python tests, start FastAPI, compare `/` and `/app`
   with the Step 1 baseline, and confirm all referenced assets still load.

   **Complete when:** FastAPI remains fully functional and no public asset named
   `static/index.html` can conflict with SvelteKit's root route.

3. [x] **Add the SvelteKit and TypeScript foundation alongside FastAPI**

   **Prerequisite:** Step 2.

   **Goal:** Establish a buildable SvelteKit project without changing the
   production deployment.

   **Changes:**

   - Use the current official SvelteKit scaffold as the source of configuration.
   - Convert the root `package.json` into the SvelteKit package while preserving
     relevant project metadata.
   - Add TypeScript, Svelte, Vite, `svelte-check`, and
     `@sveltejs/adapter-node` with a regenerated lockfile. The lockfile must be
     committed: Step 5 runs `npm ci` in CI, which fails without it. An empty
     83-byte `package-lock.json` stub is already on disk and must be replaced
     by a real one, not left in place.
   - Add `vite.config.ts`, `tsconfig.json`, `src/app.html`, and a minimal route
     that proves the framework runs. The current scaffold emits **no
     `svelte.config.js`**: adapter and compiler options live in the
     `sveltekit()` plugin inside `vite.config.ts`. Later steps that would have
     edited `svelte.config.js` must edit `vite.config.ts` instead.
   - Configure `adapter-node`; do not edit `render.yaml` yet.
   - Do not copy the scaffold's `static/robots.txt`. Files added to `static/`
     are served by the FastAPI mount too, so it would create a new public URL.
   - Reuse the existing `static/` directory rather than duplicating its large
     icon and font collections.
   - Add scripts for at least `dev`, `build`, `preview`, and `check`.
   - Ensure `.env.example` lists `SUPABASE_URL` and `SUPABASE_ANON_KEY` by name
     only, with no values, and that it is tracked. Note: local permission
     settings deny agent reads of any `.env*` file, so its contents were
     confirmed by the repository owner. Step 29 must re-check rather than
     inherit that assurance.
   - Prerequisite already applied: `.gitignore` previously matched
     `.env.example` under `.env.*` and ignored `package-lock.json` outright, so
     both files would have stayed untracked and CI's `npm ci` would have failed.
     The rules now carry a `!.env.example` negation, drop the lockfile ignore,
     and ignore `node_modules/`, `/.svelte-kit`, and `/build` instead. Confirm
     this is still true before installing dependencies.

   **Verification:** `npm ci`, `npm run check`, and `npm run build` pass. The
   FastAPI application still starts independently.

   **Complete when:** Both runtimes can be developed locally and production is
   still configured to use FastAPI.

4. [x] **Create the SvelteKit test harness, fixtures, and contract tests**

   **Prerequisite:** Step 3.

   **Goal:** Make parity failures visible before porting behavior, and settle
   how multi-user tests get their data before any feature step needs it.

   **Changes:**

   - Add a unit/integration test runner suitable for SvelteKit server modules.
     Use the official add-on rather than hand-written config, to stay
     consistent with how Step 3 was scaffolded:
     `npx sv add vitest playwright`. Both are official add-ons of the same
     `sv` CLI that generated the project; `vitest` takes
     `usages: unit, component`.
   - Add Playwright browser tests for critical public navigation and a minimal
     application smoke path.
   - Read **"Fixture constraints derived from the schema"** in
     `docs/SVELTEKIT_PARITY_BASELINE.md` before designing any fixture. It
     records, from `supabase/schema.sql`, why the obvious approaches do not
     work: accounts exist only via `auth.signUp` (no INSERT policy on
     `profiles`), an accepted contact can never be deleted, messages are
     removed only by `dismiss_ping` called as **both** users, and an
     RLS-blocked write returns success with zero rows rather than an error.
   - **Resolved.** `invites` has no UPDATE or DELETE policy, so invite rows
     cannot be removed by any authorized client. Both workarounds are barred by
     the migration rules. Decision, approved by the repository owner: **accept
     the accumulation** and amend the cleanup requirement below.
   - **Resolved, and it was worse than recorded.** Uploaded files cannot be
     cleaned up either. Section 12 of the schema supersedes section 8: every
     file ping is copied into `file_archive` on insert, `handle_ping_delete`
     deliberately keeps the storage object while an archive row exists, and
     neither `file_archive` nor `storage.objects` has a DELETE policy. The
     baseline's earlier claim that "file cleanup is automatic" is corrected
     there. Same decision applies, with one added constraint: **tests may
     upload only small fixture files**, since stored objects are permanent and
     metered.
   - **Resolved.** Supabase Auth *Confirm email* is **enabled**, verified
     against the project's own `/auth/v1/settings` endpoint
     (`mailer_autoconfirm: false`). `signUp` therefore returns no session, so
     the two fixture accounts are created **by hand, once**, and the seed
     script only signs in to them. It never calls `signUp`, and it fails with
     the manual setup instructions rather than working around the setting.
   - Translate the route contract from Step 1 into automated assertions where
     practical, initially marking only genuinely unimplemented SvelteKit
     behavior as pending.
   - Define the two-user fixture strategy that Steps 15 through 27 depend on,
     and document it in the parity document:
     - Provision dedicated, clearly named test accounts (for example a
       reserved username prefix) rather than ad-hoc manual sign-ups. The
       prefix must fit `^[a-z0-9_]{3,20}$` — lowercase, digits and underscore
       only, no hyphens, 20 characters total including the suffix.
     - Add a seed script that creates the accounts, their profiles, and their
       contact relationship idempotently, so a test run can be repeated. The
       existing `create_invite` / `redeem_invite` pair is already idempotent
       (it promotes a pending row, leaves an accepted row alone, and treats
       "already contacts" as success), so the seed can use the production RPCs
       instead of a parallel setup path.
     - Add a teardown/cleanup path that removes the **messages** created by
       test accounts, and decide explicitly whether cleanup runs per test, per
       suite, or on demand. *Amended from "messages, invites, and uploaded
       files": invites and files have no client-authorized DELETE and cannot be
       removed without a schema change or a service-role key, both barred. The
       cleanup script reports what it is leaving behind instead of hiding it.*
       Chosen cadence: **on demand, and per suite for suites that write
       messages** — per test costs two authenticated sessions plus a round trip
       per row, and never would let messages accumulate across runs.
     - Keep fixture credentials out of the repository; read them from the
       environment and document the variable names only.
     - State the isolation boundary plainly: these accounts share the live
       Supabase project, so tests must never touch rows they did not create
       and must never assume an empty database.
   - Add package scripts for unit tests, end-to-end tests, and fixture
     seed/cleanup.
   - Note that the browser suite is greenfield: the existing Python tests
     cover link previews only, so there is no frontend coverage to port and
     every UI assertion written here is new.
   - Keep the Python tests; the two suites coexist until cleanup.

   - Point Playwright at the **production server** (`node build/index.js`), not
     the scaffold's `vite preview`. `vite preview` serves static files without
     `ETag` or `Last-Modified`, so the conditional-request contract silently
     passes as a 200 and goes untested. Steps 11, 12, 26 and 28 depend on
     testing the server Render actually runs.
   - Extend `tsconfig.json`'s `include` to cover `e2e/` and `scripts/`. The
     generated `.svelte-kit/tsconfig.json` covers only `src/`, so `npm run
     check` reports zero errors while never looking at the test harness.

   **Verification:** The test commands run deterministically, distinguish
   pending migration cases from failures, and are documented in the README or
   parity document. Running the seed script twice in a row succeeds, and
   cleanup leaves no test-account *messages* behind (see the amendment above
   for what cleanup cannot remove).

   **Complete when:** Future endpoint and UI steps have an automated place to
   add parity tests before changing implementation, and a two-user test can be
   written without inventing its own account setup.

   **Status (2026-08-31): complete, verified against live fixtures.**

   Passing: `npm run check` (416 files, 0 errors), `npm run test:unit` (6),
   `npm run test:e2e` (13 passed, 21 pending by step), `npm run build`, and
   `pytest -q` (38). The harness, the contract table, the fixture strategy, the
   seed/cleanup scripts, and the package scripts are all in place, and a
   two-user test can now be written against `e2e/fixtures/accounts.ts`.

   The fixture criteria were verified against the real Supabase project once
   `ping_e2e_a` and `ping_e2e_b` existed:

   | Run | Result |
   | --- | --- |
   | `test:fixtures:seed` (1st) | profiles found, `create_invite` / `redeem_invite`, contact accepted in both directions |
   | `test:fixtures:seed` (2nd) | "contact: already accepted, nothing to do" — idempotent, exit 0 |
   | `test:fixtures:clean` with one message present | dismissed from **both** sides, row gone, verified by an independent `check` |
   | `test:e2e` | 14 passed, 20 skipped — the two-user test now executes |

   The cleanup test is the one worth keeping: an earlier run passed trivially
   with zero messages, which proves nothing. A message was inserted first, so
   the both-sides `dismiss_ping` path actually ran. `check` reported the one
   retained invite row, as designed.

   Cautionary note, learned the expensive way: `signUp` is a **write** against
   the live project and sends confirmation email. Do not use it to probe
   whether an account exists — Supabase returns `invalid_credentials`
   identically for "no such user" and "wrong password". Probing that way
   created two unusable accounts and spent the 2/hour email rate limit. Note
   that `email_not_confirmed` *is* returned distinctly, so an unconfirmed
   account is distinguishable; only the first two cases are conflated.

5. [x] **Run the test suites automatically in continuous integration**

   **Prerequisite:** Step 4.

   **Goal:** Ensure every later step is checked by something other than the
   chat that wrote it.

   **Changes:**

   - Add a CI workflow that runs on pushes and pull requests.
   - Run `npm ci`, type checking (`npm run check`), the TypeScript unit and
     integration suites, and the production build.
   - Run the existing Python test suite alongside them until Step 29 removes it.
   - Run the Playwright suite in CI for the tests that need no live Supabase
     credentials; gate the two-user suite behind available secrets and make it
     skip loudly rather than fail when they are absent.
   - Cache dependencies, pin the Node and Python versions to match local and
     production runtimes, and keep total runtime short enough to be useful.
   - Document how to reproduce a CI failure locally.

   **Verification:** CI passes on the current branch, and a deliberately broken
   type or test causes a visible failure.

   **Complete when:** No later step can be marked complete while the automated
   suites are red.

   **Status (2026-08-31): implemented; verified locally, not yet on GitHub.**

   `.github/workflows/ci.yml` runs two parallel jobs — **web** (npm ci, check,
   unit, build, Playwright) and **python** (pytest 3.14). Node is pinned by
   `.nvmrc` (24.16.0, matching local); Python is pinned in the workflow.

   Verified by replaying the workflow against a clean copy of the tree with no
   `node_modules`, no `.env`, and no `.git` — the closest local equivalent of a
   fresh runner:

   | Check | Result |
   | --- | --- |
   | `npm ci` from the committed lockfile | ok |
   | `npm run check` | 416 files, 0 errors |
   | `npm run test:unit -- --run` | 6 passed |
   | `npm run build` | ok |
   | `CI=true npm run test:e2e`, no fixture secrets | 13 passed, 21 skipped, exit 0 |
   | fresh venv + `requirements-dev.txt` + `pytest -q` | 38 passed, Python 3.14.5 |

   Deliberate-failure verification, each reverted afterwards:

   | Break | Exit code |
   | --- | --- |
   | type error in `src/lib/contract/routes.ts` | `npm run check` → 1 |
   | assertion flipped in `routes.spec.ts` | `npm run test:unit` → 1 |
   | wrong URL in `public-navigation.e2e.ts` | `npm run test:e2e` → 1 |
   | *no break* — pending `test.fixme` entries | e2e → 0, as intended |

   That last row is the one worth keeping honest: pending contract entries must
   never turn CI red, or later steps will be tempted to delete them.

   Confirmed on GitHub: run `33435834792` on `main` is green. The web job took
   77s and the Python job 15s. The e2e step logged the loud skip banner naming
   the four missing `PING_E2E_*` variables, then reported 13 passed and 21
   skipped — the intended fork-pull-request path.

   `actions/checkout` and `actions/setup-python` were bumped to v5 and v6 after
   that run: the originals target Node.js 20, which GitHub has deprecated, and
   the run carried a warning annotation saying so.

   Note for Steps 12 and 28: CI pins Python 3.14 to match local development, but
   `render.yaml` pins nothing (no `PYTHON_VERSION`, no `runtime.txt`), so
   production can drift from what CI tests. That belongs to the deployment
   steps, not here.

6. [x] **Port environment handling and the `/config` endpoint**

   **Prerequisite:** Step 5.

   **Goal:** Supply the same public Supabase configuration from SvelteKit.

   **Changes:**

   - Add a server-only environment helper that validates `SUPABASE_URL` and
     `SUPABASE_ANON_KEY` without leaking any other environment variables.
   - Implement `src/routes/config/+server.ts` with the existing JSON keys
     `supabaseUrl` and `supabaseAnonKey`.
   - Preserve the current route URL and relevant response/cache behavior.
   - Add unit and route tests for present and missing configuration.
   - Do not add a service-role key.
   - Note in the parity document that this endpoint exists to keep the legacy
     frontend working unchanged, and that Step 29 retires the runtime fetch.
   - Flip the `/config` entry in `src/lib/contract/routes.ts` to `done: true`.
     Its recorded contract is **exactly** the keys `supabaseUrl` and
     `supabaseAnonKey` — the test asserts the exact key set, so any extra
     environment value leaking into the response fails it, which is the point.
   - CI already supplies placeholder `SUPABASE_URL` / `SUPABASE_ANON_KEY` at
     job level, so the endpoint has values to serve there. The missing-config
     test must not depend on those being absent; construct that case in the
     test rather than by unsetting the environment.

   **Verification:** The SvelteKit `/config` response matches the recorded
   FastAPI contract and no server-only value appears in client bundles.

   **Complete when:** The legacy frontend could initialize its Supabase client
   from the SvelteKit endpoint without modification.

7. [ ] **Port and strengthen the pure link-preview helpers**

   **Prerequisite:** Step 5.

   **Goal:** Replace `link_preview.py` with tested server-only TypeScript logic
   before wiring HTTP routes to it.

   **Changes:**

   - Implement focused modules under `src/lib/server/` for metadata parsing,
     URL validation, IP classification, DNS resolution, redirect validation,
     bounded response reading, and TTL caching.
   - Port all meaningful cases from `tests/test_link_preview.py`.
   - Accept only HTTP and HTTPS URLs with a hostname.
   - Reject loopback, private, link-local, reserved, multicast, unspecified,
     carrier-grade NAT, IPv4-mapped IPv6, and other non-public destinations.
   - Validate every redirect destination and resolved address before fetching
     it. Do not copy the current `follow_redirects=True` behavior without
     per-hop revalidation.
   - Bound redirect count, request time, downloaded bytes, and cache lifetime.
   - Keep these modules server-only so they cannot enter the browser bundle.
   - This step deliberately diverges from the Python implementation. Confirm
     the divergence is recorded in the Step 1 intentional-differences section
     and write the tests against the stricter behavior, not the old behavior.

   **Verification:** Unit tests cover IPv4, IPv6, malformed URLs, DNS failure,
   unsafe redirects, metadata precedence, relative image/favicon URLs, cache
   hits, and cache expiry. At least one test asserts that a redirect chain
   ending at a private address is rejected even though its first hop is public.

   **Complete when:** The TypeScript helper suite passes without making real
   network calls and has equivalent or stronger security than the Python code.

8. [ ] **Implement the SvelteKit `/preview` metadata endpoint**

   **Prerequisites:** Steps 6 and 7.

   **Goal:** Port link metadata fetching while preserving the frontend API.

   **Changes:**

   - Add `src/routes/preview/+server.ts`.
   - Preserve query handling, user agent, timeout, HTML content-type check,
     metadata precedence, same-origin image/favicon URL rewriting, success JSON,
     and no-preview/error behavior from the parity baseline.
   - Read the response body incrementally and stop at the configured byte cap;
     do not download an unbounded body before truncating it.
   - Use the tested redirect validation and TTL cache from Step 7.
   - Port relevant cases from `tests/test_preview_routes.py` into the SvelteKit
     test suite using mocked DNS and HTTP.
   - Where a ported case encodes the old permissive redirect behavior, update
     it to the approved intentional difference instead of relaxing the new
     implementation to match.

   **Verification:** Contract tests compare the SvelteKit response status and
   body with the baseline for success, invalid URL, network failure, non-HTML,
   missing metadata, redirects, oversized content, and cache hits. Cases
   covered by an approved intentional difference assert the new behavior and
   cite the baseline entry.

   **Complete when:** The current `static/app.js` link-preview call can use the
   SvelteKit endpoint unchanged.

9. [ ] **Implement the SvelteKit `/preview/image` endpoint**

   **Prerequisites:** Steps 7 and 8.

   **Goal:** Port the same-origin preview-image proxy safely.

   **Changes:**

   - Add `src/routes/preview/image/+server.ts`.
   - Reuse the URL, DNS, and redirect validation from Step 7.
   - Preserve image content-type validation, maximum response size, relevant
     status codes, and the public browser cache header.
   - Abort the upstream response as soon as the byte limit is exceeded.
   - Reject misleading non-image responses even when the URL has an image-like
     suffix.
   - Port all image-proxy route tests.

   **Verification:** Tests cover a valid image, private address, unsafe
   redirect, upstream error, non-image content type, oversized body, timeout,
   and expected cache headers.

   **Complete when:** Preview cards can load proxied images without expanding
   the application's CSP to arbitrary hosts.

10. [ ] **Serve the unchanged legacy pages and assets through SvelteKit**

    **Prerequisites:** Steps 3, 6, 8, and 9.

    **Goal:** Make SvelteKit a behavior-compatible host before rewriting the UI.

    **Changes:**

    - Implement SvelteKit responses for `/` and `/app` using the relocated legacy
      HTML without altering its DOM or inline bootstrap script.
    - Implement `/privacy` and `/terms` with the existing content.
    - Ensure the production Node build can read or bundle the legacy HTML; do not
      rely on a development-only filesystem path.
    - Verify all current static paths, including manifest, sitemap, icons, fonts,
      audio, emoji data, scripts, and service worker.
    - Preserve password-recovery, OAuth, invite-hash, and `/app` redirect URLs.

    **Verification:** Run the SvelteKit production build with `node build`, not
    only the Vite development server. Run browser comparisons for every public
    page and inspect the console/network panels for missing assets or duplicate
    script execution.

    **Complete when:** The unchanged legacy frontend works against the SvelteKit
    server with no FastAPI process running.

11. [ ] **Port security headers and initial PWA compatibility**

    **Prerequisite:** Step 10.

    **Goal:** Match the security boundary currently applied by FastAPI.

    **Changes:**

    - Add SvelteKit server hooks that apply CSP, `X-Content-Type-Options`,
      `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and HSTS.
    - Derive the Supabase HTTPS and WebSocket origins from validated config.
    - Preserve the inline-script hash while the legacy inline script is
      unchanged; regenerate or remove it only when the script changes later.
    - Keep `/config`, `/preview`, and `/preview/image` outside service-worker
      caching.
    - Confirm that static assets receive appropriate headers and that errors do
      not bypass the security policy.

    **Verification:** Automated header/CSP assertions pass, the browser shows no
    CSP violations during core flows, Supabase Realtime connects, and preview
    images remain same-origin.

    **Complete when:** SvelteKit provides at least the current FastAPI security
    headers without adding `unsafe-eval` or broad remote-host allowances.

12. [ ] **Create and validate a non-production SvelteKit deployment**

    **Prerequisite:** Step 11.

    **Goal:** Prove the Node runtime behaves correctly on the real hosting
    platform without touching the production FastAPI service.

    **Changes:**

    - Add a separate preview/staging deployment configuration using
      `@sveltejs/adapter-node`.
    - Configure the existing public Supabase environment values through the
      host's environment settings.
    - Set the correct host, port, origin, and proxy-header behavior for the
      deployment platform.
    - Keep `render.yaml` production behavior unchanged unless the chosen preview
      mechanism explicitly requires a separate file or service entry.
    - Staging points at the same Supabase project as production, so state the
      data-hygiene rules for it explicitly and document them next to the
      deployment instructions:
      - Manual and automated staging testing uses the Step 4 test accounts, not
        real user accounts.
      - Run the Step 4 cleanup path after staging test sessions so test
        messages, invites, and uploaded files do not accumulate in the shared
        project.
      - Never point staging at a destructive migration, a schema change, or a
        bulk delete; the migration explicitly does not redesign the database.
      - If the risk of writing test data into the live project is judged
        unacceptable, create a separate Supabase project for staging and record
        that decision plus the extra configuration here instead.
    - Document preview deployment and rollback/removal instructions.
    - **Read "Deployment state" in `docs/SVELTEKIT_PARITY_BASELINE.md` first.**
      Three facts recorded during Step 5 constrain this step:
      - The production Render service was **suspended** at that point (503 with
        `x-render-routing: suspend`), so Steps 1-5 may never have deployed and
        Step 2's relocation has not been exercised on a live server. Confirm
        production is healthy before adding a second service on top of it.
      - A second service is what exhausts free instance hours. If that is what
        suspended the first one, this step needs a paid instance or a different
        preview target — decide explicitly rather than discovering it.
      - `render.yaml` pins no Python version and sets no `autoDeploy`. CI pins
        3.14; production floats. Pin it here or accept the drift in writing.
    - The cleanup path removes **messages only**. Invites and uploaded files
      cannot be deleted by any authorized client (Step 4), so the staging
      hygiene rules above are amended to match, and staging file uploads must
      stay small.

    **Verification:** Run the full server contract and browser smoke suite
    against the deployed URL. Manually verify Supabase Auth redirects, Realtime,
    file upload/download, previews, CSP, and PWA registration. Confirm cleanup
    leaves the shared project free of staging test rows.

    **Complete when:** The staging SvelteKit server has legacy-feature parity and
    production FastAPI remains available as the untouched fallback.

13. [ ] **Create the component architecture, styling strategy, and app shell**

    **Prerequisite:** Step 12.

    **Goal:** Start the UI rewrite without replacing the working `/app` route,
    and decide up front how the existing stylesheet becomes component styles.

    **Changes:**

    - Add an unlinked migration route such as `/app-next` for the new Svelte UI.
    - Define typed domain models for profiles, contacts, pings, files, invites,
      receipts, and disappearing-message settings.
    - Create a single browser Supabase client from `/config` and bundle
      `@supabase/supabase-js` through npm instead of the CDN on the new route.
    - Establish small stores or state modules for session, contacts, active
      conversation, messages, and UI preferences. Avoid one global mega-store.
    - Build the semantic application shell, loading/error states, and shared
      primitive components.
    - Decide and document the styling strategy before writing feature
      components, because the existing `static/style.css` is large enough that
      an improvised approach will not survive the feature steps. Record the
      decision in the parity document. The strategy must answer:
      - Which parts of `style.css` are global and stay global: the custom
        properties and design tokens, font faces, resets, theme variants, and
        any element-level base styles. Extract these into a single imported
        global stylesheet that both routes can share while `/app` still exists.
      - Which parts are component-scoped and move into the `<style>` block of
        the component that owns them, deleted from the global sheet as each
        feature step ports its component. Prefer scoped styles over global
        selectors for anything tied to one piece of UI.
      - How theme and font switching work: keep the existing custom-property
        and attribute-based mechanism rather than inventing a second one, so
        Step 25 can port persistence without redefining the tokens.
      - What happens to selectors that target legacy DOM structure the new
        components do not reproduce. These are deleted, not carried forward
        with wrapper markup that recreates the old DOM.
      - How to tell, at any point, which rules are still unported: keep the
        shrinking legacy sheet and the new global sheet as separate files so
        the remaining surface is visible, and confirm the legacy sheet is
        empty or deleted at Step 29.
    - Reuse the current design tokens, fonts, icons, and audio assets. This is
      a re-implementation of the existing visual design, not a redesign.
    - Do not link `/app-next` from the production UI yet.

    **Verification:** Type checking, component tests, and a browser smoke test
    pass; no service-role key or server-only module enters the client bundle.
    The shell renders with the current tokens and both themes apply correctly.

    **Complete when:** `/app-next` starts reliably, creates only one Supabase
    client, provides typed foundations for later feature slices, and has a
    written styling strategy that later steps can follow without re-deciding.

14. [ ] **Port authentication, recovery, and invite-entry handling**

    **Prerequisite:** Step 13.

    **Goal:** Make the new Svelte route capable of establishing the same user
    session as the legacy application.

    **Changes:**

    - Port login, sign-up, logout, forgotten-password, password-reset, and auth
      state changes.
    - Preserve username/profile creation behavior and user-facing errors.
    - Preserve recovery and OAuth redirect compatibility with `/app` while the
      legacy route is primary; add the future cutover redirect to the parity
      checklist.
    - Parse and retain invite tokens from URL hashes without exposing them in
      logs or losing them during authentication.
    - Port auth-focused accessibility behavior, focus handling, and tests.
    - **Blocked until the Supabase Auth URL configuration is fixed** — see that
      section in `docs/SVELTEKIT_PARITY_BASELINE.md`. Site URL points at
      `localhost`, and two origins must be in the Redirect URLs allowlist
      before any auth flow can be tested: `http://localhost:5173/**` (the Vite
      dev server, not FastAPI's 8000) and `http://localhost:4173/**`, which is
      Playwright's `baseURL` and therefore where every automated auth test
      runs. Missing the second one fails the suite while manual testing looks
      fine. Verify both before writing code, not after.
    - Pass `emailRedirectTo` explicitly on signup, the way the legacy
      `resetPasswordForEmail` call already does. The legacy `signUp` omits it
      and silently falls back to Site URL, which is the bug above. The port
      should not inherit that dependency on a dashboard setting.
    - Note that Auth *Confirm email* is enabled, so a newly signed-up account
      has **no session** until the link is clicked. Sign-up and login are not
      symmetric, and the UI must not assume a session follows signUp.

    **Verification:** Test new account creation, existing login, invalid login,
    logout, recovery email flow, password reset, refresh persistence, and an
    invite opened while logged out. Use the Step 4 test accounts.

    **Complete when:** An authenticated user can enter `/app-next` and reload it
    without session loss or duplicate profile creation.

15. [ ] **Port contacts, requests, invitations, and navigation**

    **Prerequisite:** Step 14.

    **Goal:** Recreate how users find and switch conversation partners.

    **Changes:**

    - Port profile search, contact requests, accept/reject behavior, and contact
      list loading.
    - Port invite creation, ten-minute/single-use semantics, redemption, link
      generation, QR display, and already-connected/error states.
    - Port active-contact selection, unread badges, mute state, contact
      switcher, empty states, and relevant keyboard navigation.
    - Continue to call the existing Supabase RPCs; do not duplicate their
      authorization logic in the client.

    **Verification:** Test two-user request/accept flows, invite redemption in
    logged-in and logged-out states, invalid/expired/reused invites, contact
    switching, unread counts, and refresh persistence. Use the Step 4 two-user
    fixtures and run cleanup afterwards.

    **Complete when:** A user can establish and navigate contacts in
    `/app-next` with results matching the legacy UI.

16. [ ] **Port the conversation read path: history and pagination**

    **Prerequisite:** Step 15.

    **Goal:** Recreate the durable conversation read path on its own, before
    any live or write behavior depends on it.

    **Changes:**

    - Port latest-message loading for the active contact and per-contact
      conversation state that survives switching away and back.
    - Port date separators and message grouping.
    - Port paged scrollback and the request for older messages.
    - Port scroll anchoring so loading a page does not move the viewport, and
      so arriving at a conversation lands in the expected position.
    - Render messages read-only in this step. Sending, receipts, and live
      updates arrive in Steps 17 through 19.

    **Verification:** With a seeded conversation long enough to paginate, test
    initial load position, scrolling back through multiple pages without jumps,
    switching contacts and returning, and reload persistence.

    **Complete when:** `/app-next` can display an existing conversation's full
    history correctly without any Realtime connection.

17. [ ] **Port Realtime subscriptions and live delivery**

    **Prerequisite:** Step 16.

    **Goal:** Make the conversation update live, with subscription lifecycles
    that cannot leak or duplicate.

    **Changes:**

    - Port Supabase Realtime subscriptions for incoming messages.
    - Implement explicit subscribe/unsubscribe cleanup when the session changes,
      the active contact changes, or the component unmounts. Every subscription
      must have exactly one owner and one teardown path.
    - Prevent duplicate messages when a local result and a Realtime event
      describe the same row. Decide the deduplication key explicitly and
      document it.
    - Handle reconnection after a dropped connection, including messages that
      arrived while disconnected.
    - Preserve the ordering guarantees the legacy UI provides when a live event
      and a paged fetch overlap.
    - Port the separate presence channel: keyed by user id, tracking
      `{online_at}` on subscribe and recomputing the online set on `sync`. It
      drives the contact-list online dots and `/who` and writes nothing to the
      database. It is a distinct channel from the `postgres_changes`
      subscriptions and needs its own explicit teardown.

    **Verification:** Use two browser contexts to test live delivery, contact
    switching during an active subscription, network drop and reconnect,
    messages sent while offline, and repeated switching to confirm no duplicate
    subscriptions accumulate. Check that leaving the route tears subscriptions
    down. Confirm presence dots appear when a second user signs in and clear
    when that user's tab closes.

    **Complete when:** Two users see each other's messages live, across
    reconnects and contact switches, with no duplicates and no leaked channels.

18. [ ] **Port the message lifecycle: receipts, unread, deletion, and expiry**

    **Prerequisite:** Step 17.

    **Goal:** Recreate every state a message passes through after it exists.

    **Changes:**

    - Port sent, delivered, and read receipt behavior using the existing RPCs
      and policies.
    - Port unread counting, unread persistence across reloads, and the
      transition to read.
    - Port dismiss and delete semantics, including which party each affects.
    - Port disappearing-message settings, expiry display, and the behavior of a
      message as it expires while on screen.
    - Preserve archived-file references when messages are dismissed or deleted;
      removing a message must not orphan or destroy its archived file.
    - Do not duplicate RPC authorization logic in the client.

    **Verification:** With two users, test receipts in both directions, unread
    counts across reloads and contact switches, dismissal and deletion
    semantics, expiry display and removal, and confirm a dismissed message's
    file remains reachable in the archive.

    **Complete when:** Message state transitions in `/app-next` match the legacy
    UI and leave no orphaned or unexpectedly destroyed data.

19. [ ] **Port the composer and text sending**

    **Prerequisite:** Step 18.

    **Goal:** Complete the primary write path for plain text.

    **Changes:**

    - Port text composition, input validation, and length limits.
    - Port optimistic/pending UI and its reconciliation with the confirmed row
      using the Step 17 deduplication key.
    - Port send failure handling, error surfacing, and retry behavior.
    - Keep send actions idempotent enough to prevent accidental duplicates from
      repeated clicks, Enter-key repeats, or reconnects.
    - Port focus restoration after sending and mobile composer behavior,
      including on-screen keyboard handling.
    - Port the emoji picker: search, category row, grid, and insertion at the
      cursor, backed by `static/data/emoji-data.json` and the emoji SVG set. It
      sits deliberately outside the overlay/Escape registry; keep that unless a
      change is explicitly approved.

    **Verification:** Test sending between two users, rapid repeated sends,
    sending with the network disabled, retry after failure, focus after send,
    composer behavior on a mobile viewport, and emoji search, category
    switching, and insertion at the cursor.

    **Complete when:** Text messages can be sent and received in `/app-next`
    without duplicates or lost input.

20. [ ] **Port link detection and inline previews**

    **Prerequisites:** Steps 8 and 19.

    **Goal:** Connect the ported preview endpoints to the new UI.

    **Changes:**

    - Port URL detection in composed and received messages, and linkification
      of message text.
    - Port preview loading through the SvelteKit `/preview` endpoint.
    - Port the preview card, its loading state, and the fallback when no
      preview is available or the request fails.
    - Load preview images through the same-origin `/preview/image` proxy so the
      CSP stays strict.

    **Verification:** Test a message containing a rich URL, a URL with no
    metadata, an unreachable URL, a URL rejected by validation, a redirecting
    URL, and multiple URLs in one message. Confirm no browser request goes
    directly to a third-party host.

    **Complete when:** Link previews in `/app-next` match the legacy UI and all
    preview network access remains server-side.

21. [ ] **Port file upload, download, and the per-contact archive**

    **Prerequisite:** Step 19.

    **Goal:** Complete attachment workflows without weakening Storage access
    control.

    **Changes:**

    - Port file selection, size and type validation, and rejection messaging.
    - Port private Supabase Storage upload with progress and error states.
    - Port download, including authorized access and the denial path for
      unauthorized access.
    - Port the per-contact file archive and its persistence after a message is
      dismissed or deleted.
    - Preserve the current RLS-compatible storage paths and the existing
      database and RPC calls exactly; a changed path silently breaks the
      policies.

    **Verification:** Test upload and download between two users, an oversized
    file, a rejected type, an interrupted upload, an authorized download, an
    unauthorized access attempt, and archive contents after message dismissal.

    **Complete when:** Every supported payload can be sent and received in
    `/app-next` without weakening Supabase access controls.

22. [ ] **Port camera capture and video recording**

    **Prerequisite:** Step 21.

    **Goal:** Port the two media-capture surfaces. They ride on the file upload
    path but carry their own device and permission handling.

    **Changes:**

    - Port the photo capture overlay: camera preview, snap, retake, send, and
      cancel.
    - Port the video recording overlay: start, stop, the 60-second hard
      auto-stop, preview, re-record, send, and cancel.
    - Handle `getUserMedia` permission denial, an absent or busy device, and an
      unsupported browser with a visible error rather than a hang.
    - Release camera and microphone tracks on close, cancel, send, and route
      change. A leaked track leaves the device indicator lit.
    - Send captured media through the Step 21 upload path rather than a second
      parallel one.
    - Preserve the `Permissions-Policy` grants `camera=(self)` and
      `microphone=(self)`; that header exists for this feature.
    - Confirm the CSP still allows `media-src blob:` and `img-src blob:`, which
      the capture previews depend on.

    **Verification:** Test photo capture and video recording end to end on
    desktop and on a mobile browser, permission denial, cancelling mid-capture,
    the 60-second auto-stop, and that the camera indicator turns off after
    every exit path.

    **Complete when:** Both capture surfaces work in `/app-next`, release their
    devices reliably, and produce messages indistinguishable from a normal file
    send.

23. [ ] **Port slash commands and the suggestion menu**

    **Prerequisite:** Step 19.

    **Goal:** Recreate the command surface of the composer.

    **Changes:**

    - Port slash-command parsing and the `/` suggestion menu, including
      filtering, selection, and dismissal.
    - Port `/help`, `/theme`, `/font`, `/clear`, `/who`, `/last`, `/mute`,
      `/unmute`, and `/shrug` with their current semantics.
    - Where a command opens an overlay or changes a preference, implement the
      command's parsing and dispatch here and let Steps 24 and 25 supply the
      target surface; stub the target explicitly rather than leaving it silent.
    - Port unknown-command and malformed-argument behavior. `/who` reports the
      active contact's online state, so it depends on the presence channel from
      Step 17.

    **Verification:** Run command tests for each command, the suggestion menu's
    keyboard and pointer interaction, unknown commands, and commands typed
    mid-message.

    **Complete when:** Every documented command parses and dispatches correctly
    in `/app-next`.

24. [ ] **Port overlays, dialogs, keyboard shortcuts, and focus management**

    **Prerequisites:** Steps 21, 22, and 23.

    **Goal:** Recreate the application's non-composer interaction surfaces and
    their accessibility behavior.

    **Changes:**

    - Port all eight registered overlays, preserving their topmost-first
      Escape order: shortcuts cheatsheet, contact palette, video recording,
      camera capture, image lightbox, invite dialog, settings, and the file
      archive. Add confirmations and toasts.
    - Preserve the rule that the palette and settings refuse to open on top of
      an already-open overlay rather than stacking.
    - Keep the emoji picker outside the overlay registry, as it is today.
    - Port all documented keyboard shortcuts.
    - Implement deterministic Escape and overlay-stacking behavior: which
      surface closes, in what order, and what happens with two open at once.
    - Port focus traps within overlays and focus restoration to the triggering
      element on close.
    - Port the accessible names, roles, and live-region announcements the
      legacy UI provides.

    **Verification:** Run keyboard-only navigation through every overlay, focus
    order checks, Escape behavior with stacked overlays, focus restoration
    after each dialog, and screen-reader announcement checks for toasts and
    status changes.

    **Complete when:** Every overlay in `/app-next` is reachable, dismissable,
    and operable by keyboard alone, with focus never lost to the document body.

25. [ ] **Port preferences, theming, audio, and responsive layout**

    **Prerequisite:** Step 24.

    **Goal:** Close the remaining interaction gap and remove the last legacy
    DOM dependencies from the new route.

    **Changes:**

    - Port theme and font selection and their persistence, using the token
      mechanism fixed in Step 13 rather than a second parallel system.
    - Port audio notification behavior, including its mute and permission
      states.
    - Port responsive layout across the supported viewport range.
    - Port reduced-motion support.
    - Remove legacy global DOM dependencies from the new route rather than
      wrapping them indefinitely. `/app-next` must not read or write globals
      defined by the legacy scripts.
    - Confirm the legacy stylesheet has shrunk as planned in Step 13 and record
      what remains unported, if anything.

    **Verification:** Run theme and font persistence tests across reloads,
    audio behavior tests, responsive tests at the supported breakpoints, a
    reduced-motion check, and the Step 1 manual UX checklist against
    `/app-next`.

    **Complete when:** The only known differences between `/app` and
    `/app-next` are recorded in the parity document and explicitly approved.

26. [ ] **Replace the service worker with a rollback-safe PWA strategy**

    **Prerequisite:** Step 25.

    **Goal:** Preserve installability and offline shell behavior without caching
    obsolete or unhashed application files, and without stranding installed
    clients if the cutover is reverted.

    **Changes:**

    - Implement the service worker through SvelteKit's service-worker support or
      a deliberately selected PWA integration.
    - Cache generated build assets using the framework's versioned asset lists;
      do not hard-code the current `/app.js` and `/style.css` assumptions from
      `static/sw.js`.
    - Keep navigations network-first, as the legacy worker does, so a server
      that starts returning different HTML is picked up on the next load
      instead of being masked by a cached shell.
    - Never cache `/config`, `/preview`, `/preview/image`, Supabase requests,
      authenticated data, or private files.
    - Add an update flow that does not strand users on incompatible cached
      bundles.
    - Design for reversibility, because the current worker calls `skipWaiting()`
      and `clients.claim()` and takes over immediately. A client that installs
      the SvelteKit worker and then meets a rolled-back FastAPI server must
      recover on its own:
      - Write and keep in the repository a reset service worker: a minimal
        worker that claims clients, deletes every cache it finds, unregisters
        itself, and forces a reload. This is the artifact a rollback deploys at
        the service-worker URL.
      - Verify the reset worker actually replaces the SvelteKit worker on an
        already-installed client, rather than assuming the browser will pick it
        up.
      - Ensure the worker never serves a cached response referencing hashed
        build assets that a rolled-back server cannot provide; the network-first
        navigation rule plus cache versioning must make a stale shell
        self-correcting.
      - Document the reset procedure in the rollback instructions, not only in
        code comments.

    **Verification:** Test first install, reload, update, offline shell, return
    online, cache cleanup, and the explicit absence of private or API data in
    Cache Storage. Then run the rollback drill on staging: install the SvelteKit
    worker in a browser profile, switch the server back to the legacy FastAPI
    build with the reset worker deployed, and confirm the client recovers to a
    working legacy application without the user manually clearing site data.

    **Complete when:** The new app remains installable, its offline behavior
    matches the approved baseline without stale-code or data-leak risks, and an
    installed client survives a rollback unaided.

27. [ ] **Run full parity, security, accessibility, and production-build QA**

    **Prerequisite:** Step 26.

    **Goal:** Decide whether the new Svelte UI is safe to place on `/app`.

    **Changes:**

    - Resolve every pending item in `SVELTEKIT_PARITY_BASELINE.md`.
    - Run the complete TypeScript unit/integration suite, browser suite, and the
      still-existing Python suite, in CI as well as locally.
    - Run a fresh production build and test it through `node build`.
    - Exercise all two-user workflows against staging using the Step 4 fixtures,
      and run cleanup afterwards.
    - Review CSP, request/response size limits, unsafe redirects, authorization
      failures, client bundles, console errors, memory/subscription cleanup,
      keyboard access, and supported viewport sizes.
    - Confirm the Step 26 rollback drill still passes against the current build.
    - Record approved intentional differences and unresolved blockers, and
      confirm every entry in the intentional-differences section is still
      accurate and still approved.

    **Verification:** All automated suites pass in CI and the full Step 1 manual
    smoke checklist passes against staging on the production Node build.

    **Complete when:** There are no unapproved parity, security, data-integrity,
    accessibility, or deployment blockers.

28. [ ] **Cut over `/app` and production with a tested rollback path**

    **Prerequisite:** Step 27.

    **Goal:** Make SvelteKit and the new UI production-primary without deleting
    the proven fallback yet.

    **Changes:**

    - Move the new Svelte application from `/app-next` to `/app` and update
      Auth/recovery/invite redirect destinations.
    - Decide explicitly whether `/` renders the application shell or a separate
      landing page, preserving the approved public behavior.
    - Update `render.yaml` to build and start the adapter-node output with the
      required host, port, origin, and proxy configuration.
    - Write the rollback as an executable procedure, not an intention, and
      rehearse it on staging before deploying to production. It must state:
      - The exact revert: which commit restores the FastAPI `render.yaml`, and
        that reverting it is the first action.
      - That reverting the server is not sufficient on its own, because
        installed clients still hold the SvelteKit service worker. The rollback
        must also deploy the Step 26 reset worker at the service-worker URL so
        those clients clear their caches and unregister.
      - The order of operations, since a client that reloads between the two
        deployments must still land somewhere working.
      - How to confirm recovery: a browser profile with the SvelteKit worker
        already installed, loaded after rollback, reaching a functional legacy
        application without manual cache clearing.
      - How long the rollback path must stay available before Step 29 may run.
    - Deploy during a window where two-user messaging, Auth redirects, Realtime,
      Storage, previews, headers, and service-worker upgrades can be monitored.

    **Verification:** Run production smoke tests immediately after deployment,
    then verify again after a fresh browser session and a service-worker update.
    Confirm the rehearsed rollback drill passed on staging before the production
    deployment proceeded.

    **Complete when:** Production uses SvelteKit successfully, monitoring shows
    no blocking regression, and a tested FastAPI rollback remains available.

29. [ ] **Remove the Python and legacy frontend implementation**

    **Prerequisite:** Step 28 has been stable for an explicitly agreed period.

    **Goal:** Finish the migration and return the repository to one supported
    application architecture.

    **Changes:**

    - Remove `server.py`, `link_preview.py`, Python-only requirements, obsolete
      pytest configuration/tests, the relocated legacy HTML, and legacy global
      JavaScript that has been fully replaced.
    - Remove the legacy stylesheet. Per the Step 13 strategy its rules have
      moved to the shared global sheet or to component styles; confirm nothing
      still imports it and that no ported rule was lost.
    - Retire the `/config` round-trip now that no legacy client depends on it:
      - Move the public Supabase values to build-time public environment
        variables (`PUBLIC_`-prefixed, read through SvelteKit's public env
        module) so the browser client initializes without a blocking request on
        every application boot.
      - Delete `src/routes/config/+server.ts` and its tests, and remove the
        route from the parity document's live contract.
      - Keep the values public-only. This is a change of delivery mechanism,
        not of trust boundary; no service-role key enters the client.
      - If the endpoint must survive for a reason discovered during migration,
        record that reason here instead of deleting it.
    - Remove the CDN Supabase script and obsolete CSP hash/origins, including
      the `https://cdn.jsdelivr.net` allowance in `script-src`.
    - Remove the temporary `/app-next` route and staging-only migration flags.
    - Remove the Python job from the CI workflow added in Step 5.
    - Retain any genuinely useful offline asset-generation script only if its
      separate Python development dependency is intentional and documented;
      it must not be a production runtime requirement.
    - Update README setup, architecture, routes, tests, deployment, and security
      documentation for SvelteKit.
    - Ensure `.env.example` contains names only and no real credentials.

    **Verification:** From a clean checkout, run `npm ci`, type checking, all
    tests, the production build, and local production startup. Confirm the app
    boots with no request to `/config`. Search for stale FastAPI, Uvicorn,
    Python deployment, legacy route, CDN, `/config`, and old service-worker
    references. Re-run the production smoke checklist.

    **Complete when:** Ping has no Python production runtime, documentation
    matches reality, clean installation works, and the final SvelteKit system is
    independently deployable and maintainable.

## Final definition of done

The migration is complete only when all 29 steps are checked, production uses
the SvelteKit Node build, the full parity checklist passes, Supabase RLS remains
the authorization boundary, link previews retain strict server-side network
controls, the PWA does not cache private/API data, an installed client can
survive a rollback unaided, and no Python dependency is required to run the
production application.
