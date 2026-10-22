# Phase 8b UI engineering plan

Author: UI engineer. Date: 2026-10-21. Reads: `po-spec.md` (45 ACs). `ux.md`, `db.md` and `backend.md` don't exist yet; where I depend on them I say so, and I'll reconcile once they land. Also read: Phase 8 `ui.md` and `po-decisions.md` (Phase 8 is built first), the Next 16 docs `01-app/02-guides/server-actions.md` (§ Security, body size) and `03-api-reference/05-config/01-next-config-js/serverActions.md`, and the current `next.config.ts`, `src/proxy.ts`, `src/app/(portal)/calismalar/page.tsx`, `src/lib/attendance/rehearsals.ts` (`listRehearsals`), `src/components/{copy-button,use-run-action,confirm-dialog}.tsx`, `src/components/ui/input.tsx`, `src/components/finance/csv-range-form.tsx`, `src/app/globals.css`, `scripts/{seed.ts,finance-fixture.mjs}`, `e2e/{run,lib,phase2-attendance,phase5-finance,phase6-z-guards,phase7-b-page}.mjs`.

Facts I checked before planning (each one changes the plan or a test):
- **Server actions are capped at 1 MB of raw request body** by default, multipart overhead included (`serverActions.md` § bodySizeLimit). A file of exactly 1 MB (AC 11's limit) plus the hash field plus boundaries is over it, so the request dies in Next before our code can answer `Dosya en fazla 1 MB olabilir.`. Fix in §2.4: `experimental.serverActions.bodySizeLimit: "1100kb"` and a client pre-check.
- **`e2e/run.mjs` only runs files matching `/^phase\d+-.*\.mjs$/`.** `phase8b-a-format.mjs` does **not** match (`8b-`), so AC 45's file names would silently never run. Fix in §8.1.
- **Seeded users joined on 2025-09-01** (`scripts/seed.ts:35`), and the seed has terms `2025–26 Bahar` (2026-02-01…06-30) and `2026–27 Güz` (from 2026-09-15). So the spec's sample rehearsal on `2025-10-07` would expect all ~37 demo users (auto-absent counts depend on the seed) and could collide with seeded rehearsals. Samples and fixtures must be dated **before 2025-09-01** (§8.3, @po 3).
- **The e2e opening date is not 2026-10-19.** `seedFinance` writes the opening entries on the 1st of M−2 (`finance-fixture.mjs:204`). AC 30's test uses that date.
- **`cleanup()` runs `seedFinance` first, which `delete from finance_entries … sponsors`** (`finance-fixture.mjs:106-111`). If `import_items` references those rows with an FK, every e2e cleanup breaks. Import tables must be wiped first (§8.2).
- **`copyText` already falls back to `execCommand`** (`copy-button.tsx:9`), but `CopyButton`'s toast is fixed (`Kopyalandı.`) and AC 5/16 need `Talimat kopyalandı.` / `Hatalar kopyalandı.`.
- **No file input exists in the app yet.** The shadcn `Input` is `h-8` with `file:h-6`, below 44 px; I don't use it for the file picker (§2.2).
- The `/calismalar` past list is `listRehearsals({ to, order: "desc", limit: 60 })`, no offset (`rehearsals.ts:80`). Phase 2's test reads `?sekme=gecmis` page 1 only (`phase2-attendance.mjs:553`).
- Older tests count manager links per `href` (`phase5-finance.mjs:126-129`, `phase7-b-page.mjs:174`), so adding a `/ice-aktar` link to `/profil`, `/yedek` and `/finans/ayarlar` breaks nothing.
- Tokens for states exist: `late`/`late-ink` (warnings), `absent`/`absent-ink` and `destructive` (errors), `present`/`success` (done).

**No new dependency. No new shadcn component.** I use `button`, `label`, `card`, `separator`, `dialog`, `alert-dialog` (through `ConfirmDialog`) and `sonner`. No virtualisation library (§3.3).

---

## 1. Files (frontend side; @backend owns `src/lib/import/*`, the actions and the route handlers)

| File | Kind | Content |
|---|---|---|
| `src/app/(portal)/ice-aktar/page.tsx` | Server | `requireManager()`; backup line, member-list link, step 0, six step cards, log link (AC 3) |
| `src/app/(portal)/ice-aktar/[tur]/page.tsx` | Server | `requireManager()`; `notFound()` unless `tur` is a known slug; header, `ColumnTable`, `TemplateActions`, `<ImportFlow>`; `export const maxDuration = 60` (the actions run in this page's function) |
| `src/app/(portal)/ice-aktar/[tur]/ornek/route.ts` | backend | sample CSV, `Content-Disposition: attachment; filename="<n>-<slug>.csv"` |
| `src/app/(portal)/ice-aktar/[tur]/talimat/route.ts` | backend | `.md`, `text/markdown; charset=utf-8` |
| `src/app/(portal)/ice-aktar/uye-listesi/route.ts` | backend | `arkhe-uyeler-<YYYY-MM-DD>.csv` (AC 4) |
| `src/app/(portal)/ice-aktar/gecmis/page.tsx` | Server | log, `?sayfa=`, 50 per page (AC 37); `maxDuration = 60` (undo) |
| `src/app/(portal)/ice-aktar/actions.ts` | backend | `checkImport`, `commitImport`, `undoImport` (§6) |
| `src/app/(portal)/ice-aktar/loading.tsx` | Server | skeleton: title bar plus 7 card placeholders |
| `src/components/import/step-card.tsx` | Server | one numbered card with stretched link (index) |
| `src/components/import/column-table.tsx` | Server | table from `md`, cards below (§2.6) |
| `src/components/import/template-actions.tsx` | Server | two download links plus the prompt `CopyButton` |
| `src/components/import/import-flow.tsx` | Client | file picker, state machine, preview, commit, result (§2) |
| `src/components/import/error-list.tsx` | Client | first 100 errors, copy, download (§3) |
| `src/components/import/import-preview.tsx` | Server-safe (no hooks) | summary, warnings, effects; rendered inside `ImportFlow` |
| `src/components/import/undo-button.tsx` | Client | `Geri al` plus `ConfirmDialog` plus `useRunAction` |
| `src/components/import/imported-chip.tsx` | Server | `İçe aktarıldı` / `İçe aktarıldı · Kayıt no <n>` (AC 35) |
| `src/components/copy-button.tsx` | edit | `toastText` prop and the dialog fallback (§4) |
| `src/components/pager.tsx` | new, Server | `Daha yeni` / `Daha eski` links, shared by `/calismalar` and `/ice-aktar/gecmis` (§5) |
| `src/app/(portal)/calismalar/page.tsx` | edit | `?sayfa=` for the past tab (§5) |
| `src/lib/attendance/rehearsals.ts` | edit (backend) | `offset` param on `listRehearsals` |
| `src/app/(portal)/calismalar/[id]/page.tsx`, `finans/hareketler/[id]/page.tsx` | edit | `ImportedChip` for managers only |
| `src/app/(portal)/profil/page.tsx`, `yedek/page.tsx`, `finans/ayarlar/page.tsx` | edit | `Veri içe aktar` link (AC 2), `href="/ice-aktar"` |
| `next.config.ts` | edit | `experimental.serverActions.bodySizeLimit: "1100kb"` |

Route names: static segments (`gecmis`, `uye-listesi`) win over `[tur]`, and no type slug collides with them. The downloads are child segments of `[tur]` because a segment can't have both `page.tsx` and `route.ts`.

---

## 2. `/ice-aktar/<slug>`: the import flow

### 2.1 One page, sections in place

I agree with the PO's default (§7 q3): one page. Order top to bottom: header (step number, title, explanation) → column table → template actions → `ImportFlow`. @ux decides the visual order and whether the table collapses behind a `<details>` once a file is chosen; the component split above works either way.

`ImportFlow` is the only client island. Everything else is server-rendered, so the page ships little JS (the flow is roughly the size of the existing forms).

### 2.2 The file input

```
<Label htmlFor="import-file">Dosya seç (.csv)</Label>
<input id="import-file" type="file" accept=".csv,text/csv,text/plain"
       class="block w-full min-h-11 rounded-xl border bg-card text-sm
              file:mr-3 file:h-11 file:rounded-l-xl file:border-0 file:bg-muted file:px-4 file:font-medium
              focus-visible:ring-3 focus-visible:ring-ring/50" />
<p id="import-file-hint">En fazla 1 MB ve 5000 satır. UTF-8 CSV.</p>
```
- A native input, not the shadcn `Input` (`h-8`). The `file:` button is 44 px tall and the label is visible (AC 43).
- `accept` lists the extension **and** MIME types: Windows reports `.csv` as `application/vnd.ms-excel` when Excel is installed, and iOS Files greys out files whose type it doesn't know. `accept` is only a hint; neither client nor server judges by MIME. The server decides by content.
- No drag-and-drop zone. Chrome and Safari already accept a drop on the native input, and a custom zone is extra code and an extra keyboard trap.
- While a check or commit runs, the input is `disabled`.

### 2.3 Keeping the file between `Kontrol et` and `İçe aktar` without storing it

The server stores nothing between the steps (constraint 6). The browser keeps the file, and it keeps a **snapshot of the bytes**, not the `File` from the input:

```ts
type Snapshot = { file: File; name: string; size: number };
const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
  setPreview(null);                        // any new pick throws the old preview away
  const picked = e.target.files?.[0];
  if (!picked) return setSnapshot(null);
  if (picked.size > MAX_BYTES) return setLocalError("Dosya en fazla 1 MB olabilir.");
  const bytes = await picked.arrayBuffer(); // read once, here
  setSnapshot({ file: new File([bytes], picked.name, { type: "text/csv" }), name: picked.name, size: picked.size });
}
```
- **Why a snapshot:** a `File` from an input is a live handle on disk. If the user edits the CSV in Excel after `Kontrol et` (a very likely thing here: "fix it and try again"), Chrome throws `NotReadableError` on the next read, and Safari quietly reads the new bytes. That second case reaches the server as a hash mismatch the user didn't cause on purpose. With the snapshot, **what was checked is exactly what is sent**, byte for byte, and a changed file means picking it again (which resets the preview).
- 1 MB in memory is nothing. The snapshot lives in React state only: no `localStorage`, no IndexedDB, no service-worker cache. Leaving or reloading the page drops it, and the user picks the file again. That's the documented behaviour, not a bug.
- **Check:** `FormData { file: snapshot.file }` → `checkImport(slug, formData)`.
- **Commit:** `FormData { file: snapshot.file, sha256: preview.file.sha256 }` → `commitImport(slug, formData)`. The server recomputes the hash of what arrived and compares (AC 18). The client never computes a hash itself: one implementation, on the server, and no `crypto.subtle` secure-context edge cases.
- `slug` is bound with `.bind(null, slug)` in the server page and passed as a prop, so it isn't a form field the user can edit. The server still validates it against the definitions.
- Choosing another file, or `Başka dosya seç` (a button that clears the input and the state), resets to idle.

### 2.4 The size limit, on both sides

- **Client:** `picked.size > 1_048_576` → the AC 11 message immediately, no upload. This is also what users actually see.
- **Next:** `bodySizeLimit: "1100kb"` (1,126,400 bytes) leaves about 75 KB above a 1 MiB file for multipart overhead (the docs suggest 10–20 KB). It applies to every action in the app, which moves the global cap from 1 MB to 1.1 MB. That's negligible.
- **Server:** `file.size > 1_048_576` → the same message (a crafted request skips the client check).
- **"1 MB" means 1,048,576 bytes** everywhere: client, server, README and the test. @backend: please use the same constant, exported from the definitions so the client imports it.
- A request above 1.1 MB is refused by Next itself. `ImportFlow` catches the rejection and shows `Dosya en fazla 1 MB olabilir.`, the same as `useRunAction`'s catch-all pattern but with this specific text.

### 2.5 State machine

```
idle ──pick──▶ ready ──Kontrol et──▶ checking ──▶ fileError | errors | clean | unchanged
                 ▲                                                  │
                 └──────────── pick / Başka dosya seç ◀─────────────┤
clean ──İçe aktar──▶ committing ──▶ done
                           └──▶ errors (DB changed) | fileError (hash mismatch, denied)
```
- **Pending:** `useTransition`. Buttons show `Kontrol ediliyor…` / `Aktarılıyor…` with `aria-busy`, and the hint `Büyük dosyalarda bu birkaç saniye sürebilir.` appears after 1 s (a 5000-row check may take up to 15 s, AC 44).
- **Double tap (AC 18):** a `useRef` flag set synchronously on the first click, plus `disabled={pending}`. `pending` alone is not enough, because two clicks in the same frame both run before React re-renders. The server must still be safe on its own (§6.4); the e2e tests both.
- **Commit failure with new errors:** the preview switches to the error view with the line `Kontrolden sonra portalda bir şey değişti; hiçbir şey yazılmadı.` above the list (@ux: copy). The snapshot stays, so after fixing the portal side the user can just tap `Kontrol et` again.
- **Navigation during commit:** the action completes on the server anyway, and the log page shows it. I don't add a `beforeunload` prompt.

### 2.6 Column table (`column-table.tsx`, Server)

- **From `md`:** a real `<table>` with `<caption class="sr-only">`, header cells `Sütun`, `Zorunlu`, `Biçim`, `İzin verilen değerler`, `Örnek` (AC 5). Column names and codes in `<code>`. Codes wrap as chips (`flex flex-wrap gap-1`). The expense list has 11 codes.
- **Below `md`:** a `<ul>` of cards, one per column, with a `<dl>` inside (`Zorunlu`, `Biçim`, …). Two DOMs, toggled with `hidden md:table` / `md:hidden`. `display: none` takes the hidden one out of the accessibility tree.
  - I don't restyle `tr`/`td` as blocks, because Safari drops table semantics when `display` changes.
  - Test ids are distinct: `column-row` (table) and `column-card` (cards), the Phase 8 lesson about duplicate test ids.
- Long values (`belge_linki` example, `@eski.invalid` addresses) get `[overflow-wrap:anywhere]`, so 375 px has no horizontal scroll (AC 5, 43).

### 2.7 Template actions (`template-actions.tsx`, Server)

- `Örnek dosyayı indir` and `Talimatı indir` are plain `<a href="/ice-aktar/<slug>/ornek" download>` styled with `buttonVariants({ variant: "outline" })`, `h-11`. They are **not** `<Link>`: a route handler isn't a page, and `Link` would prefetch and try a client navigation.
- `Yapay zekâ talimatını kopyala` is a `CopyButton` with the prompt text as a prop (about 2–4 KB per type, in the RSC payload) and `toastText="Talimat kopyalandı."`. The text is already in memory when the user taps, so `navigator.clipboard.writeText` runs inside the user gesture. Safari refuses the write if it comes after an `await fetch(...)`, so I never fetch the prompt on click.

---

## 3. The preview

### 3.1 Summary and live region

- A `<div role="status" aria-live="polite" data-testid="import-summary">` is **always in the DOM** while `ImportFlow` is mounted, empty at idle. Live regions inserted together with their content are not announced reliably, so the text is swapped inside an existing region (AC 43).
- It holds exactly the AC 16 / 17 summary sentence, and nothing else, so the announcement is one sentence and not the whole error list.
- After a check, focus stays on `Kontrol et` (it's still there), and the status announces. After a commit, `İçe aktar` is gone, so focus moves to the result heading (`<h2 tabIndex={-1}>`). Otherwise focus would fall to `<body>`.

### 3.2 File line and hash

Under the summary, one muted line: `<dosya adı> · 12,4 KB · SHA-256 1a2b3c4d5e6f`.
- The name and size come **from the server's response** (the cleaned name, D14), not from the local `File`, so the user sees what will be logged.
- The hash shows the first 12 hex characters, the same as the log page (AC 37), in `font-mono`, with the full hash in `title` and an sr-only label `SHA-256 özeti`. Twelve characters are enough for a human to match the preview to a log row. The full hash isn't copyable; nobody needs it.
- Size uses `Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 })` and `KB` = 1024 bytes.

### 3.3 Large error lists: render 100, keep the rest in memory

- The UI renders **the first 100 errors** as an `<ol aria-label="Hatalar">` (a real list, AC 43), followed by `ve <k> hata daha` (AC 16). Each `<li>` reads `Satır 7 · tarih: Tarihi 2025-10-07 ya da 07.10.2025 biçiminde yaz.`. The prefix is `font-medium tabular-nums`, and the message has `[overflow-wrap:anywhere]` because cells such as unknown codes can be long.
- **No virtualisation and no paging.** 100 `<li>` are trivial, even on an old phone. A virtual list would break find-in-page, screen-reader list navigation and the plain-text copy for no measurable gain. Paging through 5000 errors helps nobody: the user's next step is "paste to the AI", not reading error 3,417.
- **All errors** (up to the server cap below) stay in the client as one array. `Hataları kopyala` copies them joined by `\n` (toast `Hatalar kopyalandı.`). `Hataları indir (.txt)` saves the same text as `<slug>-hatalar.txt` through a `Blob` and an object URL, with no server round trip. That covers chat AIs that take attachments, and a clipboard that refuses 100 KB. @po 2 asks to confirm that extra button.
- Line format for both copy and download, the same as on screen:
  - `Satır <n> · <sütun>: <mesaj>` for a cell error
  - `Satır <n>: <mesaj>` for a row error with no column (AC 9's line break)
  - just `<mesaj>` for a whole-file error
- **Server cap (@po 1, @backend):** the action returns at most **1000** structured errors and `errorCount` (the true total, or "1000+" when it stopped counting). A 5000-row file with three bad columns is 15,000 errors × ~90 bytes ≈ 1.4 MB of RSC payload into a phone, for a file that is clearly structurally wrong. With the cap, the copied text ends with `İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.` This amends AC 16's "copies **all**" only above 1000 errors. AC 16's own test (120 errors) is unaffected.

### 3.4 Warnings, effects, button

- **Warnings** (`Dikkat`): a `<section aria-labelledby>` with `bg-late/15`-style token surface and `text-late-ink` heading. @ux picks the exact surface; tokens only. Each warning is a sentence from the server, optionally with a list:
  - deactivations list every name (AC 24)
  - new sponsors list every name
  - name mismatches, one `<li>` each

  Lists over 20 items collapse behind a native `<details><summary>Tümünü göster (<n>)</summary>`, which is keyboard-accessible with no JS. The deactivation list is **never** collapsed: AC 24 wants all names in view, and a lock-out must be impossible to miss.
- **Balance line** (AC 30): `İçe aktarımdan sonra: Kasa ₺… · Banka ₺…`, formatted by the existing money formatter from kuruş sent by the server, `tabular-nums`.
- **Effects:** up to 50 server sentences in an `<ol>`, then `ve <k> değişiklik daha`.
- **Button:** `İçe aktar (<a + u> değişiklik)`, `h-11`, primary, full-width below `sm`. In the all-unchanged case there's no button and the AC 17 sentence shows instead.
- **Placement at 375 px** (@ux decides): my recommendation is summary → warnings → the button → effects. The button then sits right after what the user must read before committing, not below 50 effect lines, and the warnings can't be scrolled past to reach it.

### 3.5 Result

`<h2>İçe aktarıldı</h2>`, the AC 18 sentence, then the type's links as `h-11` outline buttons (`Raporlar`, `Çalışmalar`, …). The links come from the server (the definition knows them), as `{ label, href }[]`. Plus `Başka dosya aktar` (reset) and `İçe aktarma geçmişi`. The batch's undo lives only on the log page, so a stray tap here can't undo.

---

## 4. Clipboard fallback (@po §7 q4)

`copyText` already tries `navigator.clipboard.writeText`, then `document.execCommand("copy")` on a hidden textarea. That covers old in-app browsers. When **both** fail (some WebViews, a denied permission), `CopyButton` opens a `Dialog`:
- title `Metni kopyala`
- a read-only `<textarea>` with the full text, `rows={10}`, `font-mono text-xs`, selected on open (`select()` in `onOpenChange`)
- the hint `Metin seçildi. Kopyala: Ctrl+C / Cmd+C, telefonda uzun bas → Kopyala.`
- `Kapat`

Changes to `copy-button.tsx`: add `toastText?: string` (default `Kopyalandı.`), and the dialog replaces today's `Kopyalanamadı, metni elle seç.` toast (which asks the user to select text that isn't on screen). Existing callers (Phase 4/5) keep their toasts. Phase 5's clipboard test (`phase5-finance.mjs:1028`) grants permission, so it never hits the dialog.

---

## 5. `/calismalar` past list paging (AC 36) and the shared pager

- URL: `/calismalar?sekme=gecmis&sayfa=<n>`, 1-based. Anything that isn't an integer 1–1000 means page 1. No redirect, so an old or bad link still works.
- Query: `listRehearsals({ to: todayStart, order: "desc", limit: 61, offset: (n − 1) × 60 })`. Fetch 61, show 60; the 61st only says that `Daha eski` exists. There's no `count(*)`.
- **Offset, not keyset:** the past list changes only when a rehearsal ends or an import lands. A shifted row between two page loads is harmless, and offset keeps `Daha yeni` trivial. At a few hundred rows, `OFFSET` on the `starts_at` index costs nothing.
- `<Pager>`: a `<nav aria-label="Sayfalar">` at the bottom, with `Daha yeni` (if n > 1, `rel="prev"`) on the left and `Daha eski` (if a 61st row exists, `rel="next"`) on the right. Both are `h-11` outline links, keeping the other query params. Between them is a muted `Sayfa <n>`. Empty pager → not rendered.
- Week groups can split across a page boundary (the same `… haftası` heading at the end of page 1 and the top of page 2). That's correct and expected, and I won't fetch extra rows to avoid it.
- The `devamın` card stays on page 1 only (it's about the current period), which saves two queries on older pages. Phase 2's AC 29 reads page 1, so it's unchanged.
- `sayfa` > last page → the normal empty state `Henüz geçmiş çalışma yok.` plus `Daha yeni`.
- The same `Pager` serves `/ice-aktar/gecmis` (50 per page, fetch 51).

---

## 6. Data contracts I need from @backend

Proposed shapes. @backend owns the names; I only need the information.

```ts
// src/lib/import/types.ts (isomorphic: imported by the client flow)
export const IMPORT_MAX_BYTES = 1_048_576;
export const IMPORT_MAX_ROWS = 5000;

export type FileMeta = { name: string; size: number; sha256: string };
export type RowError = { line: number | null; column: string | null; message: string };
export type Warning = { text: string; items?: string[]; kind: "deactivate" | "autoAbsent" | "newSponsor" | "nameMismatch" | "sameFile" | "other" };

export type CheckResult =
  | { kind: "denied"; message: string }                          // AC 1: "Bu işlem için yetkin yok."
  | { kind: "fileError"; file: FileMeta | null; message: string } // encoding, header, size, rows, empty
  | { kind: "errors"; file: FileMeta; rowCount: number; errorCount: number; capped: boolean; errors: RowError[] }
  | { kind: "clean"; file: FileMeta; rowCount: number;
      counts: { added: number; updated: number; unchanged: number };
      warnings: Warning[];
      balances?: { cashKurus: number; bankKurus: number };         // hareketler, aidat-odemeleri
      effects: string[]; effectsMore: number };                    // ≤ 50

export type CommitResult =
  | Exclude<CheckResult, { kind: "clean" }>                        // stale: errors / fileError (hash mismatch)
  | { kind: "done"; batchId: string; counts: { added: number; updated: number; unchanged: number };
      links: { label: string; href: string }[] };
```
1. **Turkish sentences come from the server** (warnings, effects, errors), so the parser, the preview and the docs share one copy source. The client formats only numbers it already has (counts, balances, size).
2. `checkImport` and `commitImport` take `(slug, formData)`. `formData.get("file")` is a `File`; `formData.get("sha256")` is the previewed hash on commit. Every action calls the manager check first and returns `denied` without reading the file.
3. **Never return raw rows or DB records** (the docs' "constrain return values"). Errors and effects are strings.
4. **Double commit:** both requests re-validate inside the write transaction. SQLite serialises them, so the second sees everything `unchanged` and returns `unchanged`-style `fileError` or `errors`, **without creating a batch**. Please confirm, since AC 18's "one batch" relies on it.
5. **`undoImport(batchId)`** returns the usual `FormState` (`{ success } | { error }`) so `useRunAction` toasts it (`İçe aktarma geri alındı.` or the D13/AC 38 messages).
6. **The docs and the downloads come from one generator.** The route handlers render the sample CSV and the `.md` from the definitions at request time. A script (`npm run docs:import`, tsx) writes the same bytes to `docs/ice-aktarma/`. The e2e compares the route bytes with the repo files, so a definition change without regenerating fails the run. Reading `docs/` from disk at runtime would need output-file tracing on Vercel; generating avoids it.
7. **Samples dated before 2025-09-01** (see the facts at the top), and sample term and period dates that don't overlap the seed's terms and the finance fixture's periods. Otherwise AC 7 can't pass on the dev DB.
8. **Fault hook (AC 19):** I'd suggest an `app_settings` row `e2e_import_fault_after = <n>`, honoured only when `NODE_ENV !== "production"` and the DB URL is `file:`. The test can set it by a DB write, with no env var on the running dev server, and `e2e:prod` proves it's ignored. @backend decides.
9. `maxDuration = 60` on `/ice-aktar/[tur]` and `/ice-aktar/gecmis`, like `/yedek`. Server actions run in the function of the page that serves them.

---

## 7. Accessibility and performance checklist (AC 43, 44)

- Visible labels: `Dosya seç (.csv)`. The hint is attached with `aria-describedby`. The first error doesn't steal focus; the user stays on the button, and the status sentence tells them.
- 44 px: file button, `Kontrol et`, `İçe aktar`, copy and download buttons, step cards (whole card is the link), pager links, `Geri al`.
- Focus rings: the existing `focus-visible:ring-3 ring-ring/50`. Stretched-link cards use `has-[a:focus-visible]:ring-3` (Phase 8 card pattern).
- Dialogs (`Geri al` confirm, clipboard fallback) have titles, which give them accessible names.
- Colour never alone: warnings carry the `Dikkat` heading and errors carry `Satır n` text. Contrast uses the `*-ink` tokens on tinted surfaces in both themes, checked with axe in the e2e.
- No raw hex: `grep -rnE "#[0-9a-fA-F]{3,8}\b" src/components/import src/app/(portal)/ice-aktar` must be empty.
- Hydration: `ImportFlow` renders identically on server and client at idle (no `Date.now()`, no `navigator` at render). The 1 s "takes a while" hint is set inside an effect.
- Performance: one client island per type page. Nothing parses CSV in the browser (one parser, on the server). The preview payload is bounded: ≤ 1000 errors, ≤ 50 effects, warnings lists ≤ a few hundred names.

---

## 8. e2e plan

### 8.1 Files and runner

| File | Content |
|---|---|
| `e2e/run.mjs` | edit: the filter becomes `/^phase\d+[a-z]?-.*\.mjs$/`. Without it, no `phase8b-*` file runs. Sort order stays right: `phase8-…` < `phase8b-…` because `-` < `b`. |
| `e2e/import.mjs` | helper module (not a phase file), §8.4 |
| `e2e/phase8b-a-format.mjs` | AC 1–6, 8–16 and the format parts of 43 |
| `e2e/phase8b-b-types.mjs` | AC 7, 17, 18, 20–36 |
| `e2e/phase8b-c-undo.mjs` | AC 19, 37–40, 42 |
| `e2e/phase8b-d-scale.mjs` | AC 44 timings, AC 41 (migrate a Phase 8 snapshot in a tmp dir, grep `drizzle/0009_*.sql` for `ALTER`/`DROP`/`__new_`, `db:check`), the rest of AC 43 (375 px light/dark overflow, axe, 44 px boxes) |
| `e2e/prod.mjs` | edit: `/ice-aktar`, a type page, `/ice-aktar/gecmis` and the three download routes refuse korist@ in production mode; the fault row is ignored (AC 19, 45) |
| `e2e/lib.mjs` `cleanup()` | edit, §8.2 |

### 8.2 Keeping Phase 1–8 green

1. **`cleanup()` wipes import data first,** before `seedFinance`:
   - attendance, `rehearsal_parts` and rehearsals whose id is an `import_items` target
   - imported terms
   - `import_items` and `import_batches`
   - users `like '%@ornek.com' or like '%@eski.invalid'`, after their attendance, sessions and invites

   `seedFinance` then wipes the imported entries, waivers, periods and sponsors as today. @dba: the exact statements depend on `import_items`' FKs. Please make sure this order works with yours.
2. **Each `phase8b-*` file also calls `wipeImports()` at its start and end,** so a run filtered to one file starts clean, and Phase 9 files later start clean too.
3. **Fixture dates are 2019-09-01 … 2025-06-30,** before the seed's `joined_at` (2025-09-01). So no demo user is expected at an imported rehearsal or owes an imported period, and the seeded terms are never overlapped. Term and period names start with `E2E` where a fixture creates them (cleanup already catches `E2E%` terms).
4. **Demo users are never changed by an import that commits.** The demo users appear only in rows that must be refused (AC 22 own row, AC 25 sef@/yk@ rows as yk@). Member-history updates use arranged `@ornek.com` users.
5. **Opening date:** AC 30 moves it through the real `Finans › Ayarlar` form. The next `cleanup()`'s `seedFinance` restores M−2.
6. The `/calismalar` change keeps page 1 identical, and the three new `/ice-aktar` links are extra `href`s, so the Phase 2, 5 and 7 assertions hold. Any Phase 1–8 expectation that still changes is listed in `implementation-notes.md`, as in Phase 8 D40.

### 8.3 Fixtures: generated in the test, fictional

**@po: I'd generate every fixture in code instead of committing `e2e/fixtures/import/*.csv`.** It's AC-neutral; the spec's folder becomes code in `e2e/import.mjs`.
- The interesting fixtures are about bytes: BOM or no BOM, CRLF, Windows-1254, exactly 1,048,577 bytes, 5001 rows. Those are invisible or unreviewable as files, but obvious as code.
- Dates relative to "today" (tomorrow, AC 12) can't live in a static file.
- `setInputFiles({ name, mimeType: "text/csv", buffer })` takes a Buffer directly, so nothing touches the disk.

The only on-disk CSVs the tests read are the shipped `docs/ice-aktarma/*`.

All people are fictional: `ayse.demir@ornek.com`, `mehmet.kaya@ornek.com`, `zeynep.ak@eski.invalid`, `perf-01…40@ornek.com`. Arranged users are inserted directly with `joined_at` in 2019. A user who must be able to log in (AC 24's two-context test) gets the demo users' `password_hash` copied, so it logs in with `arkhe-demo-2026`.

### 8.4 `e2e/import.mjs` helpers

- `csv(rows, { sep = ";", bom = false, eol = "\n" })` → Buffer, with RFC 4180 quoting.
- `win1254(text)` → Buffer, a hand-written map for `ç ğ ı İ ö ş ü Ç Ğ Ö Ş Ü` (≈ 12 entries; everything else ASCII).
- `arrangeUsers(list)`, `arrangeEvent(name)`, `arrangeSponsor(name)`.
- `snapshot(tables?)`: count plus a sorted-row SHA-256 per table, enumerating `sqlite_master` like `phase6-z-guards.mjs`. `sessions` compares ids only (`last_seen` moves); `login_attempts` is excluded.
- `checkFile(page, slug, buffer, name)`: open the type page, `setInputFiles`, click `Kontrol et`, wait for a non-empty `[data-testid=import-summary]`, return the summary text, the error `<li>` texts and the warning texts.
- `commit(page)`: click `İçe aktar`, wait for the result heading, return its text.
- `clipboard(page)`: `navigator.clipboard.readText()` after `grantPermissions(["clipboard-read","clipboard-write"])` (the Phase 5 pattern).
- `download(page, href)`: `page.request.get(href)` (shares cookies), returning the body Buffer and headers.
- `importAction(page, name, fields)`: a crafted multipart call of a server action, built like React's own encoding of a `(slug, formData)` call, for the cases the UI can't produce (hash mismatch, double commit, korist@). It needs `Next-Action` plus a `FormData` body with `0 = ["<slug>","$K1"]` and `1_file`, `1_sha256`. If React's encoding proves brittle in this version, the fallback is `page.route()` on the commit POST to swap the file part. I'll pin whichever works in `implementation-notes.md`.
- `wipeImports()`: the §8.2 statements, shared with `cleanup()`.

### 8.5 Contract round-trips: docs = page = parser (AC 6, 7, 8)

The e2e can't import the TS definitions (plain Node `.mjs`), so it proves agreement through behaviour:
1. **Bytes:** for each slug, `download(/ice-aktar/<slug>/ornek)` and `/talimat` are `Buffer.equals` to `docs/ice-aktarma/<n>-<slug>.{csv,md}`. Also checked: `Content-Disposition` filename, `charset=utf-8`, and the CSV's BOM/`;`/CRLF match the README's rules.
2. **Header = table = prompt:** the column names parsed from the `.md` table equal the sample CSV's header (as a set) and the header line inside the copied prompt (exactly, in order). The page's `column-row` names equal both.
3. **Required flags are true:** for each column the `.md` marks required, a copy of the sample with that column removed gives `Zorunlu sütun eksik: "<col>".`. For each optional column, removing it gives no header error. This proves the `.md`'s `Zorunlu` column matches the parser.
4. **Codes are true:** for each code column, a fixture with one row per canonical code listed in the `.md`, plus each code's app label and English DB code (AC 14), gives no error in that column. One unknown value gives the AC 14 message, and the message's code list equals the `.md` list.
5. **The samples import** in D1 order with 0 errors and the documented edges (AC 7). Then a re-check of each sample shows all `değişmeyecek` (AC 20).
6. **Member list round-trip (AC 4):** download `arkhe-uyeler-<date>.csv`, check BOM, CRLF, header, one row per user against the DB, and the `=HYPERLINK(` guard. Then **drop `rol` and `durum`** and check the rest as an `uyeler` file: every row is `değişmeyecek`. This proves the export's date and part formats are the import's.

### 8.6 Per-row error cases (one fixture per AC, one case per line, the line number asserted)

| AC | Type | Lines → expected message |
|---|---|---|
| 9 | any | 1254 file → whole-file message; quoted CRLF in a cell on line 3 → `Satır 3: Hücrede satır sonu olamaz.`; the six encoding/sep/eol variants → identical summaries and effect lists |
| 10 | uyeler | `e-posta` → unknown column (and the list of valid ones); `eposta` twice → duplicate; no `durum` (yoklama) → missing; `EPosta` + shuffled order → passes |
| 11 | any | 1,048,577 bytes (client message, and the crafted request for the server message); 5001 rows → limit; header-only, empty and BOM-only → `Dosyada veri satırı yok.`; blank line 4 + bad date on line 7 → `Satır 7 · tarih: …` |
| 12 | yoklama | three equivalent forms of one day → one rehearsal; `2025-02-30` → `Bu tarih takvimde yok.`; `07/10/2025`, `7 Ekim 2025`, `25-10-07` → format message; tomorrow → future; `1999-12-31` → before 2000; `19:00`, `9:30`, `19:00:00` pass; `7 pm`, `25:00` → time message |
| 13 | hareketler | four accepted forms → kuruş 125000/125050/125050/125050 after commit; nine refused forms; `0` → zero message; 10,000,000.01 → max message |
| 14 | hareketler, yoklama, uyeler | five spellings → `travel`; four → `late`; `Bas`/`bass` → `bass`; `seyahat` → list message |
| 16 | yoklama | 120 errors → 100 `<li>`, `ve 20 hata daha`, clipboard has 120 lines, no `İçe aktar` button; the `.txt` download equals the clipboard |
| 22 | uyeler | left < joined; future left; importer's own row; unknown email without left date |
| 23 | uyeler | former member created (`is_active = 0`, `password_hash` null, `left_at` = 23:59:59.999 Istanbul, no invite); login attempt gives the normal wrong-credentials text; missing `partisyon` → its message |
| 25 | uyeler | as yk@: sef@ row and a board row → conductor-only message; same file as sef@ → passes |
| 26 | donemler | overlap with DB; overlap between two rows; 367 days; same name, other dates |
| 28 | yoklama | joined after; left before; conductor; outside a sectional's parts; ends after now; `partiler` on tutti; sectional without; `not` on `geldi`; later row with another `tur`; portal-created rehearsal at the same start; earlier import with other rows; the auto-absent warning numbers |
| 29 | hareketler | `aidat`; `kategori` on a transfer; `hedef_hesap = hesap`; unknown and ambiguous event |
| 30 | hareketler | a row before the M−2 opening → opening message; after moving the opening in Ayarlar it passes; the preview's balances equal `/finans` after commit |
| 31 | aidat-donemleri | overlap; reduced ≥ full; `son_odeme` < `baslangic` |
| 32 | aidat-odemeleri | not owed (joined later, left before, conductor); over the open amount counting earlier rows; reduced-rate member judged on the reduced amount |
| 33 | aidat-odemeleri | `muaf` with `tutar`; without a reason; period paid in the DB; period paid earlier in the file |
| 20 | all six | the same key twice → `Satır <m> ile aynı kayıt.` on the later line; same key with different content → the type's conflict message |

Every one of these checks also asserts AC 15: `snapshot()` is unchanged after the check.

### 8.7 Commit, idempotency, undo

- **AC 15 per type:** a clean and a broken file of each type; `snapshot()` before = after `Kontrol et`.
- **AC 18:**
  - hash mismatch: `importAction` with file B and A's hash → the message, snapshot unchanged
  - DB change: check, move the opening date in Ayarlar, commit → the new error list, nothing written
  - double commit: `dblclick()` on `İçe aktar` → 1 batch, and two concurrent crafted commits (`Promise.all`) → 1 batch
  - the batch row has name, size, the 64-hex hash and counts, and `pragma table_info` shows no text/blob column large enough to hold content (no column other than the known ones)
- **AC 19:** set the fault row to 50, commit a 100-row file → an error, `snapshot()` unchanged across all tables (users, sponsors, rehearsals, attendance, entries, batches, items). Then clear the row.
- **AC 20 idempotency per type:** import, re-check → `Değişecek bir şey yok…`, no button, the `Bu dosya <tarih> tarihinde <ad> tarafından aktarılmıştı.` warning; snapshot unchanged.
- **AC 34 parity:** rehearsal A created and marked through the UI and closed; rehearsal B imported with the same people and statuses on an aligned date in the same E2E term. Compare `/raporlar` rate and counts, the `/raporlar/csv` rows (minus the date), the member's history entries and the `/calismalar/<id>` summary text. The same pairing is done for a finance entry (`/finans/rapor` totals, `/finans/hareketler` row text minus the chip) and a dues payment (`/finans/aidat` status, `/finans/aidat/csv` row).
- **AC 36:** insert 130 past rehearsals directly (titles `E2E paging …`, dates 2019–2021) plus the seed's own past rehearsals (counted from the DB as `total`) → pages 1 and 2 have 60 rows each, the last page has `total − 120` (three pages while `total` ≤ 180), `Daha yeni`/`Daha eski` present or absent correctly, newest-first order across the pages, and `sayfa=abc` → page 1. Counted with `[data-testid=rehearsal-row]` (existing `RehearsalRow`; I'll add the test id if it's missing).
- **AC 37–40 undo:**
  - two batches (sef@ then yk@): `Geri al` only on the newest, only for yk@ and sef@; korist@ redirected
  - crafted undo of the older one → `Önce daha sonraki içe aktarmayı geri al.`; yk@ undoing sef@'s → the owner message
  - per type: `snapshot()` before the import equals after the undo. The exceptions are compared explicitly: `import_batches`/`import_items` (log kept, undo fields set), voided entries (present, `voided_at` set, reason `İçe aktarma geri alındı`, balances back), created sponsors (inactive), and deactivated people's sessions (gone; they log in again). Then re-check the same file → all `eklenecek`.
  - refused undo, one case each (AC 40), with the D13 message and an unchanged snapshot
- **AC 42:** a handful of direct inserts that must throw (bad type, 63-hex hash, negative count, half-set undo fields, duplicate live `kayit_no`, an item pointing at two targets). The exact list follows `db.md`.

### 8.8 Scale and timing (AC 44)

- Warm-up first: check one tiny file of each type, so dev-server compilation isn't timed.
- **5000-row `yoklama`:** 40 arranged users × 125 weekly rehearsals (2022-01 … 2024-05, Tuesdays 19:00). Exactly 5000 rows, about 330 KB. Time from the click on `Kontrol et` to the summary (< 15 s), and from `İçe aktar` to the result heading (< 30 s). The same file plus one row → the 5000-row message (AC 11), checked before the import.
- **2000-row `hareketler`:** check < 10 s.
- **Index and log pages with 50 batches** (directly inserted): `page.goto` → `domcontentloaded` < 1 s, measured after one warm-up load.
- Timings are printed in the run output and saved to `e2e-results.txt`. The thresholds are loose, because the dev server isn't production. @backend reports the Turso estimate in `backend.md`.

### 8.9 What I'm not doing now

Per the tech lead's prompt: no `src/` changes, no data written, no e2e run. Screenshots of the built pages (390 px and 1280 px, light and dark) go into `review-ui.md` after implementation.

---

## 9. Replies

**@po:**
1. **Error cap (§3.3).** I'd cap the server's error list at 1000 and amend AC 16's "copies all" to "copies all, up to 1000, plus the line `İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.`". AC 16's 120-error test is unaffected. The reason is a bounded payload on phones for files that are structurally wrong anyway. Please settle it in `po-decisions.md`.
2. **`Hataları indir (.txt)`.** It's a small client-only extra next to `Hataları kopyala`, useful for AIs that take attachments and when a clipboard refuses a long text. Accept or cut; nothing else depends on it.
3. **Sample dates.** The `3-yoklama.csv` example in §4.1 uses `2025-10-07`. Seeded users joined on 2025-09-01, so on the dev DB (and on production, where all 37 joined 2026-10-19 but may be back-dated by step 1) that date makes the auto-absent counts depend on who exists. Please move every sample date before 2025-09-01 (I'd use the 2024–25 season). Also choose sample term and period names and dates that don't overlap the seed's `2025–26 Bahar` / `2026–27 Güz`.
4. **Fixtures as code (§8.3)** instead of `e2e/fixtures/import/*.csv`. AC-neutral.
5. **AC 18 "swap the file in the input"** can't happen through the UI: picking another file resets the preview by design (§2.3). The test does it with a crafted request carrying file B and A's hash. The behaviour under test is unchanged.
6. **AC 30's opening date** in e2e is the fixture's (1st of M−2), not 2026-10-19. The AC's logic is unchanged.
7. **§7 q3:** one page with sections, agreed. **§7 q4:** answered in §4 (Clipboard API → `execCommand` → a dialog with a selected read-only textarea).
8. **"1 MB" = 1,048,576 bytes** (§2.4), and the README says "1 MB".
9. **AC 45's file names** only run once `e2e/run.mjs`'s filter accepts `phase8b-` (§8.1). It's a one-character-class edit to the runner, listed in `implementation-notes.md`.

**@ux:** you own the copy and the visual order of the preview. My constraints are:
- the summary sentence is the only content of the `role="status"` region
- the deactivation names are never collapsed
- I recommend the warnings and the button before the 50 effects at 375 px (§3.4)
- the column table is two DOMs (table from `md`, cards below), so style both

**@backend:** §6 is my contract wish list. Please confirm points 4 (the double commit creates no second batch), 6 (one generator for docs and downloads) and 8 (where the fault hook lives), and add `offset` to `listRehearsals`. Also: the client imports `IMPORT_MAX_BYTES`/`IMPORT_MAX_ROWS` from an isomorphic module (no `server-only`, no Node APIs).

**@dba:** `cleanup()` must delete imported rows before `seedFinance` wipes the finance tables (§8.2). If `import_items` FKs point at `finance_entries`, `sponsors`, `dues_periods` or `dues_overrides`, `seedFinance`'s deletes fail unless the items go first. Please state the delete order that works with your FKs.
