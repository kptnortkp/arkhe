# Phase 3 — PO decisions

Author: arkhe-po. Settles `po-spec.md` §9 and every conflict between `ux.md`, `ui.md`, `db.md`, `backend.md`. Where this file is silent, the role file owning the topic stands (ux: copy/flows, ui: components/a11y, db: schema, backend: actions/links.ts). This file wins over all of them.

## 1. Decisions

| # | Topic | Decision | Reason | Owner |
|---|---|---|---|---|
| D1 | Status label (Q7) | Enum stays `concert`; label **`Hazır`**. Form hints: `Şu an öğreniyoruz` · `Konserde söyleyebiliriz` · `Söyledik, dosyalar duruyor`. | "Konser repertuvarı" next to `Program` gets mixed up; `Hazır` + hint is clear. | ux |
| D2 | List chips + URL | `Çalışılıyor` · `Program` · `Hazır` · `Arşiv` · `Tümü`, each with a count. `?liste=calisiliyor|program|hazir|arsiv|tumu`, default/unknown = `calisiliyor`. Backend's `?gorunum=` is dropped. `Program` is hidden for members while the programme is empty; managers always see it. | One naming, ux owns URLs. | ui, backend |
| D3 | Search vs chips | With `q`, search spans all statuses; no chip is `aria-current`; rows show the status chip; line `"{q}" için {n} sonuç · tüm durumlar` + `Aramayı temizle`. `q` ≤ 100 chars. | A singer looking for an archived piece must find it. | ui |
| D4 | `Partisyonum` with no voice part (Q2) | **Hidden** (not rendered) on list, home and detail. The detail page has no part filter row and shows everything. `resolveMyPart` returns nothing for `myPart = null`; backend's Tutti fallback is rejected. Disabled `Partisyon kaydı yok` stays only for users with a part and no part/Tutti file. | Conductor would see 20 identical buttons; the Tutti file is one tap away on the detail page. | backend, ui |
| D5 | Part filter | `?partisyon=soprano|alto|tenor|bas|tumu` (Turkish `bas`, mapped to `bass`). Default = my part, else all. Filters **every kind** with a non-null part; Tutti always shows. A non-own part in the URL appears as a third active chip. Empty `Partisyon kayıtları` in my filter: `Alto için kayıt yok.` + `Tüm partisyonları göster`; if the whole page is empty after filtering: `Bu partisyon için bağlantı yok.` + `Tümünü göster`. | ui's rule is the simplest consistent one; Phase 4 links use this param. | ui |
| D6 | Bulk preview (§3.6) | **Client-side parse** with the shared isomorphic `parseBulk`; no server call for `Önizle`. Server re-parses and re-validates on save, all-or-nothing with `rowErrors`. | Instant on a flaky phone, same result; server stays authoritative. AC13 unchanged. | ui, backend |
| D7 | Bulk folder line | A folder URL with no kind word becomes kind `Drive klasörü` (offered only while the piece has no folder) and sets `driveFolderUrl` on save; otherwise `other`. Toast adds ` Drive klasörü de ayarlandı.` | Spec rule, ux/ui shape. | ui, backend |
| D8 | Iframe `sandbox` | **No `sandbox`.** | `src` is only built from fixed templates + charset-checked ids and CSP limits `frame-src` to two hosts; sandbox adds breakage we can't e2e-test (Drive viewer, YouTube player) for no real gain. | ui |
| D9 | Iframe `referrerPolicy` | `strict-origin-when-cross-origin` on **all** preview iframes (Drive file, folder, YouTube). Global `Referrer-Policy: no-referrer` stays. | YouTube needs a referrer (error 153); one policy is simpler; only our origin leaks. Manual check on a real phone by tech lead. | ui |
| D10 | Iframe `allow` / misc | YouTube `autoplay; encrypted-media; picture-in-picture; fullscreen` + `allowFullScreen`; Drive `autoplay; fullscreen`. `loading="lazy"`, `title="{label} önizlemesi"`. | — | ui |
| D11 | Preview frames | Score/other Drive file `aspect-[3/4] max-h-[75dvh]`; part/recording Drive file and YouTube `aspect-video`; folder `h-96`; `max-w-2xl mx-auto` from md. **One preview open at a time.** Fallback line always shown under an open Drive preview (Q5). | Portrait A4 is unreadable at 4:3; two players on a phone is heavy. | ui |
| D12 | Link positions | Gaps allowed; UI always renders ordinals from row index. Positions start at **1**. **No unique** on `(piece_id, position)`: plain index `piece_links_piece_position_idx`. Reorder = client sends the full id order; server checks the set (else `Liste bu arada değişti. Sayfayı yenileyip tekrar dene.`) and writes `1..n` in a tx. | Idempotent, race-detecting, avoids SQLite per-row UNIQUE collisions. db.md §4.4 swap is replaced. | db, backend |
| D13 | Programme order | Keep partial unique `program_position` + archive CHECK. Append = db's single guarded statement. Reorder/remove = backend's null-then-renumber in a tx with the same STALE set check. Archive = one UPDATE setting status + null position. Clear = one UPDATE. | Unique stays a real guard; renumbering is ≤ 30 rows. | db, backend |
| D14 | Create flow | `/repertuvar/yeni` = piece form only; on success redirect to `/repertuvar/[id]/duzenle#baglantilar`, heading focused, toast `Eser eklendi. Şimdi bağlantılarını ekle.` | Links need an id; keeps C1 under a minute. | ui |
| D15 | Delete / archive | `Eseri sil` only in the edit page danger zone. Confirm (AlertDialog) offers `Vazgeç` · `Arşivle` · `Kalıcı olarak sil`. Detail menu has `Programa ekle`/`Programdan çıkar`, `Arşivle`/`Arşivden çıkar` (restores to `Hazır`); `Programa ekle` is not offered on archived pieces. Archive confirm only when the piece is in the programme. **No `Geri al` toast action** (`Arşivden çıkar` covers it). Hard delete kept (Q4). | Steer to archive without admin burden. | ux, ui |
| D16 | Confirms | `AlertDialog` (cancel focused) for delete link, delete piece, clear programme, archive-in-programme. No `window.confirm`. | ui pushback accepted. | ui |
| D17 | `Partisyonum` accessible name | Visible text first + sr-only suffix (`Partisyonum<span class="sr-only"> (Alto): {title}, yeni sekmede açılır</span>`); same pattern on `Aç`. No `aria-label` that replaces visible text. | WCAG 2.5.3; e2e can use `getByRole('link', { name: /Partisyonum/ })`. | ui |
| D18 | Duration input | `inputMode="decimal"`, placeholder `3:40`. Accept `m:ss` with `:`, `.` or `,` as separator (`3:40`, `3.40`, `3,40`); seconds 00–59; 0:01–99:59. Bare `340` is rejected. Error `Süreyi dakika:saniye olarak gir (ör. 3:40).` Shown as `m:ss`. | iOS numeric pad has no colon; bare digits are ambiguous. | ui, backend |
| D19 | Lengths | title/composer/arranger 120, language 40, voicing 20, notes 1000, **label 120** everywhere (bulk too), URL 2000. | One rule; matches db CHECKs. | backend |
| D20 | Drive folder field | Invalid → `Geçerli bir https bağlantısı gir.`; valid but not a folder → `Bu bir Drive klasörü bağlantısı değil.` | ux copy. | backend |
| D21 | Server copy | Not found **`Eser bulunamadı.`**, link not found `Bağlantı bulunamadı.`, forbidden `Bu işlem için yetkin yok.`, generic `Bir şeyler ters gitti, tekrar dene.`, archived append `Arşivdeki eser programa eklenemez.` | One voice. | backend |
| D22 | Q1 MIDI vs MP3 | Help text only, no badge. Copy: ux §6.2 (`Telefonlar MIDI çalamaz. Partisyonun MP3'ünü de Drive'a koyarsan tarayıcıda dinlenir.`). | Badge would guess from label text. | ux |
| D23 | Q3 / Q5 / Q6 | One programme only. Iframe errors undetectable: permanent fallback line + `Drive'da aç`. Docs/Sheets: no preview, no `docs.google.com` in CSP. | Agreed by all. | — |
| D24 | `resourcekey`, YouTube `t` | Keep `resourcekey` on stored and preview URLs; keep `t` as integer seconds (`&t=90`, preview `?start=90`); strip the rest. `open?id=` is always a file. | backend §1.2. | backend |
| D25 | Loading | Add `src/app/(portal)/repertuvar/loading.tsx` (skeleton rows). `(portal)/loading.tsx` is carry-forward, not this phase. | Scope. | ui |
| D26 | `/uyeler` chips | Raise to `min-h-11` in the same change (allowed: trivial, AC20 consistency). | — | ui |
| D27 | Home card | List (not cards) of up to 5 `learning` pieces by title, no meta chips, `+{n} eser daha` when more. Empty: hidden for members; managers get `Şu an çalışılan eser yok.` + `Eser ekle`. Remove `previewPieces` and the pill. | Same button position on every row. | ui |
| D28 | Small ui calls accepted | Opaque sticky save bar; native `<select>` in bulk rows; `datalist` for language/voicing; `BackLink` via sessionStorage (no `?geri=`); one base-ui Dialog as sheet/dialog; part-link `host` shown for external links; optimistic reorder with `aria-live`. | — | ui |
| D29 | Seed | db.md §6 table, plus one Drive link with `resourcekey` and one YouTube link with `&t=`; all stored URLs in normalised form. `korist@` stays alto; a seeded soprano member is used for the chooser AC. | e2e compares hrefs. | db |

