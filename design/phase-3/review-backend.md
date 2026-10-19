# Phase 3 backend review

Author: arkhe-backend. Checked against `backend.md` and `po-decisions.md` (the PO file wins). I read `src/lib/links.ts`, `src/lib/repertoire.ts`, `src/app/(portal)/repertuvar/**`, `src/components/repertoire/{link-row,part-button,part-chooser}.tsx`, `next.config.ts`, `src/db/schema.ts`, `src/lib/auth/dal.ts` and `src/proxy.ts`. I probed the running app at :3100 and used only `E2E Review Probe` rows, which I deleted afterwards. Scratch scripts are in the session scratchpad (`review-backend/fuzz.ts`, `probe.mjs`, `probe2.mjs`).

**Verdict: one P1 (the same one the DBA found, which I reproduced in the live app), one P2, and several P3s. Authorization, IDOR scoping, the parser and the CSP/iframe setup are all sound.**

## What holds up

- **Authorization.**
  - Every one of the 13 actions calls `assertManager()` before it parses any input or touches the DB.
  - Pages call `requireUser()` (list, detail, home) or `requireManager()` (`yeni`, `duzenle`, before param parsing).
  - Members only receive list columns plus the url/label of their part files. `PieceMenu`, the editors and the danger zone are only rendered for managers.
- **IDOR.**
  - `updateLink` and `deleteLink` are scoped `where id = ? and piece_id = ?`, with both ids zod-validated.
  - `reorderLinks` and `reorderProgram` reject any id set that differs from the DB set (STALE). The per-row `update … where id` that follows therefore can't touch another piece's links.
- **Transactions.** drizzle-libsql ignores the config argument, and `@libsql/client` defaults to `transaction("write")`, which issues `BEGIN IMMEDIATE`. So concurrent bulk saves and reorders serialize: the second one reads after the first commits and gets `rowErrors` or STALE. The single-statement guarded `addToProgram` is atomic.
- **Idempotency.**
  - Full-order reorders, `clearProgram`, `setPieceStatus` and the guarded `addToProgram` can be replayed safely.
  - Link and bulk inserts are protected by `unique(piece_id,url)`. A bulk replay fails dedupe, so nothing is inserted twice.
- **`parseLink`.**
  - I ran about 65 hand-written cases plus 200k random mutations over the Drive, YouTube, Docs and generic bases. The idempotency invariant `parseLink(parseLink(x).url).url === parseLink(x).url`, including `previewSrc`, failed **0 times**. Every `previewSrc` was on `drive.google.com` or `www.youtube-nocookie.com`, and every `url` started with `https://` and was ≤ 2000 characters.
  - These are rejected: `http:`, `javascript:`, `ftp:`, userinfo (`drive.google.com@evil.com`), non-443 ports, spaces and control characters, backslashes, quotes and angle brackets.
  - These fall to `external` and get no preview: Cyrillic look-alikes (shown as `xn--drve-m9d…`), a trailing-dot host, a percent-encoded id (`AB%43`), and `open?id=A&id=B`.
  - Fullwidth `ｄrive`, a soft hyphen or a ZWSP inside the host, and `%2e%2e` path tricks all normalise to the *real* `drive.google.com` URL. That's benign, because what we store and open is the genuine canonical URL.
  - YouTube `t`: `1m30s`→90, `1h`→3600. `0`, `-5`, `1.5` and 20-digit values are dropped. `start=` on the nocookie host is read.
- **Bulk.**
  - The AC14 lines give exactly 5 valid rows and 1 invalid one.
  - 51 lines gives `En fazla 50 satır yapıştırabilirsin.`, and blank lines are not counted.
  - A duplicate inside the paste is flagged. Turkish `İLAHİ KAYIT` gives `recording`.
  - The server re-parses every row and saves all or nothing.
- **CSP and iframes.**
  - `frame-src` is exactly `https://drive.google.com https://www.youtube-nocookie.com` (AC20).
  - The iframe `src` is only `previewSrc`. There is no `sandbox` (D8). `referrerPolicy="strict-origin-when-cross-origin"` (D9), `allow` (D10) and `loading="lazy"` plus `title` are set.
  - `Aç` uses the re-parsed `url` and has `rel="noopener noreferrer"`.
- **Timezones.** This phase has no date logic, and `updatedAt` is UTC epoch through `$onUpdateFn`. Nothing to flag.

## P1

### P1-1 Link labels of 81–120 characters crash the action (agree with review-db P1-1)
- **Where:**
  - `src/db/schema.ts:298` and `drizzle/0002_phase3_repertoire.sql:49` have `CHECK(length(trim(label)) between 1 and 80)`.
  - The app allows 120, as D19 requires: `links.ts:7` `LABEL_MAX = 120`, `actions.ts:184` (`linkSchema`), `actions.ts:302` (`bulkRowSchema`), `links.ts:239,248` (the bulk splitter cuts labels to 120), and `maxLength={120}` in `links-editor.tsx:154` and `bulk-paste.tsx:219,295`.
