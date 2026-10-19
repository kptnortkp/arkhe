# Phase 3 backend design: repertoire, links, programme

Author: arkhe-backend. Inputs: `design/phase-3/po-spec.md`, `design/phase-2/backend.md` + `review-backend.md`, `src/lib/auth/dal.ts`, `src/lib/validation.ts`, `src/app/(portal)/calismalar/actions.ts`, `next.config.ts`, Next 16 docs `02-guides/server-actions.md` (Origin check, 1 MB body cap, sequential dispatch per client) and `02-guides/data-security.md`. `db.md`, `ux.md` and `ui.md` don't exist yet; I assume the PO's §6 names (`piece_links`, `PIECE_STATUSES`, `LINK_KINDS = ["score","part","recording","video","other"]`).

## 0. Cross-cutting rules (same as Phase 2)

- Pages: `requireUser()` (list, detail, home) / `requireManager()` (`/repertuvar/yeni`, `/repertuvar/[id]/duzenle`). Every action starts with `assertManager()` and returns `{ error: "Bu işlem için yetkin yok." }` before parsing or touching the DB (AC 9). There are no member-facing writes in this phase.
- Every argument goes through zod, bound args included: ids `z.uuid()`, enums from `schema.ts`, trimmed text with the limits below. Copy: `FORBIDDEN`, `NOT_FOUND = "Bu eser bulunamadı."`, `LINK_NOT_FOUND = "Bu bağlantı bulunamadı."`, `STALE = "Liste bu arada değişti. Sayfayı yenileyip tekrar dene."`.
- After every write: `revalidatePath("/")`, `revalidatePath("/repertuvar")`, `revalidatePath(\`/repertuvar/${id}\`)`.
- Multi-statement writes run in `db.transaction`. Single-statement guarded writes are used where a race is likely (programme append). libsql transactions are deferred, so keep each transaction short and free of `await`s on anything other than the DB.
- **We never fetch a stored URL on the server**, so there is no SSRF surface. Links only become `<a href>` and, for parsed IDs, an `<iframe src>`.
- No route handlers this phase, so CSRF is covered by Next's server-action Origin check.

## 1. `src/lib/links.ts` (isomorphic, no dependencies, no `server-only`)

```ts
export type LinkProvider = "drive-file" | "drive-folder" | "docs" | "youtube" | "external";
export type ParsedLink = {
  url: string;               // normalised, stored value; also the "Aç" href
  provider: LinkProvider;
  previewSrc: string | null; // only ever built from a regex-checked id
  host: string;              // punycode hostname, shown next to external links
};
export function parseLink(raw: string): ParsedLink | null; // null => "Geçerli bir https bağlantısı gir."
export const LINK_MAX = 2000;
```

### 1.1 Gatekeeping (in this order, any failure returns `null`)
1. `s = raw.trim()`; `s.length` must be 1..2000.
2. `/^https:\/\/[^\s<>"'`\\\u0000-\u001f\u007f]+$/i.test(s)`. This rejects `http:`, `ftp:`, `javascript:`, `data:`, relative paths, `https:/x` (WHATWG would "fix" that to `https://x/`), backslash tricks (`https://evil.com\@drive.google.com`), embedded whitespace and control characters.
3. `u = new URL(s)` inside try/catch; require `u.protocol === "https:"`.
4. Require `u.username === "" && u.password === ""`. This rejects `https://drive.google.com@evil.com/…`, which would otherwise show "drive.google.com" to a human while pointing at evil.com.
5. Require `u.port === ""` (a default `:443` is already dropped by `URL`). Other ports are rejected outright, because a non-standard port has no legitimate use here.
6. `host = u.hostname`. `URL` already lowercases it and converts IDN to punycode (`drіve.google.com` with a Cyrillic `і` becomes `xn--drve-…`). Provider detection then uses **exact string equality against an ASCII allowlist**. It never uses `endsWith` or `includes`, so `drive.google.com.evil.com`, `evil-drive.google.com` and a trailing-dot `drive.google.com.` all fall through to `external`.
7. After normalising, check the length again (≤ 2000).