## 2. Final copy changes (vs spec)

- `Konser repertuvarı` / `Konser` → **`Hazır`** (chip, status pill, form option). Empty `Hazır`: `Konsere hazır eser yok.`
- Program eyebrow `KONSER PROGRAMI · {n} ESER` (+ `· toplam mm:ss` when all have a duration); detail chip `Programda {n}. sıra`.
- Detail primary button `Partisyonumu aç (Alto)`; disabled `Alto için partisyon kaydı yok`. List/home: `Partisyonum` / `Partisyon kaydı yok`.
- Delete confirm title `"{title}" kalıcı olarak silinsin mi? Bağlantıları da silinir.`, description `Bu işlem geri alınamaz.`; buttons `Vazgeç` · `Arşivle` · `Kalıcı olarak sil`; toast `Eser silindi.`
- Clear programme: `Program temizlensin mi?` / `{n} eser programdan çıkar. Eserler ve bağlantıları silinmez.` / `Programı temizle`; toast `Program temizlendi.`
- Errors: `Eser bulunamadı.`, `Bağlantı bulunamadı.`, `Süreyi dakika:saniye olarak gir (ör. 3:40).`, `Bu bir Drive klasörü bağlantısı değil.`, `Bu bağlantı listede iki kez var.`, `Liste bu arada değişti. Sayfayı yenileyip tekrar dene.`
- All other copy as in `ux.md`.