- **Repro (live):** as `sef@`, adding a link with a 100-character label shows the error boundary `Bir şeyler ters gitti` and saves 0 rows. A bulk paste with a long label loses the whole batch the same way, because the paste parser itself produces labels up to 120 characters.
- **Fix:**
  - Add migration `0003`: change the schema CHECK to `between 1 and 120` and run `npm run db:generate`, which rebuilds `piece_links`. Don't edit 0002.
  - Add an e2e case that saves a 120-character label through both `addLink` and `saveBulkLinks`.
  - As defence in depth, map `CHECK constraint failed` in `addLink`/`updateLink`/`saveBulkLinks` to a field or form error instead of throwing.

## P2

### P2-1 Piece title leaks to unauthenticated requests through `generateMetadata`
- **Where:** `src/app/(portal)/repertuvar/[id]/page.tsx:36-39`. `generateMetadata` calls `load(id)`, and `load` (`:29-34`) has no auth check. The page's `requireUser()` runs in parallel and redirects, but the streamed body already contains the title.
- **Repro:** `curl -H "Cookie: arkhe_session=bogus" /repertuvar/<id>` returns a 307 to `/giris`, but the body contains `<title>Ave Verum Corpus · Arkhe</title>`. Any cookie value gets past the optimistic `proxy.ts`.
- The same response is also an existence oracle: a valid id returns a title, an unknown id returns not-found metadata. The impact is limited because UUIDs aren't guessable, but it still breaks the rule "authorize on the server in every data query".
- **Fix:** call `await requireUser()` at the top of `load()`, or at least at the top of `generateMetadata`. It's cached per request through `getSessionUser`, so the page pays nothing extra.

## P3

- **P3-1 `?partisyon=` uses a prototype key lookup.**
  - **Where:** `[id]/page.tsx:21-26,52-53`. `PART_PARAM[raw]` is a plain object literal, so `?partisyon=constructor|toString|valueOf|__proto__` resolves to a function or object.
  - **Effect (live):** `filter` becomes that function, every part link is hidden, and a third active chip renders with an empty label and `href="…?partisyon=function Object() { [native code] }"`.
  - **Fix:** `const filter = raw === "tumu" ? null : Object.hasOwn(PART_PARAM, raw ?? "") ? PART_PARAM[raw!] : mine;`, or use a `Map`, or validate with `z.enum(["soprano","alto","tenor","bas","tumu"])`.
- **P3-2 A user with no voice part can get stuck in a filtered view.**
  - **Where:** `[id]/page.tsx:52-54` and `:124`. With `mine = null` and `?partisyon=bas`, the links are filtered, but the filter nav is hidden (`mine && …`), so there is no chip to clear the filter. D4 says users without a part see no filter and everything.
  - **Fix:** `const filter = mine ? (…) : null;`
- **P3-3 Part-file hrefs aren't re-parsed on render.**
  - **Where:** `src/lib/repertoire.ts:44-62`, `part-button.tsx:52` and `part-chooser.tsx:54` use the stored `url` directly. `backend.md` T1 said the renderer re-parses stored URLs, and the detail `LinkRow` does.
  - **Risk:** low. Writes always store `parsed.url`, and the DB CHECK forces an `https://` prefix.
  - **Fix:** in `partFilesOf`, map `url: parseLink(row.url)?.url` and drop rows that return null.
- **P3-4 `removeFromProgram` returns success for a piece that doesn't exist.**
  - **Where:** `actions.ts:435-448`. A random UUID gets `Programdan çıkarıldı.`
  - **Fix:** if `!ids.includes(id)`, check that the piece exists and return `NOT_FOUND` when it doesn't. Keep the success no-op when the piece exists but isn't in the programme.
- **P3-5 `setPieceStatus` toast is misleading.**
  - **Where:** `actions.ts:150`. Any non-archive status returns `Arşivden çıkarıldı.`, even `learning`→`concert`.
  - **Fix:** load the previous status in the same UPDATE using `returning` the old value, or by reading it first. Return the archive copy only when leaving `archive`, and `Kaydedildi.` otherwise.
- **P3-6 `addLink` has an exists/insert gap.**
  - **Where:** `actions.ts:201-215`. If another manager deletes the piece between `pieceExists` and the insert, the insert throws an FK error and the user sees the error boundary.
  - **Fix:** catch `FOREIGN KEY constraint failed` and return `NOT_FOUND`, or use `INSERT … SELECT … WHERE EXISTS` and check `rowsAffected`.
- **P3-7 Rough edges in `saveBulkLinks`.**
  - **Where:** `actions.ts:319,324`. An oversize or unparsable `rows` payload returns `Geçerli bir https bağlantısı gir.`, which is misleading. Use `Bir şeyler ters gitti, tekrar dene.` (D21).
  - **Where:** `:381`. A paste that contains only a folder line returns `0 bağlantı eklendi. Drive klasörü de ayarlandı.` Use `Drive klasörü ayarlandı.` when `links.length === 0`.
  - **Where:** `:378-380`. The insert has no unique-violation catch, unlike `backend.md` §3.3 step 3. `BEGIN IMMEDIATE` makes a violation unreachable today, but map it anyway so a future mode change can't produce a 500.
- **P3-8 A URL with an empty authority is accepted.**
  - **Where:** `links.ts:26,78`. `https:///drive.google.com/…` passes `SAFE_URL`, and WHATWG fixes it into a real Drive URL.
  - **Impact:** harmless, since the result is the canonical genuine URL. Note it in `backend.md` §1.1 rather than changing the code.