### 1.2 Provider rules
Path handling: `seg = u.pathname.split("/").filter(Boolean)`. Then remove one `u/<digits>` pair wherever it appears in the first three segments (`/u/0/`, `/drive/u/1/folders/…`, `/file/u/0/d/…`). IDs must match `DRIVE_ID = /^[A-Za-z0-9_-]{3,200}$/` and `YT_ID = /^[A-Za-z0-9_-]{3,64}$/`. The lower bound is 3, not 11/25, because the AC and the seed use fake IDs like `ABC123`/`XYZ`. That's safe, since the charset is what protects the iframe. `rk = u.searchParams.get("resourcekey")` is kept only if it matches `DRIVE_ID`.

| Host | Path / query | Stored `url` | `previewSrc` |
|---|---|---|---|
| `drive.google.com` | `file/d/<ID>[/view|/edit|/preview|…]` · `open?id=<ID>` · `uc?id=<ID>` (any `export=`) | `https://drive.google.com/file/d/<ID>/view` + `?resourcekey=<rk>` | `…/file/d/<ID>/preview` + `?resourcekey=<rk>` |
| `drive.google.com` | `drive/folders/<ID>` · `drive/mobile/folders/<ID>` (`open?id=` is always treated as a file, §6) | `https://drive.google.com/drive/folders/<ID>` + `?resourcekey=<rk>` | `https://drive.google.com/embeddedfolderview?id=<ID>` + `&resourcekey=<rk>` + `#list` |
| `docs.google.com` | `(document|spreadsheets|presentation|forms)/d/<ID>/…` | `u.href` (as is, WHATWG-serialised) | `null` (PO Q6) |
| `www.youtube.com`, `youtube.com`, `m.youtube.com`, `music.youtube.com` | `watch?v=<ID>` · `shorts/<ID>` · `live/<ID>` · `embed/<ID>` | `https://www.youtube.com/watch?v=<ID>` + `&t=<sec>` | `https://www.youtube-nocookie.com/embed/<ID>` + `?start=<sec>` |
| `youtu.be` | `/<ID>` | same | same |
| `www.youtube-nocookie.com` | `embed/<ID>` | same | same |
| allowlisted host, unrecognised path (`/drive/my-drive`, `/playlist?list=…`, `drive.google.com/drive/folders/` with no id) | — | `u.href` | `null` (provider `external`) |
| anything else | — | `u.href` | `null` |

- Drive query noise (`usp=sharing`, `usp=drive_link`, `authuser`, `export`) is dropped by rebuilding the URL. AC 11 `open?id=ABC123` becomes `https://drive.google.com/file/d/ABC123/view`.
- **`resourcekey`:** Drive files shared before the 2021 security update need it, or "anyone with the link" fails. Drop it and the link silently breaks, so it is kept on the stored URL and the preview URL. The same file with and without a key counts as two distinct URLs for dedupe. That's acceptable.
- **YouTube `t`:** read `t` (or `start`). Accept `^\d+s?$` or `^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$`, convert to integer seconds and keep it if `0 < sec ≤ 86400`, otherwise drop it. `si`, `feature`, `pp`, `list`, `index` and everything else are dropped. So `https://youtu.be/XYZ?si=foo` becomes `https://www.youtube.com/watch?v=XYZ` (AC 11), and `…?v=ID&t=1m30s` becomes `…watch?v=ID&t=90`.
- **Idempotency invariant:** `parseLink(parseLink(x)!.url)!.url === parseLink(x)!.url` for every case above. The renderer re-parses stored URLs (§5), so this must hold.
- Exported helpers: `isDriveFolder(p)`, `formatDuration(sec) -> "m:ss"`, `parseDuration("m:ss") -> number | null`, `deriveLabel(kind, voicePart)` (uses `src/lib/labels.ts`), `guessLink(label, parsed)` (§2.2).

## 2. Bulk paste (`Toplu bağlantı ekle`)

### 2.1 Line parser `parseBulk(text: string, ctx: { hasFolder: boolean; existing: Set<string> })`
- Reject `text.length > 120_000` (form error `Metin çok uzun.`). Split on `/\r?\n/`, trim each line and skip empty lines. More than 50 non-empty lines gives the form error `En fazla 50 satır yapıştırabilirsin.`, and nothing is parsed.
- Tokens are `line.split(/\s+/)`, so tab-separated pastes from Sheets work too.
  - If the **last** token parses, it is the URL, and the label is everything before it, with trailing `|`, `-`, `–`, `:` and whitespace stripped.
  - Otherwise, if the **first** token parses (`<URL> <label>`), it is the URL and the rest is the label.
  - Otherwise the row is invalid: `{ label: line, error: "Geçerli bir https bağlantısı gir." }`. `not a url` lands here (AC 13).
