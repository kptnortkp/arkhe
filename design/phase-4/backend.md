# Phase 4 backend design: recording homework

Author: arkhe-backend. Inputs: `design/phase-4/po-spec.md`, Phase 3 `actions.ts` / `repertoire.ts` / `links.ts`, `src/lib/auth/{dal,session}.ts`, `src/lib/permissions.ts`, `src/lib/time.ts`, `src/lib/attendance/roster.ts`, `src/lib/validation.ts`, Next 16 docs `02-guides/server-actions.md`, `02-guides/data-security.md`, `04-functions/revalidatePath.md`. `ux.md`, `ui.md` and `db.md` don't exist yet; I use the PO's §6 names (`assignments`, `assignment_parts`, `submissions`, `app_settings`).

## 0. Cross-cutting rules (same as Phases 2–3)
- Pages: `requireUser()` for `/odevler` and `/odevler/[id]`; `requireManager()` for `/odevler/yeni`, `/odevler/[id]/duzenle` and `/odevler/matris`. Hiding a button is never the check.
- Every action starts with `assertUser()` or `assertManager()` and returns `FORBIDDEN = "Bu işlem için yetkin yok."` **before** parsing or touching the DB (AC 9, 10). Every argument goes through zod, bound args included (`z.uuid()` ids, enums from `schema.ts`).
- Copy: `NOT_FOUND = "Ödev bulunamadı."`, `STALE = "Ödev bu arada değişti. Sayfayı yenileyip tekrar dene."`, `FEEDBACK_LOCK = "Şef geri bildirim yazdı; teslimi geri alamazsın."`, `PIECE_HAS_HOMEWORK = "Bu esere bağlı ödevler var. Silmek yerine arşivle."`.
- `db.transaction()` on libsql is `BEGIN IMMEDIATE` (Phase 3 review-db), so read-check-write inside one transaction is serialised. Keep transactions DB-only and short.
- After every write: `revalidatePath("/", "layout")`. The tab badge lives in the portal layout, so per-path invalidation would leave it stale. The cost is fine at choir scale.
- I verified FKs are enforced: the libsql client reports `pragma foreign_keys = 1`. A `restrict` violation throws `LibsqlError` with code `SQLITE_CONSTRAINT`, extendedCode `SQLITE_CONSTRAINT_TRIGGER` (not `_FOREIGNKEY`!), message `FOREIGN KEY constraint failed`. Match on the message through the `cause` chain, like `isUniqueUrlError`.
- No route handlers this phase. CSRF is covered by the server-action Origin/Host check (docs: server-actions.md "CSRF check"); do not add `serverActions.allowedOrigins`. Body cap stays at 1 MB, and our largest input is 1000 chars.

## 1. Pure modules (isomorphic, no `server-only`, no Node APIs)

### 1.1 `src/lib/homework/eligibility.ts`
```ts
type Singer = { role: Role; voicePart: VoicePart | null; joinedAt: Date; leftAt: Date | null };
export const isEligible = (u: Singer, parts: VoicePart[]) =>
  u.leftAt === null && (u.role === "member" || u.role === "board") && u.voicePart !== null && parts.includes(u.voicePart);
export const isExpected = (u: Singer, a: { parts: VoicePart[]; createdAt: Date }) =>
  isEligible(u, a.parts) && u.joinedAt <= a.createdAt;
```
This is the single definition (like `attendance/roster.ts#isExpected`). The actions, the list, the matrix and the badge all use it or its SQL mirror (§4.4). Do **not** reuse the rehearsal `isExpected`: it allows the conductor's `leftAt > startsAt` and ignores parts for tutti.

