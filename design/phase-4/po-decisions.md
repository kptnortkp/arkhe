# Phase 4 — PO decisions

Author: arkhe-po. Settles `po-spec.md` §10 and every conflict between `ux.md`, `ui.md`, `db.md`, `backend.md`. Where this file is silent, the role file owning the topic stands (ux: copy/flows/visuals, ui: components/a11y, db: schema/queries, backend: actions/mail.ts/deadline.ts). This file wins over all of them.

## 1. Decisions

| # | Topic | Decision | Reason | Owner |
|---|---|---|---|---|
| D1 | Day-count rounding | **Ceil** for `{d} gün kaldı` (`Math.ceil(r / 24h)`), ceil for `{h} saat kaldı`, **floor** for `Gecikti · {d} gün` (0 → `Gecikti`). Bands: green `r > 72h` (≥ 4 gün), amber `24h < r ≤ 72h` (2–3 gün), red `0 < r ≤ 24h` (hours; `< 1h` → `1 saatten az kaldı`). Spec's floor is replaced. | Bands never show the same number in two colours (floor makes "3 gün" both green and amber); "2 gün kaldı" at 47h is how a singer reads it. | backend |
| D2 | Seed offsets | Every offset sits mid-band so the text holds ≥ 30 min either way: A `T+4d12h` (`5 gün`), B `T+1d12h` (`2 gün`, amber), C `T+4h30m` (`5 saat`), D `T−2d12h` (`Gecikti · 2 gün`), E `T−10d`, F `T+3d12h` (`4 gün`). db.md §6 offsets (`+5d+12h` etc.) are replaced; ui's floor offsets are dropped. | AC3 stays stable however long the suite runs. | db |
| D3 | Tones / tokens | `data-tone` = `green\|amber\|red\|done\|muted`. Attendance tokens: green `bg-present/14 text-present-ink`, amber `bg-late/18 text-late-ink`, red soon `bg-absent/12 text-absent-ink`, done/muted `bg-muted`. Icons per ux §2 (`Clock`, `Hourglass`, `AlarmClock`, `CircleAlert`, `CircleCheck`, `CalendarX`). No `success`/`gold`/`destructive` aliases, no new tokens. | `gold`/`success` text fails 4.5:1; singers already read these colours from Phase 2. | ux, ui |
| D4 | Overdue red | **Solid** `bg-absent` with `text-white` in light, `dark:text-background` in dark; must reach ≥ 4.5:1 in both (ui verifies in review, fallback = soft + `CircleAlert`). In `Geçmiş` overdue uses the soft red. | Solid vs soft separates "late" from "soon" without relying on hue. | ui |
| D5 | Not-expected singer (late joiner / changed part) | Tone `muted`, label `İsteğe bağlı` before the deadline, `Son tarih geçti` after. Never amber/red, never counted in the badge. Hint `Sen katılmadan önce verildi; istersen teslim edebilirsin.` | Simpler than backend's red→amber rule; it's optional practice. | backend, ux |
| D6 | Manager row past due | Muted `Süre doldu` (`CalendarX`) + `{k} eksik` in `text-absent-ink`. Before due: deadline tone. If the manager is also an expected, unsubmitted singer (YK), the row adds `text-xs` `Teslimin bekleniyor`. | The homework isn't late, singers are; YK needs to find their own. | ux |
| D7 | Tab badge | Shown to **anyone** with expected, unsubmitted homework in `Güncel` (members and board singers; conductor and no-part users never). `bg-primary text-primary-foreground ring-2 ring-background`, `9+` above 9, hidden at 0, also in the sidebar. Hook `data-nav-badge={n}`; accessible name `Ödevler, {n} bekleyen ödev`. One `cache()`d count shared with the home card. | It's the main nudge and YK sing too; red would alarm on green homework. | ui, db |
| D8 | Q1 undo after manual mark | **Allowed** (their record). Singer sees `Teslimini {Ad Soyad} işaretledi.` under the state. Undo is blocked only by feedback. | One rule, one statement. | backend |
| D9 | Q4 feedback authors | Conductor **and** board. Heading `Şefin notu` when the author's role is `conductor`, otherwise `Geri bildirim` (also when the author is null); always footer `{Ad Soyad} · 22 Eki 21:40`. | A YK note must not pose as the conductor's. | ux |
| D10 | Note seen | Separate self action `markFeedbackSeen`, fired by a client effect when the note renders on the detail page. Never on GET/prefetch. Re-saving unchanged text doesn't revive `Yeni not`; a changed text does. | Prefetch must not mark notes read. | backend |
| D11 | `Güncel` window | `dueAt ≥ now − 7×24h`, asc; `Geçmiş` older, desc. Singer groups `YAPILACAK` / `TESLİM ETTİKLERİM`. | Weekly rhythm: last week's late homework stays visible for one rehearsal. | ux |
| D12 | Matrix | 8 latest by `dueAt`, **newest left** on every width (db's "shown ascending" is dropped). Cells are **icons** (`Check` on time, `Clock` late, `X` missing, `·` pending, blank not eligible) with a word legend (`Zamanında`, `Geç`, `Gecikti`, `Bekleniyor`, `Bu partisyon için değil`), `aria-label` per cell, hook `data-cell="done\|late\|missing\|pending\|none"`. Scroll only inside the focusable region. | Latest homework visible at 375 without scrolling; icons + words beat letters. | ui, ux |
| D13 | Detail roster filter | `?filtre=eksik` (ux owns URLs; ui's `?durum=` dropped). Section anchor `#teslimler`. | One naming. | ui |
| D14 | Piece picker | **Native `<select name="pieceId">`** with `<optgroup>` `Çalışılıyor` / `Hazır`, placeholder option `Eser seç`; archived current piece on edit as an extra `(Arşiv)` option. ux's search sheet is out. `Ödev ver` in the piece menu is hidden on archived pieces. | < 200 pieces, accessible, no JS, no new component. | ui |
| D15 | Create idempotency | Hidden client UUID = primary key; `onConflictDoNothing`; same creator → success with that id, other → STALE. | Double tap on a flaky phone can't create two. | backend |
| D16 | Edit version check | Hidden `updatedAt` version; mismatch → `Ödev bu arada değişti. Sayfayı yenileyip tekrar dene.` | Two managers editing parts/deadline. | backend |
| D17 | Submit feedback | Inline row/home: optimistic move + toast `Teslim edildi.` with action `Geri al` (6 s). Detail: no toast, button flips in place + sr-only status. Undo toast `Teslim geri alındı.` | On the list the button leaves view, so undo must travel with the toast. | ui, ux |
| D18 | Shared components | Move `useRunAction` → `src/components/use-run-action.ts`, `ConfirmDialog` and `PartDot` → `src/components/`, imports updated, no behaviour change. Allowed this phase. | Now used by two features. | ui |
| D19 | Seed fixture | `scripts/homework-fixture.mjs` `seedHomework(client, T)`: deletes `seed-hw-%`, reinserts per db.md §6 with D2 offsets, upserts `recording_email = kayit@arkhe.local`, and **upserts `yeni@arkhe.local`** ("Arda Tan", member, tenor, demo password, `joined_at = T − 1h`). Called by `seed.ts` and by e2e `cleanup()` with `T = now`. `yeni@` is **not** in seed.ts's `choir` array, so no attendance rows are created for him. | Re-anchoring to now keeps clock ACs stable; Phase 2 reports unchanged. | db |
| D20 | Member counts | Checked `e2e/`: Phase 1–3 tests compute counts with SQL at run time (Phase 2 AC20/AC30) and no test hard-codes the roster size or tenor count. Adding `yeni@` is safe. Tech lead re-runs the whole suite to confirm. | — | tech lead |
| D21 | Eligibility | One helper `src/lib/homework/eligibility.ts` (backend §1.1); `leftAt === null` and `is_active` are equivalent by `users_left_matches_active`. db §2 and backend agree otherwise. | One definition. | backend |
| D22 | Migration | **`0004_phase4_homework`** (0003 is the Phase 3 label fix, applied). Additive only; db.md §1 schema incl. all CHECKs and `submissions_not_empty`. Badge index: db verifies the plan on the final query; add `assignment_parts(voice_part, assignment_id)` only if it scans. | — | db |
| D23 | Absolute date | Always `Son tarih: {formatDue}` (e.g. `24 Eki Cmt 23:59`, whatever tr-TR Intl produces). **No `bugün`/`yarın`** wording. | Fewer clock-dependent strings; tests compare with Intl. | ux |
| D24 | Optional ux extras | **In:** numbered steps `Partisyonunu dinle` → `Kaydını gönder` → `Gönderdiysen işaretle` and the nudge after the mail tap. **Out:** quick picks `Sonraki çalışmaya kadar` / `1 hafta` (default already +7 d 23:59), live subject preview. | Steps fight "tapped, never sent"; the rest is form clutter. | ux |
| D25 | Server copy | Not found `Ödev bulunamadı.` (ux's `Bu ödev artık yok.` dropped; UI redirects to `/odevler`), forbidden `Bu işlem için yetkin yok.`, generic `Bir şeyler ters gitti, tekrar dene.` (Phase 3), archived piece `Arşivdeki esere ödev verilemez.`, target `Bu kişi bu ödevden sorumlu değil.`, `Son tarih çok ileride.` (> 2 years). | One voice with Phase 3. | backend |
| D26 | Mail | backend §1.3: `encodeURIComponent`, CRLF body, unencoded address only via `RECORDING_EMAIL_RE`; subject ≤ 200 chars trimming the title. Copy fallback per ui §3 (`Kopyalanamadı, konuyu elle seç.`). | AC4 literal prefix stays safe. | backend, ui |
| D27 | Recording email | ux §7 dialog; empty clears (row deleted). Members without email: spec §3.2 copy; managers: banner `Kayıt e-postası ayarlanmadı. Koristler kaydını nereye göndereceğini göremiyor.` + `Ayarla`. | — | ux |
| D28 | Freshness | Badges/tone computed per request with one `now`; no client ticking; `revalidatePath("/", "layout")` after every write. | Accepted staleness for an open tab. | ui, backend |

## 2. Final copy changes (vs spec)

- `{d} gün kaldı` uses ceil (D1); not-expected: `İsteğe bağlı` / `Son tarih geçti`; managers past due: `Süre doldu` · `{k} eksik`; YK row tag `Teslimin bekleniyor`.
- Feedback heading `Şefin notu` or `Geri bildirim` (D9); manual mark line `Teslimini {Ad Soyad} işaretledi.`
- Matrix legend `Zamanında` · `Geç` · `Gecikti` · `Bekleniyor` · `Bu partisyon için değil`; sub `Son 8 ödev · yeni olan solda`.
- Errors: `Ödev bulunamadı.`, `Ödev bu arada değişti. Sayfayı yenileyip tekrar dene.`, `Bir eser seç.`, `Bu kişi bu ödevden sorumlu değil.`, `Arşivdeki esere ödev verilemez.`
- All other copy as in `ux.md`, minus the dropped extras (D24) and `bugün`/`yarın` (D23).

## 3. Final acceptance criteria

Rules for tests: no mail client, no real email; assert `href`, `data-tone`, `data-cell`, `data-nav-badge` and our UI. Every suite starts with `cleanup()`, which re-anchors the fixture to now (D19). Dates in expected text are computed in the test with `Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul" })` at assertion time. Seed counts are those in db.md §6.

Member (`korist@`, alto, "Demo Korist")
1. `Ödevler` is in the 375 px tab bar and the desktop sidebar; `korist@`'s badge is `4` (A, B, C, D), `yk@`'s is `2` (B, C), `sef@` and `yeni@` have none. With 10 open alto homework (test-inserted on an `E2E` piece) the badge reads `9+`.
2. `/odevler` (Güncel) shows A, B, C, D under `YAPILACAK`, not E or F; E appears only under `?liste=gecmis`. Rows show `Ölçü 12–34` / `Tüm eser` correctly.
3. Badges: A `green` `5 gün kaldı`, B `amber` `2 gün kaldı`, C `red` `5 saat kaldı`, D `red` `Gecikti · 2 gün`. Test-inserted homework: `+72h−10min` → amber `3 gün kaldı`; `+72h+10min` → green `4 gün kaldı`; `+23h` → red `23 saat kaldı`; `+30min` → red `1 saatten az kaldı`. Every badge has text and an icon next to `Son tarih: …`.
4. On A's detail the mail link `href` starts with `mailto:kayit@arkhe.local?subject=`, contains no `+`, and the decoded subject is `Arkhe ödev · Ave Verum Corpus · Ölçü 12–34 · Alto · Demo Korist`; the decoded body contains `Son tarih:`. `Konuyu kopyala` shows `Konu kopyalandı.` (or the fallback message without error). Steps 1–3 are visible.
5. `Partisyonum` on A has the same `href` as on `/repertuvar` (Phase 3 AC4); `Esere git` → `/repertuvar/{pieceId}?partisyon=alto`.
6. `Teslim ettim` on A (detail) flips to `Teslim edildi · {today}` (`done`), survives reload, and the badge becomes `3`. `Geri al` restores the green badge and `4`. On the list, `Teslim ettim` on B moves it to `TESLİM ETTİKLERİM` with the toast `Teslim edildi.`, whose `Geri al` moves it back.
7. `Teslim ettim` on D shows `Geç teslim · {today}`; D's manager roster and `/odevler/matris` show korist as late (`data-cell="late"`), and D's alto count rises to `4/6`.
8. E's row shows `Yeni not` before opening; E's detail shows `Şefin notu`, the seeded text and `Demo Şef · {date}`; after returning (reload) the dot is gone. No `Geri al` on E; calling the undo action returns `Şef geri bildirim yazdı; teslimi geri alamazsın.`
9. F's detail has no `Teslim ettim` and says `Bu ödev senin partisyonun için değil.`; calling the submit action for F returns `Bu işlem için yetkin yok.` and writes nothing.
10. `korist@` sees no `Ödev ver`, edit, delete, matrix, roster, note or `Kayıt e-postası` controls; `/odevler/yeni`, `/odevler/[id]/duzenle`, `/odevler/matris` redirect away; every manager action returns `Bu işlem için yetkin yok.` and changes no rows. Ceren's note `Kaydın gelmedi, cumartesiye kadar gönderebilirsin.` never appears in `korist@`'s HTML of `/odevler`, D's detail or home.
11. `yeni@` (tenor, joined after D was given) sees D with `data-tone="muted"`, `Son tarih geçti` and the joiner hint; can submit it; before submitting, D's roster and matrix don't list him; after submitting he appears with `Sonradan katıldı` and both numbers rise by 1.
12. With the recording email cleared, A's detail shows `Kayıt e-postası henüz ayarlanmadı. Kaydını şefe nasıl ileteceğini sor.` and no `mailto:` link, `Teslim ettim` still works; managers see the `Ayarla` banner.

Manager (`sef@` / `yk@`)
13. From `Ave Verum Corpus`' menu `Ödev ver` opens `/odevler/yeni?eser={id}` with the piece preselected; bars 5–20, Alto + Tenor, due +3 d 21:00, a description → lands on the detail with `Ödev verildi.`, showing `Ölçü 5–20`, Alto and Tenor chips and `Son tarih` in Istanbul time. `Ödev ver` is absent on an archived piece.
14. Validation: `20`–`5` → `Bitiş ölçüsü başlangıçtan küçük olamaz.`; only `Başlangıç` → `Ölçüleri başlangıç ve bitiş olarak gir (ör. 12–34).`; no part → `En az bir partisyon seç.`; no piece → `Bir eser seç.`; past date → `Son tarih geçmişte olamaz.` Replaying the create action with the same client id leaves one row.
15. D's roster shows `S 4/7 · A 3/6 · T 3/4 · B 3/5`, `13/22 teslim`, states `Teslim edildi` / `Geç teslim` / `Gecikti`, `şef işaretledi` on Kaan Özdemir; `Teslim etmeyenler` (`?filtre=eksik`) lists only the 9 missing.
16. Marking a missing singer (Buse Kurt on D) shows `şef işaretledi` and raises the count; that singer sees `Teslim edildi` and `Teslimini Demo Şef işaretledi.`, and can `Geri al` it (count drops back).
17. `sef@` writes a note for `korist@` on A: korist sees `Yeni not`, then `Şefin notu` with it, and no `Geri al`. `yk@` writes a note for korist on B: heading `Geri bildirim`, footer `Demo Yönetim · {date}`. `Notu sil` removes it and `Geri al` returns.
18. `/odevler/matris` lists expected singers by part, columns newest-left `A, F, B, C, D, E`; korist's cells are `pending, none, pending, pending, missing, done`; the page has no horizontal scroll at 375 px (only the grid region scrolls).
19. Editing A's due to −1 d turns korist's unsubmitted A `red` `Gecikti`. Saving an edit form opened before another save shows `Ödev bu arada değişti. Sayfayı yenileyip tekrar dene.` Deleting A shows `"Ave Verum Corpus · Ölçü 12–34" silinsin mi?` with the submission count, then removes it from the list and matrix with `Ödev silindi.`
20. `Kayıt e-postası` accepts `kayit@koro.org` (A's mailto updates) and rejects `kayit@` with `Geçerli bir e-posta adresi gir.`; cleanup restores `kayit@arkhe.local`.
21. Deleting a piece with homework from its edit page shows `Bu esere bağlı ödevler var. Silmek yerine arşivle.` and deletes nothing (links intact); the piece detail lists its open homework under `ÖDEVLER`.
22. Home: `korist@` sees `Ödevlerim` with D first (overdue), a working `Teslim ettim` and `+3 ödev daha`; `sef@` sees the `Ödevler` card with `{n}/{m} teslim`; `yk@` sees both.

Quality
23. `/odevler` (both lists, member and manager), detail (both roles, open sheet), `yeni`, `duzenle`, `matris` and home: no page-level horizontal scroll at 375 px in light and dark; interactive targets ≥ 44 px; badges carry text + icon.
24. `npm run lint`, `npm run typecheck`, `npm run e2e` (Phases 1–4) pass.

Manual (tech lead, once, not e2e): the mail button on a real iPhone and Android opens the mail app with subject and body in Turkish characters; solid overdue badge contrast in dark mode.

## 4. Out of scope / carry-forward

- Everything in spec §8 (sending mail/reminders, uploads, audio, templates, grades, CSV, part-wide notes, per-assignment inbox).
- Searchable piece picker / combobox (D14), quick deadline picks and live subject preview (D24), `bugün`/`yarın` dates (D23).
- Client-side ticking of tones for long-open tabs (D28).
- Seeded left member with `Ayrıldı` (e2e may create one under `@e2e.test`; not required).
- `(portal)/loading.tsx` polish (Phase 3 carry-forward) stays carry-forward unless trivial.
