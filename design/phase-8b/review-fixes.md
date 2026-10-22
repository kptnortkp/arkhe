# Phase 8b review fixes

## Backend

Author: arkhe-backend. Date: 2026-10-21. Scope: `review-backend.md` P2-1, P2-2, P3-1/2/3/5/6/7/8/9, and the server/prompt side of `review-ux.md` P1-1, P1-2, P2-2, P2-3, P2-4, P2-6, P2-7, P3-9/10/11.

### What changed

| Finding | Fix | Where |
|---|---|---|
| BE P2-1 quadratic header, 20 MB response | Trailing blank header cells are dropped as spreadsheet padding (data under them still gets `Satırda başlıktaki sütunlardan fazla hücre var.` per row). A header wider than `columns + 20` is refused with `Başlıkta çok fazla sütun var; ilk satır yalnızca sütun adlarını içermeli.` The 5000-row cap runs before the header loop. "Blank header cell has data" is one pass over the rows for all blank cells. Header problems are deduplicated and capped at 20, plus a last line `ve <k> sorun daha.` | `src/lib/import/engine.ts` `mapRecords` |
| BE P2-2 undo dead-ends | A create item whose target is already gone is skipped: a freeze dropped by `voidEntry` (members undo), a waiver removed with `Muaf kaldır` (ledger undo; its delete is not emitted), a period deleted with `Dönemi sil` (periods undo). A row that still exists but differs is still refused. | `src/lib/import/undo.ts` |
| BE P2-2 re-import message | `kayit_no` conflicts now say what happened: `RECORD_TAKEN` `Kayıt <no>, <tarih> tarihli aktarımda farklı içerikle var. O aktarım doğruysa bu satıra yeni bir kayit_no ver; yanlışsa önce onu geri al.` (the imported row is untouched), `RECORD_EDITED` `Kayıt <no> aktarıldıktan sonra portalda değiştirildi; bu satırı çıkar ya da yeni bir kayit_no ver.` (voided, revised, edited, or a waiver whose row changed), `RECORD_DELETED` `Kayıt <no> portalda silinmiş; bu satırı çıkar ya da yeni bir kayit_no ver.` (waiver removed by hand). `RECORD_CONFLICT` is gone. This also covers UX P2-3's message part. | `rules/common.ts`, `rules/hareketler.ts`, `rules/aidat-odemeleri.ts`, `rules/ledger-snapshot.ts` (`batchAt`) |
| BE P3-1 formula guard | One leading `'` before `= + - @ \t \r` is stripped from every cell before parsing (inverse of `csvCell`). | `engine.ts` `unguard` |
| BE P3-2 restrict FKs | The created-user undo also checks `finance_entries.created_by/updated_by/voided_by`, `board_tickets.created_by/updated_by`, `board_ticket_events.actor_id/from_user_id/to_user_id`, `budgets.approved_by/created_by/updated_by`, `budget_revisions.actor_id`, `listening_assistants.created_by`, `midi_files.created_by`, `import_batches.created_by/undone_by`. Safety net: a foreign-key error from the final write batch becomes the refusal `Bu aktarımdaki bir kayıt portalda kullanıldı; geri alınamaz.` instead of `GENERIC`. | `undo.ts` |
| BE P3-3 "Bir üye" | Moot: a nulled freeze item is now skipped; a changed freeze names the member. | `undo.ts` |
| BE P3-5 Turso driver | Go-live check added to the root README (`sqld` / `turso dev`, samples, an in-process `commitFile` with `faultAt`, a timed 5000-row `uyeler`). Not run here. | `README.md` |
| BE P3-6 client hash | Recorded: the `sha256` the client sends guards against an accidental file swap (AC 18) only. Integrity comes from re-planning inside `BEGIN IMMEDIATE`. One-line comment at the compare. | `run.ts` |
| BE P3-7 | `db:check` fails on `live import batches without items`. | `scripts/db-check.ts` |
| BE P3-8 | `docs:import -- --check` also fails on a file in `docs/ice-aktarma/` the generator no longer writes, and on a live prompt that still holds a placeholder. README says when to run it. Wiring it into `e2e/run.mjs` is in the contract below. | `scripts/import-docs.ts`, `README.md` |
| BE P3-9 | README D33 line: `npm run e2e` also deletes attendance and excuses of rehearsals from today on. | `README.md` |
| UX P1-1 | Steps 3 and 6: a row dated before the member's `katilim_tarihi` is written anyway and listed under `Tarih çelişkisi`. With more than 3 such people the AI gives no CSV and says `Önce 1. adımı (Üye geçmişi) yap ve üye listesini yeniden indir`. Leave-date and wrong-part filters stay. `Tarih çelişkisi` is a closing heading for every people type. README §Sıra starts with the bold sentence about invite-day join dates; both type `.md`s have a note. `importIndex()` returns `memberHistoryImported`. | `defs/yoklama.ts`, `defs/aidat-odemeleri.ts`, `docs.ts`, `queries.ts` |
| UX P1-2 | Live prompt: `liveData()` reads the dues periods (name, dates, due date, full and reduced amount), the event names and the earliest live hand-made ledger entry (not opening, not dues, not imported). `livePrompt(def)` / `liveMarkdown(def)` fill the blocks `AİDAT DÖNEMLERİ` (step 6) and `ETKİNLİKLER` + `PORTALDA ELLE GİRİLMİŞ HAREKETLER` (step 4). The `talimat` route serves `liveMarkdown`. The repo copy keeps a placeholder line starting with `<Portaldaki Yapay zekâ talimatını kopyala ve Talimatı indir bu listeyi … kendisi doldurur.` that tells a repo reader what to write instead, plus a note in each `.md`. Empty lists read `Portalda henüz aidat dönemi yok. CSV verme; …`, `Portalda etkinlik yok; …`, `Portalda elle girilmiş hareket yok.` The member list has `aidat_orani` as its last column (`tam` / `indirimli` / `muaf`; `tam` when no row exists; empty for the conductor). Step 6 has the fallback rules (✓ = the period amount for the member's rate, missing date = due date under `Tahmin ettiklerim`, missing account = ask once, muafiyet only when stated, never from an empty cell, no rows for `aidat_orani muaf`) and a second worked example built on a tick grid. | `queries.ts`, `docs.ts`, `def.ts`, `defs/aidat-odemeleri.ts`, `defs/hareketler.ts`, `[tur]/talimat/route.ts` |
| UX P2-2 | Step 1 prompt: `sef`/`yonetim` rows go into a second code block headed `Koro şefinin aktaracağı satırlar`, or into the one CSV when the user says `koro şefiyim`. The worked example is from the conductor's side, so the e2e cast and sample stay valid. README and the step 1 `.md` explain it to board users. I did not strip manager rows from the member list, because steps 3 and 6 need them (board members sing and pay). | `defs/uyeler.ts`, `docs.ts` |
| UX P2-3 | Numbering rules that survive splits. Step 6: `O-<payment date>-<period YYYYMM>-<n>` (e.g. `O-20241002-202409-1`), so a split by period can't collide. Steps 4 and 6: number in source order; a later supplementary file prefixes the label the user gives (`EK1-…`), or the AI asks for one. Sample, examples and column docs are updated. | `defs/aidat-odemeleri.ts`, `defs/hareketler.ts` |
| UX P2-4 | Preview `Dikkat` (kind `other`) when a file row has the same day, kind, category and amount as a live hand-made entry: `<k> satır portalda elle girilmiş bir hareketle aynı gün, kategori ve tutarda (<first 3 effects>; …). Aynı hareket iki kez sayılmasın: tekrar olanları dosyadan çıkar.` `items` holds up to 50 effect lines. Plus the step 4 prompt block with the first hand-entry date, and notes in README and `4-hareketler.md`. | `rules/hareketler.ts` |
| UX P2-6 | `done.links` are built from the commit (contract below). | `rules/*.ts`, `run.ts` |
| UX P2-7 | Step 4 rule: no account in the source → ask once, apply to all, never invent. | `defs/hareketler.ts` |
| UX P3-9/10/11 | README: made-up sample people (`Bu e-postayla üye yok`), `Hücrede ayırıcı (noktalı virgül ya da virgül) varsa…`, `yeni CSV ile`. | `docs.ts` |

### Contract for the UI engineer (UI pages, components, e2e)

1. **Copied prompt.** In `src/app/(portal)/ice-aktar/[tur]/page.tsx`, replace `promptText(def)` with `await livePrompt(def)` (from `@/lib/import/queries`; it calls `requireManager()` itself). For the four types without live blocks the text is identical to before.
2. **`importIndex()`** now also returns `memberHistoryImported: boolean` (true when a live `members` batch exists). On `yoklama` and `aidat-odemeleri`, when it is false, render the `Önce:` line in the `Dikkat` style (UX P1-1 fix 3): `Üye geçmişi henüz aktarılmadı. Portaldaki katılım tarihleri davet günü; daha eski kayıtlar reddedilir.` with a `1 · Üye geçmişi` link.
3. **`done.links`** (`ResultLink[]`, still `{label, href}`):
   - `uyeler`: unchanged (`Üyeler` → `/uyeler`, `Aidat` → `/finans/aidat`).
   - `donemler`: `Raporlar` → `/raporlar?donem=<newest imported term id>`.
   - `yoklama`: one rehearsal: `Çalışma` → `/calismalar/<id>`. More: `Çalışmalar` → `/calismalar?sekme=gecmis`, or `…&sayfa=<n>` for the page (60 per page) that holds the newest imported rehearsal. Then `Raporlar` → `/raporlar`.
   - `hareketler`: `Hareketler` → `/finans/hareketler?ay=<YYYY-MM of the earliest imported entry>`, then `Finans raporu`.
   - `aidat-donemleri`: `Aidat` → `/finans/aidat?donem=<earliest imported period id>`.
   - `aidat-odemeleri`: `Aidat` → `/finans/aidat?donem=<earliest period touched>`, then `Finans raporu`.
   - If a plan returns no links, the type's static `def.links` are used, as before.
4. **New whole-file message** `Başlıkta çok fazla sütun var; ilk satır yalnızca sütun adlarını içermeli.` Add `Başlıkta çok fazla sütun` to `HEADER_PROBLEM` in `import-flow.tsx`. `fileError.messages` has at most 21 lines; the last may be `ve <k> sorun daha.`
5. **Warnings.** The double-count warning is `kind: "other"` with `items` (≤ 50). The text already names up to 3 rows. A `Listeyi göster` disclosure for `other` items, like `nameMismatch`, is optional.
6. **Copy (P3-11).** The page's `HOW_TO` step 5: `yeni metinle` → `yeni CSV ile`. The README now reads `… "Atladıklarım" ve "Tarih çelişkisi" listelerini oku …`; mirror that if you like.
7. **Optional board note** on `uyeler` (`data-testid=board-note`): append `Talimat şef ve yönetim satırlarını ikinci bir kod bloğuna ayırır; o bloğu koro şefine ver.`
8. **e2e changes needed** (I did not touch `e2e/`):
   - `phase8b-a-format.mjs` AC4: the header is `eposta;ad;partisyon;rol;durum;katilim_tarihi;ayrilis_tarihi;aidat_orani`. Add `sefRow[7] === ""` and `aliRow[7] === "tam"` (or whatever the cast's rate is). The round trip (columns 0, 1, 2, 5, 6) is unaffected.
   - `phase8b-a-format.mjs` AC5/6 (byte-identical `talimat` and copied prompt = `.md` prompt): still exact for `uyeler`, `donemler`, `yoklama`, `aidat-donemleri`. For `hareketler` and `aidat-odemeleri`, compare after removing, in both texts, the lines after each block head (`AİDAT DÖNEMLERİ (`, `ETKİNLİKLER (`, `PORTALDA ELLE GİRİLMİŞ HAREKETLER`) up to the next blank line. Also assert that the served or copied text contains the head and does not contain `<Portaldaki`.
   - `phase8b-b-types.mjs:343`: expect `Kayıt 20240905-1, ` and `tarihli aktarımda farklı içerikle var` instead of `daha önce farklı içerikle aktarıldı`.
   - `phase8b-c-undo.mjs`: add the three P2-2 scenarios, all expected to succeed:
     - remove the imported waiver `M-202409-1` (`removeWaiver`), then undo step 6;
     - undo step 6, delete the unused imported `Kasım 2024` (`deleteDuesPeriod`), then undo step 5;
     - a rate change `indirimli` → `tam` creates a freeze, `voidEntry` on the paid period drops it, then undo that `uyeler` batch (the rate is back to `indirimli`).
     - Plus a re-check of `6-aidat-odemeleri.csv` after `Muaf kaldır`, which expects `Kayıt M-202409-1 portalda silinmiş; bu satırı çıkar ya da yeni bir kayit_no ver.`
   - `e2e/run.mjs`: run `npx tsx scripts/import-docs.ts --check` before the suite (read-only) and fail on a non-zero exit.
   - Sample `kayit_no` values in `6-aidat-odemeleri.csv` are now `O-YYYYMMDD-YYYYMM-n`. No e2e string referenced the old ones.

### Verification

- `npm run lint`, `npm run typecheck`: clean. `npm run docs:import -- --check`: `0 file(s) out of date, 0 orphan file(s)`.
- I ran everything on scratch copies of the dev DB (`sqlite3 .backup`), never on `data/arkhe.db`. No e2e run. Harness copies are in `scratchpad/fix8b/`.
  - `parse.ts` (reviewer):
    - 16k × 16k blank-header file: 5 ms (was 1534 ms).
    - 150,000 unknown headers: 1 message, 101 JSON bytes (was 20 MB).
  - `parse2.ts`:
    - a 900 KB middle-blank header: 61 ms, refused;
    - 5000 wide rows: 46 ms;
    - the guard strip works.
  - `samples.ts`: all passed (samples and `.md` examples: check, commit, unchanged, undo, DB equal).
  - `edge.ts`: all passed. The one expectation changed is the new conflict text.
  - `dead2.mts` (the reviewer's `dead.mts` scenarios): waiver, period and freeze undo now succeed. The re-import gives the deleted, taken and edited messages.
  - `extra.mts`:
    - the double-count warning;
    - links for all six types;
    - the second step 6 example checks clean and imports;
    - live prompt rendering, including the empty lists;
    - a referenced former member is refused by name.
  - `db:check` on the copy: ok.
  - I did not run `rv8b-be/h/http.mjs`, because it writes to the shared dev DB over HTTP.

### Backlog (not done)

- BE P3-10:
  - a warning for a hand-made rehearsal on the same Istanbul day;
  - the global 1.1 MB `bodySizeLimit` note;
  - no rate limit on `checkImport`.
- BE P2-1 option: `parseCsv` refusing more than 500 cells per line. Not needed, because the cost is now linear.
- BE P3-5: the actual `sqld` run (go-live check in the README).
- UX P2-1 (member-list button on type pages), P2-5 (imported roster meta), P3-1…8, P3-14, P3-15: UI.
- UX P3-12 (ask about former members with no known part) and P3-13 (sectional tick matrices): prompt wording, deferred.

## UI

Author: arkhe-ui-engineer. Date: 2026-10-21. Scope: the UI side of `review-ux.md` P1-1 (fix 3), P2-1, P2-5, P2-6, the cheap P3s, plus the UI and e2e side of the Backend contract above.

### What changed

| Finding | Fix | Where |
|---|---|---|
| UX P1-1 fix 3 | On `yoklama` and `aidat-odemeleri`, while `importIndex().memberHistoryImported` is false, the `Önce:` box uses the `Dikkat` style (`border-late/45 bg-late/10`, `TriangleAlert` in `text-late-ink`, heading `Dikkat · Önce:`), and the step 1 line reads `1 · Üye geçmişi henüz aktarılmadı. Portaldaki katılım tarihleri davet günü; daha eski kayıtlar reddedilir.`, with `1 · Üye geçmişi` linking to `/ice-aktar/uyeler`. `data-warning` and `data-testid=history-warning` are there for e2e. | `ice-aktar/[tur]/page.tsx` |
| UX P1-2 (UI) | The copy button sends `await livePrompt(def)`, which runs in parallel with `importIndex()`. | `[tur]/page.tsx` |
| UX P2-1 | `Üye listesini indir` (outline, `Users` icon) on `uyeler`, `yoklama` and `aidat-odemeleri`, with the muted privacy line below it. At 375 px it is a full-width row under the two downloads; on desktop it wraps to a second row, because four buttons don't fit in 718 px. On the other three types the prepare text no longer says `ve üye listesini`. | `[tur]/page.tsx` |
| UX P2-5 | On an imported rehearsal, a mark nobody has touched since the import (`!corrected`, nothing pending) reads `İçe aktarıldı`. A later hand correction always sets `corrected_at`, so it keeps `Elle · <saat> · <ad>`. An excused row with a note still shows the note. | `marking-roster.tsx` (`imported` prop), `detail-roster.tsx`, `calismalar/[id]/page.tsx` (passes the flag it already had) |
| UX P2-6 | No UI change: `ImportFlow` renders `done.links` as given. | — |
| Contract 4 | `HEADER_PROBLEM` includes `Başlıkta çok fazla sütun`, so that refusal also offers `Geçerli sütunlar` and `Başlığı kopyala`. | `import-flow.tsx` |
| Contract 5 | A `kind: "other"` warning with `items` gets the same `Listeyi göster` disclosure as `nameMismatch`. | `import-flow.tsx` |
| Contract 6/7, UX P3-11 | HOW_TO step 1 says `Üye listesini indir (bu sayfada ya da Veri içe aktar sayfasında).` Step 5 says `yeni CSV ile` and `"Atladıklarım" ve "Tarih çelişkisi" listelerini oku`. The board note has the second sentence about the conductor's code block. | `[tur]/page.tsx` |
| UX P3-1 | `Nasıl yapılır?` has a `ChevronDown` that turns on `[open]` (`group-open:rotate-180`), `gap-1.5`, and a focus ring. | `[tur]/page.tsx` |
| UX P3-2 | The undo confirm leaves out a zero clause: `1 eklenen kayıt silinir.` | `undo-button.tsx` |
| UX P3-4 | On the index, when step 1 has no live import but a later step does, the step 1 card uses the `Dikkat` tint, and its state line reads `Henüz aktarılmadı · eski yoklama ve aidat için gerekli` (`text-late-ink`). The `Sıradaki` logic in `queries.ts` is unchanged. | `ice-aktar/page.tsx` |
| UX P3-5 | The prerequisites run in step order `0, 1, 5`. The `Ayarlar` link is now `inline py-3 -my-3`, so it keeps its hit area without leaving a gap mid-sentence. | `[tur]/page.tsx` |
| UX P3-6 | Example chips of up to 10 characters (dates, codes) are `whitespace-nowrap`. Columns are 16/10/14/22/14/24 %. I chose 10 rather than 16 characters because a 16-character mono chip is wider than the 14 % column and would overflow into `Açıklama`. | `column-table.tsx` |

### Not done

- **P3-3** (span line on log cards): needs per-batch date ranges from the server. That's a backend query change.
- **P3-7** (yoklama tiles): the `notes` line already says `1 çalışma · …`. Relabelling the three tiles to `satır …` is too wide for the 3-column grid at 375 px. Proposal: the backend puts `<n> satır` into the yoklama `notes` and leaves the tiles as they are.
- **P3-14** (link from Yönetim / Finans › Ayarlar): outside my files.
- **P3-15**: no change, as the review says.

### e2e

- `phase8b-a-format.mjs`:
  - header caps: 20 unknown columns give ≤ 21 messages; a 3000-column header is refused with 1 message; a 16k-wide blank header with 16k rows answers in < 1 s and < 20 KB. Measured: 20 messages; 1 message in 353 ms; 14 ms and 359 bytes.
  - AC4 now includes `aidat_orani`.
  - AC5/6: `hareketler` and `aidat-odemeleri` are compared with the live blocks stripped. The test asserts a block head is present and `<Portaldaki` is absent.
- `phase8b-b-types.mjs`:
  - all six type pages: the `Dikkat` line only on 3 and 6 before step 1, and plain after step 1; the member-list button only on 1, 3 and 6; the chevron; the prerequisite order on step 6.
  - the imported roster shows `İçe aktarıldı` and never `Elle ·` or `Otomatik ·`.
  - the undo confirm has no `0 …` clause.
  - the `RECORD_TAKEN` text.
- `phase8b-c-undo.mjs`, P2-2:
  - an imported waiver removed by hand: the re-check says `Kayıt M-E2E-1 portalda silinmiş`, then the undo succeeds;
  - an imported period deleted by hand, then undone;
  - a rate change that froze a paid period, the payment voided and the freeze dropped, then the `uyeler` undo succeeds and the rate is back to `indirimli`.

  These run on the test's own rows rather than the shipped samples, and they reproduce the FK `SET NULL` explicitly.
- `e2e/run.mjs` runs `scripts/import-docs.ts --check` before the suite and stops on a non-zero exit.