## 3. Final acceptance criteria

Tests must not depend on Google or YouTube being reachable: they check `href`/`src`/attributes and our own UI. Seed per D29.

Browsing (as `korist@`, alto)
1. `/repertuvar` shows the `Çalışılıyor` pieces by default; the `Hazır`, `Program`, `Arşiv` and `Tümü` chips (and `?liste=` URLs) show the matching seeded sets with correct counts.
2. Searching `gulum` finds `Aman Gülüm`; `Mozart` finds `Ave Verum Corpus`; searching an archived title (`Abendlied`) finds it from the default view with its `Arşiv` status chip and the `tüm durumlar` result line. No match shows `Eşleşen eser yok.` and `Aramayı temizle` returns to the list.
3. Each row shows composer/arranger and the language, voicing and duration chips as seeded (`Ave Verum Corpus` shows `3:40`).
4. For `Ave Verum Corpus`, `Partisyonum` is a link whose `href` is the normalised alto Drive URL, with `target="_blank"` and `rel` containing `noopener`; its accessible name starts with `Partisyonum`.
5. As a seeded soprano, `Partisyonum` on `Bogoroditse Devo` opens a dialog listing `Soprano 1` and `Soprano 2` as links to their Drive URLs. As `korist@`, `Partisyonum` on `Aman Gülüm` points to the Tutti file; on `Hallelujah` it is a disabled button reading `Partisyon kaydı yok`.
6. A user without a voice part sees no `Partisyonum` button on list or home, and the detail page has no part filter and shows all links.
7. On `/repertuvar/[id]` the default filter `Benim partisyonum (Alto)` shows alto + Tutti links and hides soprano/tenor/bass ones; `Tümü` (`?partisyon=tumu`) shows all; `?partisyon=bas` shows a third active `Bas` chip with bass + Tutti links.
8. No iframe exists on the detail page before `Önizle`. `Önizle` on a Drive file creates an iframe with `src` `https://drive.google.com/file/d/<ID>/preview` (with `?resourcekey=` for the seeded resourcekey link); on YouTube `https://www.youtube-nocookie.com/embed/<ID>` (with `?start=<sec>` for the seeded `t` link); on the `Drive klasörü` row `https://drive.google.com/embeddedfolderview?id=<ID>#list`. Every preview iframe has a `title`, `referrerpolicy="strict-origin-when-cross-origin"` and no `sandbox`. Opening a second preview removes the first iframe; `Kapat` removes it.
9. The `Program` view lists the seeded programme pieces numbered 1..n in programme order. With an empty programme, members don't see the `Program` chip.
10. `korist@` sees no `Eser ekle`, edit, menu, reorder or delete controls; `/repertuvar/yeni` and `/repertuvar/[id]/duzenle` redirect away. Calling each create/update/status/delete/link/bulk/reorder/programme action as `korist@` returns `Bu işlem için yetkin yok.` and changes no rows.