- `label` is trimmed and cut to 80. An empty label becomes `null`, and the derived label is shown instead.
- Duplicates get the row error `Bu bağlantı bu eserde zaten var.`: either the URL is in `ctx.existing`, or an earlier row in the same paste has it.

### 2.2 Guessing (`guessLink`)
`tokens = searchKey(label).split(/[^a-z0-9]+/).filter(Boolean)` (`searchKey` from `src/lib/format.ts` folds case, Turkish İ/ı and diacritics, so `KAYIT` becomes `kayit` and `Tümü` becomes `tumu`).

- **Part** (per token, the first distinct match wins; two *different* parts in one label means no guess):
  - soprano: `^(sop|sopran|soprano)[12]?$` or `^s[12]$`
  - alto: `^alto[12]?$` or `^a[12]$`
  - tenor: `^tenor[12]?$` or `^t[12]$`
  - bass: `^(bas|bass|basso)[12]?$` or `^b[12]$`
  - Tutti (null): `^(tutti|hepsi|tumu)$`
  - Bare `s`, `a`, `t`, `b` are ignored, because they're too ambiguous.
- **Kind**, first match in this order:
  1. YouTube URL: always `video`.
  2. A token in `midi|mid|mp3|wav|m4a|partisyon` gives `part`.
  3. `nota|score|pdf|partitur` gives `score`.
  4. `kayit|recording|referans` gives `recording`.
  5. `video` gives `video`.
  6. Drive folder with no kind word: target is the piece's `driveFolderUrl` if `!ctx.hasFolder` and no earlier row claimed it, otherwise `other`.
  7. A part word with no kind word gives `part` (AC 13: `Tenor <drive>` becomes part/tenor).
  8. Drive file with no hints gives `score` and Tutti.
  9. Docs or external with no hints gives `other`.
- AC 13 check: `Soprano 1 MIDI` → part/soprano; `Alto mp3 |` → part/alto; `Tenor` → part/tenor; `Nota` → score/Tutti; bare YouTube → video/Tutti; `not a url` → invalid. That's 5 valid rows and 1 invalid. ✔

### 2.3 Where it runs
`parseBulk` is pure and isomorphic, so **the preview runs in the client** with the piece's existing URLs (already loaded on the edit page). The preview gets no action, no round-trip, and nothing to authorize. **The server re-validates everything on save** (§3.3) and never trusts the preview. @po: this gives the same behaviour as "the server parses" for AC 13. Tell me if you want it to be a server action anyway; it's ~10 lines.

## 3. Server actions (`src/app/(portal)/repertuvar/actions.ts`)

All of them are manager-only (`assertManager()` first). FormState-based ones use `useActionState`. Others take bound args and return `{ error?: string }`.

