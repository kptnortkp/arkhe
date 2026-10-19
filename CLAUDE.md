@AGENTS.md

# Arkhe Portal

Member portal for Koro Arkhe (choir). Plan and phases: `PLAN_INPUT.md`.

## Hard rules
- **Zero budget.** Only free/open-source dependencies and free tiers. Never add a paid service or plan.
- **No git yet.** Do not run `git init`, commit, or any `gh` command until the user sets git up. When they do, use only their personal identity (repo-local `user.name`/`user.email`, personal SSH alias). The machine's global git, `gh` and SSH are the company account and must never touch this repo.
- **Language.** UI copy is Turkish. Code, comments, identifiers, logs and error messages are English. Talk to the user in Turkish.
- **Phase gates.** Each phase ends with e2e tests and a team review; the next phase starts after the PO accepts. The user asked for fully autonomous progress: decide and document instead of asking.
- Testing is end-to-end only: `npm run e2e` (Playwright scripts in `e2e/`, real Chrome, against the running dev server; resets its own data). No unit tests. Keep `npm run lint` and `npm run typecheck` clean.
- Team process and phase docs: `design/TEAM.md`, `design/phase-<n>/`. Project subagents live in `.claude/agents/`.

## Stack
- Next.js 16 (App Router, `cacheComponents` off), React 19, TypeScript. Read `node_modules/next/dist/docs/` before using an unfamiliar API; this version differs from older training data (e.g. `middleware` is now `proxy.ts`).
- Tailwind v4 + shadcn/ui (base-ui primitives) in `src/components/ui`. Add components with `npx shadcn@latest add <name>`; don't hand-edit them unless needed.
- Drizzle ORM + libSQL. Local DB is `data/arkhe.db` (git-ignored); schema in `src/db/schema.ts`, versioned migrations in `drizzle/`. Later production target: Turso free tier via `DATABASE_URL` / `DATABASE_AUTH_TOKEN`.
- Auth is our own: email + password (scrypt), DB-backed sessions with an httpOnly cookie, invite links instead of email.

## Running
- `npm run dev` → http://127.0.0.1:3100 (port 3000/8000 range is used by the user's work containers).
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, then `npm run db:migrate` (or `npm run db:reset` with the dev server stopped to rebuild + seed).

## Domain
- Roles: `conductor` (Koro şefi), `board` (Yönetim kurulu), `member` (Korist). Role and voice part are separate: a board member also sings a part.
- Voice parts: `soprano`, `alto`, `tenor`, `bass` (no subdivisions). Labels/colours live in `src/lib/labels.ts`.
- Conductor and board are "managers": they run attendance, manage members and repertoire. Members check in and see their own history.
- **Authorize on the server** in every server action, route handler and data query. Hiding UI is never the check.

## UI conventions
- Mobile first: design at 375px, then widen. Bottom tab bar on mobile, sidebar from `md`.
- Use the tokens in `src/app/globals.css` (`bg-stage`, `bg-gold`, `bg-soprano`…); no raw hex colours in components.
- Headings use the display serif (Fraunces) automatically; body is Geist. Both themes (light/dark) follow the system setting and must both look right.
- Dates/times are formatted with `Intl.DateTimeFormat("tr-TR")`, Europe/Istanbul.
