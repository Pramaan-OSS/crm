# Environment

Setup, DB commands, Google Cloud and the `vercel env pull` hazard: `docs/setup.md`.

## One `.env`, at the repo root

`.env.example` **is the documentation** — every variable the repo reads, with a note,
and nothing that is not read. `packages/env` walks up to the workspace root and reads
`.env`, then `.env.local` on top.

- **Real environment variables always win** — the loader never overwrites
  `process.env`, so Vercel/Docker/CI takes precedence.
- **Never add a per-package `.env`.** Four once existed with duplicate
  `DATABASE_URL`/`BETTER_AUTH_SECRET`; when they drifted the API minted a cookie the
  app could not verify and the browser bounced between `/sign-in` and `/` forever.
- **The root marker is a `package.json` declaring `workspaces`** — stopping at the
  first `turbo.json` resolves the API's root to `apps/api`.

## A new variable has three homes, not two

`.env.example` and — if the API reads it — `env.validation.ts` are the two people
remember. The third is **`globalPassThroughEnv` in the root `turbo.json`**, and it is
the one that bites: Turborepo hides an undeclared variable from every task it runs, so
a deployment that sets the variable perfectly still hands the code `undefined`, and
nothing anywhere says so. That is how `MICROSOFT_CLIENT_ID` shipped with the sign-in
button quietly missing. **`passThroughEnv`, never `env`** — a secret in `env` is a
cache key, which means a cache miss on every rotation and the secret in the cache
metadata. The root file's comment has the whole account.

## Required

`PRAMAAN_API_KEY` is the only value a person types. `DATABASE_URL` has a
localhost default matching the compose Postgres, `BETTER_AUTH_SECRET` (and
`AGENT_BRIDGE_SECRET`/`CRON_SECRET`) are generated into `.env` by `./start`,
and `ALLOWED_SIGN_IN` is only consulted once a sign-in method exists —
everything else has a localhost default or is genuinely optional.

**`GOOGLE_CLIENT_ID`** (and **`MICROSOFT_CLIENT_ID`** for Entra ID) are the sign-in
buttons — optional, so an SSO-only install needn't create a provider project. The
client **secret is not set here at all**: it belongs to the builder's connected
sign-in account on the platform, which redeems the sign-in codes
(`auth.social.exchange`) — this process never handles a provider token. Give the
provider project the redirect URI `<API_URL>/api/auth/oauth2/callback/<provider>`.
**`MICROSOFT_TENANT_ID`** defaults to `common` and is the only truly optional one —
set it to your tenant's GUID to refuse other tenants at Microsoft instead of at
`ALLOWED_SIGN_IN`. There is **no Microsoft equivalent of `hd`**: `tenantId` is the
whole of it.

**No client id is required, but an install wants one of them or an SSO provider** —
with none, the sign-in page says so by name rather than rendering nothing.

**`ALLOWED_SIGN_IN`** — comma-separated whole domains or single addresses (bare
addresses exist for a solo self-hoster, where `gmail.com` would be an open door). **One
list, read by the sign-in guard *and* the sync's "which side is external" decision** —
if they drifted a colleague would be refused at the door or filed as a lead. **An empty
list fails closed.** Parsed on demand. `packages/auth/src/workspace.ts`.

## Where things are

- **`API_URL`** (`:3001`) mints session cookies and serves `/api/auth/*`;
  `next.config.ts` republishes it as `NEXT_PUBLIC_API_URL`, so one variable does both
  sides. `BETTER_AUTH_URL` is a legacy fallback.
- **Editing a file under `packages/` does not restart the API. Restart it by hand.**
  `bun --watch src/main.ts` refuses to watch outside its project directory and
  says so once at boot: `File ... is not in the project directory and will not be
  watched`. So a change to `packages/auth` or `packages/db` leaves the API
  serving the old module until someone kills it. This cost an hour once: an
  OAuth scope list was correct in source and stale in the process, and every
  reconnect kept asking the provider for the old scopes.
  Running the API from the repo root fixes the watch and breaks Nest, which
  resolves its tsconfig paths from the current directory and then cannot build
  its dependency graph. There is no fix in the dev script today.
- **`APP_URL`** (`:3000`) is also the trusted-origin and `callbackURL` allow-list.
- **Every OAuth `redirect_uri` is built from `API_URL`, never `APP_URL`.** Better
  Auth serves `/api/auth/*` at `baseURL`, and `baseURL` is `apiUrl`. A redirect
  built from `APP_URL` points at the web app, where `/api/auth/callback` does not
  exist, and the provider rejects it with "redirect_uri did not match". This is
  invisible until someone sets `APP_URL` to a tunnel or a LAN host, at which
  point the redirect silently becomes that host. `ssoCallbackBase()` is the
  pattern; a redirect-uri helper in `auth.ts` once was not.
- **`AUTH_COOKIE_DOMAIN`** only for API and app on different subdomains of one parent.
- **`AGENT_URL`** is the agent's deployment, server-side only, and **must include the
  scheme** — validated at boot, or it throws when a task is queued instead.
