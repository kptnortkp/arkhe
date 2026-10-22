# Phase 8b: backend and security plan (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-21. Inputs: `po-spec.md` (AC 1–45, §7 q2 is mine), `ui.md` (UI engineer, landed while I wrote this), `design/phase-8/po-decisions.md`, `CLAUDE.md`, `AGENTS.md`, `design/TEAM.md`. `db.md` and `ux.md` did not exist yet, so §11 is the **data I need** from @dba, not a schema.

Code read: `src/lib/{permissions,validation,money,time,text,csv,labels,format,api}.ts`, `src/lib/auth/{dal,session,rate-limit}.ts`, `src/db/{schema,write-tx,client,index}.ts`, `src/lib/attendance/{roster,close,rehearsals}.ts`, `src/lib/finance/{dues,ledger,schemas,guard,categories,queries,queries-internal}.ts`, `src/app/(portal)/calismalar/actions.ts`, `src/app/(portal)/finans/actions.ts`, `src/app/(portal)/finans/aidat/actions.ts`, `src/app/(portal)/uyeler/actions.ts`, `src/app/api/cron/aylik-yedek/route.ts`, `src/proxy.ts`, `next.config.ts`, `vercel.json`, `scripts/seed.ts`, `e2e/{lib,phase6-z-guards}.mjs`, `node_modules/drizzle-orm/libsql/session.js`, `node_modules/@libsql/core/lib-esm/{api.d.ts,config.js}`. Next docs read: `02-guides/server-actions.md` (Security, Configuration), `03-api-reference/05-config/01-next-config-js/serverActions.md` (`bodySizeLimit`), `.../proxyClientMaxBodySize.md`, `03-file-conventions/02-route-segment-config/maxDuration.md`.

`src/` is untouched, nothing was written to `data/arkhe.db`, no e2e was run, no git.

---

## 0. Decisions in one table

