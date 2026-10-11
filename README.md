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
| `packages/*` | `auth` (better-auth), `db` (Prisma), `pramaan` (the one outside-call client), `telemetry`, `ui`, `env`, `validation` |

Postgres is the database. Redis is an optional shared cache once website tracking is on.

## Quick start

```bash
bun install
docker compose up -d          # Postgres
cp .env.example .env          # then fill in the values below
bun run db:test               # creates the test database and applies migrations
bun run dev                   # all three processes
```

Open `http://localhost:3000` and sign in with an address under your `ALLOWED_SIGN_IN`
domain.

### The values to set

| Key | What it is |
|---|---|
| `PRAMAAN_API_KEY` | **Required.** The one outside credential. Everything — enrichment, research, storage, exchange rates, connected mailboxes — runs through it. |
| `DATABASE_URL` | Postgres. `docker compose` starts one with the defaults. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `ALLOWED_SIGN_IN` | Who may sign in: a domain (`acme.com`) or single addresses, comma-separated. |
| `GOOGLE_CLIENT_ID/SECRET` | Sign-in with Google (optional; SSO also works). Mail and calendar are connected separately, through Pramaan, on Settings → Connections. |
| `MICROSOFT_CLIENT_ID/SECRET` | Sign-in with Microsoft 365 (optional). |
| `POSTHOG_KEY` / `POSTHOG_HOST` | Optional product analytics — your own project. Unset, nothing is sent. |

Everything else in [`.env.example`](./.env.example) is optional and commented.

## The agent and the model

The agent's runs need a **tool-capable model**. The platform does not serve one yet,
so agent runs report that they cannot start until the lab
ships `llm.agent.run`. Everything else — the CRM, mail and calendar sync, connections,
the model-free surfaces — works today.

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

## Licence

AGPL-3.0. See [`LICENSE`](./LICENSE); the original project's MIT notice is in
[`LICENSE-ORIGINAL`](./LICENSE-ORIGINAL).

## Built on

This template is a rewired copy of [Comp AI's CRM](https://github.com/trycompai/crm)
(MIT), reworked so every outside call runs through Pramaan. The original project's
licence text is preserved in [`LICENSE-ORIGINAL`](./LICENSE-ORIGINAL).
