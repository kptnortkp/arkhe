# Phase 8b spec: historical data import (Veri içe aktar)

Author: PO. Date: 2026-10-21. Status: amended after team feedback; every open point is settled in `po-decisions.md` (D17–D34), and changed ACs are marked `(amended Dn)`. AC numbers are unchanged (1–45).

Inputs: the user's request of 2026-10-21 ("We want to feed the system with historical data", translated in the tech lead's brief), the tech lead's codebase analysis of the same day, `design/STATUS.md`, `design/phase-8/po-spec.md` (format), and the code I spot-checked: `src/db/schema.ts` (`users`, `terms`, `rehearsals`, `attendance`, `finance_entries`, `dues_periods`, `dues_overrides`, `sponsors`, `events`), `src/lib/attendance/roster.ts` (`isExpected`), `src/lib/attendance/close.ts`, `src/lib/finance/dues.ts` (`owesPeriod`, `owedFor`), `src/lib/finance/categories.ts`, `src/lib/finance/schemas.ts`, `src/lib/money.ts` (`parseAmount`, `csvAmount`), `src/lib/labels.ts`, `src/lib/permissions.ts`, `src/app/(portal)/calismalar/actions.ts` (`createRehearsal`, `termSchema`, `createTerm`), `src/app/(portal)/finans/actions.ts` (`setOpeningBalances`), `src/app/(portal)/finans/aidat/actions.ts` (`recordDuesPayment`, `periodSchema`, `setWaiver`, `setDuesRate`), `src/app/(portal)/uyeler/actions.ts` (`setMemberActive`), `src/components/shell/nav-items.ts`.

Fixed constraints (not up for discussion):
1. **The portal is live** with real data (37 users). The Phase 8b migration is **additive only** (new tables and indexes; no change to existing columns or CHECKs). It comes after Phase 8's migration and is **not deployed before Phase 7 is live** (`phase-7/review-po.md` §6): a monthly encrypted backup must exist before anyone bulk-writes into production.
2. **Zero budget.** No paid service. CSV parsing is small enough to write ourselves; if the team wants a parser library it must be free/open-source, tiny and justified in `backend.md`. No XLSX parsing (D3).
3. **No bypass.** Every imported row goes through the same validation and business rules as the UI that would create it (the zod schemas, `isExpected`, `owesPeriod`, the opening-date guard, overlap and uniqueness checks, `canEditMember`). If the UI would refuse it, the import refuses it. Where the import needs a rule the UI doesn't have (a past rehearsal), the spec says so explicitly (D9).
4. **e2e only.** Every AC is checked by `npm run e2e` (Playwright, real Chrome, dev server; uploads via `setInputFiles`), by `npm run e2e:prod`, or by a script. "Arrange" means the test writes DB state directly.
5. **Authorize on the server** in every page, action, route and query. Hiding a button is never the check.
6. **The uploaded file is never stored.** Only its name, size, SHA-256 hash and the resulting row counts are logged (D14).

## 1. Problem

Koro Arkhe has years of history outside the portal: attendance sheets on paper and in Google Sheets, a treasurer's Excel ledger, dues lists per season, "who joined when" in somebody's memory. Since go-live (2026-10-19) the portal only knows the present:

- **Everyone "joined" on 2026-10-19.** All 37 imported members have `joined_at` = import time. So last season's rehearsals would not expect them (`isExpected` in `roster.ts`), they owe no earlier dues period (`owesPeriod` in `dues.ts`), and a 6-year soprano looks like a newcomer. Fixing that today means opening 37 profile pages one by one.
- **People who left aren't there at all**, so their past attendance and dues payments have nowhere to go. And `leftAt` can only be "now" (`setMemberActive`).
- **Past rehearsals can't be entered**: `createRehearsal` refuses anything more than 24 hours old, and manual marks are stamped "now".
- **The ledger starts at go-live.** Past entries can be typed in one at a time, but nobody will type 600 rows on a phone.
- **No import exists anywhere**; there are only CSV exports.

The board wants the season reports, the member attendance history, the ledger, the dues status and the yearly finance report to show the real past, as if the portal had always been used. The people doing the import are volunteers with a laptop, an AI chat assistant and their own messy records. So the format has to be precise enough to hand to an AI ("convert my data into this"), forgiving where Excel is predictable (Turkish dates, `;` separators), strict where ambiguity would corrupt data (amounts), and it must **check everything before writing anything**.

## 2. Users and roles

| Role | Import |
|---|---|
| Şef (conductor) | All six types, every row. Can undo any batch (D13). |
| Yönetim kurulu (board) | All six types, but each row follows the UI's own rules. For member history that means only `role = member` rows, like `/uyeler/[id]` today (`canEditMember`). Can undo the batches they imported. |
| Korist (member) | No access. Pages redirect to `/`; actions and download routes are refused. Members only see the result (their own history, their own dues). |
| Machine (monthly email) | Nothing new. The import tables are in the encrypted DB dump automatically. |

