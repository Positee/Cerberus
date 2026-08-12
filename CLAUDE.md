# Cerberus

Open-source security visibility and vulnerability orchestration platform for engineering teams.

Read this file before you change any code or write any text. The rules below are
project law. Do not change them without the owner's approval.

## Brand colors

The theme is black and deep purple. Use only these colors.

| Token | Hex | Use |
| --- | --- | --- |
| Deep Night Black | `#0B0314` | Page background. The base of every screen. |
| Royal Dark Purple | `#3A125E` | Primary surfaces, buttons, and selected states. |
| Tyrian Purple | `#4A0E4E` | Secondary surfaces and gradient partners. |
| Teal | `#008080` | The one accent. Focus rings, links, active steps. |
| Bright Cyan | `#00F5FF` | Held in reserve. Teal reads more professional, so the product uses Teal. |

The interface uses a lighter ramp of Teal, because `#008080` reaches only 3.7:1
on the page black and fails for small text. The ramp is `--accent: #14B8A6`,
`--accent-dim: #0D9488`, and `--accent-glow: #2DD4BF`. All three clear 7:1.

Rules:

1. Black and deep purple carry the design. Teal is an accent only. Do not fill
   large areas with teal.
2. Do not add a new hue. If you need another step, make a lighter or darker
   value of a color in the table.
3. Red is reserved. The only red in the product is the eyes of the Cerberus
   animation. Do not use red for buttons, links, or surfaces. Error states use
   a desaturated red that is defined once as a token.
4. Every color must come from a CSS custom property in `src/styles.css` or
   `src/app.css`. Do not write a raw hex value in a component.

### Data colors

Charts and severity marks are the one documented exception to rule 2. A reader
must be able to tell Critical from Low, so these slots need their own hues. They
live in `src/app.css` and nowhere else.

| Token | Hex | Use |
| --- | --- | --- |
| `--sev-critical` | `#E5425F` | Critical severity |
| `--sev-high` | `#EF8A12` | High severity |
| `--sev-medium` | `#C2C53C` | Medium severity |
| `--sev-low` | `#3FB4C9` | Low severity |
| `--series-raised` | `#8B5CF6` | Chart series: findings raised |
| `--series-resolved` | `#13A89A` | Chart series: findings resolved |

Both chart series pass every check in the data-viz validator against the panel
surface. The severity ramp is a status palette, so every severity mark must also
carry its name and its count. Never encode severity with color alone.

## Writing style

Write all text in ASD-STE100 Simplified Technical English. This applies to the
user interface, code comments, commit messages, documentation, and chat replies.

1. Write short sentences. Use 20 words or fewer.
2. Write one idea in one sentence.
3. Use the active voice. Write "Cerberus scans your repository", not "your
   repository is scanned".
4. Use one word for one meaning. Do not use a synonym for variety.
5. Use simple, common words. Do not use jargon or slang.
6. Use articles such as "the" and "a".
7. Write positive statements. Say what to do, not what to avoid.
8. Do not use em dashes. Use a period, a comma, or a colon.
9. Do not use contractions in interface text.

## Stack

Frontend, in `src/`:

- React 19, TypeScript, Vite 6, React Router 7.
- `lucide-react` for icons.
- No CSS framework. Styles live in `src/styles.css` and `src/app.css`.

API, in `server/`:

- Fastify 5 on Node 20, TypeScript, ES modules.
- Drizzle ORM with `postgres.js`. Postgres runs on Neon.
- Argon2id password hashing through `@node-rs/argon2`.
- Sessions are opaque tokens in an HTTP-only cookie. The database stores only
  the SHA-256 of each token.

Shared, in `shared/`:

- Types and rules that both sides import. The password policy lives here.
  Never copy a rule into one side only. The form and the API must agree.

## Commands

Run these from the repository root.

| Command | Action |
| --- | --- |
| `npm run dev` | Start the web app on port 5173. |
| `npm run dev:api` | Start the API on port 4000. |
| `npm run typecheck` | Typecheck the web app and the API. |
| `npm run build` | Typecheck and build the web app. |
| `npm run db:generate` | Write a migration from `server/src/db/schema.ts`. |
| `npm run db:migrate` | Apply migrations to the database. |
| `npm run db:studio` | Open the Drizzle table browser. |

Vite proxies `/api` to port 4000, so the browser and the API share one origin
and the session cookie needs no CORS.

## Database rules

1. Every tenant table carries an `organization_id`. A personal signup still
   creates an organization row with kind `personal`. There is one scoping rule.
2. Change the schema in `server/src/db/schema.ts`, then run `npm run db:generate`.
   Never edit a file in `server/drizzle/` by hand.
3. Store an email address in lower case. Call `normalizeEmail` before you write.
4. Never log a password, a password hash, or a session token.
