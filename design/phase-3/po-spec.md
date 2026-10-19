# Phase 3 — Repertuvar ve nota/MIDI kütüphanesi (PO spec)

Author: arkhe-po. Inputs:
- `PLAN_INPUT.md` (Faz 3)
- stakeholder: "google drive'da midi dosyaları ve nota dosyaları var. O linkler de bir yerde dursun"; "Repertuvara erişim: Google Drive midilerine erişim (ikinci aşamada belki midileri de ekleriz)"
- current `pieces` / `piece_files` in `src/db/schema.ts` (free to change)
- `next.config.ts` CSP (already allows `frame-src https://drive.google.com`)
- Phase 2 decisions (roster/part rules, `Çalışmalar` IA)

@ux, @ui, @dba, @backend: reply in your own files. **Proposal** marks my default. Open questions are listed in §9.

## 1. Problem

The choir's scores, part MIDIs and reference recordings live in a Google Drive folder tree that only a few people can navigate. Before each rehearsal, someone posts links in WhatsApp, and three weeks later nobody can find "the alto MIDI of Sicut Cervus". On the bus to a concert, a singer wants their part in **one tap** on the phone.

Phase 3 gives:
1. One list of the choir's pieces with the facts a singer needs: who wrote it, the language, the voicing, the length and whether we're working on it.
2. Per piece, all links in one place: score, part files per voice part, reference recordings and YouTube. Each link is filtered to *my* part by default.
3. A fast way for managers to put dozens of Drive links in without typing each one.

No files are stored by us. We store **links only** and need no Google API key (zero budget, no OAuth review). Uploading MIDIs into the app ("ikinci aşamada") is out of scope.

## 2. Users and roles

| Role | In this phase they… |
|---|---|
| Korist | Browses and searches the repertoire, opens a piece, plays or downloads **their part** in one tap, previews the score, watches the reference video. |
| Şef / YK (managers) | Add and edit pieces, paste links in bulk, set status, order the concert programme, archive. |

Authorization: viewing is any logged-in user; every write needs `isManager`, checked on the server (`PLAN_INPUT` roles table).

## 3. Domain

### 3.1 Piece fields
| Field | UI label | Rules |
|---|---|---|
| `title` | Eser adı | required, ≤ 120 |
| `composer` | Besteci | optional, ≤ 120 (e.g. `W. A. Mozart`, `Anonim`, `Halk türküsü`) |
| `arranger` | Düzenleyen | optional, ≤ 120 |
| `language` | Dil | optional. Free text with suggestions: Türkçe, Latince, İngilizce, Almanca, İtalyanca, Fransızca, İspanyolca, Rusça, Ermenice, Kürtçe, Yunanca, Diğer. A short, **free-text** field, because folk repertoire has many languages. |
| `voicing` | Ses dağılımı | optional, ≤ 20. Suggestions: SATB, SSAA, TTBB, SSA, SAB, SATB divisi, SSAATTBB. Free text. |
| `durationSec` | Süre | optional. Entered as `m:ss` (e.g. `3:40`) and shown as `3:40`. |
| `status` | Durum | `learning` = **Çalışılıyor** (default), `concert` = **Konser repertuvarı**, `archive` = **Arşiv** |
| `notes` | Notlar | optional, ≤ 1000, plain text. Visible to everyone (e.g. "2. kıta tekrar yok, coda'ya atla"). |
| `driveFolderUrl` | Drive klasörü | optional. The piece's Drive folder, as a fallback for anything not linked one by one. |
| `programPosition` | — | nullable integer; see §3.4 |

Meaning of the statuses, as a singer reads them:
- **Çalışılıyor**: we're learning it now.
- **Konser repertuvarı**: we know it and can sing it at a concert.
- **Arşiv**: we sang it once; the files are kept.

### 3.2 Links (replaces `piece_files`)
A piece has 0..n links. Each link has `kind`, `voicePart`, `label`, `url` and `position`.