### 1.2 `src/lib/homework/deadline.ts`: tone, with `now` injected
```ts
export type DeadlineTone = "green" | "amber" | "red" | "done" | "muted";
export type DeadlineBadge = { tone: DeadlineTone; label: string; late: boolean };
export function deadlineBadge(i: { dueAt: Date; now: Date; submittedAt: Date | null; expected: boolean }): DeadlineBadge;
```
- `H = 3_600_000`, `D = 24 * H`, `r = dueAt − now` (ms, integer, no Date arithmetic across zones; the instant difference is timezone-free).
- `submittedAt` set: `late = submittedAt > dueAt`. Label `Teslim edildi · {d}` or `Geç teslim · {d}`, where `d = formatDayMonthShort(submittedAt)` (new `time.ts` formatter `{ day: "numeric", month: "short" }` tr-TR Istanbul gives `22 Eki`). Tone `done`.
- `r > 3D` → green; `D < r ≤ 3D` → amber; label `${Math.ceil(r / D)} gün kaldı`.
- `0 < r ≤ D` → red; `r < H` → `1 saatten az kaldı`, otherwise `${Math.ceil(r / H)} saat kaldı`.
- `r ≤ 0` → red; `o = Math.floor(−r / D)`; `o === 0` → `Gecikti`, otherwise `Gecikti · ${o} gün`.
- `expected === false` (a new joiner, or a submitter whose part changed): red becomes amber while `r > 0`. When `r ≤ 0` the tone is `muted`, label `Son tarih geçti`. Never red.
- **@po: ceil, not floor, for "gün kaldı".** The spec's `floor` contradicts AC 3. The seed puts A at `+5 d`, but the test reads it a few seconds later, so floor shows `4 gün kaldı`; B at `+2 d` would read `1 gün kaldı`. Ceil satisfies AC 3 (A `5`, B `2`, `+72h−1m` → amber `3 gün`, `+72h+1m` → green `4 gün`). It also keeps the bands disjoint: green ≥ 4, amber 2–3, red in hours. Overdue keeps floor (D `−2 d − ε` → `2 gün`).
- `data-tone` = `tone`. Add `muted` to the PO's hook list (@ui).
- Manager list rows: call with `submittedAt: null, expected: true` (deadline tone only).

### 1.3 `src/lib/homework/mail.ts`: mailto builder
```ts
export function homeworkSubject(a: { pieceTitle: string; barFrom: number | null; barTo: number | null }, part: VoicePart, name: string): string;
export function homeworkBody(a: …, dueAt: Date, name: string): string;
export function mailtoHref(email: string, subject: string, body: string): string | null;
export function barsLabel(from: number | null, to: number | null): string; // "Ölçü 12–34" | "Ölçü 12" | "Tüm eser"
```
- Subject: `["Arkhe ödev", clean(title), barsLabel(...), VOICE_PART_LABELS[part], clean(name)].join(" · ")`. Here `clean(s) = s.toWellFormed().replace(/[\u0000-\u001f\u007f  ]/g, " ").replace(/\s+/g, " ").trim()`. Hard cap 200 chars: if over, shorten the title with `…` so the bars, part and name survive.
- Body lines are joined with `"\r\n"` (RFC 6068 §5: line breaks in `body` must be `%0D%0A`). `Son tarih:` uses `formatLongDate` + `formatTime` → `24 Ekim Cuma 23:59`. Interpolated values go through `clean()` too.
- `mailtoHref`: returns `null` unless `RECORDING_EMAIL_RE.test(email)` (§2.9), so an invalid stored value hides the button instead of rendering it. Shape: `` `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` ``.
  - The address is **not** encoded, because AC 4 expects a literal `mailto:kayit@arkhe.local?subject=`. That is safe only because the regex allows no `?`, `&`, `%`, `#`, whitespace or CR/LF.
  - Use `encodeURIComponent`, **never `URLSearchParams`**, which writes spaces as `+` that iOS Mail/Gmail show literally.
  - `toWellFormed()` prevents `URIError` on lone surrogates in a pasted title.
- Header injection: a mailto URL sets no headers on our side. The risk is a crafted `%0D%0ABcc:` reaching the client's composer. Every value is `encodeURIComponent`ed, so `&`, `=`, `%` and CR/LF can't create extra `hfields`. `clean()` also strips control characters from the subject before encoding. `homeworkSubject` is a pure function, so the copy button and the href use the same string (AC 4).

## 2. Server actions: `src/app/(portal)/odevler/actions.ts`

### 2.1 Shared form schema
```ts
const bar = z.string().trim().optional().transform(v => v || null)
  .pipe(z.coerce.number().int("…").min(1).max(9999).nullable());          // "" → null
const assignmentSchema = z.object({
  pieceId: z.uuid("Bir eser seç."),
  barFrom: bar, barTo: bar,
  parts: z.array(z.enum(VOICE_PARTS)).transform(a => [...new Set(a)]).pipe(z.array(z.enum(VOICE_PARTS)).min(1, "En az bir partisyon seç.")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bir tarih seç."),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Bir saat seç."),
  description: optionalText(1000).transform(v => v?.replace(/\r\n?/g, "\n") ?? null),
}).superRefine(...)
```
- The input is `{ ...Object.fromEntries(formData), parts: formData.getAll("parts") }`. `Object.fromEntries` keeps only the last checkbox.
- `superRefine` checks, in order:
  - Exactly one bar set → `barTo` gets `Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).`
  - `barTo < barFrom` → `Bitiş ölçüsü başlangıçtan küçük olamaz.`
  - The date must be a real calendar day: `istanbulDateOf(istanbulToUtc(d, t)) === d` rejects `2026-02-30`.
  - `dueAt ≤ now + 2 years`, otherwise `Son tarih çok ileride.`
  - The `dueAt > now` check is create-only (§2.2), so the schema is shared.