Managing (as `sef@` or `yk@`)
11. A manager creates a piece with all fields (duration `4:05`) and lands on its edit page at `#baglantilar` with the toast `Eser eklendi. Şimdi bağlantılarını ekle.`; the piece appears under its status with `4:05`. Duration `4.05` is saved as `4:05`; `abc` shows `Süreyi dakika:saniye olarak gir (ör. 3:40).` An empty title shows `Eser adı gerekli.`
12. Adding a link `https://drive.google.com/open?id=ABC123` stores and shows `https://drive.google.com/file/d/ABC123/view`; `https://youtu.be/XYZ?si=foo` is stored as `https://www.youtube.com/watch?v=XYZ`.
13. `http://…`, `javascript:alert(1)`, `ftp://…` and `https://drive.google.com@evil.com/x` are rejected with `Geçerli bir https bağlantısı gir.`; a URL already on the piece with `Bu bağlantı bu eserde zaten var.` A non-folder URL in `Drive klasörü` shows `Bu bir Drive klasörü bağlantısı değil.`
14. Bulk paste of 6 lines (`Soprano 1 MIDI <drive>`, `Alto mp3 | <drive>`, `Tenor <drive>`, `Nota <drive>`, `<youtube>`, `not a url`) previews 5 valid rows (part/soprano, part/alto, part/tenor, score/Tutti, video/Tutti) and 1 invalid row. After changing the Tenor row's kind to `Nota`, `Kaydet (5 bağlantı)` saves exactly those 5, in order, with the edit applied. 51 lines show `En fazla 50 satır yapıştırabilirsin.`; a line duplicating an existing link shows `Bu bağlantı bu eserde zaten var.` and is not counted.
15. A link with an empty label shows the derived label (e.g. `Partisyon kaydı · Alto`).
16. Up/down reorders links and the order persists after a reload; the first row's up and last row's down are disabled. Deleting a link asks for confirmation (`Bağlantı silinsin mi?`) and removes it.
17. `Programa ekle` on a piece appends it to the end of the programme (`Programda {n}. sıra`); in `Sırayı düzenle`, up/down changes the numbering and persists after reload; `Programı temizle` (with confirm) empties the `Program` view. Archiving a programme piece asks for confirmation and removes it from the programme.
18. `Arşivle` moves a piece to `Arşiv` with its links intact; `Arşivden çıkar` puts it back under `Hazır`. `Eseri sil` exists only on the edit page; its confirm shows `"{title}" kalıcı olarak silinsin mi? Bağlantıları da silinir.`; `Kalıcı olarak sil` removes the piece and its links and returns to `/repertuvar` with `Eser silindi.`

Home and quality
19. Home shows `Çalışılan eserler` with the seeded `learning` pieces (max 5), each with a working `Partisyonum` as in AC4–5; the `örnek veri` pill is gone.
20. The response CSP `frame-src` is exactly `https://drive.google.com https://www.youtube-nocookie.com`.
21. `/repertuvar` (all views), detail, `yeni`, `duzenle` (including an open bulk preview) and home have no horizontal scroll at 375 px in light and dark. Rows, chips (including `/uyeler`) and buttons are ≥ 44 px tall.
22. `npm run lint`, `npm run typecheck` and `npm run e2e` pass.

Manual (tech lead, once, not e2e): a public Drive PDF and a YouTube video preview correctly on a real phone.

## 4. Out of scope / carry-forward

- Everything in spec §8 stays out (uploads, MIDI player, Drive API, several programmes, linking pieces to rehearsals, bars/measures, tags, favourites, drag and drop, offline files).
- Docs/Sheets preview (D23); iframe error detection; `Geri al` on archive; `preconnect` hints.
- `(portal)/loading.tsx` for the whole portal → Phase 4 polish.
- Phase 4: `assignments.piece_id → pieces (restrict)`; `deletePiece` maps the FK error to `Bu esere bağlı ödevler var. Silmek yerine arşivle.`; homework links use `/repertuvar/[id]?partisyon=…`.
- Concurrent edits of the same piece by two managers: last write wins (accepted).