### 3.1 Pieces
| Action | Input (zod) | Behaviour | Errors |
|---|---|---|---|
| `createPiece(prev, fd)` | `pieceSchema` | Inserts with `createdBy = actor.id`, then `redirect(\`/repertuvar/${id}/duzenle\`)` so links can be added right away (@ux may prefer the detail page). | field errors |
| `updatePiece(id, prev, fd)` | `z.uuid()` + `pieceSchema` | In a tx: load the piece (NOT_FOUND), update and set `updatedAt`. If the new status is `archive`, also do `programPosition = null` + `renumberProgram(tx)`. Last write wins between two editing managers; acceptable for 2–6 managers. | NOT_FOUND, field errors |
| `setPieceStatus(id, status)` | `z.uuid()`, `z.enum(PIECE_STATUSES)` | The same archive rule (C4, AC 16–17). An unchanged status is a no-op, so the action is idempotent. | NOT_FOUND |
| `deletePiece(id)` | `z.uuid()` | In a tx: `delete piece_links where piece_id`, `delete pieces where id` (explicit, so it doesn't rely on `PRAGMA foreign_keys`), then `renumberProgram(tx)` if the piece had a position. Then `redirect("/repertuvar")`. Phase 4: catch `SQLITE_CONSTRAINT_FOREIGNKEY` and return `Bu esere bağlı ödevler var. Silmek yerine arşivle.` A delete of an already-deleted piece returns NOT_FOUND (harmless). | NOT_FOUND |

`pieceSchema`:
- `title`: trim, min 1 `Eser adı gerekli.`, max 120 `En fazla 120 karakter.`
- `composer`, `arranger`: `optionalText(120)`. `language`: `optionalText(40)`. `voicing`: `optionalText(20)`. `notes`: `optionalText(1000)`.
- `duration`: `""` gives null, otherwise `/^(\d{1,2}):([0-5]\d)$/` becomes `m*60+s`, and it must be `> 0`. Error `Süreyi dakika:saniye olarak yaz (ör. 3:40).` AC 10: `4:05` → 245 → shown as `4:05`.
- `status`: `z.enum(PIECE_STATUSES)`, default `learning`.
- `driveFolderUrl`: `""` gives null. Otherwise `parseLink`, which must succeed **and** be `drive-folder`. Error `Bir Google Drive klasör bağlantısı gir.` (the field is labelled Drive klasörü; any other link belongs in links).
- Hoist `optionalText` from `calismalar/actions.ts` into `src/lib/validation.ts` and reuse it.

### 3.2 Single links
| Action | Input | Behaviour |
|---|---|---|
| `addLink(pieceId, prev, fd)` | `kind` enum, `voicePart` enum or `""` (→ null), `label` `optionalText(80)`, `url` → `parseLink` (`Geçerli bir https bağlantısı gir.`) | Piece must exist. Insert with `position = (select coalesce(max(position),-1)+1 … where piece_id)` in **one** `INSERT … SELECT`. A unique `(piece_id,url)` violation becomes the field error `Bu bağlantı bu eserde zaten var.` (no pre-check; the constraint is the check, so it's race-free). |
| `updateLink(linkId, pieceId, prev, fd)` | same + ids | `update … where id = linkId and piece_id = pieceId`. 0 rows gives LINK_NOT_FOUND. Same dedupe mapping. |
| `deleteLink(linkId, pieceId)` | ids | Same scoped where. Positions may have gaps after this; the order still holds. |
| `reorderLinks(pieceId, orderedIds: string[])` | `z.array(z.uuid()).max(200)` | In a tx: load ids for the piece. If the set differs from `orderedIds` (someone else added or deleted), return STALE. Otherwise write `position = index`. The UI's up/down sends the full new order it displays. That makes the call **idempotent** (a double tap or replay sends the same order) and detects concurrent edits. |

### 3.3 Bulk save
`saveBulkLinks(pieceId, prev, fd)`. `fd.get("rows")` is a JSON string, at most 200 KB before `JSON.parse` (in try/catch). It is validated as `z.array(bulkRow).min(1).max(50)`, with `bulkRow = { label: optionalText(80), kind: z.enum([...LINK_KINDS, "folder"]), voicePart, url: z.string().max(2000) }`.

1. Re-run `parseLink` on every row. Any failure means **all-or-nothing** reject: `{ error: "n satırda hata var.", rowErrors: { [index]: message } }`. This adds `rowErrors?: Record<number, string>` to `FormState`. The preview drops invalid rows before saving, so a failure here means the client was tampered with or the data is stale.
2. In a tx: load the existing URLs and current `driveFolderUrl`. In-batch or existing duplicates give `rowErrors` and a rollback. A `folder` row sets `driveFolderUrl` only if it's still null, otherwise it is stored as an `other` link (another manager may have set it since the preview). At most one `folder` row is accepted. Insert the rest with `position = max+1+i`, in paste order (AC 13).
3. If a unique violation still slips through (concurrent save), roll back and return `Bu bağlantı bu eserde zaten var.`. The user can re-preview.
4. Success: `{ success: "5 bağlantı eklendi." }`. Replaying the same save fails on dedupe, so nothing is inserted twice.

### 3.4 Programme (§3.4 of the spec)
`programPosition` is unique when not null (DBA). SQLite checks UNIQUE per row during an UPDATE, so **never shift positions in place**. Instead:

- `renumberProgram(tx, orderedIds?)`: read the ids ordered by position (or take `orderedIds`), `UPDATE pieces SET program_position = NULL WHERE program_position IS NOT NULL`, then set `1..n` one row at a time. This is ≤ ~30 rows.
- `addToProgram(pieceId)`: a single guarded statement, `UPDATE pieces SET program_position = (SELECT coalesce(max(program_position),0)+1 FROM pieces) WHERE id = ? AND program_position IS NULL AND status <> 'archive'`. It is atomic, idempotent and appends at the end. If 0 rows change: NOT_FOUND if the piece doesn't exist, `Arşivdeki eser programa eklenemez.` if archived, and a no-op if it's already in the programme. If two managers append at the same moment and hit the unique constraint, retry once.
- `removeFromProgram(pieceId)`: in a tx, set it to null, then `renumberProgram`.
- `reorderProgram(orderedIds)`: same STALE set check as links, then `renumberProgram(tx, orderedIds)`.
- `clearProgram()`: `UPDATE pieces SET program_position = NULL`. It's idempotent, and the confirm lives in the UI.

## 4. Queries (`src/lib/repertoire.ts`, `server-only`)

- `listPieces(view, q)`:
  - `view` comes from `?gorunum=` validated as `calisilan|konser|program|arsiv|tumu`, with `calisilan` as the default. An invalid value falls back to the default (no 500).
  - Select the list columns with a `where` on status (or `program_position is not null` for `program`, ordered by position). Other views are sorted in JS with `collator` by title.
  - Search mirrors `/uyeler`: `searchKey(q)` (max 100 chars) against `searchKey(title + " " + composer + " " + arranger)` in JS. The repertoire is a few hundred rows at most. It needs no FTS and no `LIKE` (SQLite's `lower()` doesn't fold `İ`/`ş`).
  - Then **one** query for the part links of the returned pieces: `select piece_id, voice_part, label, url, position from piece_links where kind = 'part' and piece_id in (…) order by position`. Each piece gets `partisyonum = resolveMyPart(links, me.voicePart)`. That's 2 queries in total, never N+1.
- `getPieceDetail(id)`: if `z.uuid()` fails, `notFound()`. Fetch the piece and all its links by position. On the server, every link gets `parsed = parseLink(link.url)`. If it returns `null` (bad seed, manual DB edit), the row renders as plain text with no `href` and no preview. Grouping in the order score, part, recording, video, other happens in the page. The filter comes from `?partisyon=` (validated `VOICE_PARTS` or `tumu`), defaulting to `me.voicePart`. In the filtered view, `part`-kind links show my part + Tutti. Other kinds are not filtered by part, except that a `score` with a different part is hidden too (@ux confirm; the spec says "part links").
- `homePieces()`: `status = 'learning'`, same order as the list, `limit 5`, plus the same part-links query.

### 4.1 `resolveMyPart(partLinks, myPart)`, a pure function in `links.ts`
```
mine  = links.filter(l => myPart && l.voicePart === myPart)
pool  = mine.length ? mine : links.filter(l => l.voicePart === null)
pool.length === 0 -> { state: "none" }                  // disabled "Partisyon kaydı yok"
pool.length === 1 -> { state: "single", link }          // <a href={url} target=_blank rel="noopener noreferrer">
else              -> { state: "choose", links: pool }   // sheet, ordered by position
```
- It only considers `kind = 'part'`, never recordings or scores.
- Ties sort by `position`, then `id`.
- `myPart = null` (the conductor, or a member without a part) skips straight to Tutti. That's my suggestion for PO Q2: a conductor's Partisyonum then opens the Tutti part file if there is one, and is disabled otherwise. @po decide; it's a one-line change.
- AC 5: S1+S2 for a soprano gives `choose`, Tutti-only for an alto gives `single`, and no part links gives `none`.

## 5. Rendering and security

| # | Threat | Mitigation |
|---|---|---|
| T1 | `javascript:`/`data:` href (stored XSS) | https-only regex + `URL` check on every write. The renderer re-parses stored URLs and drops the `href` on failure (defence in depth against the seed or DB edits). |
| T2 | Open redirect | We have no redirector endpoint (`/go?url=`) and must not add one. Actions only `redirect()` to `/repertuvar` or `/repertuvar/${uuid}`. External links are plain anchors with `target="_blank" rel="noopener noreferrer"` (AC 4). The global `Referrer-Policy: no-referrer` stays. |
| T3 | Look-alike hosts (userinfo, IDN, port, trailing dot, sub-domain tricks) | §1.1 steps 4–6. External rows show `host` (punycode) under the label, so `xn--…` is visible to the manager and the singer. |
| T4 | Iframe injection | `iframe src` is **only** `parsed.previewSrc`, built from constant templates and `DRIVE_ID`/`YT_ID`-checked ids. The client never builds `src` from a raw URL. CSP is the backstop. |
| T5 | CSP | `frame-src https://drive.google.com https://www.youtube-nocookie.com` and nothing else (AC 19). A non-shared Drive file redirects to `accounts.google.com` and is blocked by CSP. That's the expected "Önizleme açılmıyorsa…" case, and the copy covers it. No `docs.google.com` (Q6). No `img-src` change. |
| T6 | YouTube embeds broken by `no-referrer` | Since 2025, YouTube refuses embeds that send no Referer (player error 153). The **video iframe** must set `referrerPolicy="strict-origin-when-cross-origin"` (origin only, no path). Drive iframes keep the default. Iframe attributes: `loading="lazy"`, `allow="encrypted-media; picture-in-picture; fullscreen"`, `allowFullScreen`, and a `title` for a11y. Don't use `sandbox`, because Drive's previewer needs scripts, same-origin and popups, so it would add breakage, not safety. |
| T7 | XSS through label/notes/title | Plain text only. React escapes it. No `dangerouslySetInnerHTML`, no markdown, and notes render with `whitespace-pre-line`. |
| T8 | Member calling manager actions (AC 9) | `assertManager()` first in every action. The e2e calls each one as `korist@` and asserts no rows changed. |
| T9 | IDOR between pieces on link actions | Every link write is scoped `where id = ? and piece_id = ?`, with both ids zod-validated. |
| T10 | Replay / double submit | Idempotent shapes: full-order reorder, guarded `addToProgram`, `clearProgram`, status set. Link and bulk inserts are protected by `unique(piece_id,url)`. |
| T11 | Input size / DoS | Field limits as in §3. URL ≤ 2000, ≤ 50 bulk rows, text ≤ 120 KB, rows JSON ≤ 200 KB (all under Next's 1 MB action cap; keep the default). `orderedIds ≤ 200`. Search `q ≤ 100`. Manager-only writes need no rate limit. |
| T12 | Unique-position races (programme, links) | Null-then-renumber in a tx, a single-statement append, and STALE set checks. |
| T13 | Privacy | `youtube-nocookie.com` for embeds, and iframes are only created on `Önizle`. Drive iframes load with the singer's own Google session; that's expected and what makes private files work for them. |

No timezone logic in this phase. `updatedAt`/`createdAt` stay UTC epoch, and if `updatedAt` is ever shown it uses `dateTimeFormat` from `src/lib/format.ts` (Europe/Istanbul).

## 6. Replies

- **@po Q4 (delete vs archive):** agree, keep hard delete for managers with the confirm, because nothing references pieces in Phase 3 and a mistyped duplicate piece must be removable. The server deletes links and the piece in one transaction and renumbers the programme. Once Phase 4 adds `assignments.piece_id → pieces (restrict)`, `deletePiece` maps the FK error to `Bu esere bağlı ödevler var. Silmek yerine arşivle.`, so "archive, don't delete" becomes enforced, not just suggested. I'd keep `Sil` visually secondary to `Arşivle` (@ux).
- **@po Q2:** see §4.1 (null part goes to Tutti; disabled only if there's no Tutti either).
- **@po Q5:** the iframe's cross-origin error can't be detected (no `onerror` for HTTP or CSP failures, and `onload` fires either way). Keep the permanent hint plus `Drive'da aç`.
- **@po §3.3 spec nits:** (a) the `t=` sentence is garbled. I keep `t` (as integer seconds) and strip everything else. (b) Drive `resourcekey` must be kept (§1.2). (c) without the API, `open?id=` can't tell a file from a folder. We treat it as a file. A folder pasted in that form gets a broken file preview, but `Aç` still works, since Drive resolves the id. Managers can paste the `/drive/folders/` form instead.
- **@dba:**
  - `unique(piece_id, url)` is required (the dedupe check *is* the constraint).
  - `program_position` unique-when-not-null with `CHECK (program_position > 0)` is fine given the null-then-renumber approach.
  - Please **don't** make `(piece_id, position)` unique; an index is enough.
  - The `label` limit is 80 and `language` is 40.
  - The migration maps the old `kind='midi'` → `part` and `is_active=0` → `archive`.
  - Seed URLs must be the *normalised* forms (the e2e compares `href`s), including one `resourcekey` and one `&t=` example.
- **@ux / @ui:**
  - Up/down buttons send the full order. Disable them while pending; `useTransition` is enough, since actions are sequential per client anyway. On STALE, show the message and `router.refresh()`.
  - The bulk preview table is client state. `Kaydet` posts `rows` as JSON.
  - Show `host` under external links.
  - The YouTube iframe needs `referrerPolicy` (T6).