- `dueAt = istanbulToUtc(dueDate, dueTime)`. Istanbul is UTC+3 all year since 2016, and `istanbulToUtc` handles a future offset change anyway. Never use `new Date("…T23:59")`, which would parse in server-local time.

### 2.2 `createAssignment(_prev, formData)`: manager
- Also parse `id: z.uuid()`, a hidden field generated once per form mount (`crypto.randomUUID()` in the client). It becomes the primary key, so a double submit or a replay of the same POST can't create two rows.
- `dueAt ≤ now` → field error `dueDate: Son tarih geçmişte olamaz.`
- Transaction:
  1. Load the piece. Missing → `Eser bulunamadı.`; archived → `Arşivdeki esere ödev verilemez.`
  2. Insert into `assignments` with `onConflictDoNothing().returning()`. If the conflict row exists, `createdBy === actor.id` → return success with that id (idempotent); otherwise → `STALE`.
  3. Insert the `assignment_parts` rows.
- `createdAt` comes from the DB/server clock, never from input; it is the eligibility cut-off.
- Returns `{ success: "Ödev verildi.", values: { id } }`, and the form navigates, like `createPiece`.

### 2.3 `updateAssignment(id, _prev, formData)`: manager
- Same schema plus `version`: the hidden `updatedAt` ms the form was rendered with. No future check (spec §3.1).
- Transaction:
  1. `update assignments set … , updated_at = now where id = ? and updated_at = version`. 0 rows → `NOT_FOUND` if the row is gone, otherwise `STALE`. This stops two managers from silently overwriting each other's parts or deadline.
  2. Delete and re-insert `assignment_parts`.
- The piece may change only to an existing piece. It must not be archived unless it is the current one.
- Submissions are never touched, so a part change keeps them (spec §3.4). `createdAt` is never updated: editing must not shift who is expected.

### 2.4 `deleteAssignment(id)`: manager
- `delete … returning`. `assignment_parts` and `submissions` cascade (FK verified).
- 0 rows → `NOT_FOUND`. The UI treats that as done; a replay is harmless. Toast `Ödev silindi.`
- The dialog's `{n} teslim kaydı` comes from the detail query, not the action.

### 2.5 `submitAssignment(id)`: self only
- `actor = assertUser()`. The user id **always comes from the session**: there is no `userId` parameter, so there is nothing to IDOR.
- Transaction:
  1. Load the assignment parts and `users.{role, voicePart, joinedAt, leftAt}` for `actor.id`. The session user lacks `joinedAt`/`leftAt`, and the DB is fresher.
  2. `!isEligible` → `FORBIDDEN` (AC 9: F for an alto). An unknown id → `NOT_FOUND`.
  3. Upsert: `insert (assignmentId, userId, submittedAt: now, method: "self", markedBy: null) onConflictDoUpdate({ set: same, setWhere: isNull(submissions.submittedAt) })`.
- **Idempotent:** a second tap keeps the first time. After an undo, a new tap records the new time, which is the PO's "latest submit".
- Late is computed, never stored. Returns `{ success: "Teslim edildi." }` (the UI derives late from its badge).
- After the deadline the action still works (spec §3.6). There is no time gate.

### 2.6 `undoSubmission(id)`: self only
- `delete from submissions where assignment_id = ? and user_id = actor.id and feedback is null and submitted_at is not null returning`.
- 0 rows: look the row up. It has feedback → `FEEDBACK_LOCK` (AC 8). No row, or not submitted → `{}` (idempotent).
- One statement, so no race with a manager writing feedback at the same instant. Whichever runs first wins, and both outcomes are consistent.
- No eligibility check: the action only clears the caller's own row, and a singer whose part changed must still be able to fix a mistaken tap.
- **@po Q1:** agree with your lean. Undo also clears a `manual` mark, because the predicate doesn't look at `method`.