| `kind` | UI label | Typical content |
|---|---|---|
| `score` | Nota | PDF on Drive |
| `part` | Partisyon kaydı | MIDI or an MP3 render of a part, on Drive |
| `recording` | Referans kayıt | audio on Drive or elsewhere |
| `video` | Video | YouTube |
| `other` | Diğer | lyrics/translation doc, pronunciation guide… |

- `voicePart`: `soprano` / `alto` / `tenor` / `bass`, or null = **Tutti** (everyone). Divisi lives in the label: `Soprano 1`, `Soprano 2` both carry `voicePart = soprano`. Voice parts stay four, as in CLAUDE.md.
- `label` is optional. When empty it is derived as `<Kind> · <Part>`, e.g. `Partisyon kaydı · Alto` or `Nota · Tutti`.
- **Validation:** only `https://`. Drive, Docs and YouTube URLs are recognised (§3.3); any other `https` URL is allowed as a plain external link. `http:`, `javascript:`, `data:`, relative URLs and anything over 2,000 characters are rejected with `Geçerli bir https bağlantısı gir.`
- A duplicate URL on the same piece is rejected: `Bu bağlantı bu eserde zaten var.`

### 3.3 Recognised URLs (no API key)
| Pattern | Stored as | Preview (iframe) | Open |
|---|---|---|---|
| `drive.google.com/file/d/<ID>/…`, `drive.google.com/open?id=<ID>`, `drive.google.com/uc?id=<ID>` | normalised to `https://drive.google.com/file/d/<ID>/view` | `https://drive.google.com/file/d/<ID>/preview` | the normalised URL (the Drive app intercepts it on phones) |
| `drive.google.com/drive/folders/<ID>` (+ `/u/0/`) | `https://drive.google.com/drive/folders/<ID>` | `https://drive.google.com/embeddedfolderview?id=<ID>#list` | the folder URL |
| `docs.google.com/document|spreadsheets|presentation/d/<ID>` | as is | none | as is |
| `youtube.com/watch?v=<ID>`, `youtu.be/<ID>`, `youtube.com/shorts/<ID>`, `music.youtube.com/watch?v=<ID>` (keep `t=`/`si=` stripped except `t`) | `https://www.youtube.com/watch?v=<ID>` | `https://www.youtube-nocookie.com/embed/<ID>` | the watch URL |
| other https | as is | none | as is, `rel="noopener noreferrer"` |

- CSP: add `https://www.youtube-nocookie.com` to `frame-src`. Nothing else.
- **Sharing:** a Drive file is only viewable if it's shared as "Bağlantıya sahip olan herkes" (or the singer's Google account has access). We can't check this without the API. The add form shows a one-line hint, and the preview area shows the fallback `Önizleme açılmıyorsa dosya Drive'da paylaşıma açık olmayabilir. Drive'da aç.`
- **MIDI on phones:** Drive's previewer can't play `.mid` files, and iOS can't either. The part-file row therefore offers **Aç** (opens Drive, which lets the user download or open the file in an app) as the primary action, not an inline preview. The add form suggests uploading **MP3 renders** of part MIDIs to Drive, because Drive previews and plays MP3 in the browser. **Proposal:** we don't build a MIDI player (§8).

