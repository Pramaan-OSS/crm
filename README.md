<h1 align="center">Agentic CRM</h1>

<p align="center">
  <strong>A customer relationship manager with a research agent on every record.</strong>
</p>

---

## What this is

Most CRMs are a database with a form in front of it. The AI ones bolt a chat box onto
the side of that form. Both leave the actual work — finding out what is true, and
writing it down — to a human who has better things to do.

This is built the other way round. The agent is not a feature of the CRM; the CRM is
where the agent keeps its notes. It runs on its own deployment, on its own schedule,
against its own work queue. It decides what to look at next, books its own follow-ups,
spends a research budget, and stops when the budget runs out.

The rule the agent itself never breaks: **nothing about a person is guessed.** Tools
report what they observed, and a ledger prices the evidence. Strong evidence writes to
the record. Weak evidence becomes a suggestion a human settles.

**Every outside call — enrichment, web research, mail and calendar connections, picture
storage, exchange rates — runs through [Pramaan](https://github.com/pramaan-oss), keyed
by one `PRAMAAN_API_KEY`.** There are no vendor accounts to create and no vendor keys to
manage.

## The stack

| Piece | What it is |
|---|---|
| `apps/app` | The web app (Next.js): the CRM, the agent chat, settings, connections |
| `apps/api` | The API (NestJS): records, mail and calendar sync, currency, tracking |
| `apps/agent` | The research agent (Bun, on the `eve` runtime): enrichment, briefs, identity matching |
| `packages/*` | `auth` (better-auth), `db` (Prisma), `pramaan` (the one outside-call client), `ui`, `env`, `validation` |

Postgres is the database. Redis is an optional shared cache once website tracking is on.

## Quick start

You need Docker and [Bun](https://bun.sh). Nothing else — no accounts, no
other keys.

```bash
cp .env.example .env          # then paste PRAMAAN_API_KEY=... into .env
./start
```

`./start` installs dependencies, generates the local secrets into `.env`
(session, agent bridge, cron — written, never printed), starts the Postgres
this repo owns, applies migrations, and runs the web app, API and research
agent. Open `http://localhost:3000`.

`PRAMAAN_API_KEY` is the only value you type. With a key, **sign-in and the
database are provided through Pramaan in test mode**: the install gets a
managed sign-in backend — social sign-in works on shared test credentials,
and email sign-up is available through "Sign in with email" — plus, when the
platform can serve one, a managed Postgres, falling back to the bundled
local Postgres with one plain line while that switch is off. With no key at
all the product still starts: the sign-in page says "Add PRAMAAN_API_KEY to
.env", and enrichment, research and connected apps stay off until you add
one and restart.

**Who may sign in** is decided by `ALLOWED_SIGN_IN` — set it to your email
domain (`acme.com`) or a single address and restart; an empty list lets
nobody in, by design. If you'd rather use your own sign-in instead of the
managed backend, set `GOOGLE_CLIENT_ID` or `MICROSOFT_CLIENT_ID` in `.env`
(the client secret lives in your connected sign-in account on the platform —
codes are exchanged through Pramaan, so this install never holds one). Your
own SSO provider can be added later from Settings → SSO.

| Key | What it is |
|---|---|
| `PRAMAAN_API_KEY` | **The only typed value.** Everything — sign-in, the database, enrichment, research, storage, exchange rates, connected mailboxes — runs through it. |
| `DATABASE_URL` | Optional. With a key, the managed database is used when the platform serves one and the bundled local Postgres otherwise; set it only for a Postgres you run yourself. |
| `BETTER_AUTH_SECRET`, `AGENT_BRIDGE_SECRET`, `CRON_SECRET` | Generated into `.env` by `./start` on first run. |
| `ALLOWED_SIGN_IN` | Who may sign in: a domain (`acme.com`) or single addresses, comma-separated. Empty means nobody. |
| `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` | Optional sign-in of your own, replacing the managed backend's button. |

Everything else in [`.env.example`](./.env.example) is optional and commented.

## The agent and the model

The agent's tool loop runs through `llm.chat`. Company research first presents an
estimate for approval. Stopping a running research job requests cancellation;
completed work may remain. If a step's effect is unknown, check its status before
trying again. A busy start asks you to try later, and long runs can time out.

Settings → Connections includes action search. Search requests one paid catalogue
page; Load more requests the next. Results are cached for the current session.
Without a key, action search explains what to configure and stays disabled.

## The Pramaan client

`packages/pramaan` is the one module that talks to the platform and reads
`PRAMAAN_API_KEY`. It imports the published `@pramaan/sdk@0.1.0` package.
Product helpers and the fake client stay local; `src/sdk` keeps only compatibility
code for freshness headers, cancellation, retry metadata and accepted research reports.

## Three rules the codebase holds to

1. **One outside door.** Every external call goes through `packages/pramaan`, keyed by
   `PRAMAAN_API_KEY`. A vendor client anywhere else is a bug.
2. **Nothing about a person is guessed.** Evidence is recorded and priced; weak
   evidence never writes to the record.
3. **The test database is sacred.** Tests are real integrations against
   `TEST_DATABASE_URL`; they never touch `DATABASE_URL`.

## Deploying

Three deployments: the app and the API are stateless (Vercel works), the agent is a
long-running process on any Node host. One Postgres. Environment variables come from
the platform — the same names as `.env.example`. Run `prisma migrate deploy` against
`DATABASE_URL` on release.

## Connected accounts

Connecting an outside account, such as a mailbox or calendar for sync, carries a monthly Pramaan charge for each
connected account, billed to the Pramaan account behind `PRAMAAN_API_KEY`. Signing in is free. Disconnecting an account
ends its charge.

## Licence

AGPL-3.0. See [`LICENSE`](./LICENSE); the original project's MIT notice is in
[`LICENSE-ORIGINAL`](./LICENSE-ORIGINAL).

## Built on

This template is a rewired copy of [Comp AI's CRM](https://github.com/trycompai/crm)
(MIT), reworked so every outside call runs through Pramaan. The original project's
licence text is preserved in [`LICENSE-ORIGINAL`](./LICENSE-ORIGINAL).

Research steps default to a ceiling of 1,024 output tokens. Set `RESEARCH_MAX_TOKENS`
to a whole number from 64 to 8,192 to adjust it; larger limits allow more spending
on each step. Failed research remains visible and can be retried explicitly.