### 2.7 `setSubmissionFor(assignmentId, userId, submitted: boolean)`: manager
- `submitted = true`: the target must be `isEligible` (a joiner after `createdAt` is allowed), else `Bu kişi bu ödevden sorumlu değil.` Upsert `{submittedAt: now, method: "manual", markedBy: actor.id}` with `setWhere: isNull(submittedAt)`, so a singer's real `self` time is never overwritten (idempotent).
- `submitted = false`: works on any existing row, including a left member's, to fix a mistake.
  - With feedback: `update set submitted_at = null, method = null, marked_by = null`. The DB `CHECK` keeps `method` and `submitted_at` paired.
  - Without feedback: `delete`.
  - No row → `{}`.
- Does not touch `feedback*`.

### 2.8 `saveFeedback(assignmentId, userId, _prev, formData)`: manager
- `feedback: optionalText(1000)`, with CRLF normalised.
- The target must be `isEligible`, or already have a row (a past submitter who left or changed part). Else `Bu kişi bu ödevden sorumlu değil.`
- Transaction:
  - Non-empty: upsert `{feedback, feedbackBy: actor.id, feedbackAt: now, feedbackSeenAt: null}`. If the text is unchanged, return early, so a re-save doesn't revive `Yeni not`.
  - Empty: `feedback`, `feedbackBy`, `feedbackAt` and `feedbackSeenAt` are set to null. If the row then has no submission, `delete`.
- Two managers editing: last write wins; the stored author is whoever saved last. Acceptable at this scale.
- **@po Q4:** agree, both managers can write. Show `feedbackBy`'s name, so a YK note is never mistaken for the conductor's.

### 2.9 `markFeedbackSeen(id)`: self only
- `update submissions set feedback_seen_at = now where assignment_id = ? and user_id = actor.id and feedback is not null and (feedback_seen_at is null or feedback_seen_at < feedback_at)`.
- Call it from a tiny client effect on the detail page when `Şefin notu` renders, **not** during the server render. A Link prefetch of `/odevler/[id]` must never mark a note as read, and server components shouldn't write on GET. Idempotent.

### 2.10 `setRecordingEmail(_prev, formData)`: manager
- `export const RECORDING_EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/` lives in `mail.ts`, shared by the action and the renderer.
- Schema: `z.string().trim().toLowerCase().max(254).refine(v => v === "" || RECORDING_EMAIL_RE.test(v), "Geçerli bir e-posta adresi gir.")`.
- It deliberately rejects `%`, quotes and IDN/Unicode, which `z.email()` might let through. That is what makes the raw address in `mailtoHref` safe. `kayit@` fails (AC 20); `İ` lowercases to `i̇` and fails, which is fine.
- `""` → `delete from app_settings where key = 'recording_email'` (clears it, AC 12). Otherwise upsert `{value, updatedAt: now, updatedBy: actor.id}`.
- Read via `getRecordingEmail()`, which re-validates with the same regex and returns `null` when the value is invalid (defence in depth against a hand-edited DB).

### 2.11 `deletePiece` change (`repertuvar/actions.ts:153`)
- Inside the existing transaction, **before** deleting links: `select 1 from assignments where piece_id = ? limit 1` → return `PIECE_HAS_HOMEWORK` (AC 21). This doesn't depend on error strings, and `BEGIN IMMEDIATE` closes the race with a concurrent `createAssignment`.
- Backstop: wrap the transaction in try/catch with `isForeignKeyError(e)`, which walks `cause` for `"FOREIGN KEY constraint failed"`. If it matches, return the same message (the rollback restores the links).
- Also archive-friendly: `setPieceStatus("archive")` doesn't touch homework.

## 3. Idempotency and replay summary
| Action | Double tap / replay | Concurrency |
|---|---|---|
| create | client UUID primary key + `onConflictDoNothing` | — |
| update | `version` guard → `STALE` | optimistic |
| delete / undo / seen / mark false | the second run is a no-op | single statement |
| submit / mark true | `setWhere submitted_at is null` keeps the first time | upsert on PK |
| feedback | an unchanged text is a no-op | last write wins |

React dispatches actions from one client sequentially (docs), and `useActionState` disables the pending button. Neither is relied on for correctness.

## 4. Queries: `src/lib/homework/queries.ts` (`server-only`)
Rule: **no query that serves a member selects another user's `feedback`**. Feedback text is selected in exactly two places: `mySubmission` (filtered by `user_id = viewer.id`) and `managerMatrixFor` (called only after `isManager(viewer.role)`). Neither is passed as props to a client component that a member renders.