### 3.4 Concert programme order
- There is one **current programme**: the pieces with a non-null `programPosition`, numbered 1..n. A manager adds a piece (`Programa ekle`), reorders with up/down buttons (no drag and drop; it's unreliable on phones), removes a piece, or presses `Programı temizle` after the concert.
- The repertoire list has a `Program` view that shows these pieces in order with their numbers. Singers use it as the running order (the concert folder order).
- The programme is independent of status: a piece can be `Çalışılıyor` and still be in the programme. Archiving a piece removes it from the programme.
- Linking programmes to Phase 2 concert rehearsals, or keeping several programmes, is out of scope (§8, §9 Q3).

### 3.5 What Phase 4 will need from this phase
Phase 4 homework will be "piece X, bars 12–34, parts A+T, due Friday". This phase must therefore guarantee:
- Stable piece ids and detail URLs `/repertuvar/[id]` (homework will link to them, also with `?partisyon=alto`).
- **No hard delete of a piece once anything references it.** In Phase 3 nothing references pieces yet. Delete is allowed (with confirmation), and the UI steers managers to `Arşivle` first. Phase 4 will add `assignments.piece_id → pieces (restrict)` and keep bars as two integers (`barFrom`, `barTo`) plus parts there, not on the piece. **Proposal:** no bar or measure data on pieces in Phase 3.

## 4. Screens (IA proposal; @ux owns the details)

- **`/repertuvar`** (tab exists):
  - search (title, composer, arranger; Turkish diacritic folding as on `/uyeler`);
  - view chips `Çalışılıyor` (default) · `Konser` · `Program` · `Arşiv` · `Tümü`.
  - **Row:** title, `composer · düz. arranger`, chips for language, voicing and duration. On the right, a **`Partisyonum`** button: one tap opens the singer's first part file (§5 M2). Managers have `Eser ekle`.
- **`/repertuvar/[id]`:**
  - header with all fields and notes;
  - part filter chips `Benim partisyonum (Alto)` (default for a singer with a part) · `Tümü`;
  - links grouped by kind in the order Nota, Partisyon kayıtları, Referans kayıt, Video, Diğer. In `Benim partisyonum`, part links show my part + Tutti only.
  - Each row: label, part dot and `Aç`. Previewable rows have an `Önizle` toggle that expands the iframe inline (lazy: the iframe is created only when expanded; `loading="lazy"`; 4:3 for files, 16:9 for video).
  - If the piece has a `driveFolderUrl`: `Drive klasörü` row with `Aç` + `Önizle`.
- **`/repertuvar/yeni`**, **`/repertuvar/[id]/duzenle`:** the piece form + a links editor (add one link, edit label/kind/part, reorder up/down, delete) + **`Toplu bağlantı ekle`** (§3.6).
- **Home:** the preview repertoire card becomes real: `Çalışılan eserler` (up to 5, `learning`), each with a `Partisyonum` button. Remove the `örnek veri` pill.

### 3.6 Bulk paste (managers)
- A textarea `Bağlantıları yapıştır (her satıra bir tane)`. Each line is either a bare URL, or `<label> <URL>` / `<label> | <URL>`.
- On `Önizle`, the server parses every line and shows an editable table: label, kind, part, URL, and a status (`Geçerli` / error text). Invalid lines are listed but not saved. `Kaydet (n bağlantı)` saves only the valid lines, in order.
- **Guessing from the label** (case- and diacritic-insensitive), always editable in the preview table:
  - Part from `soprano|sop|s1|s2` → soprano, `alto|a1|a2` → alto, `tenor|t1|t2` → tenor, `bas|bass|b1|b2` → bass, `tutti|hepsi|tümü` → null.
  - Kind from `midi|mp3|partisyon` → `part`, `nota|score|pdf` → `score`, `kayıt|kayit|recording` → `recording`. A YouTube URL is always `video`. A Drive folder URL with no kind word → the piece's `driveFolderUrl` if that's empty, otherwise `other`.
  - Defaults: Drive file with no hint → `score`, Tutti.
- Maximum 50 lines per paste.

## 5. User stories

Singers
- **M1** As a singer, I see the pieces we're working on and find any piece by typing part of its name or composer, with or without Turkish letters (`gulum` finds `Gülüm`).
- **M2** On my phone, I tap `Partisyonum` next to a piece and my part's file opens. If there are several (e.g. Soprano 1 and Soprano 2), a small sheet lets me pick. If my part has no file, the Tutti part file opens; if there's none of either, the button is disabled with `Partisyon kaydı yok`.
- **M3** On the piece page, I see only my part's files plus Tutti by default, and can switch to all parts (to hear the bass line against mine).
- **M4** I preview the score PDF and watch the reference video inside the page, and open the Drive folder when something isn't linked individually.
- **M5** Before a concert, I see the programme in performance order.

Managers
- **C1** I add a piece in under a minute: title, composer, arranger, language, voicing, duration and status.
- **C2** I paste the 10 Drive links of a piece at once, check the guessed parts and kinds, fix one, and save.
- **C3** I set the concert programme order and clear it after the concert.
- **C4** I archive pieces we no longer sing, so the default list stays short, without losing their links.

## 6. Data (for @dba; proposal)
- `pieces`: add `language`, `voicing`, `duration_sec`, `status` (CHECK enum, replaces `is_active`), `program_position` (nullable, unique when not null), `updated_at`, `created_by`. Length CHECKs per §3.1.
- Rename `piece_files` to `piece_links`: `kind` CHECK (`score|part|recording|video|other`), `voice_part` nullable CHECK, `label` nullable, `url` (normalised), `position` int, unique `(piece_id, url)`, index `(piece_id, position)`.
- URL parsing and normalisation live in one isomorphic helper (`src/lib/links.ts`), used by the forms, bulk preview, server actions and the renderer, with no dependency.
- Seed: 6 pieces covering all three statuses, mixed languages, one with S1/S2 part files, one with only Tutti, one with none, YouTube and folder links, and a 3-piece programme. Drive IDs are fake (e2e checks attributes, not Google).

## 7. Acceptance criteria (e2e-verifiable)

Tests must **not** depend on Google or YouTube being reachable. They check `href`/`src` attributes and our own UI only.

Browsing (as `korist@`, alto)
1. `/repertuvar` shows `Çalışılıyor` pieces by default; the `Konser`, `Arşiv` and `Tümü` chips show the matching seeded sets.
2. Searching `gulum` finds a piece titled `…Gülüm…`. Searching by composer surname finds that composer's pieces. No match shows `Eşleşen eser yok.`
3. Each row shows composer/arranger and the language, voicing and duration chips exactly as seeded (duration `3:40`).
4. For a piece with an alto part file, `Partisyonum` is a link whose `href` is the normalised Drive URL of the alto file and has `target="_blank"` with `rel` containing `noopener`.
5. For a piece with `Soprano 1` and `Soprano 2` files, a soprano member's `Partisyonum` opens a chooser listing both. For a piece with only a Tutti part file, the alto's `Partisyonum` points to the Tutti file. For a piece with no part files, the button is disabled and reads `Partisyon kaydı yok`.
6. On `/repertuvar/[id]`, the default filter `Benim partisyonum (Alto)` hides soprano/tenor/bass part links and shows alto + Tutti. `Tümü` shows all of them.
7. `Önizle` on a Drive file creates an iframe with `src` `https://drive.google.com/file/d/<ID>/preview`. On a YouTube link the `src` is `https://www.youtube-nocookie.com/embed/<ID>`. On the Drive folder row it is `https://drive.google.com/embeddedfolderview?id=<ID>#list`. No iframe exists before `Önizle` is tapped.
8. The `Program` view lists the seeded programme pieces numbered 1..n in programme order.
9. `korist@` sees no `Eser ekle`, edit or delete controls. `/repertuvar/yeni` and `/repertuvar/[id]/duzenle` redirect away. Calling the create/update/delete/link/programme actions as `korist@` returns `Bu işlem için yetkin yok.` and writes nothing.

Managing (as `sef@` or `yk@`)
10. A manager creates a piece with all fields (duration entered as `4:05`). It appears under its status with the duration shown as `4:05`. A missing title shows the field error `Eser adı gerekli.`
11. Adding a single link with the URL `https://drive.google.com/open?id=ABC123` stores and shows `https://drive.google.com/file/d/ABC123/view`. `https://youtu.be/XYZ?si=foo` is stored as `https://www.youtube.com/watch?v=XYZ`.
12. `http://…`, `javascript:alert(1)` and `ftp://…` are rejected with `Geçerli bir https bağlantısı gir.` A URL already on the piece is rejected with `Bu bağlantı bu eserde zaten var.`
13. Bulk paste of 6 lines (`Soprano 1 MIDI <drive>`, `Alto mp3 | <drive>`, `Tenor <drive>`, `Nota <drive>`, `<youtube>`, `not a url`) previews 5 valid rows with the guessed kind/part (part/soprano, part/alto, part/tenor, score/Tutti, video/Tutti) and 1 invalid row. After changing the Tenor row's kind to `score` in the table, `Kaydet (5 bağlantı)` saves exactly those 5, in order, with the edit applied.
14. An empty label shows the derived label (e.g. `Partisyon kaydı · Alto`).
15. Up/down reorders links within the piece and persists after a reload. Delete removes a link after a confirm.
16. `Programa ekle` adds a piece at the end of the programme; up/down changes the numbering; `Programı temizle` (with confirm) empties the `Program` view. Archiving a programme piece removes it from the programme.
17. `Arşivle` moves a piece to `Arşiv` with its links intact. `Sil` asks for confirmation (`… kalıcı olarak silinsin mi? Bağlantıları da silinir.`) and removes the piece and its links.

Home and quality
18. Home shows `Çalışılan eserler` with real seeded `learning` pieces, up to 5, each with a working `Partisyonum`. The `örnek veri` pill is gone.
19. The response CSP's `frame-src` includes `https://drive.google.com` and `https://www.youtube-nocookie.com`.
20. All new screens have no horizontal scroll at 375 px, light and dark. Rows and buttons are ≥ 44 px.
21. `npm run lint`, `npm run typecheck` and `npm run e2e` pass.

## 8. Out of scope (Phase 3)

- Uploading or storing files (MIDI/PDF/MP3) in the app; an in-app MIDI player or MIDI→MP3 rendering.
- The Google Drive API: listing folder contents into links, checking sharing permissions, thumbnails, file names.
- Several programmes, or linking a programme or pieces to Phase 2 rehearsals/concerts ("bu çalışmada çalışılacak eserler").
- Bars/measures, rehearsal marks, practice tracking per piece (Phase 4 owns the homework).
- Lyrics/translation/pronunciation as structured fields (use an `other` link).
- Tags, genres, period, difficulty, performance history ("en son ne zaman söyledik"), copyright/licence tracking.
- Drag and drop reordering; offline caching of files (Phase 6 PWA may cache the list, never the Drive content).
- Per-member favourites or "learned" checkmarks.

## 9. Open questions (settle in po-decisions.md)

1. **MIDI vs MP3:** should the form actively nudge managers towards MP3 renders (the help text, and a `MIDI` badge on `.mid` labels)? Or do we just accept that phones hand MIDI to other apps? My lean: help text only.
2. **`Partisyonum` with no voice part** (a conductor, or a member without a part): show `Tümü` and disable `Partisyonum`? My lean: yes.
3. **One programme only:** good enough for a choir that does 3–5 concerts a year? My lean: yes for now; Phase 4/5 may introduce events.
4. **Delete vs archive only:** should managers be able to hard-delete at all in Phase 3? My lean: yes with confirm, until Phase 4 references exist.
5. **Drive sharing failures:** without the API we can't detect "not shared". Is the help text plus the `Drive'da aç` fallback enough? @ui: can the iframe's error be detected? (Probably not cross-origin.)
6. **Docs/Sheets preview:** should `docs.google.com/.../preview` be embeddable too (it needs `frame-src https://docs.google.com`)? My lean: not now.
7. **Status names:** is "Konser repertuvarı" vs "Çalışılıyor" clear to singers? @ux, you may propose better copy.