- **`AUTH_COOKIE_PREFIX` is `crm`** (`@crm/auth/cookies`), set on **both**
  `advanced.cookiePrefix` in `auth.ts` and `getSessionCookie(request, { cookiePrefix })`
  in `proxy.ts` — one alone redirects every signed-in request. Better Auth's default
  collides with any neighbour on a shared parent domain, silently: sign-in completes,
  the row is written, every reader resolves `null`. **Changing it signs everybody out.**

## `IS_MARKETING` — landing page flag, off by default

`"true"` serves `app/(landing)` at `/`; anything else sends a signed-out visitor to
`/sign-in`, because the page markets *this* product.

- **Only the literal `true`** (same shape as `PRISMA_LOG_QUERIES`).
- **It decides one thing**: what a stranger at `/` sees.
- **`isMarketing()` (`apps/app/lib/env.ts`) reads per request**, so a config change
  needs no rebuild. Declared in `apps/app/turbo.json` `passThroughEnv`.

## Typed, validated env

`apps/api/src/config/env.validation.ts` runs via `ConfigModule.forRoot({ validate })`,
and lists every variable the API reads and nothing else.

- **Validation runs while `AppModule` is evaluated** — a test must set variables before
  importing it (see the dynamic `import()` in `test/auth.e2e.spec.ts`).
- **The schema is the API's, not the repo's** — `@crm/auth` and the agent read their own.

## Optional: what the install can do

Every outside call runs through Pramaan. There are no per-source keys: `PRAMAAN_API_KEY`
turns the whole set on, and `agent/lib/capabilities.ts` is the single place that reports
what the platform serves.

| Variable | What it adds |
| --- | --- |
| `PRAMAAN_API_KEY` | Research, enrichment, picture storage, exchange rates, connected mailboxes |
| `PRAMAAN_BASE_URL` | Only for a dev Pramaan API |
| `PRAMAAN_STORAGE_BUCKET` | Where mirrored images land (default `crm`) |
| `RESEARCH_MAX_TOKENS` | Ceiling per generation step, default 1024; whole number 64–8192 |
| `AGENT_BRIDGE_SECRET` | The rep-facing Agent panel — see `agent.md` |

## Mailbox sync

Always on, on whichever social provider is configured, so there is no extra redirect
URI beyond the sign-in one. Scopes are requested at sign-in and gated by
`requireMailboxAccess()`, because granular consent lets a user untick one and still
sign in.

**An SSO rep is not gated** — `needsMailboxGrant` (`@crm/auth`) walls only an account
whose sign-in rows are *all* mailbox providers. It cannot be "has the scopes": an SSO
rep has no Google or Microsoft account to grant on, and `revoke()` keeps the `account`
row, so trying the optional feature and revoking would lock them out. They connect from
Settings → Connections, posting the same `linkSocial` call.

**One granted mailbox is enough.** A rep with both providers linked who granted Google
is not asked for Outlook; `mailboxGrantsNeeded` names the ones still outstanding and
`/grant-access` offers exactly those buttons.

**Microsoft's granted scopes come back fully qualified** —
`https://graph.microsoft.com/Mail.Read`, not `Mail.Read`. `parseScopes` is the one
canonicaliser and strips that prefix, so the comparison is against the bare permission
everywhere.

**Sync is forward-only** — Gmail records the current `historyId` on its first pass and
imports nothing, Calendar reads from `now`, and Outlook records `now` as its cursor.

**`CRON_SECRET`** (min 16 chars) guards `POST /internal/sync/mailboxes` and
`/internal/sync/rates`; both **fail closed when unset**. `/internal/sync/google` is
kept as an alias of the first, so an existing deployment's cron does not break on
deploy. **Crons live in `apps/api/vercel.json`** — mailboxes `*/5 * * * *`, rates
daily. Minute-level schedules need a Pro plan; on Hobby it silently becomes daily.

Deliberate absences: **no `GOOGLE_SYNC_ENABLED`** (a switch that can disable a mandatory
feature is only ever wrong), **no `GOOGLE_WORKSPACE_DOMAIN`** (`ALLOWED_SIGN_IN` already
says who is internal — two sources is how a colleague becomes a lead), **no
`GMAIL_BACKFILL_DAYS`**, **no `OUTLOOK_BACKFILL_DAYS`**, **no rate provider variable**.

## No product analytics

This build ships no product analytics at all: no third-party telemetry, no error
tracking, no install IDs. Errors surface in the server logs. If product analytics
comes back, it should go through a platform capability, not a
vendor key.
## Not env vars

- **Cache TTL** — `DEFAULT_TTL_MS` (60s) in `cache.module.ts`; `CACHE_TTL_MS` overrides.
- **Redis** — optional; without `REDIS_URL` the cache is per-instance in-memory, which
  is wrong for multi-instance.
- **Sign-in method** — Google and Microsoft are in code; an IdP is a row (SSO, in `api.md`).