Why not conductor-only: in practice the treasurer (a board member) owns the finance and dues records, and the person who kept attendance is often a board member too. The UI already lets every manager enter all of this by hand, so the import gives them the same rights, just faster. The one place the UI separates conductor and board (editing managers' profiles) is kept row by row (AC 25).

## 3. Key product decisions

### Scope and order

- **D1. Six import types, in dependency order, plus one manual step.** The page shows them numbered in this order, and the docs say "do them in this order":

  | # | Type | Slug | What it writes |
  |---|---|---|---|
  | 0 | Açılış bakiyesi (manual) | — | Nothing. The user sets the opening date and the cash/bank amounts in `Finans › Ayarlar` (D10). The page shows the current value and links there. |
  | 1 | Üye geçmişi | `uyeler` | Updates `joined_at`, `left_at`, voice part and dues rate of existing users; creates **former** members (inactive, no login) (D7). |
  | 2 | Çalışma dönemleri | `donemler` | Creates terms (`terms`). |
  | 3 | Çalışmalar ve yoklama | `yoklama` | Creates past rehearsals, already closed, with their attendance (D9). |
  | 4 | Finans hareketleri | `hareketler` | Creates income, expense and transfer entries (not dues) (D10). |
  | 5 | Aidat dönemleri | `aidat-donemleri` | Creates dues periods. |
  | 6 | Aidat ödemeleri ve muafiyetler | `aidat-odemeleri` | Creates dues payments (finance entries linked to member + period) and waivers (D11). |

  The order matters. Member dates decide who was expected at a rehearsal and who owed a dues period; dues periods must exist before payments. A wrong order doesn't corrupt anything, it just produces row errors ("Bu kişi bu çalışmada beklenmiyor"). The fix is to import the earlier type first and upload the same file again.

- **D2. Out of scope: homework, repertoire, events, cancelled rehearsals, active member creation.**
  - Past homework isn't representable (`created_at` = now, every submission would be late), and nobody keeps homework history worth importing.
  - Repertoire already has a bulk paste.
  - Events (concert P&L) are few; they are created in the UI first and finance rows can **refer** to them by name (D10).
  - Active members keep coming in through invite links only. The import never creates a user who can log in.

### File format (one set of rules for all types)

- **D3. CSV only, UTF-8.** The tool is a CSV importer, not an Excel or Sheets reader. Every source (Excel, Sheets, paper) goes through the AI or "Save as CSV" first. I'm not adding XLSX parsing: it's a dependency, it's ambiguous (formatted dates, merged cells), and it isn't needed.
  - **Encoding:** UTF-8, with or without BOM. Anything else is refused as a whole-file error. Excel TR's plain "CSV" is Windows-1254 and breaks `ş/ğ/ı`, so the message tells the user exactly what to do (AC 9).
  - **Delimiter:** `;` (recommended, what Excel TR and our own exports use) or `,`. It's detected from the header line: if the header contains `;` it's `;`, otherwise `,`.
  - **Quoting:** RFC 4180 double quotes (`"Salon; kira"`, `""` for a literal quote). A quoted cell containing a line break is refused (`Hücrede satır sonu olamaz.`), so line numbers stay true.
  - **Lines:** LF or CRLF. Blank lines, and lines where every cell is blank, are ignored, including trailing ones.
  - **Header:** the first non-blank line, with the exact column names of the type. Names are matched after D6 normalisation (so case, Turkish letters and spaces don't matter; amended D27), and column order is free. An **unknown column is an error**, not ignored: an AI that writes `e-posta` instead of `eposta` must be caught, not silently lose a column. Duplicate columns and missing required columns are errors too. Optional columns may be left out of the header entirely.
  - **Cells:** trimmed. Blank means "no value" (for member history: "don't change").
  - **Pasted text (amended D18):** instead of a file, the user may paste the CSV text into `Metni yapıştır`. The browser turns it into a UTF-8 file named `yapistirilan-metin.csv` before either call, so the hash, limits, log and undo are exactly those of an upload.
  - **Size:** at most **1 MB** (1,048,576 bytes, amended D25) and **5000 data rows** per file. A three-season attendance file for 40 singers is about 40 × 35 × 3 ≈ 4200 rows. Bigger histories are split per season, which is also easier to check.

- **D4. Dates and times: two unambiguous date forms, one time form.**
  - **Dates:** `YYYY-MM-DD` (canonical, what the AI is told to write) **or** `DD.MM.YYYY`, because Excel TR rewrites dates that way when a user opens and re-saves the file. Single-digit day or month in the dotted form (`1.9.2025`) is accepted for the same reason. **Slashes are refused** (`09/10/2025` is 9 October in Turkey and 10 September in the US), and so are two-digit years and month names.
  - **Dates must be real** (no `2025-02-30`), **between 2000-01-01 and today** (Istanbul). The only exceptions are the end-type dates of terms and dues periods (`bitis`, `son_odeme`), which may be in the future. A future start date isn't history; it belongs in the normal UI.
  - **Times:** `HH:MM`, 24-hour, Istanbul local (`19:00`, `9:30` accepted). `HH:MM:00` is accepted because Excel writes it. No `pm`.

- **D5. Amounts: strict, one meaning per string.** The UI's `parseAmount` is lenient for typing: `1.250` means one thousand two hundred fifty. In a file, that is exactly the ambiguity that corrupts a ledger: an AI or a US-locale sheet may write `1.250` for 1,25. So the import has its own strict rule:
  - **Accepted:** digits, optionally followed by **one** decimal separator (`,` or `.`) and **one or two** digits: `1250`, `1250,5`, `1250,50`, `1250.50`.
  - **Refused:** thousands separators (`1.250`, `1.250,00`, `1,250.00`), `₺`/`TL`, spaces, signs, more than 2 decimals, and zero. The message is `Tutarı 1250,50 biçiminde yaz: binlik ayırıcı, ₺ ve boşluk yok.`
  - The UI's maximum applies (`₺10.000.000,00`).
  - This is the format of our own CSV exports (`csvAmount`: `1250,50`), so an exported file round-trips.

- **D6. Codes: one Turkish code per value, with forgiving matching.** Every enumerated column has a **canonical code**: the Turkish label from `src/lib/labels.ts`, normalised. Normalising means:
  1. lower-case with Turkish rules (`İ`→`i`, `I`→`ı`)
  2. fold `ç ğ ı ö ş ü â î û` to `c g i o s u a i u`
  3. replace every run of characters other than `a–z 0–9` with `_`, and trim `_`

  Every cell is normalised the same way before matching, so the canonical code (`ulasim_ve_konaklama`), the app's label (`Ulaşım ve konaklama`) and the English DB code (`travel`) are all accepted. That's one rule, and nothing to memorise. An unknown value lists the canonical codes in the error (AC 14). The full code tables are in §4.1.

### Per-type rules

- **D7. Member history (`uyeler`): match by email, change only what's filled in, create former members only.**
  - **Matching:** `eposta`, lower-cased. An existing user is updated. For an existing user, `ad` is **only a sanity check**: if it differs from the portal name, the preview shows a **warning** (`Ad portaldakinden farklı: "Ayşe D." ↔ "Ayşe Demir"`). It doesn't block and doesn't rename. This catches the AI pairing the wrong email with a name.
  - **Blank cell = no change.** Blank `ayrilis_tarihi` never reactivates anyone; reactivation stays a deliberate click on `/uyeler/[id]`.
  - **`katilim_tarihi`** is the first day of membership, stored as the start of that Istanbul day, exactly like the member form's `joinedOn`.
  - **`ayrilis_tarihi`** is the **last day of membership**, stored as the **end** of that Istanbul day (23:59:59; amended D27). A member who sang at the rehearsal on the day they left is still expected that day.
  - **Deactivation:** a filled `ayrilis_tarihi` on an **active** user deactivates them with that date. This works like `setMemberActive(false)`: sessions closed, unused invite links deleted. Because this locks a real person out, the preview lists every such person by name in a warning block (AC 24). On an already-inactive user, it changes the date.
  - **Rules (same as the UI):** `ayrilis_tarihi ≥ katilim_tarihi` (after applying both), neither in the future, nobody deactivates themselves, and the board can't change conductor or board users. A board user's row for a manager that would change nothing is `değişmeyecek`, not an error (amended D27). "Unchanged" compares dates by Istanbul day. Voice part and dues rate go through the same rules as the member form and `setDuesRate`.
  - **Former members (new in this phase):** a row whose email is **not** in the portal **and** has `ad`, `katilim_tarihi`, `ayrilis_tarihi` and `partisyon` creates a user with role `member`, inactive, no password, and `left_at` set. Such a user can never log in: there's no password and no invite, and inactive users are refused at login. Without them, five seasons of attendance and dues from people who left would have nowhere to go. A row with an unknown email but no `ayrilis_tarihi` is refused: `Bu e-postayla üye yok. Aktif üyeleri Üyeler sayfasından davetle ekle; eski üyeler için ayrılış tarihini de yaz.`
  - **Former members without a known email:** the step-1 docs tell the AI to write `ad.soyad@eski.invalid`. `.invalid` is a reserved TLD that can never receive mail. Later steps don't invent addresses: the user re-downloads `Üye listesini indir` after step 1, and the AI uses only addresses from it (amended D21).

- **D8. Terms (`donemler`).**
  - Rules: those of `termSchema`/`createTerm` (name 1–40, end ≥ start, at most 366 days, no overlap, unique name).
  - Natural key: `ad`. The same name with the same dates is "unchanged"; the same name with different dates is an error. Terms have no edit in the UI and the import doesn't add one; a wrong term is fixed by undoing the batch (D13).

- **D9. Rehearsals and attendance (`yoklama`): one row per person per rehearsal; rehearsals are created already closed.**
  - **The rehearsal key is `tarih` + `baslangic`.** A blank `baslangic` means the rehearsal of the nearest earlier row with the same `tarih`; with no such row it is `19:00` (amended D27). `bitis` defaults to `22:00`, Arkhe's usual weekday rehearsal, because paper sheets rarely have times. Counts (`eklenecek`, the button) are file rows; auto-absent rows appear only in the warning and the effect lines.
  - **Rehearsal-level columns** (`baslangic`, `bitis`, `tur`, `partiler`, `baslik`, `yer`) may be **blank on every row but the first** of that rehearsal, and are then inherited. If filled, they must equal the first row's values; otherwise the row is an error. That keeps the AI's job simple (repeat or leave blank) and catches mixed-up rows.
  - **Validation:**
    - The rehearsal follows `rehearsalSchema` (type, title ≤ 80, location ≤ 120, end after start, parts required and only for `partisyon`).
    - It must have **ended before now**. This is the one deliberate difference from `createRehearsal`, which refuses anything over 24 h old. It's allowed only here and only for closed, already-past rehearsals.
  - **Who may appear:** only people `isExpected` at that rehearsal. That means not the conductor; `joined_at ≤ start`; not left before the start; and, for a sectional, their part is in `partiler`. Anyone else is a row error: `Bu kişi bu çalışmada beklenmiyor (katılım/ayrılış tarihi, rol ya da partisyon).` This is the UI's manual-mark rule, made visible instead of silently skipped. The fix is in the member file, not here.
  - **`durum`:** `geldi`, `gec_geldi`, `mazeretli` or `gelmedi`. `not` (≤ 200) is allowed only with `mazeretli`, like the excuse note it is.
  - **Shape written** (so it looks exactly like a rehearsal run in the portal and then closed):
    - The rehearsal gets `opened_at = starts_at`, `closed_at = ends_at` and `created_by = importer`.
    - Each row becomes an attendance record with `method = manual`, `recorded_by = importer` and `recorded_at = starts_at`.
    - Then the normal close rule runs: **every expected person without a row is recorded `absent`/`auto`** at `ends_at`.
    - So the file may list everyone, or only the people who came. The preview says how many will be counted absent (AC 28).
  - **Conflicts:**
    - A rehearsal at the same start that was **created in the portal** (not imported) is an error: `Bu saatte portalda girilmiş bir çalışma var; yoklamasını o sayfadan düzelt.` We never merge into hand-entered data.
    - One that came from an earlier import is "unchanged" if every row matches, and an error if anything differs: `Bu çalışma daha önce farklı yoklamayla aktarıldı; önce o aktarımı geri al.` No silent overwrite.
  - **Marker:** imported rehearsals carry an `İçe aktarıldı` chip on the detail page, for managers (AC 35).

- **D10. Finance entries (`hareketler`) and the opening balance.**
  - **The opening balance is not an import type.** It is two amounts and a date that already have a form (`Finans › Ayarlar`, `setOpeningBalances`), and that form already refuses an opening date after existing entries. The docs and the page explain the one thing people get wrong:
    > When importing history, the opening balance is the cash and bank balance **on the first day of your records**, not today's balance. Otherwise the money is counted twice.
  - **Opening-date guard:** an entry dated before the opening date is a row error: `Tarih açılış bakiyesinden (<tarih>) önce. Önce Finans › Ayarlar'da açılış tarihini kayıtlarının başladığı güne çek ve o günkü bakiyeyi yaz.`
  - **Balance check (amended D19):** the previews of `hareketler` **and** `aidat-odemeleri` show the balance per account **before → after** (`Kasa ₺2.500,00 → ₺3.412,50`), with the step hint of D19, so the treasurer can compare it with the real bank statement before committing. This is the best single check that the AI didn't drop or double a row.
  - **Kinds:** `gelir`, `gider`, `virman`. `kategori` is required for income and expense, empty for transfers. `hedef_hesap` is required only for transfers and must differ from `hesap` (the UI's `Kaynak ve hedef hesap aynı olamaz.`, amended D26).
  - **Category `aidat` is refused here:** `Aidat ödemelerini 6. adımdaki aidat dosyasıyla aktar.` Dues need the member and the period (CHECK `fe_dues`).
  - **Sponsorship:** `sponsorluk` requires `sponsor` (CHECK `fe_sponsor`). It's matched to an existing sponsor by name, case- and accent-insensitively, the way `sponsors.name_key` works. If there's no match, the sponsor is **created** with that name, and the preview lists it as a warning: `Yeni sponsor oluşturulacak: …`. Making the treasurer pre-create twelve old sponsors by hand is admin burden for nothing.
  - **Events:** `etkinlik` is optional. It must match exactly one existing event by name after D6 normalisation (amended D20); zero or several matches is an error. Events are not created by the import.
  - **Idempotency key: `kayit_no`, required.** Finance rows have no natural key: two identical ₺50 tea expenses on the same day are legitimate. So every row carries a record number unique within the type, 1–40 characters from `A–Z a–z 0–9 - _ . /`. The AI is told to build it deterministically from the data: `20240905-1` = the first record of 5 September 2024 (ux §8). It is compared case-sensitively (D28). A re-import with the same number and the same content is "unchanged"; with different content it's an error. A number freed by an undo (D13) may be used again.
  - **Shape:** the same columns as a hand-made entry, `created_by = importer`, and the import marker (AC 35). `occurred_on` is the date from the file, so every report places it correctly.

- **D11. Dues (`aidat-donemleri`, `aidat-odemeleri`).**
  - **Periods:**
    - Rules: those of `periodSchema` (name 1–40, end ≥ start, `son_odeme ≥ baslangic`, reduced < full amount, no overlap, unique name).
    - Natural key: `ad`. Same name and same values → unchanged; different → error.
    - The UI's `Aylık toplu oluştur` stays the quicker way for a run of identical months, and the docs say so.
  - **Payments:**
    - The period is matched by name after D6 normalisation (`Eylul 2024` finds `Eylül 2024`; amended D20).
    - One row = **one member, one period, one payment**. The importer creates exactly the finance entry `recordDuesPayment` would: income, `dues`, `member_id`, `dues_period_id`, the account, the date, the description. There is no `payment_group_id`, because a multi-period payment is simply several rows.
    - Rules, the same as the UI's:
      - the member must owe the period (`owesPeriod`, with joined/left dates)
      - the role must be `member` or `board`
      - the amount must be at most what's still open, after earlier rows of the same file (the UI's `Kalan borç ₺<x>; daha fazlası girilemez.`; nothing open: `Bu dönemin borcu yok.`; amended D26)
      - the date must be on or after the opening date
    - The first rule is why member history comes first.
  - **Waivers (`islem = muaf`):**
    - The problem: after periods are imported for three past seasons, every member who doesn't appear in the payments will show as `Gecikti` for every old period. The choir forgave much of that long ago.
    - So a row with `islem = muaf` creates the same waiver as `setWaiver` (`Muaf tut`). `aciklama` is the reason (3–200 characters), and `tutar`, `tarih` and `hesap` must be empty.
    - It's refused if the period already has a payment from that member, in the DB or earlier in the file: `Bu döneme ödeme var; muafiyet verilemez.` A period the member already has a hand-made waiver for is `değişmeyecek` (D28).
    - The docs give the AI a ready instruction: "for each period I name, create a `muaf` row for every member who has no payment".
  - **Dues rate:** member history carries an optional `aidat_orani` (`tam` / `indirimli` / `muaf`). It goes through `setDuesRate`'s logic, so a reduced-rate member's historical payments are judged against the reduced amount. It is the **current** rate applied to all periods, as everywhere in the portal. Per-period historical rates are out of scope.
  - **Key:** `kayit_no` is required for payment and waiver rows, as in D10.

### Flow, safety and undo

- **D12. Two steps: `Kontrol et` (dry run), then `İçe aktar` (one transaction).**
  1. **Choose and check.** On `/ice-aktar/<slug>` the user picks a file and taps `Kontrol et`. The server parses and validates every row against the current DB and **writes nothing**: no batch row, no partial data, no sponsor.
  2. **Preview.**
     - Errors: a list of `Satır <n> · <sütun>: <mesaj>`, where `n` is the **line number in the file** (the header is line 1, so the first data row is 2), and a `Hataları kopyala` button that copies them (up to 1000) as plain text after a short instruction for the AI, ready to paste back into the same chat (amended D22, D23). `İçe aktar` isn't offered while any error exists.
     - Otherwise: the counts (`eklenecek`, `güncellenecek`, `değişmeyecek`), the warnings (deactivations, auto-absences, new sponsors, name mismatches, resulting balances, "this exact file was already imported on…"), and the first 50 effects in plain Turkish.
  3. **Commit.** `İçe aktar (<n> değişiklik)` opens a confirm dialog (amended D31), then sends **the same file again**. The browser keeps it, so the server stores nothing between steps. The server checks the hash equals the previewed one, re-validates everything **inside the write transaction**, and either writes all rows or none. If the DB changed in between and a row is now invalid, the user gets the new error list and nothing is written.
  4. **Result.** `İçe aktarıldı: <a> eklendi, <u> güncellendi, <s> değişmedi.`, with links to where the data now shows (AC 18).

  All-or-nothing is per file. There's no "import the good rows and skip the bad ones": half-imported history is worse than none, and the AI fixes the file in seconds.

- **D13. Undo: the latest batch, if nothing was built on it.**
  - AI conversions will contain mistakes that only show once the report is on screen ("why does Ahmet have 0% in 2023?"). Without undo, a wrong term or 400 wrong attendance rows would be permanent. So `/ice-aktar/gecmis` offers `Geri al` on the **most recent batch that is not yet undone**, globally, across types: a stack.
  - The stack rule makes dependencies trivial (a rehearsal batch can't be undone while a later batch may rely on it), and it matches how people work: import, look, undo, fix, re-import.
  - **Who:** the importer, or the conductor.
  - **What undo does:**
    - **Member history:** restores each changed user's previous `joined_at`, `left_at`, `is_active`, voice part and rate (stored at import), and deletes the former members it created. Deactivated people become active again but must log in anew, since their sessions are gone.
    - **Terms, rehearsals (with their attendance) and dues periods** created by the batch are deleted.
    - **Finance entries and dues payments** are **deleted** (amended D17). This happens only when every one of them is untouched, which the dependency check below guarantees. They were never confirmed as real money, and voiding would freeze the stack for ever (the voided rows would block deleting their periods). The batch row stays as the audit record. Their `kayit_no` becomes free.
    - **Waivers** created by the batch are removed, and freezes that no longer protect a live payment are dropped.
    - **Sponsors** created by the batch are deleted when nothing references them any more and they are unchanged; otherwise they stay, active.
  - **Refused when something was built on it in the portal since.** The message names the first conflict:

    | Batch type | Refused when… | Message |
    |---|---|---|
    | Member history | a changed user was edited since, or a created former member is referenced by any row | `<ad> bu aktarımdan sonra değişti ya da kullanıldı; geri alınamaz.` |
    | Rehearsals | an attendance row was corrected (`corrected_at`) or the rehearsal edited | `<tarih> çalışması bu aktarımdan sonra düzeltildi; geri alınamaz.` |
    | Finance, dues payments | an entry was corrected or voided by hand | `Kayıt <kayit_no> bu aktarımdan sonra değişti; geri alınamaz.` |
    | Rehearsals | an event points at the rehearsal (D28) | `<tarih> çalışmasına bir etkinlik bağlanmış; geri alınamaz.` |
    | Dues periods | any finance entry (voided or not) or override references the period | `<ad> dönemine ödeme girilmiş; geri alınamaz.` |
    | Dues periods | the period was edited by hand (D28) | `<ad> dönemi bu aktarımdan sonra değişti; geri alınamaz.` |

    When undo is refused, the user fixes things by hand like any other data.
  - **No time limit.** The dependency checks are the real guard.
  - Undo is one transaction and is logged on the batch (`Geri alındı · <ad> · <tarih>`).

- **D14. Import log, privacy and the backup hint.**
  - **What a batch row stores:** who, when, type, file name (≤ 120 characters, cleaned), file size, SHA-256, the counts (added, updated, unchanged), the undo fields, and the link to each written row, which the undo and the marker need. Not the file content and not the error list.
  - **Who sees it:** the log page `/ice-aktar/gecmis` is for managers.
  - **Backup hint:** the index page shows `Son yedek: <tarih>` (from `backup_runs`) with the line `Büyük bir aktarımdan önce Yedekleme › Şimdi gönder ile yedek al.`. It's a hint, not a gate: the conductor alone can send a manual backup, and blocking the treasurer on it would be admin burden.

- **D15. Where it lives and how people find it.**
  - **Pages:** the index `/ice-aktar` (`Veri içe aktar`), a page per type `/ice-aktar/<slug>`, and the log `/ice-aktar/gecmis`.
  - **No nav entry:** it's used a few evenings, then rarely. It's linked from `/profil` (manager section, next to `Yedekleme`), from `/yedek`, and from `Finans › Ayarlar` (next to the opening balance, because step 0 sends people there and back).
  - **`Üye listesini indir`:** a link on the index page downloads `arkhe-uyeler-<YYYY-MM-DD>.csv`, all users with `eposta;ad;partisyon;rol;durum;katilim_tarihi;ayrilis_tarihi` in the import formats. Paper sheets have names, not emails. The user gives this file to the AI together with their records so it can map "Ayşe D." to `ayse.demir@…`. It contains nothing a manager can't already see on `/uyeler`.

- **D16. The template pack: in the repo and on the page, from one source.**
  - **One definition per type.** Columns, required flags, formats, allowed values, examples and help text live in one TypeScript definition per type (`src/lib/import/`, @backend decides the shape). The parser, the page's column table, the downloadable files and the docs all come from it, so they can't drift. The e2e proves it (AC 6, 7).
  - **In the repo:** `docs/ice-aktarma/`:
    - `README.md`: Turkish. The order (D1), the general file rules (D3–D6), the opening-balance warning (D10), and "how to work with an AI": attach your records and `Üye listesini indir`, paste the prompt, check the preview, fix with `Hataları kopyala`.
    - `<n>-<slug>.csv`: a sample of 3–5 **fictional** rows (`ornek.com` / `eski.invalid` addresses, invented names), showing every column, a blank inherited cell (yoklama), a transfer (hareketler) and a waiver (aidat-odemeleri).
    - `<n>-<slug>.md`: the column table (`Sütun`, `Zorunlu`, `Biçim`, `İzin verilen değerler`, `Örnek`, `Açıklama`) and the AI prompt (§4.2).
  - **On the page:** `/ice-aktar/<slug>` shows the same table, the upload card with the tabs `Dosya seç` / `Metni yapıştır` (D18), and three buttons: `Örnek dosyayı indir` (the CSV), `Talimatı indir` (the `.md`), and `Yapay zekâ talimatını kopyala` (the prompt to the clipboard).

### 4.1 Columns and codes (the contract; @backend implements exactly this)

Common to every type: D3–D6. `*` = required. "Code" columns accept the canonical code, the app label or the English DB code (D6).

**1. `uyeler` (Üye geçmişi)**

| Column | Req. | Format / values | Notes |
|---|---|---|---|
| `eposta` | * | e-mail | Match key. |
| `ad` | for new former members | 2–80 characters | Existing users: check only, warning if different. |
| `katilim_tarihi` | for new | date | First day of membership. |
| `ayrilis_tarihi` | for new | date | Last day of membership. Fills in = deactivate (active user) or change date. |
| `partisyon` | for new | `soprano`, `alto`, `tenor`, `bas` | |
| `aidat_orani` |  | `tam`, `indirimli`, `muaf` | Current rate. |

**2. `donemler` (Çalışma dönemleri):** `ad`* (1–40), `baslangic`* (date), `bitis`* (date, may be future, ≤ 366 days after start).

**3. `yoklama` (Çalışmalar ve yoklama)**

| Column | Req. | Format / values | Notes |
|---|---|---|---|
| `tarih` | * | date | With `baslangic`: the rehearsal key. |
| `baslangic` |  | time, default `19:00` | Inherited when blank (D9). |
| `bitis` |  | time, default `22:00` | Must be after `baslangic`. |
| `tur` |  | `tutti` (default), `partisyon`, `genel_prova`, `konser` | |
| `partiler` |  | voice parts joined by `+`: `soprano+alto` | Required for, and only for, `partisyon`. |
| `baslik` |  | ≤ 80 characters | |
| `yer` |  | ≤ 120 characters | |
| `eposta` | * | e-mail of an existing or former member | |
| `durum` | * | `geldi`, `gec_geldi`, `mazeretli`, `gelmedi` | Also `gec` (the short label). |
| `not` |  | ≤ 200 characters | Only with `mazeretli`. |

**4. `hareketler` (Finans hareketleri)**

| Column | Req. | Format / values | Notes |
|---|---|---|---|
| `kayit_no` | * | 1–40, `A–Z a–z 0–9 - _ . /` | Unique within the type (D10). |
| `tarih` | * | date | ≥ opening date. |
| `tur` | * | `gelir`, `gider`, `virman` | |
| `kategori` | income/expense | income: `sponsorluk`, `bilet_satisi`, `bagis`, `hibe_destek`, `diger_gelir`. Expense: `kostum`, `salon_mekan`, `sef_korrepetitor_ucreti`, `nota_ve_telif`, `ulasim_ve_konaklama`, `festival_katilim_ucreti`, `organizasyon_tanitim`, `ikram`, `iade`, `banka_masrafi`, `diger_gider` | Must fit `tur`. `aidat` refused. Empty for `virman`. |
| `tutar` | * | amount (D5) | |
| `hesap` | * | `kasa`, `banka` | For a transfer: the source. |
| `hedef_hesap` | virman | `kasa`, `banka`, ≠ `hesap` | Empty otherwise. |
| `aciklama` |  | ≤ 200 characters | |
| `karsi_taraf` |  | ≤ 120 characters | |
| `sponsor` | sponsorluk | ≤ 120 characters | Matched or created (D10). Empty otherwise. |
| `etkinlik` |  | name of one existing event (D6-normalised match, D20) | Income/expense only. |
| `belge_linki` |  | `https://…`, ≤ 2000 characters | |

**5. `aidat-donemleri` (Aidat dönemleri):** `ad`* (1–40), `baslangic`* (date), `bitis`* (date, may be future), `son_odeme`* (date ≥ `baslangic`, may be future), `tutar`* (amount), `indirimli_tutar` (amount < `tutar`).

**6. `aidat-odemeleri` (Aidat ödemeleri ve muafiyetler)**

| Column | Req. | Format / values | Notes |
|---|---|---|---|
| `kayit_no` | * | as in `hareketler` | Its own namespace. |
| `islem` |  | `odeme` (default), `muaf` | |
| `eposta` | * | e-mail of an existing or former member | |
| `donem` | * | name of an existing dues period (D6-normalised match, D20) | |
| `tutar` | odeme | amount, ≤ open amount | Empty for `muaf`. |
| `tarih` | odeme | date, ≥ opening date | Empty for `muaf`. |
| `hesap` | odeme | `kasa`, `banka` | Empty for `muaf`. |
| `aciklama` | muaf | ≤ 200; for `muaf` 3–200 (the reason) | |

Sample (`3-yoklama.csv`, fictional; all sample dates are before 2025-09-01 and don't overlap seeded terms or periods, amended D24):

```
tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not
2024-10-08;19:00;22:00;tutti;;;Mülkiye Salonu;ayse.demir@ornek.com;geldi;
2024-10-08;;;;;;;mehmet.kaya@ornek.com;gec_geldi;
2024-10-08;;;;;;;zeynep.ak@eski.invalid;mazeretli;Sınav haftası
10.10.2024;20:00;21:30;partisyon;soprano+alto;;;ayse.demir@ornek.com;geldi;
```

### 4.2 The AI prompt (skeleton; each type's `.md` fills in its table)

> Aşağıdaki verilerimi Koro Arkhe portalının **<tür adı>** içe aktarma biçimine çevir.
>
> Kurallar:
> - Çıktı yalnızca bir CSV olsun, tek bir kod bloğunun içinde. Ayırıcı noktalı virgül (`;`), kodlama UTF-8.
> - İlk satır tam olarak şu başlık olsun: `<başlık satırı>`. Başka sütun ekleme, sütun adlarını değiştirme.
> - Her kayıt bir satır. Tarihleri `YYYY-AA-GG` (örnek `2025-10-07`), saatleri `SS:DD` (örnek `19:00`), tutarları binlik ayırıcı ve ₺ olmadan, kuruşu virgülle yaz (örnek `1250,50`).
> - Kod sütunlarında yalnızca aşağıdaki değerleri kullan. <sütun tablosu ve kodlar>
> - Bilmediğin bir değeri uydurma. Boş bırak. Zorunlu bir alan bilinmiyorsa o satırı CSV'ye koyma.
> - (1. adım, `uyeler`) Kişileri ekteki üye listesindeki e-postayla eşleştir. Listede olmayan, ayrılmış bir üye için `ad.soyad@eski.invalid` biçiminde bir adres yaz.
> - (3. ve 6. adım) Kişileri yalnızca ekteki üye listesindeki e-postalarla eşleştir; yeni adres uydurma. Listede olmayan kişinin satırını atla ve Atladıklarım listesine yaz. (Eski üyeler `@eski.invalid` adresleriyle listededir; 1. adımdan sonra listeyi yeniden indir.)
> - CSV'den sonra, kod bloğunun dışında, `Atladıklarım` ve `Tahmin ettiklerim` başlıklarıyla emin olamadığın ya da atladığın satırları gerekçesiyle listele.

(amended D21; the final per-type prompts are UX's §8 texts.)
>
> Verilerim:
> (buraya yapıştır ya da dosyayı ekle)

## 5. User stories and acceptance criteria

Copy in backticks is the exact Turkish UI text; @ux may polish it and I'll settle the final wording in `po-decisions.md`. The e2e notes say how each AC is checked.

**Seed and fixtures.** The seed is unchanged except that the demo users' `joined_at` stay recent. Each e2e test arranges its own state:
- users with the fictional emails of the samples (UX's cast: `ayse.demir@ornek.com`, …), an opening balance, an event, a sponsor
- fixture CSVs **generated in code** (`e2e/import.mjs`, passed to `setInputFiles` as Buffers), including deliberately broken ones and one Windows-1254 file. No fixture CSVs are committed; the only CSVs on disk are the shipped `docs/ice-aktarma/*` (amended D24)
- every fixture and sample date is before 2025-09-01, clear of the seeded terms, periods and rehearsals (amended D24)

### S1. Access and entry (şef, board)

*As the treasurer I want one place for bringing in the old records, which members can't touch.*

1. **Managers only, on the server.**
   - sef@ and yk@ get 200 on `/ice-aktar`, the six `/ice-aktar/<slug>` pages and `/ice-aktar/gecmis`. korist@ is redirected to `/`, and a logged-out request goes to the login page.
   - As korist@, the check, import and undo actions return `Bu işlem için yetkin yok.` and write nothing.
   - The template, prompt and member-list download routes return no file for korist@ (the JSON 403 of every manager route) and redirect logged-out requests to login (amended D27).

   (e2e: navigate per user; invoke the actions as korist@ through the test helper and compare table counts before and after; fetch each download route.)
2. **Entry points** (D15).
   - `/profil` (manager section), `/yedek` and `/finans/ayarlar` each show a `Veri içe aktar` link for sef@ and yk@. korist@'s `/profil` doesn't.
   - Neither the sidebar nor the bottom bar gains an entry.

   (e2e: links per user; nav link counts unchanged at 375 and 1280 px.)
3. **Index page `/ice-aktar`.** It has:
   - the title `Veri içe aktar`
   - the intro `Eski kayıtlarını (Excel, Sheets, kâğıt) toplu olarak portala aktar. Önce dosyanı kontrol ederiz, hiçbir şey yazılmaz; sonra tek seferde aktarırsın.`
   - the backup line of D14 (`Son yedek: <tarih>`, or `Henüz yedek yok.`) with a link to `/yedek`
   - `Üye listesini indir`
   - the step `0 · Açılış bakiyesi`, showing `Açılış: <tarih> · Kasa ₺… · Banka ₺…` or `Açılış bakiyesi girilmemiş.`, with `Ayarlar'a git`
   - six numbered cards in the D1 order, each with its title, a one-line description, and the state `Henüz aktarılmadı` or `Son aktarım: <tarih> · <ad> · <n> satır`, linking to the type page
   - a `Sıradaki` chip on the first card, in D1 order, with no live import and a number above every imported type's number; none when all are imported (amended D31)
   - a link `İçe aktarma geçmişi`

   (e2e: the order and texts; the card state and the `Sıradaki` chip after one import.)
4. **Member list download** (D15). `Üye listesini indir` returns `arkhe-uyeler-<YYYY-MM-DD>.csv`: UTF-8 with BOM, `;`, CRLF, `csvCell`-safe, and the header `eposta;ad;partisyon;rol;durum;katilim_tarihi;ayrilis_tarihi`.
   - One row per user, with dates as `YYYY-MM-DD` (Istanbul), `partisyon` as the canonical code, `rol` as `sef`/`yonetim`/`korist`, and `durum` as `aktif`/`ayrildi`.
   - A user named `=HYPERLINK(…)` doesn't start a formula.

   (e2e: download and parse; compare with the DB.)

### S2. The template pack

*As a volunteer I want to give the AI one text and get back a file the portal accepts the first time.*

5. **Type page.** `/ice-aktar/<slug>` shows:
   - the step number and title
   - a short explanation
   - the column table (`Sütun`, `Zorunlu`, `Biçim`, `İzin verilen değerler`, `Örnek`), one row per column of the definition
   - `Örnek dosyayı indir` (`<n>-<slug>.csv`)
   - `Talimatı indir` (`<n>-<slug>.md`)
   - `Yapay zekâ talimatını kopyala`, which copies the prompt and shows the toast `Talimat kopyalandı.`
   - the upload card with the tabs `Dosya seç` / `Metni yapıştır` (textarea labelled `CSV metni`) and `Kontrol et` (amended D18)

   At 375 px the table becomes stacked cards with no horizontal scroll.

   (e2e: per slug; clipboard read with permission; overflow check.)
6. **Repo docs = page = parser** (D16).
   - `docs/ice-aktarma/README.md` exists, along with `<n>-<slug>.csv` and `.md` for all six types.
   - The downloaded sample and `.md` are byte-identical to the repo files.
   - Every column name of each type's definition appears in its `.md` table and in its prompt, and every canonical code appears in the `.md`.
   - The README contains the D1 order and the opening-balance warning of D10.

   (e2e: file reads and comparisons.)
7. **The samples import cleanly.** With the samples' fictional users and the prerequisites arranged, the six samples are checked and imported in D1 order. Each check has 0 errors, each import succeeds, and every documented edge in the samples behaves as documented: the inherited blank cells, a transfer, a sponsorship with a new sponsor, a waiver and a former member. The fenced `csv` example in each `.md` also checks with 0 errors against the arranged cast (amended D24).
   (e2e: one end-to-end run.)
8. **The prompt is complete.** Each copied prompt contains:
   - the exact header line of its type
   - the `;` and UTF-8 rule
   - the date, time and amount rules with the examples `2024-10-08`, `19:00` and `1250,50`
   - every canonical code of its code columns
   - the "don't invent" rule
   - the `@eski.invalid` rule appropriate to the type: step 1 invents them for former members; steps 3 and 6 use only addresses from the re-downloaded member list (amended D21)
   - the "list what you skipped" rule

   (e2e: text assertions on the clipboard content.)

### S3. File format (D3–D6)

*As a volunteer I want the portal to accept what Excel and the AI produce, and to tell me exactly what to fix when it can't.*

9. **Encoding, delimiter, line endings.**
   - The same data saved as UTF-8 with BOM, UTF-8 without BOM, with `;` and with `,` (a quoted cell containing `;` or `,`), and with LF and CRLF, produces identical previews.
   - A Windows-1254 file is refused as a whole: `Dosya UTF-8 değil. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan UTF-8 iste.`
   - A quoted cell with a line break is refused: `Satır <n>: Hücrede satır sonu olamaz.`
   - An `.xlsx` file is refused: `Bu bir Excel dosyası. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan CSV iste.` (D26)
   - The same data pasted into `Metni yapıştır` produces the same preview as the uploaded file, and the batch is logged as `yapistirilan-metin.csv` (amended D18).

   (e2e: fixture variants, previews compared; paste via `fill`.)
10. **Header.** Columns in any order and in any case or Turkish spelling (`EPosta`, `KATILIM_TARIHI`, `Katılım tarihi`; amended D27) are accepted, and optional columns may be omitted. Each of these is refused with no row checking:
    - an unknown column: `Bilinmeyen sütun: "e-posta". Geçerli sütunlar: eposta, ad, …`
    - a duplicate column: `"eposta" sütunu iki kez var.`
    - a missing required column: `Zorunlu sütun eksik: "durum".`

    (e2e: one fixture each.)
11. **Limits and empty files.** Each of these is refused before row checking:
    - over 1,048,576 bytes: `Dosya en fazla 1 MB olabilir.` (checked in the browser and on the server; `bodySizeLimit: "1100kb"`; amended D25)
    - over 5000 data rows: `En fazla 5000 satır aktarılabilir; dosyayı (örneğin sezonlara) böl.`
    - a header-only or empty file: `Dosyada veri satırı yok.`

    Blank and all-empty lines are skipped, and line numbers still match the file.

    (e2e: generated fixtures; an error on line 7 after a blank line 4 is reported as `Satır 7`.)
12. **Dates and times** (D4).
    - `2025-10-07`, `07.10.2025` and `7.10.2025` are the same day.
    - `2025-02-30`, `07/10/2025`, `7 Ekim 2025` and `25-10-07` give `Tarihi 2025-10-07 ya da 07.10.2025 biçiminde yaz.` (or `Bu tarih takvimde yok.` for the impossible day).
    - Tomorrow gives `Gelecek bir tarih olamaz.` (except `bitis`/`son_odeme`), and `1999-12-31` gives `Tarih 2000'den önce olamaz.`
    - `19:00`, `9:30` and `19:00:00` are accepted. `7 pm` and `25:00` give `Saati 19:30 biçiminde yaz.`

    (e2e: a `yoklama` fixture with one case per row; the per-row messages.)
13. **Amounts** (D5).
    - `1250`, `1250,5`, `1250,50` and `1250.50` are accepted (125000, 125050, 125050, 125050 kuruş after import).
    - Each of `1.250`, `1.250,00`, `1,250.00`, `₺1250`, `1250 TL`, `-50`, `0`, `12,345` and `abc` is refused with `Tutarı 1250,50 biçiminde yaz: binlik ayırıcı, ₺ ve boşluk yok.` (`0` gets the UI's `Tutar sıfırdan büyük olmalı.`).
    - Over ₺10.000.000,00 is refused with the UI's maximum message.

    (e2e: a `hareketler` fixture; DB kuruş after commit.)
14. **Codes** (D6).
    - `Ulaşım ve konaklama`, `ULASIM_VE_KONAKLAMA`, `ulaşım ve konaklama`, `travel` and `ulasim_ve_konaklama` all map to `travel`. `Geç geldi`, `gec_geldi`, `gec` and `late` map to `late`. `Bas` and `bass` map to `bass`.
    - An unknown value gives `"seyahat" geçerli değil. Şunlardan biri olmalı: <canonical codes, comma-separated>.`

    (e2e: fixtures; DB values after commit.)

### S4. Check, preview and commit (D12)

*As the treasurer I want to see exactly what will happen before anything is written, and to get all of it or none of it.*

15. **The check writes nothing.** After `Kontrol et`, with errors or without, the row count of every table is unchanged: no batch, no sponsor, no user change, and no session deleted.
    (e2e: count all tables before/after for a clean and a broken file of each type.)
16. **The error preview.**
    - The summary reads `<n> satır okundu · <e> hata. Hiçbir şey yazılmadı. Dosyayı düzeltip yeniden yükle.`
    - Then a list of `Satır <n> · <sütun>: <mesaj>`, in file order. The server returns at most 1000 errors and the true count. The first 100 are shown, followed by `ve <k> hata daha (ilk 1000'i kopyalanır)`. A row with several errors shows each one.
    - `Hataları kopyala` copies the AI preface of D22, a blank line, then every returned error, one per line, with the toast `Hatalar kopyalandı.` Above 1000 errors the copied text ends with `İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.` There is no `.txt` download (amended D22, D23).
    - There is no `İçe aktar` button.

    (e2e: a fixture with 120 errors → 100 shown + `ve 20 hata daha …`; the clipboard has the preface, a blank line and 120 error lines; a 1200-error fixture → 1000 lines plus the closing line.)
17. **The clean preview.**
    - The summary reads `<n> satır okundu · <a> eklenecek · <u> güncellenecek · <s> değişmeyecek`.
    - Then the warnings block (`Dikkat`) with the type's warnings (AC 24, 28, 30, D7). Deactivations come first and are never collapsed. Name mismatches are one line, `<k> kişinin adı portaldakinden farklı (ad değişmez).`, with `Listeyi göster` (amended D31). Then the button `İçe aktar (<a + u> değişiklik)`, then up to 50 effects in plain Turkish (`Ayşe Demir: katılım 19 Eki 2026 → 3 Eyl 2019`, `8 Eki 2024 19:00 Tutti: 31 kişi, 4 Gelmedi (listede yok)`).
    - When everything is unchanged: `Değişecek bir şey yok; bu dosyadaki her şey zaten portalda.`, and no button.
    - When the same SHA-256 was imported before and not undone, an extra warning: `Bu dosya <tarih> tarihinde <ad> tarafından aktarılmıştı.`

    (e2e.)
18. **Commit and result.**
    - `İçe aktar` writes everything and shows `İçe aktarıldı: <a> eklendi, <u> güncellendi, <s> değişmedi.`, with type-specific links: `Raporlar`, `Çalışmalar`, `Hareketler`, `Aidat`, `Üyeler`, `Finans raporu`.
    - One batch row is logged (D14) with the file name, size, SHA-256 and counts, and **no file content** (no column holds the CSV text).
    - Two errors that leave nothing written:
      - a different file sent with the previewed hash: `Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.`
      - a DB change between check and commit that invalidates a row (for example the opening date moved later): the new error list.
    - `İçe aktar` always opens the confirm of D31 (`<n> değişiklik aktarılsın mı?`, the type and file name, the deactivation line when relevant, `Vazgeç` / `İçe aktar`). A double tap creates one batch.
    - After a `uyeler` import, the result also shows `Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede.` with the download button (amended D21).

    (e2e: commit; inspect the batch row and the schema; the swapped file and two concurrent commits via a hand-built server-action request, because the UI resets the preview on a new pick (amended D25); move the opening date between steps.)
19. **All-or-nothing.** A commit that fails part-way leaves no row of that batch in any table. This includes the batch row itself, created users, sponsors, rehearsals, attendance and entries. The test uses a test-only fault hook, the cookie `arkhe_e2e_import_fault=<n>`, read only when `NODE_ENV !== "production"` and `DATABASE_URL` starts with `file:` (amended D25).
    (e2e: hook at row 50 of a 100-row file → all counts unchanged; `e2e:prod`: with the cookie set, the import succeeds in full.)
20. **Idempotent re-import and in-file duplicates.**
    - Importing the same file twice: the second check is all `değişmeyecek`, and the DB is unchanged.
    - The same natural key twice in one file is refused on the later line with `Satır <m> ile aynı kayıt.` The natural keys are email (uyeler), name (donemler, aidat-donemleri), rehearsal + email (yoklama) and `kayit_no` (hareketler, aidat-odemeleri).
    - Re-importing a key with **different** content gives the type's conflict error (D8–D11).

    (e2e: per type.)

### S5. Behaviour per type

*As the person who kept the records I want each kind of record to land where the UI would put it, with the same rules.*

21. **Member history: updates** (D7).
    - A file with an existing member's email and `katilim_tarihi = 2019-09-03` sets `joined_at` to that day's Istanbul start. `partisyon` and `aidat_orani` change likewise, and a blank cell leaves the value as it is.
    - `ad` differing from the portal name gives the warning `Ad portaldakinden farklı: "<dosya>" ↔ "<portal>"` (inside the collapsed list of D31), and the name stays.
    - Afterwards `/uyeler/<id>` shows the new date, and past dues periods from 2019 on are now owed by that member on `/finans/aidat`.

    (e2e.)
22. **Member history: dates and own row.**
    - `ayrilis_tarihi` before `katilim_tarihi` gives `Ayrılış tarihi katılım tarihinden önce olamaz.` A future date gives AC 12's message.
    - A row for the importer themselves with `ayrilis_tarihi` gives `Kendini pasifleştiremezsin.`
    - An unknown email without `ayrilis_tarihi` gives D7's message.

    (e2e.)
23. **Former members** (D7).
    - A row with an unknown email, `ad`, `katilim_tarihi`, `ayrilis_tarihi` and `partisyon` creates a user with role `member`, `is_active = 0`, no password hash, `left_at` at 23:59:59 of that Istanbul day (amended D27), and no invite.
    - The user appears under the inactive members on `/uyeler` and can't log in: the login form gives the normal wrong-credentials message, and there's no reset path from the import.
    - The same row missing `partisyon` gives `Eski üye için partisyon gerekli.`

    (e2e: arrange, import, try to log in, inspect the DB.)
24. **Deactivation by import.**
    - `ayrilis_tarihi` on an **active** member puts a warning in the preview: `<k> kişi pasifleştirilecek ve oturumları kapatılacak: <ad>, <ad>, …` (all names).
    - After commit the member is inactive with that `left_at`, their sessions are gone (their open browser is logged out on the next request) and their unused invite links are deleted, exactly like `Pasifleştir`.
    - On an inactive member, it just changes the date, with no warning.

    (e2e: two contexts; the member's page redirects to login after the import.)
25. **Member history: board permission parity.**
    - Logged in as yk@, a row for sef@ or another board user that **would change something** gives `Bu kişiyi yalnızca koro şefi değiştirebilir.` The same row with nothing to change is `değişmeyecek` (amended D27).
    - The same file as sef@ passes.
    - Board users see the note `Yönetim kurulu olarak yalnızca korist satırlarını değiştirebilirsin; şef ve yönetim üyelerinin satırlarını koro şefi aktarır.` on the `uyeler` page.

    (e2e.)
26. **Terms** (D8).
    - A `donemler` file creates the terms, and they appear in the `/raporlar` period picker.
    - An overlap gives `Dönemler çakışamaz.` (also between two rows of the file), and over 366 days gives `Bir dönem en fazla bir yıl olabilir.`
    - The same name with other dates gives `Bu adla farklı tarihli bir dönem var.`

    (e2e.)
27. **Rehearsals: what gets written** (D9). After importing a `yoklama` file with one tutti and one sectional rehearsal:
    - Each rehearsal exists with the file's type, parts, title, location, start and end, and with `opened_at = starts_at`, `closed_at = ends_at` and `created_by` = the importer.
    - Each file row is an attendance record with `method = manual`, `recorded_by` = the importer and `recorded_at = starts_at`.
    - Every other `isExpected` person has `absent`/`auto` at `ends_at`.
    - Blank inherited cells take the first row's values. Default times are `19:00`–`22:00` Istanbul.
    - The rehearsals appear in the past list with their counts, and nothing shows a live code or an `Aç` button.

    (e2e: DB and UI inspection.)
28. **Rehearsals: rules and conflicts** (D9). Each of these gives the D9 message:
    - a person who joined after the date, left before it, is the conductor, or is outside a sectional's parts
    - a rehearsal ending after now
    - `partiler` on a tutti, or a sectional without `partiler`
    - a `not` on `geldi`
    - a later row of the same rehearsal with a different `tur`
    - a portal-created rehearsal at the same start
    - an earlier imported rehearsal with different rows

    The preview warns `<k> çalışmada toplam <m> beklenen kişi listede yok; Gelmedi sayılacak.`

    (e2e: one fixture with each case.)
29. **Finance entries** (D10). A `hareketler` file with an income, an expense, a transfer, a sponsorship with an existing and a new sponsor, and an entry for an existing event:
    - creates entries with exactly the columns a hand-made entry has, `created_by` = the importer
    - matches the sponsor case- and accent-insensitively, and creates the new one (listed in the warning)
    - links the event (matched after D6 normalisation, amended D20), while an unknown or ambiguous event gives `Bu adla bir etkinlik yok.` / `Bu adla birden çok etkinlik var; etkinliği adından ayırt et.`
    - refuses `aidat` with D10's message, `kategori` on a transfer with `Virmanda kategori olmaz.`, and `hedef_hesap = hesap` with the UI's `Kaynak ve hedef hesap aynı olamaz.` (amended D26)

    (e2e.)
30. **Opening date and balances** (D10).
    - With the test DB's opening date (the fixture's date, amended D25), a row dated before it gives D10's opening-date message.
    - After the opening date is moved earlier in Ayarlar, the same file passes.
    - The clean preview shows `İçe aktarımdan sonra` with `Kasa ₺<before> → ₺<after>` and `Banka ₺<before> → ₺<after>`, plus the step-4 hint of D19, and after commit `/finans` shows exactly the `after` balances (amended D19).

    (e2e.)
31. **Dues periods** (D11).
    - An `aidat-donemleri` file creates periods with the same fields the UI form writes, and they appear on `/finans/aidat` and in its period picker.
    - An overlap gives `Bu tarihler <ad> dönemiyle çakışıyor.`, a reduced amount ≥ the full one gives `İndirimli aidat tam aidattan az olmalı.`, and `son_odeme` before `baslangic` gives `Son ödeme başlangıçtan önce olamaz.`

    (e2e.)
32. **Dues payments** (D11).
    - An `odeme` row creates one income/`dues` entry with `member_id`, `dues_period_id`, the account, the date and the description, and no `payment_group_id`. The member's status for that period becomes `Ödendi` (or `Kısmi`) on `/finans/aidat` and on their own `Aidatım`.
    - A member who doesn't owe the period (joined later, left before, or the conductor) gives `Bu kişi bu dönemden sorumlu değil.` A payment over the open amount, counting earlier rows of the file, gives the UI's `Kalan borç ₺<x>; daha fazlası girilemez.`, and a period with nothing open gives `Bu dönemin borcu yok.` (amended D26).
    - A reduced-rate member is judged against the reduced amount.
    - The period is found by its D6-normalised name (`Eylul 2024` → `Eylül 2024`); no match gives `Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında.` (amended D20).
    - The clean preview shows the before → after balances with the step-6 hint `Şimdi banka ekstrenle tutmalı.`, and after commit `/finans` shows the `after` balances (amended D19).

    (e2e.)
33. **Waivers** (D11).
    - A `muaf` row with a reason creates the same `waiver` override as `Muaf tut`, and the period shows `Muaf` for that member.
    - A `muaf` row with `tutar` gives `Muafiyet satırında tutar, tarih ve hesap boş olmalı.`, one without a reason gives `Neden yaz (en az 3 karakter).`, and one for a period with a payment (in the DB or earlier in the file) gives `Bu döneme ödeme var; muafiyet verilemez.`

    (e2e.)

### S6. Imported data looks like normal data

*As the board I want the reports to simply show the past, with no second kind of data to learn.*

34. **Reports agree with hand-entered data.** The same rehearsal and attendance are produced two ways: (a) created in the portal, marked by hand, closed; (b) imported. With dates and people aligned, the two give the same:
    - `/raporlar` rate and counts for the term, and the `/raporlar/csv` rows
    - the member's own attendance history
    - the `/calismalar/<id>` summary

    Likewise, an imported entry and a hand-made entry give the same `/finans/rapor` totals and `/finans/hareketler` row (apart from the marker). An imported dues payment and a `recordDuesPayment` payment give the same `/finans/aidat` status and `/finans/aidat/csv` row.

    (e2e: paired comparisons.)
35. **Markers, for managers only.**
    - An imported rehearsal's detail page shows the chip `İçe aktarıldı`.
    - An imported finance entry's detail page shows `İçe aktarıldı · Kayıt no <kayit_no>`.
    - korist@ sees neither on their own views.
    - Nothing else changes visually, and imported rows aren't excluded from any list, report or CSV.

    (e2e.)
36. **Older rehearsals are reachable.** The past list on `/calismalar` keeps showing 60 per page and gains `Daha eski` / `Daha yeni` links, so imported seasons can be browsed. With 130 past rehearsals arranged, there are three pages, newest first.
    (e2e.)

### S7. Log and undo (D13, D14)

*As the person who made the mistake I want to take the last import back and try again.*

37. **Log page `/ice-aktar/gecmis`** (`İçe aktarma geçmişi`).
    - Batches are listed newest first, 50 per page. Each row shows `<tarih saat> · <ad> · <tür>`, the file name, `<a> eklendi · <u> güncellendi · <s> değişmedi`, the first 12 characters of the SHA-256, and either `Aktarıldı` or `Geri alındı · <ad> · <tarih>`.
    - Empty state: `Henüz içe aktarma yapılmadı.`
    - korist@ is redirected (AC 1).

    (e2e.)
38. **Undo: who and which.**
    - `Geri al` is shown only on the latest not-undone batch, and only to its importer and the conductor.
    - It opens a confirm: `Bu içe aktarma geri alınsın mı?`, then `<a> eklenen kayıt silinir, <u> güncellenen kayıt eski hâline döner.` (for the two finance types also `İçe aktarılan hareketler tamamen silinir; bakiyeler aktarım öncesine döner.`), then `Vazgeç` / `Geri al` (amended D17). Success shows the toast `İçe aktarma geri alındı.`
    - The server refuses a batch that isn't the latest with `Önce daha sonraki içe aktarmayı geri al.` and another manager's batch with `Bu içe aktarmayı yalnızca yapan kişi ya da koro şefi geri alabilir.`

    (e2e: two batches; yk@ can't undo sef@'s; the older one is refused.)
39. **Undo: effects per type** (D13). After undo:
    - **Member history:** each changed user's previous `joined_at`, `left_at`, `is_active`, voice part and rate are restored, and the former members it created are deleted.
    - **Terms, rehearsals with attendance, and dues periods:** deleted.
    - **Finance entries and dues payments:** deleted. They no longer appear in `Hareketler` at all, balances return to before, and their `kayit_no` can be imported again (amended D17).
    - **Waivers:** removed, and freezes that no longer protect a live payment are dropped.
    - **Created sponsors:** deleted when unreferenced and unchanged; otherwise kept, active.
    - **The stack keeps working:** after undoing a payments batch, the dues-periods batch beneath it can be undone, and so on down to member history.
    - Re-checking the same file shows everything as `eklenecek` again.

    (e2e: per type, with DB snapshots before import and after undo compared, apart from the kept batch rows; one run imports steps 1–6 and undoes all six in reverse order.)
40. **Undo refused when something was built on it** (D13), with the D13 messages and nothing changed:
    - an imported attendance row corrected by hand
    - an imported entry voided or corrected by hand
    - a member edited on `/uyeler/<id>` after a member-history import
    - a dues period that received a hand-entered payment, or was edited by hand
    - an event linked to an imported rehearsal (D28)

    (e2e: one case each.)

### S8. Live-data safety, quality and the test round

41. **Additive migration.**
    - `drizzle/0009_phase8b_import.sql` (the number follows Phase 8's) only creates tables and indexes. It does not alter, rebuild or drop any existing table.
    - `npm run db:migrate` on a copy of a Phase 8 database succeeds, and `db:check` passes.
    - All Phase 1–8 e2e tests still pass unchanged.

    (script: grep the SQL for `ALTER`/`DROP`/`__new_`; migrate a snapshot; full `npm run e2e`.)
42. **Constraints back the rules** (for @dba to design):
    - the batch `type` and status CHECKs
    - the undo fields set together
    - the counts as integers ≥ 0
    - the SHA-256 as 64 hex characters
    - `kayit_no` unique per type among non-undone items
    - each item row with at most one target column set, and it's the one its kind requires (amended D28)
    - FKs `restrict` to `users`

    An invalid direct write fails at the DB. Every multi-row insert of the import is chunked at ≤ 999 bound parameters per statement (D29; a review checklist item).

    (e2e: a few direct inserts that must throw.)
43. **Phone, themes, accessibility.**
    - At 375 px, in light and dark, these pages have no horizontal scroll and their controls are ≥ 44 px:
      - `/ice-aktar`
      - each type page
      - a preview with 100 errors
      - a clean preview
      - the result
      - `/ice-aktar/gecmis`
    - The file input has a visible label, `Dosya seç (.csv)`, and the paste textarea the label `CSV metni` (amended D18). The preview summary is announced (`role="status"`) and the error list is a real list. The dialogs have accessible names, and focus is visible.
    - Colours come from tokens only (grep for raw hex). There are no console errors or hydration warnings.

    (e2e + grep.)
44. **Performance at our scale.** On the dev server:
    - A 5000-row `yoklama` file (about 140 rehearsals × 36 people) is checked in under 15 s and imported in under 30 s.
    - A 2000-row `hareketler` file is checked in under 10 s.
    - The index and log pages answer in under 1 s with 50 batches.

    The commit uses the few-round-trip path (snapshot reads in one batch, writes in one or a few batches inside the same write transaction), so it stays within limits in **either** function region, `arn1` or `iad1` (amended D30). The README gets a note: "split large files per season".

    (e2e timing, loose; the generator script lives in `e2e/`.)
45. **Test round.**
    - `npm run e2e` is green, with new files `e2e/phase8b-a-format.mjs`, `e2e/phase8b-b-types.mjs` and `e2e/phase8b-c-undo.mjs` (names may differ). The runner pattern in `e2e/run.mjs` becomes `/^phase\d+[a-z]?-.*\.mjs$/` so they actually run (amended D25).
    - The repo `README.md` says that `npm run e2e` and `db:reset` wipe local import, board and budget rows (D33).
    - `npm run e2e:prod` is green, including `/ice-aktar` refusing korist@ and the fault hook refused in production mode.
    - `npm run lint` and `npm run typecheck` are clean.
    - The results are saved to `design/phase-8b/e2e-results.txt`.

## 6. Out of scope (explicitly)

- **Types not covered:**
  - homework and submissions
  - repertoire and links
  - events (only referenced)
  - cancelled rehearsals
  - excuses filed by members (`method = self`); imported excuses are manager marks
  - live check-ins (`qr`/`code`)
- **Users:**
  - creating active users, who still come through invites only
  - roles other than `member` for former members
  - phone numbers
  - several membership spells per person (left and came back): use the first `katilim_tarihi`, and the gap shows as absences or is handled with dues waivers
  - per-period historical dues rates
  - historical voice-part changes
- **Formats:**
  - XLSX/ODS/Google Sheets API
  - (pasting text is now **in** scope, amended D18)
  - slash dates, two-digit years, thousands separators in amounts
  - multi-line cells
- **Flow:**
  - partial imports (skip bad rows)
  - editing rows in the browser
  - storing files
  - undoing anything but the latest batch
  - scheduled or API imports
  - importing into another choir's format
- **UI additions:** edit or delete for terms, outside undo.
- **Data cleanup:** merging duplicate people, and correcting live-period data (that stays in the normal UI).
- The Phase 7 backlog (`phase-7/review-po.md` §5) stays there. Phase 8b only picks the past-list paging (AC 36), because without it the imported seasons can't be browsed.

## 7. Open questions for the team

All answered; see `po-decisions.md` D17–D34.

1. **@dba:**
   - Confirm that the markers and undo can live entirely in new tables (`import_batches`, `import_items` with a target table + id, before-values JSON for member rows, `kayit_no`), with no new column on `rehearsals` or `finance_entries`.
   - Confirm that the former-member insert passes the existing `users` CHECKs (`left_matches_active`, `left_after_joined`).
2. **@backend:**
   - the parser (own code vs. a tiny MIT library)
   - how a 5000-row commit fits one Turso transaction within the Vercel Hobby limit
   - whether to reuse the existing action functions' inner logic as pure validators, which is the only acceptable way to meet constraint 3
3. **@ux:** where the warnings and errors sit on a 375 px preview, and whether the type page is one page (upload → preview → result in place) or three. My default is one page with sections.
4. **@ui:** a clipboard fallback when `navigator.clipboard` is refused (select-all textarea).

## 8. Open risks

1. **A wrong file deactivates real people** (AC 24). Mitigations:
   - the named warning in the preview
   - sessions can be restored by logging in again
   - undo restores `is_active`

   A member locked out by mistake on a Saturday is the worst realistic outcome; acceptable.
2. **The AI invents data.** The prompt forbids it and asks for a "skipped rows" list, and the preview shows effects in words. There remains the risk that a plausible-looking but wrong file is imported. The balance check (AC 30) and the reports are the human check, and undo is the fix.
3. **Opening balance double-counted** (D10). This is the most likely finance mistake. It's prominent in the README, on step 0 and in the balance preview line.
4. **Old dues show as debt.** After importing periods, historical non-payers show `Gecikti`. Waiver rows (D11) solve it but must be generated. The README says so in its own paragraph.
5. **Time limits on Vercel Hobby with a remote Turso.** A 5000-row commit may be slow. Mitigation: batched writes, the row cap, and "split per season". If @backend measures it as too slow in production, the cap goes down in `po-decisions.md`, not the all-or-nothing rule. Live still runs in `iad1` until the user pushes Phases 7–8b (`vercel.json` already pins `arn1`), so the commit is built for the slower region from the start (D30).
6. **Personal data in AI tools.** Members' names and emails go into a third-party chat when the user uses an AI. The README says this in one line and suggests using initials or the `Üye listesini indir` file only as needed. It's the user's choice; we don't send anything anywhere.
7. **Current voice part used for history.** A singer who moved from alto to soprano will appear "not expected" at old alto sectionals. The error message points to it, and the workaround is to import that rehearsal as tutti. It's rare; accepted.

## 9. Priorities if time runs short

Must, in order:
1. AC 1, 15, 18, 19, 41, 42: access, a check that writes nothing, an all-or-nothing commit, and a safe migration
2. AC 9–14: the file format contract
3. AC 21, 23, 24, 27, 28: member history and attendance, the user's main need
4. AC 29, 30, 32: finance and dues payments
5. AC 5–8: the template pack, which is the deliverable the user asked for
6. AC 16, 17, 20, 34, 43, 45: preview quality, idempotency, report parity, phone and the test round

Should: AC 2–4, 22, 25, 26, 31, 33, 35–40 and 44.

Could: none.

Undo (AC 37–40) is a Should only in the sense that the phase could ship without it if the team runs out of time. In that case I will require a `db:backup` before every production import and say so on the page. Anything cut gets an entry in `po-decisions.md`. The phase can't be accepted with a Must missing.