| Topic | Decision |
|---|---|
| CSV parser | **Own code, no dependency** (~150 lines, `src/lib/import/csv.ts`, pure and isomorphic). We need exact physical line numbers, refusal of multi-line cells, a strict UTF-8 decoder and our own delimiter rule; a library (papaparse, MIT) would need wrapping for each of those and adds nothing we use (§2). |
| One definition per type | `src/lib/import/defs/<slug>.ts`, isomorphic data: columns, formats, code tables, examples, help, sample rows, prompt lines, result links. The generic parser, the page table, the sample CSV, the `.md` and the prompt are all **rendered from it** (§1). The type's rules live next to it in a `server-only` module. |
| No bypass | **Pure rule + bulk snapshot.** Every UI rule the import needs is extracted from the `"use server"` files into pure functions in `src/lib/**`; the actions keep calling them with their per-entity data, and the import calls the **same functions** with one snapshot read for the whole file. No per-row query anywhere (§4). |
| Check and commit share code | `planImport(def, rows, snapshot, ctx)` is pure. `Kontrol et` = read snapshot (no transaction) + plan. `İçe aktar` = inside one `writeTx`: read the same snapshot + the same plan + write, or roll back and return the new errors (§6). |
| Hash | SHA-256 of the raw uploaded bytes, computed on the server only. Commit recomputes and compares with the previewed hash; mismatch → `Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.` and nothing is read further (§6.3). |
| Double commit | No commit key. The second request re-validates inside its own write transaction, sees every row `unchanged`, and returns the "nothing to change" result **without a batch row** (agrees with @ui §6.4). A commit with 0 changes never writes. |
| Body size | `experimental.serverActions.bodySizeLimit: "1100kb"` in `next.config.ts` (agree with @ui). The proxy buffers up to 10 MB by default, so it isn't the bottleneck. Server checks `file.size > 1_048_576` before reading the bytes. |
| Time budget | `maxDuration = 60` on `/ice-aktar/[tur]` and `/ice-aktar/gecmis` (actions inherit the page's). A 5000-row `yoklama` commit is ~10 reads + ~25 chunked writes in one transaction (§9). |
| Undo | One `writeTx`: stack check, permission, set-based dependency checks, then restore / delete / void. I recommend one change to D13: **imported dues payments are deleted on undo, not voided** (§7.4, @po). |
| Fault hook (AC 19) | A cookie `arkhe_e2e_import_fault=<n>` read only when `NODE_ENV !== "production"` **and** `DATABASE_URL` is `file:`. Not an `app_settings` row (@ui §6.8), because `app_settings.key` has a CHECK list and changing it rebuilds an existing table, which constraint 1 forbids. |
| Rate limits | None. Check, commit and undo are manager-only and bounded (1 MB / 5000 rows). A DB-backed limiter would write a `login_attempts` row on every `Kontrol et`, which breaks AC 15 ("check writes nothing"). |
| Logging | Counts, slug, timings and error `name`/`code` only. Never the file name, cell values, emails, names or error sentences (they echo cell values) (§10). |

---

## 1. Module layout and the definition shape

```
src/lib/import/
  limits.ts        isomorphic: IMPORT_MAX_BYTES = 1_048_576, IMPORT_MAX_ROWS = 5000, IMPORT_MAX_ERRORS = 1000, SLUGS
  types.ts         isomorphic: ColumnDef, Format, ImportDef, RowError, Warning, CheckResult, CommitResult (shapes from ui.md §6)
  normalise.ts     isomorphic: normaliseCode(), codeTable()
  codes.ts         isomorphic: the code tables, built from src/lib/labels.ts + DB codes + aliases
  csv.ts           isomorphic: decode(bytes) → text | FileError; parseCsv(text) → { header, records[{ line, cells }] } | FileError
  values.ts        isomorphic: parseDate, parseTime, parseAmount (strict), parseRecordNo
  engine.ts        isomorphic: header mapping, required columns, per-cell format parsing → typed rows + cell errors
  docs.ts          isomorphic: sampleCsv(def), markdown(def), prompt(def), readme()
  defs/            isomorphic, one file per type: uyeler.ts, donemler.ts, yoklama.ts, hareketler.ts, aidat-donemleri.ts, aidat-odemeleri.ts, index.ts
  rules/           server-only, one file per type: snapshot loader + plan() + writes()
  run.ts           server-only: checkFile(), commitFile(), undoBatch(); the only caller of rules/*
  queries.ts       server-only: page reads (index cards, log, markers); every export calls requireManager()
src/app/(portal)/ice-aktar/actions.ts        "use server": checkImport, commitImport, undoImport (only these exports)
src/app/(portal)/ice-aktar/[tur]/ornek/route.ts, [tur]/talimat/route.ts, uye-listesi/route.ts
scripts/import-docs.ts                        writes docs/ice-aktarma/* from docs.ts (npm run docs:import)
```

The definition (isomorphic, plain data plus two tiny pure functions):

```ts
export type Format =
  | { kind: "text"; max: number; min?: number; line: true }      // cleanLine + trim, like optionalLine
  | { kind: "email" }                                              // emailSchema
  | { kind: "date"; future: boolean }                              // D4; future = bitis / son_odeme
  | { kind: "time"; default?: string }                             // D4
  | { kind: "amount" }                                             // D5, strict
  | { kind: "code"; table: CodeTable; default?: string }           // D6
  | { kind: "codes"; table: CodeTable; joiner: "+" }               // partiler
  | { kind: "recordNo" }                                           // kayit_no
  | { kind: "url" };                                               // documentField / parseLink

export type ColumnDef = {
  name: string;                    // canonical header: "katilim_tarihi"
  required: true | false | string; // string = the condition shown in "Zorunlu": "Eski üyede", "Virmanda"
  format: Format;
  example: string;                 // "Örnek" column, also used in the prompt
  help: string;                    // "Açıklama"
  inherited?: true;                // yoklama rehearsal-level columns (D9)
};

export type ImportDef = {
  slug: Slug; step: 1 | 2 | 3 | 4 | 5 | 6;
  title: string; summary: string; intro: string[];
  columns: readonly ColumnDef[];
  sample: readonly Record<string, string>[];   // keyed by column name; blank = ""
  promptRules: string[];                        // type-specific lines added to the §4.2 skeleton
  links: { label: string; href: string }[];     // result links (AC 18)
  key(row: Record<string, unknown>): string | null; // natural key for "Satır <m> ile aynı kayıt."
};
```

Everything a human or an AI reads is a function of `ImportDef`: `ColumnTable` renders `columns`; `sampleCsv(def)` renders `sample` in column order; `markdown(def)` renders the table, the codes (from `format.table`) and `prompt(def)`. The "İzin verilen değerler" cell is `table.canonical.join(", ")`, so AC 6's "every canonical code appears in the `.md`" holds by construction. `Biçim` is derived from `format.kind` (one Turkish phrase per kind), so the format text can't drift from the parser.

Sample CSV bytes: **UTF-8 with BOM, `;`, CRLF**, cells quoted only when they contain `;`, `"` or start with `= + - @` (so the AI sees clean rows and Excel TR opens it without mangling `ş`). The member list (AC 4) uses the existing `csvDocument` (every cell quoted, formula guard), as the spec asks.

## 2. File pipeline (D3, AC 9–11)

Order (each step is a whole-file error that stops everything after it; messages per the spec):

1. **Size.** `file instanceof File`, `file.size === 0` → `Dosyada veri satırı yok.`; `file.size > IMPORT_MAX_BYTES` → `Dosya en fazla 1 MB olabilir.` Checked **before** `arrayBuffer()`.
2. **Bytes → text.**
   - `PK\x03\x04` at offset 0 (xlsx/ods are zip) → new copy, @po: `Bu bir Excel dosyası. Excel'de "CSV UTF-8" olarak kaydet.`
   - UTF-16 BOM (`FF FE` / `FE FF`) → `Dosya UTF-8 değil. …` (the AC 9 message).
   - `new TextDecoder("utf-8", { fatal: true })` (it strips one UTF-8 BOM). A throw → the AC 9 message. Windows-1254 `ş ğ ı İ Ş Ğ` are `FE F0 FD DD DE D0`, which are never valid UTF-8 on their own, so a 1254 file with any Turkish letter fails here. A pure-ASCII 1254 file is byte-identical to UTF-8 and correctly passes.
   - A `\u0000` in the text → the same message (binary or UTF-16 without BOM).
3. **Tokenise** (one pass, RFC 4180 subset):
   - Line breaks: `\r\n`, `\n`, and a lone `\r` (old Mac Excel "CSV (Macintosh)"). The physical line counter starts at 1 after the BOM.
   - Delimiter: decided on the **first non-blank line**: `;` if it contains `;`, else `,`.
   - A cell is quoted iff its first non-space character is `"`. Inside quotes `""` is a literal quote. A line break inside quotes → `Satır <n>: Hücrede satır sonu olamaz.` with `n` = the line where the quote opened.
   - After a closing quote only spaces and then a delimiter or end of line are allowed; anything else → `Satır <n>: Tırnak işaretleri hatalı.` (new copy, @po). A `"` inside an unquoted cell (`5" ekran`) is kept literally: Excel never writes it, and refusing it helps nobody.
   - End of file inside quotes → the multi-line message.
   - A record whose cells are all blank after trimming is skipped (blank lines and `;;;;`), and its line number is consumed, so later numbers stay true (AC 11).
4. **Header** = the first non-blank record.
   - Each header cell goes through `normaliseCode` (D6), so `EPosta`, ` eposta `, `Katılım tarihi` and `KATILIM_TARIHI` all match `eposta` / `katilim_tarihi`. The case rule alone would turn `KATILIM_TARIHI` into `katılım_tarıhı` under Turkish lower-casing; the D6 fold fixes that. `e-posta` normalises to `e_posta` and is still unknown (AC 10 holds). @po: please confirm D6 applies to headers.
   - A **blank header cell** whose column is blank in every data row is ignored (Excel's trailing `;`). Blank with data under it → `Başlığı boş bir sütunda veri var.` (new copy).
   - Unknown → `Bilinmeyen sütun: "<raw, ≤ 40 chars>". Geçerli sütunlar: <canonical, comma-separated>.` Duplicate after normalising → `"<name>" sütunu iki kez var.` Missing a `required: true` column → `Zorunlu sütun eksik: "<name>".` All header problems are reported together, then stop (AC 10: "no row checking").
5. **Rows.** 0 data records → `Dosyada veri satırı yok.`; > 5000 → `En fazla 5000 satır aktarılabilir; dosyayı (örneğin sezonlara) böl.` A record with **more** cells than the header is an error on that line (`Satırda başlıktaki sütunlardan fazla hücre var.`) unless the extra cells are blank; **fewer** cells mean the missing trailing ones are blank (AIs drop trailing `;`).
6. **Cells.** `trim()` (covers NBSP and stray `﻿`), then `cleanLine` for text formats (the UI's own hygiene). A cell longer than 2000 characters is refused before any parsing (`En fazla 2000 karakter.`), which bounds every regex below.

Complexity is linear; no regex runs on more than one cell, and every regex is anchored and backtracking-free.

## 3. Value parsing (D4–D6, AC 12–14)

All in `values.ts`, pure, each returning `{ ok: true, value } | { ok: false, message }`. "Today" is `istanbulDateOf(now())`, read per call.

- **Date.** `^(\d{4})-(\d{2})-(\d{2})$` or `^(\d{1,2})\.(\d{1,2})\.(\d{4})$` → canonical `YYYY-MM-DD`. Anything else → `Tarihi 2025-10-07 ya da 07.10.2025 biçiminde yaz.` Not real (`isRealDay` from `finance/schemas.ts`) → `Bu tarih takvimde yok.` `< 2000-01-01` → `Tarih 2000'den önce olamaz.` `> today` → `Gelecek bir tarih olamaz.` unless `future: true`, which then uses the UI's own bound `inDateBounds` (today + 730) and its message `DATE_OUT_OF_RANGE`.
- **Time.** `^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$` → `HH:MM`. Else `Saati 19:30 biçiminde yaz.`
- **Amount (strict, D5).** `^(0|[1-9]\d*)(?:[.,](\d{1,2}))?$`. No match → `Tutarı 1250,50 biçiminde yaz: binlik ayırıcı, ₺ ve boşluk yok.` Integer part over 8 digits or kuruş > `MAX_KURUS` → `AMOUNT_MAX`; 0 → `AMOUNT_ZERO` (both from `money.ts`). The strict parser returns kuruş **and** the canonical string `"1250,50"`, which is what is then fed to the existing zod schemas (`amountField` → lenient `parseAmount`), so the UI schema still runs and yields the same kuruş. `1.250` fails the strict regex (3 decimals) before the lenient parser could read it as 1250.
- **Record number.** `^[A-Za-z0-9._/-]{1,40}$` → else `Kayıt numarası 1–40 karakter olmalı: harf, rakam, - _ . /` (new copy).
- **Codes (D6).** `normaliseCode(s) = searchKey(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")`. `searchKey` (`format.ts`) already does Turkish lower-casing, NFD accent stripping and `ı → i`; reusing it means sponsor matching and code matching fold identically. A `CodeTable` is `{ canonical: string[]; lookup: Map<string, DbValue> }`, built by `codeTable(values, labels, aliases)`: canonical = `normaliseCode(label)`; accepted keys = canonical, `normaliseCode(dbValue)`, aliases. Construction **throws on a key collision**, and the AC 6 e2e imports every table, so a future label change that collides fails the run, not production. Unknown → `"<raw, ≤ 40>" geçerli değil. Şunlardan biri olmalı: <canonical>.`

| Table | Canonical (from `labels.ts`) | Extra accepted |
|---|---|---|
| voice part | `soprano alto tenor bas` | DB `bass` |
| rehearsal type | `tutti partisyon genel_prova konser` | `sectional dress concert` |
| attendance status | `geldi gec_geldi mazeretli gelmedi` | `gec` (STATUS_SHORT), `present late excused absent` |
| entry kind | `gelir gider virman` | `income expense transfer` (`opening` is not in the table) |
| category | the 16 labels of `CATEGORY_LABELS` minus `Aidat` | DB codes; `aidat`/`dues` are **recognised** so they get D10's specific refusal |
| account | `kasa banka` | `cash bank` |
| dues rate | `tam indirimli muaf` | `standard reduced exempt` |
| dues row kind | `odeme muaf` | — |

I checked the folds by hand: `Salon / mekân → salon_mekan`, `Şef / korrepetitör ücreti → sef_korrepetitor_ucreti`, `İkram → ikram`, `Hibe / destek → hibe_destek`; they match §4.1 exactly.

## 4. Reusing the UI rules without bypassing them (constraint 3, @po §7 q2c)

**Answer to @po:** yes, and it's the only way that also meets the time budget. The current rules are written as "load one member/period from the DB, then check". 5000 rows × `duesPosition` (4 queries) would be 20,000 round trips. So I split each rule into **a pure function over plain data** and keep the loading in the caller. The action loads one entity and calls the function; the import loads a snapshot once and calls the same function per row. The messages move with the functions, so they are literally the same strings.

A `"use server"` file may only export async actions, so every schema the import needs **must leave those files** anyway.

| Rule | Today | Extract to | Then used by |
|---|---|---|---|
| `dateSchema`, `timeSchema`, `rehearsalSchema` | `calismalar/actions.ts` (not exported) | `src/lib/attendance/schemas.ts` | `createRehearsal`, `updateRehearsal`, import `yoklama` |
| `termSchema`, overlap query, name clash message | `calismalar/actions.ts` `createTerm` | `src/lib/attendance/terms.ts`: `termSchema`, pure `termConflict(terms, d)` → `"Dönemler çakışamaz."` / name taken | `createTerm` (loads all terms: a handful of rows), import `donemler` |
| `isExpected` | `roster.ts` (pure already) | + pure `expectedIds(users, rehearsal)` | `rosterOf`/`unmarkedExpected`, import `yoklama` (validation **and** the auto-absent rows) |
| close rule (absent/auto at close time) | `close.ts` inline | pure `absentRows(rehearsalId, userIds, at)` | `closeRehearsal`, import |
| `periodSchema`, `optionalReduced`, `REDUCED_TOO_HIGH`, `overlapping`, `nameTaken` | `aidat/actions.ts` | `src/lib/finance/periods.ts`: schema + pure `periodOverlap(periods, start, end, exceptId)`, `periodNameTaken(periods, name, exceptId)` | `createDuesPeriod`, `updateDuesPeriod`, `bulkCreateDuesPeriods` (each loads all periods: small table), import |
| dues position per period | `ledger.ts duesPosition` (queries + mapping) | pure `positionOf(member, rate, periods, overrides, paidByPeriod)`; `duesPosition` = load + `positionOf` | every dues action, import `uyeler` (rate freezes) and `aidat-odemeleri` |
| payment refusals (role, `onRoster`, opening date, remaining) | `recordDuesPayment` inline | `src/lib/finance/dues.ts`: pure `paymentRefusal({ member, periodPos, opened, occurredOn, amount })` → `{ field, message } \| null`, messages `NOT_RESPONSIBLE`, `BEFORE_OPENING`, `overpaymentError` | `recordDuesPayment`, `correctEntry` (dues branch), import |
| rate change freezes, rate payer role | `setDuesRate` inline | pure `freezesForRateChange(position, nextRate)` + `isDuesPayer(role)` | `setDuesRate`, import `uyeler` |
| waiver rules + reason schema | `setWaiver` inline | pure `waiverRefusal(member, periodPos)`, `waiverReason` schema | `setWaiver`, import `muaf` rows |
| entry → row mapping, refs, opening guard | `finans/actions.ts` `rowOf`, `checkRefs` | `src/lib/finance/entries.ts`: `entryRow(d)`, pure `beforeOpening(opened, day)`, `BEFORE_OPENING` | `createEntry`, `correctEntry`, import `hareketler` |
| `sponsorSchema`, `SPONSOR_TAKEN` | `finans/actions.ts` | `src/lib/finance/sponsors.ts` | `createSponsor`, `updateSponsor`, import (new sponsors) |
| freeze cleanup after a void | `voidEntry` inline | `dropLapsedFreezes(tx, memberId, periodId)` | `voidEntry`, import undo |
| account balance SQL | `queries.ts signed()` (private) | export `signedBalance(account)` from `queries-internal.ts` + pure `entryEffect(row)` | `balances()`, import preview (AC 30) |
| deactivation side effects | `setMemberActive` (3 statements, **no transaction**) | `src/lib/members/deactivate.ts`: `deactivateTx(tx, userIds, leftAt)` = users update + `sessions` delete + unused `invites` delete | `setMemberActive` (now atomic, a small fix), import `uyeler` |
| edit permission | `canEditMember` (pure already) | unchanged | `updateMember`, `setMemberActive`, import, undo |

Each extraction is behaviour-preserving for the UI, and the Phase 1–8 e2e is the regression net (AC 41).

What the import adds **on top** (spec-sanctioned differences, nothing relaxed):
- `yoklama`: the rehearsal must have **ended before now** instead of "not older than 24 h" (D9). `partiler` on a non-sectional is an error (the UI form just drops it).
- `hareketler`: `kategori` on `virman`, `sponsor` outside `sponsorluk`, `etkinlik` on `virman`, `hedef_hesap` outside `virman` are errors (the UI's `entrySchema` silently strips them; in a file that's a sign of a shifted column).
- D4's "not in the future" for start-type dates, which is stricter than `entryDayField` (today + 31).

## 5. Per-type plan (validation, effects, writes)

Common: `plan()` gets typed rows (cell errors already attached), the snapshot and `ctx = { actor, now, today }`. It returns `{ errors, warnings, effects, counts, writes }`. Rows are processed **in file order**, carrying in-file state (keys seen, amounts paid so far, waivers, new sponsors), so "earlier rows of the same file" rules are natural. A row with any cell error is still checked for key duplicates but not for DB rules (avoids cascades of noise). Errors per row are all reported.

### 5.1 `uyeler`
Snapshot: all users (`id, name, email, role, voicePart, joinedAt, leftAt, isActive`), `member_dues`, `dues_periods`, `dues_overrides`, dues paid sums per (member, period) for live entries.

Per row (match `emailSchema(eposta)`):
- **Existing user.**
  - `canEditMember(actor, target, target.role)` false → `Bu kişiyi yalnızca koro şefi değiştirebilir.` (on every row for such a user, even an unchanged one; AC 25).
  - `ad` given and `searchKey(ad) !== searchKey(user.name)` → warning `Ad portaldakinden farklı: "<dosya>" ↔ "<portal>"`. Case/accent-only differences don't warn.
  - Effective days: `joinDay = katilim ?? istanbulDateOf(joinedAt)`, `leftDay = ayrilis ?? (leftAt && istanbulDateOf(leftAt))`. `leftDay < joinDay` → `Ayrılış tarihi katılım tarihinden önce olamaz.` on the column that was filled.
  - `ayrilis` on an active user who is the actor → `Kendini pasifleştiremezsin.`
  - `aidat_orani` on a non-payer (`isDuesPayer`) → `Koro şefi aidattan sorumlu değil.` (new copy; the UI answers the generic `FORBIDDEN`).
  - **Unchanged is compared by Istanbul day** for the dates: a user who joined "today 14:05" and a file saying today is unchanged. Otherwise `joinedAt = istanbulToUtc(day)` and `leftAt = istanbulToUtc(addDays(day, 1)) − 1 s` (**23:59:59**; the column stores seconds, so `.999` would be truncated anyway).
  - Writes: users update; `deactivateTx` for active users getting a date; `member_dues` upsert (rate only, keeping the existing `note`) and `freezesForRateChange` overrides. Items store before/after (§11).
  - Warning (AC 24): `<k> kişi pasifleştirilecek ve oturumları kapatılacak: <ad>, <ad>, …`.
- **Unknown email.** No `ayrilis` → D7 message. Else `ad` (`nameSchema`), `katilim`, `partisyon` required: `Eski üye için <ad|katılım tarihi|partisyon> gerekli.` Created with `role = member`, `isActive = false`, `passwordHash = null`, `phone = null`, both dates as above (passes `users_left_matches_active` and `users_left_after_joined`), optional `member_dues` row. `canEditMember(actor, {role: member}, member)` is true for both manager roles, as in `createMember`. No invite is created; `createMemberLink` already refuses inactive users.
- Natural key: email.

### 5.2 `donemler`
Snapshot: all terms. `termSchema` → `termConflict` against DB terms **plus earlier file rows**. Same name + same dates → unchanged; same name, other dates → `Bu adla farklı tarihli bir dönem var.`; overlap → `Dönemler çakışamaz.` `baslangic` not future, `bitis` may be. Write: insert.

### 5.3 `yoklama`
- **Grouping.** Rehearsal key = `tarih` + effective `baslangic`. **Blank `baslangic`** means "the rehearsal of the nearest earlier row with the same `tarih`", or `19:00` if there is none. That is what the spec's sample needs (row 2 inherits row 1) and stays unambiguous with two rehearsals on one day. @po: please confirm the wording for the README. The first row of a group fixes `bitis` (default `22:00`), `tur` (default `tutti`), `partiler`, `baslik`, `yer`; on later rows a filled value must equal it (after normalisation), else `Bu çalışmanın ilk satırıyla (satır <m>) farklı.` (new copy) on that column.
- **Rehearsal validation:** `rehearsalSchema` on `{ type, date, start, end, title, location, parts }`, errors mapped back to columns (`type→tur`, `parts→partiler`, `end→bitis`, `title→baslik`, `location→yer`) and reported on the group's first line; `endsAt > now` → `Bitmemiş bir çalışma içe aktarılamaz.` (new copy).
- **Snapshot:** all users (roster fields), rehearsals with `starts_at IN (<group instants>)` + their parts, the import items for those rehearsals, and their `manual` attendance rows.
- **Rows:** member must exist (`Bu e-postayla üye yok.`); `isExpected(user, rehearsal)` → else the D9 message; `not` only with `mazeretli` → `Not yalnızca mazeretli satırda yazılır.` (new copy, AC 28's "the D9 message" for this case). Key: rehearsal key + email.
- **Conflicts:** a portal rehearsal (no import item) at the same `starts_at` → D9 message, cancelled ones included. An imported one: unchanged iff type, parts, title, location, `ends_at` and the set `{ userId → (status, note) }` of its manual rows equal the file group; else `Bu çalışma daha önce farklı yoklamayla aktarıldı; önce o aktarımı geri al.` Auto rows are not compared (they are derived).
- **Writes:** rehearsal (`openedAt = startsAt`, `closedAt = endsAt`, `createdBy = actor`, `seriesId = null`), parts, manual rows (`recordedBy = actor`, `recordedAt = startsAt`), then `absentRows(expectedIds − listed, endsAt)` exactly like `closeRehearsal`. One item per rehearsal; attendance cascades with it.
- Warning: `<k> çalışmada toplam <m> beklenen kişi listede yok; Gelmedi sayılacak.` Effects: `7 Eki 2025 19:00 Tutti: 31 kişi, 4 Gelmedi (listede yok)`.
- **Counts are rows** (attendance lines), like every other type; the auto-absent rows are only in the warning. @po: please confirm, since `İçe aktar (<a + u> değişiklik)` reads it.

### 5.4 `hareketler`
Snapshot: opening date (`openingDate`), live balances (`signedBalance`), sponsors (`id, nameKey, isActive`), events (`id, name`), this type's live items by `kayit_no` + their entries.
- Category `aidat`/`dues` → D10 message before the schema runs. Then `entrySchema` on the UI-form-shaped object (`kind`, `category`, canonical amount string, `occurredOn`, `account`, `toAccount`, `description`, `counterparty`, `documentUrl`, `sponsorId`, `eventId`), with the import-only checks of §4.
- `beforeOpening` → D10's opening message with the date.
- Sponsor: `sponsorSchema` name rules, then `searchKey` lookup among **all** sponsors (inactive ones too; the unique `name_key` index would refuse a duplicate anyway). Unknown → one new sponsor per key per file (id generated in the plan), warning `Yeni sponsor oluşturulacak: …`.
- Event: exact `cleanLine(trim)` name match; 0 → `Bu adla bir etkinlik yok.`; > 1 → `Bu adla birden çok etkinlik var; etkinliği adından ayırt et.`
- `kayit_no`: in-file duplicate → `Satır <m> ile aynı kayıt.`; existing live item: unchanged iff `entryRow(d)` equals the entry's columns and the entry is not voided and `revision = 0`; else `Kayıt <kayit_no> daha önce farklı içerikle aktarıldı ya da portalda değişti; önce o aktarımı geri al.` (new copy).
- Preview `balances = current + Σ entryEffect(new rows)` (AC 30). Writes: sponsors, entries (`createdBy = actor`, `createdAt = now`), items.

### 5.5 `aidat-donemleri`
Snapshot: all periods. `periodSchema` (its bounds, messages) + `periodNameTaken`/`periodOverlap` against DB + earlier rows; `baslangic` not future. Same name + same values → unchanged; different → `Bu adla farklı bir aidat dönemi var.` (new copy). Writes: insert with `createdBy`.

### 5.6 `aidat-odemeleri`
Snapshot: as 5.1's dues part, plus opening date, periods by exact name, this type's live items.
- Member by email, period by exact name (`Bu adla bir aidat dönemi yok.`).
- `odeme`: `tutar`, `tarih`, `hesap` required. `paymentRefusal` with `periodPos` from `positionOf` **after the file's earlier rows** (paid += earlier amounts; a waiver earlier in the file sets owed 0). Exactly `recordDuesPayment`'s single-period rules.
- `muaf`: `tutar/tarih/hesap` must be empty → `Muafiyet satırında tutar, tarih ve hesap boş olmalı.`; `waiverReason` on `aciklama`; `waiverRefusal` with the paid amount including earlier file rows → `Bu döneme ödeme var; muafiyet verilemez.` A hand-made waiver already in place → `değişmeyecek`, and no item is written (the `kayit_no` stays free).
- Writes: entries shaped exactly like `recordDuesPayment`'s (`income`, `dues`, `memberId`, `duesPeriodId`, no `paymentGroupId`, no counterparty), `waiver` overrides, items.

## 6. Check → commit (D12, AC 15–20)

### 6.1 Actions (`src/app/(portal)/ice-aktar/actions.ts`)

```ts
export async function checkImport(slug: string, formData: FormData): Promise<CheckResult>
export async function commitImport(slug: string, formData: FormData): Promise<CommitResult>
export async function undoImport(batchId: string): Promise<FormState>
```
Slug is bound in the server page (`.bind(null, slug)`). Every action does, in this order: `assertManager()` → `{ kind: "denied", message: FORBIDDEN }`; `slug` against `SLUGS` (z.enum); `formData instanceof FormData`; `formData.get("file") instanceof File`. Nothing is parsed before the role check, so a crafted korist@ request costs one session read.

### 6.2 Check
`decode → parseCsv → engine → snapshot (db.batch of the type's selects: one round trip, consistent) → plan`. Returns at most `IMPORT_MAX_ERRORS` errors plus the true `errorCount`. Also returns `FileMeta { name, size, sha256 }` with the cleaned name (`cleanLine`, path separators stripped, ≤ 120 chars) and the "same file" warning (`import_batches` by `sha256`, not undone: `Bu dosya <tarih> tarihinde <ad> tarafından aktarılmıştı.`). **No write of any kind**, no `revalidatePath`.

### 6.3 Commit
1. Auth, slug, file as above. `sha256` field must be 64 hex → else `Önce dosyayı kontrol et.`
2. Recompute the hash of the received bytes; ≠ → `fileError` `Dosya kontrol edildikten sonra değişti. Yeniden kontrol et.`
3. Parse again (pure, cheap).
4. `writeTx(async (tx) => …)` (libSQL `transaction()` = `"write"` = `BEGIN IMMEDIATE`, retried on `SQLITE_BUSY`): read the snapshot **through `tx`**, `plan`, and:
   - errors → throw a `PlanRejected` carrying them → rollback → `{ kind: "errors", … }`;
   - 0 changes → return `{ kind: "fileError", message: "Değişecek bir şey yok; bu dosyadaki her şey zaten portalda." }` without writing (the double-tap case);
   - else insert the batch row, then the writes in dependency order, in chunks, then the items; return `done`.
5. `revalidatePath("/", "layout")` after success only.

Two managers committing at once are serialised by the write lock; the second plans against the first one's result. An undo racing a commit is serialised the same way.

### 6.4 Writes and chunking
Multi-row `insert … values` in chunks of `floor(2000 / columns)` rows (attendance ≈ 285 rows per statement, finance entries ≈ 110), far under SQLite's 32,766 parameters. Member updates: one statement per changed user (≤ a few hundred), or one `UPDATE … FROM (VALUES …)` if the tech lead prefers; at our size either is fine.

### 6.5 Fault hook (AC 19)
`faultAfter = NODE_ENV !== "production" && DATABASE_URL?.startsWith("file:") ? Number(cookie "arkhe_e2e_import_fault") : null`. After the chunk containing logical row `n` is written, throw `Error("e2e import fault")` → the whole transaction rolls back, the batch row included. `e2e:prod` sets the cookie and asserts the import succeeds in full (the hook is dead there). The cookie is set by the test with `context.addCookies`; no env var on the running server, no schema change.

## 7. Undo (D13, AC 38–40)

`undoImport(batchId)`: `assertManager`; `z.uuid()`; then one `writeTx`:
1. Load the batch; missing → `NOT_FOUND`; already undone → `Bu içe aktarma zaten geri alındı.` (new copy; also makes a replayed request harmless).
2. Stack: the not-undone batch with the highest `seq` must be this one → else `Önce daha sonraki içe aktarmayı geri al.` (`seq` is an integer, not a timestamp; @dba §11).
3. Who: `actor.role === "conductor" || batch.createdBy === actor.id` → else `Bu içe aktarmayı yalnızca yapan kişi ya da koro şefi geri alabilir.` For `uyeler`, a board actor also needs `canEditMember` on every affected user **as they are now** (someone may have been promoted to board since) → `Bu kişiyi yalnızca koro şefi değiştirebilir.`
4. Dependency checks (set-based, a few queries joined to the batch's items), first conflict named:

| Type | Refused when | Then |
|---|---|---|
| `uyeler` | a user's current `(joinedAt, leftAt, isActive, voicePart, rate)` ≠ the stored *after* values; or a created former member is referenced by `attendance`, `finance_entries`, `dues_overrides` (other than the batch's own), Phase 8 board rows… (pre-check the three main tables to name the person; the restrict FKs are the backstop, mapped to the same message) | restore *before*; delete created `member_dues` rows, then the created users; delete created freezes; `member_dues` rows that existed before get their old rate back |
| `donemler` | — | delete the terms |
| `yoklama` | any attendance row of the rehearsal has `corrected_at`; the rehearsal's columns or parts ≠ the stored after-snapshot; an `events.rehearsal_id` points to it | delete the rehearsals (attendance, parts, secrets cascade) |
| `hareketler` | an entry has `voided_at`, `revision > 0` or is the `replaces_id` of another | void with `İçe aktarma geri alındı` (`voidedBy = actor`); created sponsors `is_active = false` |
| `aidat-donemleri` | any `finance_entries` row (voided or not) or `dues_overrides` row references the period | delete the periods |
| `aidat-odemeleri` | an entry voided/corrected/edited; a waiver's current row ≠ the stored one | see 7.4; delete the batch's waivers; `dropLapsedFreezes` per affected (member, period) |

5. Mark the batch `undone_at = now`, `undone_by = actor`; `revalidatePath("/", "layout")`; `{ success: "İçe aktarma geri alındı." }`.

### 7.4 The dead end in D13 as written (@po, important)
With voiding, an undone `aidat-odemeleri` batch leaves voided entries that still reference **the periods** (restrict FK, and D13's own rule "any finance entry, voided or not") and **the former members** (restrict FK). So after `undo payments`:
- the `aidat-donemleri` batch below it can **never** be undone, and
- because undo is a stack, **nothing older can be undone either**: not the attendance, not the member history.

The realistic evening ("import all six, look at the reports, the 2023 attendance is wrong") hits this on the first try. I recommend: **undo deletes imported dues payment entries** (hard delete) when they are untouched, which the dependency check already guarantees. They never existed outside the import, the batch log keeps the counts, and the monthly backup keeps the history. Ordinary `hareketler` keep D13's void: they reference sponsors and events, which aren't deleted, so they block nothing. If you prefer the ledger rule without exception, D13 must say that a dues-payment import makes everything below it permanent, and the page must warn before step 6.

## 8. Routes and page reads

- `GET /ice-aktar/[tur]/ornek` → `sampleCsv(def)`, `csvHeaders("<n>-<slug>.csv")`. `GET /ice-aktar/[tur]/talimat` → `markdown(def)`, `text/markdown; charset=utf-8`, attachment, `no-store`. `GET /ice-aktar/uye-listesi` → `csvDocument` with the AC 4 header; `rol` as `sef/yonetim/korist`, `durum` as `aktif/ayrildi`, dates `istanbulDateOf`, ordered by name with the `tr` collator. All three call `managerOrError()` first: logged-out requests are already redirected by `proxy.ts` (not under `/api/`), korist@ gets 403 with the small JSON error and no file body (the Phase 8 D38 pattern). Unknown `tur` → 404.
- `queries.ts` (each export `requireManager()`): `importIndex()` (opening state, last backup, last batch per type), `listBatches(page)` (50 per page, fetch 51, joined to user names), `rehearsalImported(id)` and `entryRecordNo(id)` for the AC 35 markers. The detail pages call them only when `isManager(user.role)`, so korist@ never triggers the query.
- `/calismalar` paging (AC 36): `listRehearsals({ …, offset })`, `?sayfa=` as `z.coerce.number().int().min(1).max(1000)`, invalid → page 1 (agree with @ui §5).

## 9. Limits and time budget (@po §7 q2b, AC 44)

- **Bytes:** client pre-check; `bodySizeLimit: "1100kb"` (`experimental.serverActions`, as the Next 16.4 docs and `config-shared.d.ts` define it); server `file.size` check. The 1100 KB limit applies app-wide; every other action already validates its own input, so this is harmless. Vercel's 4.5 MB request cap and the proxy's 10 MB buffer are above it.
- **Rows:** 5000, counted before any row check.
- **CPU:** decode + tokenise 1 MB and plan 5000 rows is pure JS over arrays and `Map`s: tens of milliseconds.
- **Round trips, 5000-row `yoklama` commit:** session (1) + ~8 snapshot reads + batch row (1) + rehearsals (1) + parts (1) + attendance ≈ 22 (5000 listed + auto-absent rows, 285 per statement) + items (1) + commit ≈ **35 statements**. A 2000-row `hareketler` commit: ~6 reads + 20 entry chunks + items ≈ 30.
- **Where the DB is:** `vercel.json` pins functions to **`arn1` (Stockholm)**, the same city as the Turso database, so a round trip is a few milliseconds and the commit is well under 1 s of DB time. `design/STATUS.md` still says `iad1`; @tech lead, please check the live project's function region. If it really is `iad1` (~100 ms to Stockholm), 35 statements are ~3.5 s inside one interactive transaction, which is too close to the few-second lifetime Turso gives an interactive transaction. The fallback I'd then build is a `batchTx` helper on `db.$client.transaction("write")` that sends the snapshot reads in one `tx.batch()` and all writes in a second `tx.batch()` (4 round trips total). The pure `plan()` doesn't change either way.
- **Budget:** `maxDuration = 60` on both pages. Target on production: check < 2 s, commit < 5 s for 5000 rows. If a measurement on Turso misses that, risk 5 applies: the row cap goes down in `po-decisions.md`, never the all-or-nothing rule. The README gets "büyük geçmişi sezonlara böl".

## 10. Logging and privacy (D14, constraint 6)

- The file is read into memory, hashed and parsed, and dropped with the request. Nothing is written to disk, cache or the DB except the batch row's fields (cleaned name, size, SHA-256, counts) and the item rows.
- `console.info("import", { op: "check" | "commit" | "undo", slug, rows, errors, added, updated, unchanged, ms })`. Never: the file name (it may be "Ayşe'nin aidatları.csv"), emails, names, cell values, error or warning sentences (they quote cell values), or the hash.
- Unexpected errors: `console.error("import failed", { op, slug, name, code })`, like the backup cron. The user gets `GENERIC`.
- Responses carry only strings and counts (never DB rows), and only to managers.

## 11. What I need from @dba (constraint 1: additive only, migration `0009`)

- `import_batches`: `id`, **`seq` integer, unique, monotonic** (stack order; timestamps have 1 s resolution), `type` (CHECK in the 6 slugs), `created_by` (FK restrict users), `created_at`, `file_name` (1–120), `file_size` (> 0), `sha256` (64 lower hex), `row_count`, `added`, `updated`, `unchanged` (integers ≥ 0), `undone_at`/`undone_by` (set together). Index on `sha256`; index on `(type, seq)` for the index cards.
- `import_items`: one row per written target: `batch_id` (FK restrict: batches are never deleted), `target` kind (`user_created`, `user_updated`, `member_dues`, `override`, `term`, `rehearsal`, `finance_entry`, `dues_period`, `sponsor`), the target key (`dues_overrides` and `member_dues` have composite / user keys, so either typed nullable FK columns with an "exactly one" CHECK, or `target_id` text plus a second `target_user_id`), `record_no` (hareketler / aidat-odemeleri), `before_json` / `after_json` (users, member_dues, rehearsal snapshot, waiver row). **No item per attendance row**: rehearsals cascade them, and the idempotency compare reads `attendance` directly. That keeps a 5000-row file at ~140 items.
- `record_no` unique per `(type, record_no)` **among not-undone items**: a partial unique index needs a column on the item itself (`released_at`, set by undo), since an index can't look at the batch. Items stay after undo (the log and AC 35's "voided but imported" marker need them).
- Typed FKs to `rehearsals`/`dues_periods`/`terms` must not block our own undo order: we delete the item-less targets after marking items released, or the FKs are `set null`. Your call; tell me which and I'll order the statements.
- e2e cleanup: `cleanup()` deletes `finance_entries` and `sponsors` first (@ui's finding), so the import tables must be wiped before them.

## 12. Threats and mitigations

| Threat | Mitigation |
|---|---|
| Member calls check/commit/undo or downloads (privilege escalation) | `assertManager()` first in every action; `managerOrError()` in every route; pages `requireManager()`; AC 1 e2e as korist@ and logged out. |
| Board edits conductor/board via the file | `canEditMember` per row (§5.1) and again per user on undo (§7). No `rol` column exists, and former members are always `member`. |
| Board deactivates themselves / the conductor locks the choir | `Kendini pasifleştiremezsin.`; board can't touch the conductor at all. |
| A former member logs in | `password_hash = null`, `is_active = 0`, no invite; login refuses both; `createMemberLink` refuses inactive. Reactivation stays a deliberate click by a manager (then the normal invite flow). |
| IDOR on undo | Only a `batchId`; ownership (`created_by` or conductor) and stack checked inside the transaction. |
| TOCTOU between check and commit | Commit re-reads and re-plans inside the write transaction; the check's result is never trusted. |
| Swapped file | Server-side hash compare (§6.3); the hash is a UX guard (what you saw is what is written), the re-validation is the security guard. |
| Replay / double submit | 0-change commit writes nothing; undo of an undone batch is refused. |
| CSRF | Server actions get Next's Origin check (the Phase 6 Safari fix keeps it working). The GET routes have no side effects. |
| Oversized / hostile input | 1 MB before reading, 5000 rows, 2000 chars per cell, anchored linear regexes, a single-pass tokenizer, ≤ 1000 errors returned, ≤ 50 effects, echoed values cut to 40 chars. |
| Spreadsheet formula injection in our outputs | Member list via `csvDocument`/`csvCell`; samples are our own fictional data with the same guard; error text is rendered by React (escaped) and copied as plain text. |
| Invisible / bidi characters in names | `cleanLine` on every text cell, `nameSchema` for former members. |
| Data loss by a wrong file | All-or-nothing transaction, named deactivation warning, balance preview, undo, and the backup hint on the index page. |
| Personal data leaking to logs | §10. |
| Test hook in production | `NODE_ENV` **and** `file:` DB guard; `e2e:prod` proves it's inert. |

## 13. Replies

### @po
- **§7 q2a, parser:** our own code, no library (§0, §2). The spec's format is a strict subset of RFC 4180 with three rules of our own (line-true numbering, no multi-line cells, header-line delimiter); a library would be configured against every one of them.
- **§7 q2b, 5000 rows in one transaction on Vercel Hobby + Turso:** §9. About 35 statements, with functions in `arn1` next to Turso; well under 60 s and under Turso's interactive-transaction lifetime. There's a ready fallback if the region turns out to be `iad1`.
- **§7 q2c, reuse:** yes, as pure validators over a bulk snapshot (§4). That is the only design that's both "no bypass" and fast enough.
- **D13 dead end (§7.4):** please decide. I recommend deleting untouched imported dues payments on undo.
- **Copy, where reuse beats a new sentence** (constraint 3 says "the same rules as the UI"; I'd use the same words too):
  - AC 32 overpayment: the UI says `Kalan borç ₺<x>; daha fazlası girilemez.` (`overpaymentError`); the spec says `Tutar bu dönemin kalan borcunu (₺<x>) aşıyor.` I'd reuse the UI's. When nothing is open (paid, waived, exempt rate), the UI's `Bu dönemlerin borcu yok.` reads oddly per row; I'd add `Bu dönemin borcu yok.`
  - AC 29 same account: the UI says `Kaynak ve hedef hesap aynı olamaz.`; the spec `Hedef hesap kaynak hesaptan farklı olmalı.` Same suggestion.
  - Either way I'll implement whatever `po-decisions.md` says; I only want one sentence per rule.
- **New copy I need settled** (all in §2, §3, §5, §7): the Excel/zip message, `Tırnak işaretleri hatalı.`, the blank-header message, the extra-cells message, the record-number format, `Bitmemiş bir çalışma içe aktarılamaz.`, `Not yalnızca mazeretli satırda yazılır.`, the inherited-value mismatch, the `kayit_no` conflict, the dues-period conflict, `Bu adla bir aidat dönemi yok.`, `Koro şefi aidattan sorumlu değil.`, `Eski üye için <alan> gerekli.` (AC 23 already fixes the `partisyon` case), `Bu içe aktarma zaten geri alındı.`
- **Please confirm:** D6 normalising applies to headers (§2.4); the blank-`baslangic` rule (§5.3); counts are file rows for `yoklama` (§5.3); a board user's row for a manager is an error even when nothing would change (§5.1); dates compare by Istanbul day for "unchanged" (§5.1); `ayrilis_tarihi` is stored as 23:59:59 (seconds column).
- **AC 16 "copies all":** agree with @ui's cap of 1000 messages (the true count is still shown).
- **AC 1 "no body":** routes answer 403 with the small JSON error used by every manager route today (Phase 8 D38), never file content. I read "no body" as "no file", please confirm.
- **AC 15:** the check writes nothing, including no rate-limit rows (§0). The session read doesn't write either (`getSessionUser` has no sliding expiry).

### @ui
- Agree with your §6 contracts (`CheckResult`, `CommitResult`, `(slug, formData)`), the byte snapshot, `bodySizeLimit: "1100kb"`, `IMPORT_MAX_BYTES = 1_048_576` exported from `src/lib/import/limits.ts`, the 1000-error cap, the generator plus byte-compare for the docs, and `maxDuration = 60` on both pages.
- §6.4 double commit: confirmed (§6.3 step 4). The second request gets `fileError` "Değişecek bir şey yok…" and the same-file warning, no batch.
- §6.8 fault hook: not `app_settings` (its key CHECK would need a table rebuild, which constraint 1 forbids). I use a cookie `arkhe_e2e_import_fault=<n>` with the same production and `file:` guards (§6.5); set it with `context.addCookies`.
- The route segment is `[tur]`, as in your table; I'll use that name.
- React 19 resets the form after an action. Your snapshot approach already covers it; just don't rely on the `<input type=file>` still holding the file at commit time.

### @dba
- §11 is my need list; you own the names and constraints (AC 42). The two things I can't do without are the integer `seq` and a per-item "released on undo" marker for the `kayit_no` uniqueness. Please also say whether item FKs are restrict or `set null`, so I can order the undo deletes.
- Former member insert: `is_active = 0`, `left_at` = day end, `joined_at` = day start, `left_at ≥ joined_at` checked by the planner first. It passes `users_left_matches_active` and `users_left_after_joined` as they are.

### @ux
- Every user-facing sentence comes from the server (definitions and planner), so copy changes are one file. Effects use `formatAuditDate`/`formatTime` (Istanbul) and `formatKurus`.