1. `listForViewer(viewer, view, now)`
   - Members: assignments where `exists (assignment_parts with voice_part = viewer.voicePart)` **or** `exists (my submission row)`, in the window (`guncel: due_at >= now − 7 d`, asc; `gecmis`: older, desc).
   - Left join `submissions` with `user_id = viewer.id` **in the ON clause**. In `WHERE` it would drop rows; without it, it would join everyone's rows.
   - Selected from my row: `submittedAt`, `method`, `hasNewNote = feedback is not null and (seen is null or seen < feedback_at)`, **not** the text.
   - Plus `pieceTitle`, the bars, `dueAt`, `createdAt` and the parts (one `inArray` query, no N+1). `expected` is computed with `isExpected` against the viewer's `joinedAt`, loaded once.
   - Managers: all rows plus counts. The counts come from one roster load (`id, role, voicePart, joinedAt, leftAt`; no email or phone) and one `submissions` load of `assignmentId, userId, submittedAt` for the listed ids. `{n}/{m}` and the per-part counts are computed with `isExpected` in JS (same as the matrix: m = expected ∪ submitters still active, n = submitted).
2. `getAssignment(id)`: assignment, piece `{id, title, status}`, parts, creator name. Every viewer can read it (spec §3.4).
   - `mySubmission(id, viewer.id)` adds feedback text, author name and `feedbackAt`.
   - `partFiles` reuses `withMyPart([{ id: pieceId }], viewer.voicePart)` from `repertoire.ts`.
3. `managerMatrixFor(id)`: roster rows as in §1.1. A left member appears only with a submitted row (`Ayrıldı`); a non-expected submitter is counted in both n and m. Feedback text is included for the sheet; `markedBy` name only.
4. `homeworkMatrix(now)`: the 8 assignments with the latest `dueAt` (sorted asc for columns); the roster; and submissions **without feedback columns** (`assignmentId, userId, submittedAt, method`). Cell = pure `cellState(user, a, sub, now)` → `on_time | late | missing | pending | none`.
5. `openHomeworkCount(viewer, now)`: one `count(*)` over the three conditions below. Wrapped in React `cache()`, so the layout and the home card share it. It returns 0 without querying when the viewer isn't eligible (no part, conductor, left).
   ```sql
   assignments a join assignment_parts p on p.assignment_id = a.id and p.voice_part = :part
   where a.due_at >= :now − 7 d and a.created_at >= :joinedAt
     and not exists (select 1 from submissions s where s.assignment_id = a.id and s.user_id = :me and s.submitted_at is not null)
   ```
   Indexes needed: `assignment_parts(voice_part, assignment_id)` and `submissions` primary key `(assignment_id, user_id)`.
   - @dba: also an index on `assignments(due_at)`, as the PO proposed.
   - **@po Q2:** yes, worth it: one indexed count over ~dozens of rows per request.
   - **But** board members are eligible singers, so they should get the badge too (it nudges them as singers). "Managers get no badge" should read "the conductor gets no badge".
6. `getRecordingEmail()`: §2.10. Piece detail `openHomeworkForPiece(pieceId, now)`: `id`, `dueAt` and the bars only.

## 5. Security notes
- **IDOR:**
  - Self actions take no `userId`.
  - Manager actions take a `userId` but are manager-gated and validate the target against the assignment (eligible or existing row).
  - Every `submissions` write keys on `(assignmentId, userId)`, so a manager can't create rows for random users either.
  - Assignment ids are UUIDs, but read access is allowed anyway; secrecy is not the control.
- **Privilege escalation:** no role or part is read from input. Eligibility is re-read from the DB inside the transaction, so a demoted or left user's still-valid session can't submit. Sessions of inactive users are already rejected by `getSessionUser`.
- **Data exposure:** the member HTML must never contain another singer's feedback or submission data (AC 10). Check this in e2e on `/odevler/[A]` as `korist@` by grepping the page source for another seeded note. The matrix and list queries select only the columns listed above (no email or phone).
- **Replay/CSRF:** server actions are POST-only with the Origin check; there is no GET mutation. `markFeedbackSeen` is an action, not a render side effect.
- **Input size:** text ≤ 1000, bars ≤ 9999, at most 4 parts after dedupe, the email ≤ 254, the 1 MB default body cap. **Rate limits:** none needed. Every action is authenticated, idempotent and O(1) rows; the login rate limit already protects session acquisition.
- **Rendering:** description and feedback render as text (`whitespace-pre-line`), never `dangerouslySetInnerHTML`. The mailto href is built only by `mailtoHref`, from a regex-validated address.
- **Timezone:** all comparisons use UTC instants. Istanbul matters only at the form boundary (`istanbulToUtc`) and in display (`formatter`s in `time.ts`). The 7-day `Güncel` window is `now − 7 × 24 h` in instants (no DST in TR).
