# Phase 4 backend review

Author: arkhe-backend. I checked the code against `backend.md` and `po-decisions.md`; where they differ, the PO file wins. I also read `implementation-notes.md`.

Code I read:
- `src/app/(portal)/odevler/actions.ts`
- `src/lib/homework/{eligibility,deadline,mail,queries}.ts`
- every page under `src/app/(portal)/odevler/**`
- `src/app/(portal)/layout.tsx`, `src/app/(portal)/page.tsx` and `src/components/homework/*`
- `deletePiece` in `src/app/(portal)/repertuvar/actions.ts`
- `src/lib/auth/dal.ts`, `src/lib/time.ts` and the Phase 4 tables in `src/db/schema.ts`

Scratch scripts are in the session scratchpad under `review4-backend/`:
- `t.ts`: deadline boundaries plus hostile input to the mail helpers
- `leak.mjs`: a live probe of the running app

**Verdict: no P1. One P2: a crash in the mail subject builder. A handful of P3s. Authorization, IDOR scoping, data exposure, D1 rounding and timezone handling all hold.**

## What holds up

- **Authorization comes first.**
  - All 9 actions call `assertUser()` or `assertManager()` before they parse input or touch the DB. Bound ids go through `z.uuid()`.
  - Pages:
    - `requireUser()` on `/odevler` and `/odevler/[id]`. `generateMetadata` goes through `load()`, which calls `requireUser()` before reading.
    - `requireManager()` on `yeni`, `duzenle` and `matris`, before param parsing.
  - The roster, the menu, the matrix and `pieceOptions` are reached only through the manager branch or manager pages.
- **IDOR.**
  - The self actions (`submitAssignment`, `undoSubmission`, `markFeedbackSeen`) take no user id. Every write is keyed on `(assignmentId, actor.id)`.
  - Manager actions validate the target with `targetAllowed`, which re-reads eligibility from the DB through `loadViewer`. Hostile args (`{}`, `null`, `"../x"`, extra args) give `Ödev bulunamadı.` or are ignored.
- **Eligibility is re-read from the DB.** `submitAssignment` loads `users.{role,voicePart,joinedAt,leftAt}` fresh, so the session's role/part is never trusted. The conductor and users without a part are never eligible.
- **Data exposure. I tested this live, as `korist@` and `yeni@`.**
  - Pages: `/`, both lists, every assignment detail and every linked piece page (14 paths).
  - I checked the HTML and the RSC payload (`RSC: 1`) for every other user's feedback text **and every other submitter's name**. There were **0 hits**.
  - Feedback text is selected only in `mySubmission` (scoped to the viewer) and the manager-only `rosterFor`. `listForSinger` joins `submissions` with `user_id = viewer` in the ON clause and selects only `submittedAt` and `hasNewNote`. `homeworkMatrix` selects no feedback.
  - Client props: members get `FeedbackSeen{id}`, `SubmitToggle` (own badges, marker name) and `SingerSteps` (own mailto). `Roster` with feedback is rendered only for managers.
- **D1 tones/rounding are exact at the boundaries.**
  - `+72h+1ms` → green `4 gün`; `+72h` → amber `3 gün`; `+24h+1ms` → amber `2 gün`; `+24h` → red `24 saat`; `+1h` → `1 saat`; `+59m` and `+1ms` → `1 saatten az kaldı`.
  - `0` and `-1ms` → `Gecikti`; `-24h` → `Gecikti · 1 gün`.
  - The D2 seed offsets give `5 gün`, `2 gün`, `5 saat`, `Gecikti · 2 gün` and `4 gün`.
  - Not expected (D5) → `muted` `İsteğe bağlı` / `Son tarih geçti`. Manager past due → `Süre doldu` (D6).
  - A submission at exactly `dueAt` counts as on time. A submission at 00:30 Istanbul is labelled with the Istanbul day (`19 Eki`), not the UTC day.
- **Timezone.**
  - `istanbulToUtc` is only used at the form boundary, and the round-trip check `istanbulDateOf(due) === dueDate` rejects `02-30`.
  - Years 0000–0099 can't sneak in: `Date.UTC` maps them to 19xx, and the round-trip check then fails.
  - Every comparison is on instants; seconds-precision storage doesn't affect `late`.
- **Mail.**
  - Header injection is prevented. CR/LF, `&`, `?`, `#`, `%0D%0A` and `Bcc:` in titles or names are flattened by `clean()` and then `encodeURIComponent`ed. No `+`, space or raw CR/LF ever reaches the href.
  - `RECORDING_EMAIL_RE` rejects `?`, `&`, `#`, `%`, whitespace, newlines and uppercase. It is re-applied on read and in `mailtoHref`.
  - The body is CRLF (RFC 6068).
- **Idempotency and concurrency.**
  - create: client UUID PK plus `onConflictDoNothing`; another creator's id gives STALE.
  - submit and mark: `setWhere submitted_at is null` keeps the first time.
  - undo: single-statement, feedback-guarded delete.
  - Unchanged feedback doesn't revive `Yeni not` (D10). `markFeedbackSeen` fires from a client effect only, so a prefetch never marks a note as read.
