# Cerberus

Open-source security visibility and vulnerability orchestration platform for engineering teams.

## Requirements

- Node 20 or later.
- A Postgres database. The project targets [Neon](https://neon.tech), which has a free tier.

You do not need Docker.

## Setup

**1. Install the dependencies.**

```bash
npm install
npm --prefix server install
```

**2. Create the database.**

Sign in to Neon and create a project named `cerberus`. Open **Connection Details** and copy
the pooled connection string. It starts with `postgresql://`.

**3. Add the connection string.**

```bash
cp server/.env.example server/.env
```

Open `server/.env` and paste the string into `DATABASE_URL`. Git ignores this file.

**4. Create the tables.**

```bash
npm run db:migrate
```

**5. Start both servers.** Use two terminals.

```bash
npm run dev:api   # API on http://localhost:4000
npm run dev       # Web app on http://localhost:5173
```

Open http://localhost:5173 and create an account.

## Layout

| Path | Holds |
| --- | --- |
| `src/` | The React app. |
| `server/` | The Fastify API and the database schema. |
| `shared/` | Types and rules that both sides import. |
| `design/` | Source art. The build does not read this folder. |

## Checking the database

Install [DBeaver](https://dbeaver.io) and connect it with the same `DATABASE_URL`.
`npm run db:studio` opens a lighter browser for the same tables.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Reports API and database status. |
| `POST` | `/api/auth/signup` | Creates a user, an organization, and a session. |
| `POST` | `/api/auth/login` | Starts a session. |
| `POST` | `/api/auth/logout` | Ends the session. |
| `GET` | `/api/auth/me` | Returns the signed-in user. |

## State

The gate calls the API. Signup and login post to the API, the session lives in
an HTTP-only cookie, and the workspace reads the signed-in user from
`GET /api/auth/me`. This path is written but not yet run against a database.

An organization account sees the Tasks and Audit modules. A personal account
does not. The sidebar hides them and the router redirects them.

Dashboard, Reporting, and Audit still show placeholder data from
`src/app/data.ts`. Scheduled, Findings, Assets, Integrations, Workspace,
Projects, Tasks, and Settings are empty pages. Ingestion does not exist yet.

Read `CLAUDE.md` before you change code. It holds the brand colors, the writing
rules, and the database rules.
