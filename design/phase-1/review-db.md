# Phase 1 review: database layer (DBA)

Scope: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `src/lib/auth/*`, every `actions.ts` and page that hits the DB, `scripts/seed.ts`, `scripts/create-admin.ts`, the live `data/arkhe.db` (read-only).

Overall: the auth data model is good. Token and session ids are stored as SHA-256 only, the invite claim is an atomic `UPDATE … RETURNING` inside a transaction, deactivation is enforced in the session query itself (`users.is_active` in `getSessionUser`), and emails are lower-cased on every write path (zod `emailSchema`, `login`, `create-admin`). The findings below are mostly about what happens when real data moves to Turso.

## What I checked on the live DB

| Check | Result |
|---|---|
| `PRAGMA foreign_keys` in `sqlite3` CLI | `0`. This is a per-connection setting and the CLI defaults to off, so manual edits in the CLI skip FK checks. |
| `PRAGMA foreign_keys` through `@libsql/client` (the app's driver, run on a copy of the DB) | `1`. libSQL turns FKs on for local file connections, so the app enforces them. |
| `PRAGMA journal_mode` / `busy_timeout` through the client | `delete` / `0` |
| Indexes | `users_email_unique`, `sessions_user_idx`, `login_attempts_key_idx (key, attempted_at)`, `attendance_user_idx`, `piece_files_piece_idx`, plus PK autoindexes. There is none on `invites.user_id` or `rehearsals.starts_at`. |
| Schema drift | `invites.purpose` and `users.last_login_at` were added with `ALTER TABLE … ADD COLUMN` by `drizzle-kit push`. No migration files exist. |
| Data | 23 users (all emails lower-case), 0 sessions, 3 invites, 0 login attempts. |

## P1: fix before real member data goes to Turso

### P1-1 No migration history and no backups. `drizzle-kit push` would run against production.
`push` diffs the schema against the live DB and applies the result straight away. Some changes (adding a CHECK, changing an FK or its on-delete, renaming a column) make it recreate the table (copy, drop, rename). It asks interactively about data loss, and there is no file to review, rerun or roll back. For a local demo DB that is fine. For the choir's real member list on Turso, with no backup, one wrong answer at a prompt loses data for good.

Fix, done now while Turso is still empty (this is the cheapest moment):

```ts
// drizzle.config.ts
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:data/arkhe.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
```

```jsonc
// package.json scripts
"db:generate": "drizzle-kit generate",   // writes drizzle/NNNN_*.sql, review it like code
"db:migrate": "drizzle-kit migrate",     // applies pending files, tracked in __drizzle_migrations
"db:push": "drizzle-kit push",           // keep for throwaway local DBs only
"db:backup": "tsx --env-file-if-exists=.env scripts/backup.ts"
```

Baseline: run `db:generate` once to get `0000_init.sql`, delete `data/arkhe.db`, run `db:migrate` followed by `seed` (the local data is demo-only). From then on every schema change is a reviewed SQL file. For changes that need a table rebuild, hand-edit the generated SQL so it does `PRAGMA foreign_keys=OFF` … `PRAGMA foreign_key_check` … `PRAGMA foreign_keys=ON`. Without that, `DROP TABLE users` while FKs are on would cascade-delete every session, invite and attendance row.

Backups at zero cost:
- Don't rely on Turso's built-in point-in-time restore. Free-tier retention is short and can change; check the current plan, but treat it as a bonus.
- Add `scripts/backup.ts`, which reads every table through `@libsql/client` and writes one JSON or SQL dump. Run it from a nightly GitHub Actions cron in a private repo (free) and upload the dump as an artifact with 30–90 day retention. The dump contains names, emails and phones (personal data), so encrypt it before upload with `age` and a public key kept in repo secrets.
- Always run `npm run db:backup` before `db:migrate` against Turso.
- Locally: `sqlite3 data/arkhe.db "VACUUM INTO 'backups/arkhe-$(date +%F).db'"`.

### P1-2 FK enforcement is unverified on Turso, and nothing fails loudly if it is off
Locally the client reports `foreign_keys = 1`. Remote Turso/sqld runs each HTTP request on a pooled connection, so a `PRAGMA foreign_keys = ON` sent from the app would not stick, and we can't "just set it". Every `onDelete: "cascade"` / `"set null"` in the schema, and the Phase 2 attendance integrity, depend on this pragma.

Fix: assert it, don't assume it. Add a one-off check to `scripts/backup.ts` (or a tiny `scripts/db-check.ts`) and to the go-live checklist:

```ts
const { rows } = await client.execute("PRAGMA foreign_keys");
if (Number(rows[0]?.foreign_keys) !== 1) throw new Error("Foreign keys are not enforced on this database");
const bad = await client.execute("PRAGMA foreign_key_check");
if (bad.rows.length) throw new Error(`Orphaned rows: ${JSON.stringify(bad.rows)}`);
```

Also: never edit production with a plain `sqlite3`/`turso db shell` session without running `PRAGMA foreign_keys = ON;` first.

## P2: should fix, not blocking

### P2-1 Enums are TypeScript-only. `users.role` has no DB constraint.
`text("role", { enum: ROLES })` is enforced only by the TS types. A typo in a shell session or a future script (`'admin'`, `'Conductor'`) gives a user whom `isManager()` silently treats as a plain member. Worse, an unknown role on a manager row would lock the choir out. Add CHECKs (drizzle-orm 0.45 supports `check()` for SQLite):

```ts
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const users = sqliteTable(
  "users",
  { /* columns unchanged, but drop .unique() on email (see P2-2) */ },
  (t) => [
    check("users_role_check", sql`${t.role} in (${inList(ROLES)})`),
    check("users_voice_part_check", sql`${t.voicePart} is null or ${t.voicePart} in (${inList(VOICE_PARTS)})`),
    check("users_email_lower_check", sql`${t.email} = lower(${t.email})`),
    uniqueIndex("users_email_unique").on(t.email),
  ],
);
```

Apply the same pattern to `invites.purpose`, `attendance.status/method` and `piece_files.kind`. Adding a CHECK rebuilds the table in SQLite, which is one more reason to land P1-1 first.

### P2-2 Case-insensitive email uniqueness relies on app discipline only
Every current write path lower-cases, and all 23 live rows are lower-case. Nothing in the DB stops `Ayse@…` and `ayse@…` from both existing, though (for example via a future CSV import or a shell insert), and then login (`eq(users.email, email)` with a lower-cased input) can never reach the mixed-case row. The `users_email_lower_check` above closes this: the existing unique index plus "must already be lower-case" means uniqueness is case-insensitive. SQLite's `lower()` only folds ASCII. That is fine here because `z.email()` accepts ASCII addresses only. Prefer this over a `lower(email)` expression index, because then every query can keep using the plain `eq(users.email, …)`.

### P2-3 Unique-violation race on create/update member becomes a 500
`createMember` / `updateMember` call `emailTaken()` and then insert or update. Two managers adding the same email at once (or a double submit) make the second insert throw `SQLITE_CONSTRAINT_UNIQUE`, which ends up as an unhandled error page. Keep the pre-check for the friendly message, but also catch the constraint:

```ts
function isUniqueViolation(e: unknown) {
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT";
}
// around the insert/update:
try { … } catch (e) {
  if (isUniqueViolation(e)) return { values: formValues(formData), fieldErrors: { email: ["Bu e-posta ile kayıtlı bir üye zaten var."] } };
  throw e;
}
```

### P2-4 `createMember` inserts the user and the invite in separate statements
If `createSetPasswordLink` fails, the member exists without a link. A manager can recover via "link oluştur", but the UI shows an error for something that half-succeeded. Do both in one transaction. `createSetPasswordLink` should accept an executor:

```ts
type Executor = Pick<typeof db, "insert" | "delete">;
export async function createSetPasswordLink(userId: string, purpose: Purpose, tx?: Executor) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + LIFETIME_HOURS[purpose] * 3_600_000);
  const run = async (x: Executor) => {
    await x.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usedAt)));
    await x.insert(invites).values({ tokenHash: hashToken(token), userId, purpose, expiresAt });
  };
  await (tx ? run(tx) : db.transaction(run));
  return { url: appUrl(`/davet/${token}`), expiresAt };
}

// createMember
const result = await db.transaction(async (tx) => {
  const [member] = await tx.insert(users).values(data).returning({ id: users.id, name: users.name });
  return { member, link: await createSetPasswordLink(member.id, "invite", tx) };
});
```

### P2-5 Local file DB: rollback journal, no busy timeout
`journal_mode=delete` and `busy_timeout=0` mean that a write landing while another connection (`drizzle-kit studio`, a seed script, the e2e run) holds the lock fails immediately with `SQLITE_BUSY`. This only matters for the local file (Turso handles it server-side). In `createDb()`, for `file:` URLs only:

```ts
const db = drizzle(client, { schema });
if (url.startsWith("file:")) {
  await client.execute("PRAGMA journal_mode = WAL"); // persistent, set once per file
  await client.execute("PRAGMA busy_timeout = 5000");
}
```

`createDb` is sync today, so either call these from a small `await ensurePragmas()` in scripts, or set WAL once by hand (`sqlite3 data/arkhe.db "PRAGMA journal_mode=WAL"`, which persists) and leave `busy_timeout` as a nice-to-have.

## P3: housekeeping

- **P3-1 Expired sessions are never deleted.** `getSessionUser` filters on `expires_at`, so this isn't a security hole, but the table only grows (90-day sessions, ~60 users, so slowly). Clean up opportunistically in `createSession`: `await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));`. It is cheap and needs no cron. Add `index("sessions_expires_idx").on(t.expiresAt)` only if the table ever passes a few thousand rows.
- **P3-2 Used and expired invites pile up.** `createSetPasswordLink` already removes the user's unused links. Add a cleanup to the same transaction for rows that are no longer useful: `tx.delete(invites).where(or(lt(invites.expiresAt, new Date()), lt(invites.usedAt, new Date(Date.now() - 30 * 86_400_000))))`. Keeping used rows for 30 days leaves a short audit trail.
- **P3-3 `login_attempts` cleanup** runs only on a failed login, which is fine (idle table, ~0 rows). The cleanup `DELETE … WHERE attempted_at < ?` can't use the `(key, attempted_at)` index and scans the table, which is irrelevant at this size. No change. @backend: `clientIp()` trusts `x-forwarded-for` as-is. That's a rate-limit bypass, not a DB issue, but behind Vercel/Render take the platform's header.
- **P3-4 Missing `invites.user_id` index.** `createSetPasswordLink`, `setMemberActive` and the FK cascade from `users` all filter invites by `user_id`. Tiny table, but the FK cascade needs it in principle: `(t) => [index("invites_user_idx").on(t.userId)]`.
- **P3-5 Non-atomic multi-step writes in `changePassword` and `setPassword`** (update hash, then delete sessions, then create session). A crash in between only logs the user out, which is acceptable. `setMemberActive` is safe without a transaction because `getSessionUser` checks `is_active` anyway.
- **P3-6 `/uyeler` sorts with `asc(users.name)`**, which is a binary collation: "Çağla", "İrem", "Özge" and "Şule" sort after "Zeynep". The members page already loads everything into JS, so sort there with `a.name.localeCompare(b.name, "tr")` and drop the `orderBy`. (@ui-engineer, this is a UI fix.)
- **P3-7 `create-admin` deletes all the user's invites, including used ones,** and uses its own 24 h expiry instead of `createSetPasswordLink`. Harmless; reuse the helper once it takes an executor (P2-4).
- **Data exposure check:** no cross-role leaks found. `/uyeler` and `/uyeler/[id]` call `requireManager()`; `getSessionUser` returns only the caller's own row; `/davet/[token]` reveals name and email only to someone holding a valid token. `password_hash` is read on `/uyeler/[id]` but used only as a boolean. Prefer `hasPassword: isNotNull(users.passwordHash)` there, as `/uyeler` already does, so the hash never reaches a server component that might pass props on.

## Ahead of Phase 2: rehearsals and attendance

The Phase 0 tables need changes before any rehearsal data exists. Since these tables are still empty, recreating them costs nothing.

1. **Status set does not match the spec.** PLAN_INPUT asks for *geldi / geç geldi / mazeretli / gelmedi*, but `ATTENDANCE_STATUSES` has no `late`. Use `["present", "late", "excused", "absent"]` with a CHECK. Pre-announced excuses (the "önceden mazeret bildirme" requirement) are rows with `status = 'excused'`, `method = null`, `recorded_by = user_id`, written before the rehearsal. Add `"self"` to `CHECK_IN_METHODS` for this and keep `note` for the reason.
2. **Don't cascade-delete history with users.** `attendance.user_id … onDelete: "cascade"` would wipe a member's whole history if a user row were ever deleted, which breaks the percentages. Members leave by `is_active = false` (already the pattern), so make it `onDelete: "restrict"`. Keep `rehearsal_id … cascade` (deleting a mistakenly created rehearsal should remove its rows).
3. **Rehearsal type and recurrence.** Add `kind text not null default 'tutti'` with CHECK in `('tutti','sectional','concert','general')` and `voice_part` (nullable; set for sectional rehearsals, which defines who is expected). Implement weekly recurrence by **materializing rows** with a `series_id text` (nullable, indexed) rather than storing an RRULE. Reports, check-in and correction all need a concrete row per date, and editing "this and following" becomes `UPDATE … WHERE series_id = ? AND starts_at >= ?`. Add `cancelled_at integer` instead of deleting, so a cancelled date doesn't count against anyone.
4. **Who was expected.** Percentages need a denominator. Compute it as "active members at `starts_at` whose voice part matches (or all, for tutti)". `is_active` is a current flag, though, so someone who joined in March would count as absent for every rehearsal in January. Add `users.joined_at integer` (backfill from `created_at`) and `users.left_at integer` (set when deactivated). Then the denominator is `joined_at <= starts_at and (left_at is null or left_at > starts_at)`. Without these, history reports go wrong the moment someone is deactivated.
5. **Check-in code.** `code_secret` is fine as an HMAC seed for the rotating 4-digit code (derive it server-side from `secret + floor(now/30s)`). Keep it out of every member-facing select: select columns explicitly, never `select()` the full rehearsal row on a member page. Rate-limit code attempts with the existing `login_attempts` table (`key = "checkin:<userId>"`). A 4-digit code is brute-forceable without it.
6. **Indexes for the screens.** `index("rehearsals_starts_idx").on(t.startsAt)` for the calendar and the "next rehearsal" card, `index("rehearsals_series_idx").on(t.seriesId)`, and `attendance_user_idx` → `(user_id, rehearsal_id)` for "my history". The PK `(rehearsal_id, user_id)` already covers the live roll-call screen.
7. **Writes.** Check-in uses an upsert: `insert(attendance).values(…).onConflictDoUpdate({ target: [attendance.rehearsalId, attendance.userId], set: { status, method, recordedAt, recordedBy } })`, guarded by `opened_at is not null and closed_at is null` in the same statement or transaction. Bulk marking ("hepsini geldi işaretle") is one multi-row upsert in a transaction, not N calls. Corrections after the fact keep `recorded_by` / `recorded_at` up to date. If the board wants an audit trail, add an `attendance_log` table later; the YAGNI default is no log for now.
8. **Reports.** Compute per-person and per-part percentages in a single `GROUP BY` query over the window (last N non-cancelled rehearsals), not one query per member. Count `late` as present and `excused` as neither present nor absent. The PO should confirm that rule in the Phase 2 spec.