- **`deletePiece`** pre-checks homework inside the `BEGIN IMMEDIATE` transaction and maps the FK message as a backstop (AC21).

## P1

None.

## P2

### P2-1 `homeworkSubject` can split a surrogate pair and crash the detail page
`src/lib/homework/mail.ts:30-31`. `toWellFormed()` runs in `clean()` *before* truncation. `title.slice(0, room)` then cuts by UTF-16 code unit, which can leave a lone high surrogate before the `…`. `mailtoHref` then calls `encodeURIComponent(subject)`, which throws `URIError: URI malformed`. The throw happens during the RSC render of `/odevler/[id]` (`page.tsx:65-66`).

Result: the detail page 500s for **every singer of that part** on that homework, and nobody can submit from the detail page.

- **Trigger:** title + name longer than about 159 characters (title ≤ 120, name ≤ 80), with an astral character near the cut. Musical symbols are astral (`𝄞` U+1D11E), and so are emoji.
- **Reproduced:** in `t.ts`, a 120-character title made of `A`×k + `😀`…, name `N`×80, bars 9999–9999. **41 of 120** offsets throw.

Fix: truncate by code point and re-sanitise:
```ts
const chars = Array.from(title);
title = `${chars.slice(0, Math.max(room, 1)).join("").trimEnd()}…`;
```
Also make the call site resilient: `mailtoHref` should do `try { … } catch { return null; }`, or call `.toWellFormed()` on `subject`/`body` before encoding. That way a future builder bug hides the button instead of crashing the page.

## P3

### P3-1 The edit version check works at one-second precision
`actions.ts:187`, `schema.ts:324` (`updated_at` is unix seconds).

A save that lands in the same wall-clock second as the previous write passes with the old version and silently overwrites it. It's mostly reachable by scripts, or by create→edit within a second.

Fix: add a `version integer not null default 0` column and update with `set version = version + 1 where id = ? and version = ?`. If a migration isn't wanted now, carry this forward.

### P3-2 A deleted homework or piece mid-action surfaces as an uncaught throw
`actions.ts:232` (submit), `:297` (mark), `:345` (feedback), `:123` (create vs `deletePiece`), `:176` (update to a just-deleted piece).

The eligibility/piece read happens outside the write, so a concurrent delete makes the insert hit `FOREIGN KEY constraint failed`. The action throws and `useRunAction` (`src/components/use-run-action.ts:13`) has no catch, so React sends it to the error boundary.

Fix: catch with the Phase 3 `hasMessage(error, "FOREIGN KEY constraint failed")` helper and return `NOT_FOUND` (or `Bir eser seç.` for create/update). Alternatively, move the read into the same `db.transaction`. In `useRunAction`, wrap `await fn()` in try/catch → `toast.error("Bir şeyler ters gitti, tekrar dene.")`.

### P3-3 `setSubmissionFor(…, true)` accepts a non-eligible target that only holds a feedback row
`actions.ts:275-280`. `targetAllowed` treats "any existing row" as allowed. That's right for `saveFeedback`, but backend.md §2.7 says marking requires `isEligible`.

Example: a manager can mark a singer who has left, or changed part, but still has a note.

Fix: give `targetAllowed` a `requireEligible` flag and pass `true` from `setSubmissionFor`, or check `isEligible` inline before the upsert.

### P3-4 `markFeedbackSeen` revalidates the whole layout even when nothing changed
`actions.ts:383`.

Any member can call it in a loop, and each call purges the route cache for everyone (`revalidatePath("/", "layout")`). It also costs a refresh on every view.

Fix: `.returning({ id: submissions.userId })` and revalidate only when `rows.length > 0`. The same applies to the no-op path of `undoSubmission` (`:266`).

### P3-5 `clean()` lets bidi and C1/format controls through
`mail.ts:18`.

- `U+202E` (RLO), `U+200B`–`U+200F`, `U+2066`–`U+2069` and the C1 range `U+0080`–`U+009F` (including NEL `U+0085`, which `\s` doesn't match) survive into the subject and body.
- This doesn't allow header injection, because everything is percent-encoded. It does allow a visually spoofed subject (`N‮ame` in the probe).
- Fix: `.replace(/[\p{Cc}\p{Cf}  ]/gu, " ")`.

### P3-6 `RECORDING_EMAIL_RE` accepts nonsense such as `.@-.-`
`mail.ts:6`. It's safe for the href, but the error message never fires for it.

Fix: `/^[a-z0-9_+-]+(\.[a-z0-9_+-]+)*@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/`. This keeps the same safe character set.

### P3-7 `updateAssignment` returns STALE for a homework that was deleted meanwhile
`actions.ts:190`. backend.md §2.3 wanted `NOT_FOUND`, so the UI could leave the page. The current flow tells the manager to reload, and then the page 404s. It's harmless.

Fix: when `updated.length === 0`, re-select the id and return `NOT_FOUND` if it is gone.

## Probe hygiene

`leak.mjs` accidentally submitted seeded homework A as `korist@` and `yeni@` (the valid-id case of the extra-args probe). I deleted exactly those two rows afterwards (`revert.mjs`: matched on `submitted_at` and on `feedback is null`). I created no homework. No other data was touched.
