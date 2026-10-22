# Phase 8b PO decisions

Author: PO. Date: 2026-10-21. Reads: `po-spec.md`, `ux.md`, `ui.md`, `backend.md`, `db.md`, and the tech lead's list of open points. Every point addressed to me is settled here. Where an AC changes, `po-spec.md` is amended in place and the change is marked `(amended Dn)`. **AC numbers are unchanged (1–45).** The decision numbers continue from the spec (D1–D16), so they start at D17.

The rule I applied throughout: a volunteer choir, a treasurer with a laptop and an AI chat, nobody does admin. When two options are equally safe, I took the one that needs fewer explanations to a board member. When the team measured something, the measurement wins over my guess. When the team found a hole in my spec, the hole gets fixed, not argued.

## 1. Decisions

### D17. Undo hard-deletes untouched imported finance entries (D13, AC 39) — db §6.4, backend §7.4
- **Decision:** undoing a `hareketler` or `aidat-odemeleri` batch **deletes** the entries it created. It is not a void.
  - **Preconditions:** this happens only when every one of those entries is untouched: never voided, never corrected or replaced, `revision = 0`, no `updated_at`. That's the D13 dependency check, which already refuses the undo otherwise.
  - **Sponsors** created by the batch are deleted when no entry references them any more **and** they equal their snapshot. Otherwise they stay, active (DBA §6.4).
  - **Waivers** created by the batch are deleted, and freezes that no longer protect a live payment are dropped (`voidEntry`'s rule).
  - **The batch row stays** as the audit record: who, when, file name, size, SHA-256, counts, and who undid it when.
- **Why:**
  - Voiding makes the stack dead-end at the first realistic fix cycle (payments → undo → periods can never be undone → nothing older can be undone). Both the DBA and backend found it independently; my D13 was wrong.
  - The "never delete" ledger rule protects **money someone recorded as real**. A row that came from a mistaken file and that nobody touched since was never confirmed as real.
  - A 2000-row ledger file imported wrongly and undone would otherwise leave 2000 voided rows in `Hareketler` for ever. That's noise the treasurer would have to explain to auditors.
  - I apply it to **both** finance types, not only dues payments (backend's narrower proposal). One rule is easier to explain than two, and a sponsor created by a mistaken `hareketler` file should go away too.
- **Undo confirm copy** for these two types gets the extra line `İçe aktarılan hareketler tamamen silinir; bakiyeler aktarım öncesine döner.`
- Amended: D13, AC 38, AC 39.

### D18. Paste CSV text as well as picking a file (D3, D12, §6) — ux §0.2.1
- **Decision: accepted.** The upload card gets two tabs, `Dosya seç` and `Metni yapıştır`, with `Dosya seç` as the default.
  - The textarea has the label `CSV metni`, 8 rows, monospace.
  - The **client wraps the text into a file**: `new File([text], "yapistirilan-metin.csv", { type: "text/csv" })`, UTF-8 by construction, with no BOM. From there the path is **byte-identical** to an upload. The same `checkImport`/`commitImport` calls run, with the same hash, limits (1 MB, 5000 rows), log and undo.
  - **The hash** is that of those bytes. The browser keeps the text in state between check and commit, exactly like the file snapshot (ui §2.3), so what was checked is what is sent. Editing the textarea after `Kontrol et` resets the preview, as picking a new file does.
  - **The log** shows the name `yapistirilan-metin.csv`.
- **Why:** UX is right that the hardest step for a volunteer isn't the AI, it's "save this code block as a UTF-8 .csv". TextEdit saves RTF, Notepad needs three settings, and a phone has no "save as file" at all. Pasting removes the whole Windows-1254 failure class, and the phone becomes usable. The hash/same-bytes design survives untouched because the text becomes bytes **in the browser**, before either call. Cost: one textarea and one tab.
- The README still keeps the `Dosyayı kaydetmek` section (ux §8.1, 5), for Excel/Sheets exports and for files over what a chat can show.
- Amended: D3, D12, D16, AC 5, AC 9, AC 43, §6.

### D19. Before → after balances on both finance steps (D10, AC 30, AC 32) — ux §0.2.2
- **Decision: accepted.** The clean preview of **`hareketler` and `aidat-odemeleri`** shows `İçe aktarımdan sonra` with one row per account: `Kasa ₺2.500,00 → ₺3.412,50`, `Banka ₺… → ₺…`.
- The hints:
  - step 4: `Banka ekstrenle karşılaştır. Aidat ödemeleri 6. adımda eklenince bu rakam artar.`
  - step 6: `Şimdi banka ekstrenle tutmalı.`
- **Why:** after step 4 alone, the balance is lower than the bank statement by every dues payment. A careful treasurer would then "fix" a correct file. Showing before → after makes the size of the change visible, and the hint says when to expect a match.
- Amended: D10, AC 30, AC 32.

### D20. Dues period and event names match like sponsors (D10, D11, AC 29, AC 32) — ux §0.2.3
- **Decision: accepted, without the "Benzerleri" suggestion list.**
  - `donem` (aidat-odemeleri) and `etkinlik` (hareketler) are matched after D6 normalisation, so `Eylul 2024` finds `Eylül 2024`.
  - Zero matches or more than one is an error, as before:
    - `Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında.`
    - `Bu adla bir etkinlik yok.` / `Bu adla birden çok etkinlik var; etkinliği adından ayırt et.`
- **Why:** `ü` and `ı` are exactly what an AI or a US keyboard drops, and sponsors already work this way, so it's one rule, not a new one. I cut the "5 nearest names" list: it's a fuzzy-matching feature with its own edge cases, and pointing to the page where the names are shown is enough.
- Amended: D10, D11, AC 29, AC 32.

### D21. The `@eski.invalid` rule depends on the step (AC 8, §4.2) — ux §0.2.4
- **Decision: accepted.**
  - **Only step 1 (`uyeler`)** tells the AI to **invent** `ad.soyad@eski.invalid` for former members whose email is unknown.
  - **Steps 3 and 6** tell it to **use only addresses from the member list**, and to re-download `Üye listesini indir` after step 1, because the former members are in it from then on.
  - **The step-1 result** shows `Sıradaki adımlardan önce üye listesini yeniden indir; eski üyeler artık listede.` with the download button.
- **Why:** my skeleton would have made the AI invent a fresh address in every file, and every one of those rows would fail with `Bu e-postayla üye yok`.
- Amended: §4.2, AC 8, AC 18.

### D22. Copied errors start with a short instruction for the AI (AC 16) — ux §0.2.5
- **Decision: accepted, with UX's preface verbatim.** `Hataları kopyala` copies: the preface paragraph, one blank line, then one error per line:

  > Portal bu CSV dosyasında aşağıdaki hataları buldu. Satır numaraları dosyanın satırlarıdır; 1. satır başlık satırıdır. Yalnızca bu hataları düzelt, öteki satırları ve kuralları değiştirme, dosyanın tamamını aynı başlıkla tek kod bloğunda yeniden ver. Düzeltemediğin satırı çıkar ve Atladıklarım listesine yaz.

- **Why:** without it, the user has to explain line numbers to the AI, and they won't.
- Amended: AC 16.

### D23. Error cap: 1000 from the server, 100 shown; no `.txt` download (AC 16) — ui §3.3, §9.1–2
- **Decision:**
  - The server returns at most **1000** errors plus the true count. The page shows the first 100 and `ve <k> hata daha (ilk 1000'i kopyalanır)`.
  - Above 1000, the copied text ends with `İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.`
  - **`Hataları indir (.txt)` is cut.**
- **Why:**
  - The cap: a file with 15,000 errors is structurally wrong. Sending 1.4 MB of messages to a phone helps nobody, and the AI can't use more than a few hundred lines either.
  - The `.txt` button: it is a second way to do what `Hataları kopyala` does. The clipboard fallback dialog (ui §4, ux §0.3) already covers a refused clipboard, and pasting into a chat is how the user works anyway. One button, one habit.
- Amended: AC 16.

### D24. Samples, fixtures and test dates (§4.1, AC 7, seed note) — ui §8.3, §9.3–4
- **Decision:**
  - **Sample dates:** every sample and every e2e fixture date is **before 2025-09-01**, using the 2023–24 and 2024–25 seasons. This keeps the seeded users (`joined_at` 2025-09-01) out of the expected rosters and avoids the seeded rehearsals.
  - **Sample names:** term and dues-period names and ranges must not overlap the seed's `2025–26 Bahar` (2026-02-01…06-30) or `2026–27 Güz` (from 2026-09-15), or any seeded dues period. Term samples are `2023–24 Güz`, `2023–24 Bahar`, `2024–25 Güz` and `2024–25 Bahar`. Period samples are `Eylül 2024`, `Ekim 2024` and `Kasım 2024`.
  - **The cast:** the samples use UX's fictional cast (ux §8.2): `ayse.demir@ornek.com`, `zeynep.ak@eski.invalid`, and so on.
  - **Fixtures are generated in code** (`e2e/import.mjs`, `setInputFiles` with a Buffer), not committed as `e2e/fixtures/import/*.csv`. The only CSVs on disk that the tests read are the shipped `docs/ice-aktarma/*` files.
  - **The `.md` examples:** each `.md`'s fenced `csv` example must also pass `Kontrol et` with 0 errors against the arranged cast (ux §8.4). That is part of AC 7.
- **Why:**
  - Byte-level fixtures (BOM, CRLF, 1254, 1,048,577 bytes) and "tomorrow" can't be reviewed or kept stable as files.
  - A sample that only works on an empty DB is a broken sample.
- Amended: §4.1 sample, §5 seed note, AC 7.

### D25. Limits and test plumbing (AC 11, 18, 19, 30, 45) — ui §2.4, §8.1, §9.5–9; backend §6.5
- **Decision:**
  - **"1 MB" = 1,048,576 bytes** everywhere: client, server, README and tests. `experimental.serverActions.bodySizeLimit: "1100kb"`, and the client pre-checks the size. The constants live in the isomorphic `src/lib/import/limits.ts`.
  - **The e2e runner pattern** becomes `/^phase\d+[a-z]?-.*\.mjs$/`, so the `phase8b-*` files actually run.
  - **AC 18's swapped file and double commit** are tested with a **hand-built server-action request** (file B with A's hash; two concurrent commits). The UI can't produce that case, by design.
  - **AC 30's opening date** is the test DB's fixture date, not 2026-10-19. The logic is unchanged.
  - **The AC 19 fault hook** is the cookie `arkhe_e2e_import_fault=<n>`, read only when `NODE_ENV !== "production"` **and** `DATABASE_URL` starts with `file:`. `e2e:prod` sets the cookie and asserts the import succeeds in full.
- **Why:** these are all the team's findings, and each one either makes an AC actually run or makes it testable at all.
- Amended: AC 11, AC 18, AC 19, AC 30, AC 45.

### D26. Reuse the UI's existing sentences; the new copy is approved (AC 29, AC 32, backend §13)
- **Decision:** one sentence per rule. Where the UI already has one, the import uses it.
  - AC 32, overpayment: `Kalan borç ₺<x>; daha fazlası girilemez.` (`overpaymentError`).
  - AC 32, nothing open (paid, waived or exempt): `Bu dönemin borcu yok.` (singular, new).
  - AC 29, same account: `Kaynak ve hedef hesap aynı olamaz.`
- **New copy approved as backend wrote it (§2, §3, §5, §7):**
  - `Bu bir Excel dosyası. Excel'de "CSV UTF-8" olarak kaydet ya da yapay zekâdan CSV iste.` (I added the AI half.)
  - `Satır <n>: Tırnak işaretleri hatalı.`
  - `Başlığı boş bir sütunda veri var.`
  - `Satırda başlıktaki sütunlardan fazla hücre var.`
  - `Kayıt numarası 1–40 karakter olmalı: harf, rakam, - _ . /`
  - `Bitmemiş bir çalışma içe aktarılamaz.`
  - `Not yalnızca mazeretli satırda yazılır.`
  - `Bu çalışmanın ilk satırıyla (satır <m>) farklı.`
  - `Kayıt <kayit_no> daha önce farklı içerikle aktarıldı ya da portalda değişti; önce o aktarımı geri al.`
  - `Bu adla farklı bir aidat dönemi var.`
  - `Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında.` (D20)
  - `Koro şefi aidattan sorumlu değil.`
  - `Eski üye için <ad|katılım tarihi|partisyon> gerekli.`
  - `Bu içe aktarma zaten geri alındı.`
- Amended: AC 29, AC 32.

### D27. Parsing and matching rules (backend §2.4, §5.1, §5.3; AC 1, 10, 21, 25)
- **D6 normalisation applies to headers. Confirmed.** `KATILIM_TARIHI`, `Katılım tarihi` and ` eposta ` all match. `e-posta` (→ `e_posta`) is still unknown. **Why:** under Turkish lower-casing, upper-case ASCII headers would otherwise break, and Excel users type headers in every case.
- **Blank `baslangic`: confirmed.** A blank start time means "the rehearsal of the nearest earlier row with the same `tarih`". With no such row, it's `19:00`. README wording:
  > Aynı günün sonraki satırlarında saati boş bırakabilirsin; satır, aynı gün içinde kendinden önceki çalışmaya sayılır. Aynı gün iki çalışma varsa ikincisinin ilk satırına saati mutlaka yaz.
- **Attendance counts are file rows: confirmed.** `eklenecek` and the button count file rows. Auto-absent rows appear only in the warning and in the per-rehearsal effect line. **Why:** "I uploaded 212 rows, it says 212" is what the user can check.
- **A board user's row for a manager: an error only if it would change something. This differs from backend's proposal.** An **unchanged** row for sef@ or another board user is `değişmeyecek`, with no error.
  - **Why:** permission is about writing, and nothing is written. More importantly, the natural workflow is "download the member list, give it to the AI, get the file back". That list contains the managers, and a board treasurer's file would otherwise fail on rows they didn't mean to touch.
  - A row that **would** change a manager still gives `Bu kişiyi yalnızca koro şefi değiştirebilir.`, and the board-only note on the page (ux §3.2) stays.
- **"Unchanged" compares dates by Istanbul day: confirmed.**
- **`ayrilis_tarihi` is stored as 23:59:59 Istanbul: confirmed.** The column has second resolution, so `.999` was never real.
- **AC 1 "no body" means "no file": confirmed.** Download routes answer korist@ with the JSON 403 used by every manager route (Phase 8 D38), and logged-out requests are redirected to login by the proxy.
- Amended: D7, D9, AC 1, AC 10, AC 23, AC 25.

### D28. DBA's small calls (db §3.6, §4, §6.2, §12)
- **A `muaf` row for a period the member already has a hand-made waiver for** is `değişmeyecek`, and no item is written. **Why:** the outcome the file asks for is already true, and we never take ownership of hand-entered data.
- **`kayit_no` is case-sensitive** (trimmed). The prompts make the AI build it deterministically (ux §8.0.5: `20240905-1`, `O-20240905-1`, `M-202409-1`), so case never varies in practice.
- **Undo is also refused when:**
  - an event points at an imported rehearsal: `<tarih> çalışmasına bir etkinlik bağlanmış; geri alınamaz.`
  - an imported attendance row disappeared (bulk undo)
  - an imported dues period was edited by hand: `<ad> dönemi bu aktarımdan sonra değişti; geri alınamaz.`
- **AC 42 wording:** "each item row has at most one target column set, and it's the one its kind requires", as the DBA wrote it.
- **Snapshots** (before/after JSON) are stored for every hand-editable target, not only users (db §1).
- Amended: D13, AC 40, AC 42.

### D29. Inserts are chunked at ≤ 999 parameters per statement (hard rule)
- **Decision:** every multi-row insert of the import is chunked so that each statement has **at most 999 bound parameters**. The DBA's limit applies over backend's ~2000.
- **Why:** it's the most conservative SQLite default, it costs a few more round trips at our size, and a statement that fails only on a bigger real file is the worst kind of bug.
- This is a review checklist item. Backend's §9 round-trip estimate grows a little (attendance ≈ 140 rows per statement), and it still fits (D30).

### D30. Function region and the commit time budget (AC 44, risk 5)
- **Facts:**
  - `vercel.json` already pins functions to **`arn1`** (Stockholm, next to Turso). That's committed in Phase 7 but not pushed yet.
  - **Live still runs in `iad1`** until the user pushes Phases 7–8b.
- **Decision:** the import must stay correct and within AC 44 **under either region**. So the commit uses the **few-round-trip path from the start**:
  - snapshot reads in one `tx.batch()`
  - the plan computed in memory
  - all writes in one (or very few) `tx.batch()` calls inside the same write transaction
- **Why:** we can't measure production before the push. If the user ever reverts the region, or pushes 8b before the region change takes effect, a 35-statement interactive transaction from Virginia is about 3.5 s, uncomfortably near Turso's interactive-transaction lifetime. Building the safe path once is cheaper than discovering it in production with a half-season of attendance on the line. If the tech lead finds the batched path impossible for a type, that type documents a lower row cap on its page (the "split per season" rule), and the all-or-nothing rule stays.
- The tech lead records this in `design/STATUS.md` (I added a line under Phase 8b).

### D31. Confirm before `İçe aktar`, the `Sıradaki` hint, and collapsed name warnings (AC 3, 17, 18, 21) — ux §0.2.6–8
- **Always confirm: accepted.**
  - The dialog title is `<n> değişiklik aktarılsın mı?`.
  - The description is `<Tür adı> · <dosya adı>. Hepsi birden yazılır; sonra İçe aktarma geçmişi'nden geri alabilirsin.`
  - When the import deactivates anyone, an extra line: `<k> kişi pasifleşecek ve oturumları kapanacak.`
  - The buttons are `Vazgeç` / `İçe aktar`.
  - **Why:** the import is rare and writes into live data, so one more tap is cheap. It also catches "I fixed the file and forgot to re-check".
- **`Sıradaki` chip: accepted, with UX's rule.** The chip goes on the first type card, in D1 order, with no live import **and** a number above every imported type's number. If everything is imported, there's no chip. It's a hint, not a lock.
- **Collapsed name mismatches: accepted.** They show as one line, `<k> kişinin adı portaldakinden farklı (ad değişmez).`, with `Listeyi göster` (`<details>`) holding the D7 lines. The **deactivation warning is never collapsed** and comes first.
- Amended: AC 3, AC 17, AC 18, AC 21.

### D32. Small UX calls
- **One page with sections** (ux §0.1, ui §2.1): accepted. The order is: header, `1 · Dosyanı hazırla`, `2 · Yükle ve kontrol et`, the result, then `Sütunlar`. The warnings and the commit button come **before** the 50 effects.
- **The `?geri=ice-aktar` back link on Ayarlar: cut.** The inline `Veri içe aktar` link inside the Ayarlar opening-balance card is enough. **Why:** a query-param-dependent second back link is UI state for one round trip.
- **The `Nasıl yapılır?` disclosure, the prerequisite line, and the board-only note on `uyeler`** (ux §3.2–3.3): accepted.
- **The result's `Sıradaki: <n> · <başlık>` button** (ux §3.4): accepted.
- **No `possessive` suffix after percentages or numbers** anywhere new (Phase 8 D23 style): already the case in the copy above.

### D33. Developer README line
- **Decision:** the repo `README.md` (development section) gets one line:
  > `npm run e2e` ve `npm run db:reset` yerel veritabanındaki içe aktarma, yönetim kurulu panosu ve bütçe kayıtlarını siler.
- **Why:** the user tests locally on `data/arkhe.db`. A line that tells them before they lose an afternoon of test imports costs nothing.

### D34. Not decided by me, but required
- **Double tap on `İçe aktar`** must create exactly one batch (AC 18). The DBA sketched a `client_key` unique index; backend relies on re-validation inside the write lock (a second commit sees everything `değişmeyecek` and writes nothing). Both meet the AC. The tech lead picks one, and AC 18's two concurrent crafted commits prove it.
- **`listRehearsals`' default `limit = 200`** (db §7): backend checks that no history or report path silently relies on it once imported seasons exist. Any path that does is a bug against AC 34.

## 2. Unchanged

- Everything else in D1–D16 stands: the six types and their order, no nav entry, all-or-nothing per file, managers only with UI-parity per row, former members as inactive users who can't log in, no XLSX, the stack undo, and the template pack in `docs/ice-aktarma/`.
- Priorities (§9 of the spec) stand. D18 (paste) is part of the "file format contract" Must group, because it is now the easiest path for most users.
