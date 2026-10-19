# Phase 3 UX: repertoire and Drive links

Author: arkhe-ux-designer. Input: `po-spec.md`, Phase 2 `ux.md` patterns, `src/app/globals.css`, `/uyeler` list code. No `ui.md`, `db.md`, `backend.md` yet; @ui, @backend, @dba: reply in your files.

Mobile first at 375px (page padding `px-4`, so 343px content). Shell bottom nav is fixed, page has `pb-28`. All tap targets ≥ 44px (`min-h-11` / `size-11`). Both themes use existing tokens only; **no new tokens this phase.**

---

## 0. Replies and decisions

**@po:**
- **Q1, MIDI vs MP3:** agree, help text only, no `MIDI` badge. A Drive URL carries no extension, so a badge would rest on the label text and be wrong half the time. Help text sits in the add-link form when kind = `Partisyon kaydı` (§6.2) and once in the bulk-paste hint.
- **Q2, no voice part:** disagree on "disabled". A conductor would see a disabled button on every row: 20 rows of noise. For users with `voicePart = null` the `Partisyonum` button is **not rendered**; the row is one link to the detail page, whose filter defaults to `Tümü` and has no `Benim partisyonum` chip. "Disabled + `Partisyon kaydı yok`" stays only for users *with* a part when no part file exists (AC5 unchanged).
- **Q7, status names:** `Konser repertuvarı` next to a `Program` chip reads as "the concert programme" and singers will mix them up. Rename the display label to **`Hazır`** (enum stays `concert`). Chip labels: `Çalışılıyor` · `Program` · `Hazır` · `Arşiv` · `Tümü`. The form explains each one (§6.1). AC1 should read `Hazır` instead of `Konser`.
- **Search spans all statuses.** A singer typing `sicut` must find it even if it is archived. With `q` set, the status chip is ignored, results show a status chip, and a line `"sicut" için 2 sonuç · tüm durumlar` appears. AC2 holds.
- **Preview ratio:** scores are portrait A4. 4:3 at 343px is 257px tall, too small to read. Files use `aspect-[3/4] max-h-[75dvh]`, video `aspect-video`, folder `h-96`.
- **Bulk preview on phones** is a stacked card per line, not a table; the table appears from `md` (§6.3).
- **Programme management** lives in the `Program` view itself (`Sırayı düzenle` mode), with `Programa ekle` on the piece page (§5).
- **Create flow:** `/repertuvar/yeni` saves the piece fields, then redirects to `/repertuvar/[id]/duzenle#baglantilar` with toast `Eser eklendi. Şimdi bağlantılarını ekle.` Links need a piece id. This also keeps C1 under a minute.

URL state (shareable, back-button safe): `/repertuvar?liste=calisiliyor|program|hazir|arsiv|tumu&q=…` (default `calisiliyor`), `/repertuvar/[id]?partisyon=alto|soprano|tenor|bas|tumu` (default = my part, else `tumu`; Phase 4 homework links use the same param).

---

## 1. Shared pieces (@ui owns names)

| Component | What |
|---|---|
| `PieceStatusChip` | `rounded-full px-2.5 py-0.5 text-xs font-medium`. `Çalışılıyor`: `bg-accent text-accent-foreground`, icon `Music`. `Hazır`: `bg-primary/10 text-primary`, icon `Check`. `Arşiv`: `bg-muted text-muted-foreground`, icon `Archive`. Shown only where status isn't implied (search, `Tümü`, `Program`, detail header). |
| `MetaChips` | language, voicing, duration: `rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums`, gap-1. Missing values are omitted, no placeholders. |
| `PartFileButton` (`Partisyonum`) | §3. Used on list rows, the home card and the detail header. |
| `LinkKindIcon` | lucide: Nota `FileMusic`, Partisyon kaydı `AudioLines`, Referans kayıt `Headphones`, Video `MonitorPlay`, Diğer `FileText`, Drive klasörü `FolderOpen`. `size-5 text-muted-foreground`. |
| `PartDot` | existing `VOICE_PART_STYLES[p].dot`, `size-2 rounded-full`; Tutti = `size-2 rounded-full ring-1 ring-foreground/40` (hollow) + text `Tutti`. |
| `FilterChip` | same look as `/uyeler` chip, but `min-h-11` (Phase 2 used `min-h-9`; @ui: bump `/uyeler` too for AC20 consistency). |

Derived label (empty `label`): `<Kind> · <Part>` → `Partisyon kaydı · Alto`, `Nota · Tutti`. Shown in normal weight, not italic; it is real copy for singers.

---

## 2. `/repertuvar` list

### 2.1 375px, top to bottom
1. **Header** `flex items-end justify-between`: h1 `Repertuvar` (`text-4xl font-medium`), sub `text-sm text-muted-foreground` `{n} eser`. Managers, right: `Button h-10 rounded-full px-4` `Plus` **`Eser ekle`** → `/repertuvar/yeni`.
2. **Search** (`/uyeler` input, `h-11 rounded-xl`, `Search` icon), GET form, `name="q"`, `type="search"`, placeholder **`Eser veya besteci ara`**, `aria-label="Repertuvarda ara"`. Diacritic folding server-side.
3. **Chips** `nav aria-label="Repertuvar listesi"`, horizontal scroll `-mx-4 px-4`: `Çalışılıyor n` · `Program n` · `Hazır n` · `Arşiv n` · `Tümü n`. `Program` is hidden for members when the programme is empty; managers always see it (it's where they build it). With `q` set, no chip is `aria-current`.
4. **Search result line** (only with `q`): `text-sm text-muted-foreground` `"{q}" için {n} sonuç · tüm durumlar` + text link `Aramayı temizle` (`min-h-11 inline-flex items-center text-primary`).
5. **List** `ul.divide-y.rounded-2xl.border.bg-card.overflow-hidden`. Sorted by title, `Intl.Collator("tr")`.

### 2.2 Row (`li`, `flex items-center gap-3 min-h-[76px] pr-3`)
- **Left, a `Link` to `/repertuvar/[id]`** (`flex-1 min-w-0 py-3 pl-4`, hover `bg-muted/60`):
  - title `font-medium leading-snug line-clamp-2`;
  - line 2 `text-sm text-muted-foreground truncate`: `W. A. Mozart · düz. E. Ertuğrul` (no composer → `düz. …` only; neither → line omitted);
  - line 3 `mt-1.5 flex flex-wrap gap-1`: `PieceStatusChip` (when shown, §1) then `MetaChips` (`Latince` `SATB` `3:40`).
- **Right, sibling (not nested in the link):** `PartFileButton`, or for users without a part a `ChevronRight size-4 text-muted-foreground` inside the link.
- Width check at 375: 343 − 16 (pl) − 12 (gap) − 12 (pr) − 116 (button) = 187px for text. Titles wrap to 2 lines; that's fine.

### 2.3 `Program` view
- Same rows, sorted by `programPosition`. Left of the title a number `w-7 shrink-0 font-heading text-2xl tabular-nums text-muted-foreground` (`1`, `2`…), `aria-hidden`; the `ol` carries the order for screen readers.
- Eyebrow above the list: `KONSER PROGRAMI · {n} ESER` (`text-xs tracking-[0.2em] text-muted-foreground`), and total duration when every piece has one: `· toplam 23:40`.
- Managers: management controls, §5.

### 2.4 States
| State | Copy / UI |
|---|---|
| Loading | 6 skeleton rows: `h-4 w-2/3` + `h-3 w-1/3` bars, right `h-11 w-28 rounded-full bg-muted` |
| No pieces at all | dashed card (`/uyeler` style), icon `Library`: **`Repertuvar henüz boş.`** Members: `Şef eser ekledikçe burada görünecek.` Managers: primary `İlk eseri ekle` |
| `Çalışılıyor` empty | `Şu an çalışılan eser yok.` + link `Tüm eserleri gör` |
| `Program` empty (managers) | `Program henüz belirlenmedi.` / `Eser sayfasındaki "Programa ekle" ile başla.` |
| `Hazır` empty | `Konsere hazır eser yok.` |
| `Arşiv` empty | `Arşivde eser yok.` |
| Search no match | **`Eşleşen eser yok.`** + `Aramayı temizle` |

### 2.5 md+
`max-w-3xl`. Row gets `min-h-16`, meta chips move to the right of line 2 (`flex justify-between`). Chips no longer scroll.

---

## 3. `Partisyonum` (`PartFileButton`) and chooser sheet

### 3.1 Resolution (shared helper, server-side)
1. Candidates = links with `kind = part` and `voicePart = my part`, in `position` order.
2. None → links with `kind = part` and `voicePart = null` (Tutti).
3. 0 → **disabled**; 1 → **direct link**; ≥ 2 → **sheet**.
Only `part` links count; recordings and scores never.

### 3.2 Button
- Look: `Button variant="outline" h-11 rounded-full px-3.5 gap-2 text-sm font-medium`, leading my `PartDot`, text **`Partisyonum`**. Fixed `w-[116px] justify-center` on list rows so the column aligns.
- **Direct:** an `<a href={url} target="_blank" rel="noopener noreferrer">`. `aria-label="{Alto} partisyonunu aç: {title}"`; Tutti fallback `aria-label="Tutti partisyon kaydını aç: {title}"` and the dot becomes hollow. Trailing `ArrowUpRight size-3.5` signals "leaves the app".
- **Sheet:** a `button` `aria-haspopup="dialog"`, trailing `ChevronDown size-3.5`.
- **Disabled:** `button disabled` with `opacity-100 border-dashed text-muted-foreground bg-transparent`, text **`Partisyon kaydı yok`** in `text-xs leading-tight` (wraps to 2 lines within 116px, still 44px tall). Not a link, no dot.
- Dark mode: outline button on `bg-card` uses `border-input`; check the dot keeps ≥ 3:1 against card (tokens already do).

### 3.3 Chooser sheet
- Existing `Sheet` `side="bottom"` on < md (`rounded-t-3xl pb-[env(safe-area-inset-bottom)]`), `Dialog sm:max-w-sm` on md+.
- `SheetTitle` = piece title (`font-heading text-xl`); `SheetDescription` = **`Soprano partisyon kayıtları`** (or `Tutti partisyon kayıtları`).
- List of `<a target="_blank" rel="noopener noreferrer">` rows, `min-h-14 px-4 flex items-center gap-3 rounded-xl hover:bg-muted`: `AudioLines` icon, label (`Soprano 1`), `ArrowUpRight` right. Tapping a row also closes the sheet.
- Footer: text link **`Eserin tüm bağlantıları`** → `/repertuvar/[id]`, and `Button variant="ghost"` **`Kapat`**.

---

## 4. `/repertuvar/[id]` detail

### 4.1 Header (375px)
1. Back link `ArrowLeft` **`Repertuvar`** (`min-h-11 text-sm text-muted-foreground`), returns to the list keeping `liste`/`q` (pass via `?geri=` or `history.back()` when same-origin referrer).
2. Chip row: `PieceStatusChip`, and if in programme a chip `bg-gold/20 text-foreground` icon `ListOrdered` **`Programda {n}. sıra`**.
3. h1 title `text-3xl font-medium leading-tight` (Jost).
4. `text-muted-foreground`: `W. A. Mozart` / line 2 `Düzenleyen: E. Ertuğrul`.
5. `MetaChips` (`text-xs` size here).
6. Managers, right of the chip row: `Button variant="outline" size-11 rounded-full` `Pencil` (`aria-label="Eseri düzenle"`) → `/duzenle`, and a `DropdownMenu` `MoreHorizontal` (`aria-label="Diğer işlemler"`): **`Programa ekle`** / **`Programdan çıkar`**, **`Arşivle`** / **`Arşivden çıkar`** (restores to `Hazır`). Delete is only on the edit page.
7. **Primary action** (members with a part): full-width `PartFileButton` variant `h-12 rounded-2xl bg-primary text-primary-foreground text-base`, text **`Partisyonumu aç (Alto)`**; disabled text `Alto için partisyon kaydı yok`. Same resolution and sheet as §3.
8. **Notes** (if any): `rounded-2xl bg-accent/60 p-4`, eyebrow `NOTLAR`, body `text-sm whitespace-pre-line`.

### 4.2 Part filter
`nav aria-label="Partisyon filtresi"`, two `FilterChip`s: **`Benim partisyonum (Alto)`** (default) · **`Tümü`**. If `?partisyon=` names another part (Phase 4 link), a third chip `Tenor` appears and is active. Users without a part get no filter row (everything shown). The filter affects `part` and `recording` links with a part; Nota/Video/Diğer Tutti links always show.

### 4.3 Grouped links
- Sections in order **`Nota`**, **`Partisyon kayıtları`**, **`Referans kayıt`**, **`Video`**, **`Diğer`**, then **`Drive klasörü`**. Each: eyebrow h2 `text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground mb-2`, then `ul.divide-y.rounded-2xl.border.bg-card`. Empty sections are omitted.
- **Row** `min-h-14 pl-4 pr-2 py-2 flex items-center gap-3`:
  - `LinkKindIcon`; text block `flex-1 min-w-0`: label `font-medium truncate`, line 2 `text-xs text-muted-foreground flex items-center gap-1.5`: `PartDot` + part name (`Alto` / `Tutti`) · host (`Drive`, `YouTube`, `Docs`, else hostname).
  - Actions: `Önizle` toggle (only for Drive file, Drive folder, YouTube) `Button variant="ghost" h-11 px-3` `Eye` + `Önizle` / `EyeOff` + `Kapat`, `aria-expanded`, `aria-controls`; then **`Aç`** `Button variant="outline" h-11 rounded-full px-4` `ArrowUpRight`, `<a target="_blank" rel="noopener noreferrer">`.
  - Width at 375: icon 20 + gaps + text ≥ 140 + `Önizle` 88 + `Aç` 64. Fits; label truncates.
  - Rows of my part get no highlight; the filter already did the work.
- **Filtered-empty** inside `Partisyon kayıtları` when my part + Tutti has none but others exist: `text-sm text-muted-foreground px-4 py-3` **`Alto için kayıt yok.`** + link **`Tüm partisyonları göster`** (→ `?partisyon=tumu`).
- **No links at all:** dashed card **`Bu esere henüz bağlantı eklenmedi.`**; managers get **`Bağlantı ekle`** → `/duzenle#baglantilar`.

### 4.4 Inline preview
- Expands under its row inside the same `li` (`px-2 pb-3`). The iframe is mounted only on open (AC7), `loading="lazy"`, `allow="autoplay; encrypted-media; fullscreen"`, `allowFullScreen`, `title="{label} önizlemesi"`, `referrerPolicy="strict-origin-when-cross-origin"`.
- Frame: `w-full rounded-xl overflow-hidden ring-1 ring-border bg-muted`. Drive file `aspect-[3/4] max-h-[75dvh]`; YouTube `aspect-video`; folder `h-96`. While loading, the `bg-muted` box shows `Loader2 animate-spin` centred (behind the iframe).
- Under every Drive frame: `text-xs text-muted-foreground` **`Önizleme açılmıyorsa dosya Drive'da paylaşıma açık olmayabilir.`** + link **`Drive'da aç`**.
- **One preview open at a time.** Opening another closes the previous one (and unmounts its iframe). This saves memory on old phones and stops a video playing under a PDF.
- Dark mode: Drive's viewer is white. The `ring-border` frame keeps the edge from glowing; no filter/invert on the iframe.

### 4.5 md+
`max-w-3xl`. Header: title left, manager buttons right; the primary `Partisyonumu aç` button becomes `w-auto`. Preview frames are capped at `max-w-2xl mx-auto`.

---

## 5. Programme management (managers)

- **Add:** detail menu `Programa ekle` → appends; toast **`Programa eklendi ({n}. sıra).`** `Programdan çıkar` → toast **`Programdan çıkarıldı.`**
- **Order:** in `/repertuvar?liste=program`, managers see `Button variant="outline" h-10 rounded-full` `ArrowUpDown` **`Sırayı düzenle`** above the list. In edit mode:
  - Each row loses its `PartFileButton` and gets `size-11` ghost icon buttons `ChevronUp` (`aria-label="Yukarı taşı: {title}"`), `ChevronDown` (`Aşağı taşı: …`), `X` (`Programdan çıkar: {title}`). First row's up and last row's down are `disabled`. Number updates instantly (optimistic), server persists.
  - After a move, focus stays on the same button of the moved row; `aria-live="polite"` region announces `{title} {n}. sıraya taşındı.`
  - Top bar: **`Bitti`** (primary, ends mode) and **`Programı temizle`** (`variant="ghost" text-destructive`).
- **Clear confirm** (`Dialog`): title **`Program temizlensin mi?`**, description **`{n} eser programdan çıkar. Eserler ve bağlantıları silinmez.`**, buttons **`Vazgeç`** / **`Programı temizle`** (destructive). Toast **`Program temizlendi.`**
- **Archive a programme piece:** confirm title **`"{title}" arşivlensin mi?`**, description **`Arşivlenen eser programdan da çıkar. Bağlantıları korunur.`**, buttons `Vazgeç` / **`Arşivle`**. Archiving a non-programme piece needs no confirm; toast **`Arşive taşındı.`** with action **`Geri al`**.

---

## 6. Piece form, links editor, bulk paste (managers)

Routes `/repertuvar/yeni` (h1 **`Yeni eser`**) and `/repertuvar/[id]/duzenle` (h1 **`Eseri düzenle`**, sub = title). Back link like §4.1. `max-w-2xl`. Reuse `src/components/forms/field.tsx`, `ChoiceGroup`, `use-focus-error`.

### 6.1 Section `Eser bilgileri`
| Field | Control | Placeholder / help | Errors |
|---|---|---|---|
| **Eser adı** | `Input` required, autofocus on `/yeni` | — | `Eser adı gerekli.` · `En fazla 120 karakter.` |
| **Besteci** | `Input` | `ör. W. A. Mozart, Anonim` | `En fazla 120 karakter.` |
| **Düzenleyen** | `Input` | `Boş bırakabilirsin` | same |
| **Dil** | `Input` + `datalist` (PO list) | `ör. Latince` | `En fazla 40 karakter.` |
| **Ses dağılımı** | `Input` + `datalist`, `autoCapitalize="characters"` | `ör. SATB` | `En fazla 20 karakter.` |
| **Süre** | `Input inputMode="numeric"`, `w-28` | `3:40` | `Süreyi dakika:saniye olarak gir (ör. 3:40).` |
| **Durum** | `ChoiceGroup`, default `Çalışılıyor` | under each option, `text-xs text-muted-foreground`: `Şu an öğreniyoruz` · `Konserde söyleyebiliriz` · `Söyledik, dosyalar duruyor` | — |
| **Drive klasörü** | `Input type="url" inputMode="url"` | `https://drive.google.com/drive/folders/…` · help `Tek tek eklenmeyen dosyalar için eserin klasörü.` | `Geçerli bir https bağlantısı gir.` · `Bu bir Drive klasörü bağlantısı değil.` |
| **Notlar** | `textarea rows=3`, counter from 800 chars `812/1000` | `Herkes görür. ör. "2. kıtada tekrar yok, coda'ya atla."` | `En fazla 1000 karakter.` |

Layout at 375: one column; `Ses dağılımı` and `Süre` share a row (`grid grid-cols-[1fr_7rem] gap-3`). md: `Dil` / `Ses dağılımı` / `Süre` in `grid-cols-3`.
Submit: `/yeni` **`Eseri kaydet`**; edit **`Değişiklikleri kaydet`** (toast **`Kaydedildi.`**). `h-12 w-full md:w-auto rounded-xl`. Form error banner: **`Bazı alanları düzeltmen gerekiyor.`**

### 6.2 Section `Bağlantılar` (`id="baglantilar"`, edit page only)
- Heading h2 **`Bağlantılar`** + count. Link list = `ul.divide-y.rounded-2xl.border.bg-card`; row `min-h-16 pl-4 pr-1 flex items-center gap-2`:
  - text `flex-1 min-w-0`: label (or derived) `font-medium truncate`; line 2 `text-xs text-muted-foreground`: kind · `PartDot` part · host.
  - `ChevronUp` / `ChevronDown` ghost `size-11` (aria `Yukarı taşı: {label}`), then `DropdownMenu` `MoreVertical` `size-11`: **`Düzenle`**, **`Bağlantıyı aç`**, **`Sil`** (destructive). 3 × 44 = 132px; text keeps 179px.
  - Reorder is immediate (optimistic) with the same `aria-live` message as §5.
- **Düzenle** expands the row into the add form below (same fields, buttons `Kaydet` / `Vazgeç`). One row in edit at a time.
- **Sil** confirm: title **`Bağlantı silinsin mi?`**, description = label, buttons `Vazgeç` / **`Sil`**. Toast **`Bağlantı silindi.`**
- Empty: `text-sm text-muted-foreground` **`Henüz bağlantı yok. Aşağıdan tek tek ya da toplu ekleyebilirsin.`**
- **Add one link** card (`rounded-2xl border bg-card p-4 space-y-4`), title **`Bağlantı ekle`**:
  1. **Bağlantı** `Input type="url" inputMode="url"` placeholder `https://drive.google.com/file/d/…`; help **`Drive dosyası "Bağlantıya sahip olan herkes" ile paylaşılmış olmalı.`** On paste/blur, the client helper pre-selects kind (YouTube → `Video`, Drive folder → `Diğer`) and shows the normalised URL under the input in `text-xs font-mono text-muted-foreground truncate`.
  2. **Tür** `ChoiceGroup`: `Nota` · `Partisyon kaydı` · `Referans kayıt` · `Video` · `Diğer` (default `Nota`). When `Partisyon kaydı` is checked, hint `text-xs`: **`Telefonlar MIDI çalamaz. Partisyonun MP3'ünü de Drive'a koyarsan tarayıcıda dinlenir.`**
  3. **Partisyon** `ChoiceGroup` with dots: `Tutti` · `Soprano` · `Alto` · `Tenor` · `Bas` (default `Tutti`).
  4. **Etiket** `Input`, optional, placeholder = live derived label (`Partisyon kaydı · Alto`); help **`Divisi için yaz: Soprano 1, Soprano 2`**.
  5. **`Ekle`** (`h-11 rounded-xl`). On success the form resets, focus returns to the URL input, toast **`Bağlantı eklendi.`**
  Errors (on the URL field): **`Geçerli bir https bağlantısı gir.`** · **`Bu bağlantı bu eserde zaten var.`**

### 6.3 `Toplu bağlantı ekle`
- Collapsed by default under the add card: `Button variant="outline" h-11 w-full` `ClipboardPaste` **`Toplu bağlantı ekle`**. Expanded card:
  - Label **`Bağlantıları yapıştır (her satıra bir tane)`**; `textarea rows=8 font-mono text-sm`, `spellCheck={false}`, `autoCapitalize="off"`. Placeholder (3 lines): `Soprano 1 MIDI https://drive.google.com/…` / `Alto mp3 | https://drive.google.com/…` / `https://youtu.be/…`.
  - Help: **`Etiketteki "soprano", "alto", "midi", "nota" gibi kelimelerden tür ve partisyon tahmin edilir; önizlemede düzeltebilirsin. En fazla 50 satır.`**
  - Buttons: **`Önizle`** (primary) · **`Vazgeç`** (ghost). Over 50 lines: **`En fazla 50 satır yapıştırabilirsin.`** Empty: **`Yapıştırılacak bağlantı yok.`**
- **Preview, 375px: one card per line** (`ol.space-y-2`), `rounded-xl border p-3 space-y-3`:
  - header `flex justify-between text-xs`: `Satır 3` (muted) and status: valid `Check` + **`Geçerli`** (`text-present-ink`); invalid `X` + error (`text-absent-ink`).
  - valid: **Etiket** `Input h-11`, **Tür** and **Partisyon** as two native `select`s side by side (`grid grid-cols-2 gap-2`, `h-11`; native selects are the reliable picker on iOS), URL `text-xs font-mono text-muted-foreground break-all`, and `Button ghost size-11` `Trash2` **`Bu satırı çıkar`** (aria).
  - invalid: card `bg-absent/8 border-absent/30`, raw line in `font-mono text-xs break-all`, no inputs. Errors: **`Geçerli bir https bağlantısı gir.`** · **`Bu bağlantı bu eserde zaten var.`** · **`Bu bağlantı listede iki kez var.`**
  - Summary above the list: **`{v} geçerli, {i} hatalı satır. Hatalı satırlar kaydedilmez.`**
- **md+: `Table`** with columns `#`, `Etiket`, `Tür`, `Partisyon`, `Bağlantı` (truncate, `title` = full URL), `Durum`, remove.
- **Save bar** sticky above the bottom nav on mobile (`sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4`, `bg-background/90 backdrop-blur rounded-2xl border p-2 flex gap-2`): **`Kaydet ({v} bağlantı)`** primary `flex-1 h-12`, disabled when `v = 0`; **`Metne dön`** ghost (back to textarea, keeps text and edits discarded). Success toast **`{v} bağlantı eklendi.`**, the panel collapses and the list scrolls into view. If a folder line filled the piece's `Drive klasörü`, the toast adds ` Drive klasörü de ayarlandı.`
- Guessed values are shown plainly; no "tahmin" badge. The status column already tells what's valid.

### 6.4 Danger zone (edit page bottom)
`rounded-2xl border border-destructive/30 p-4`: text **`Artık söylemediğiniz eserleri silmek yerine arşivleyin; bağlantılar korunur.`** Buttons **`Arşivle`** (outline) and **`Eseri sil`** (`variant="destructive"` ghost-style).
Delete confirm: title **`"{title}" kalıcı olarak silinsin mi? Bağlantıları da silinir.`** (AC17), description **`Bu işlem geri alınamaz.`**, buttons `Vazgeç` · `Arşivle` (outline, the steer) · **`Kalıcı olarak sil`** (destructive). After delete → `/repertuvar`, toast **`Eser silindi.`**

Server errors for all actions: forbidden **`Bu işlem için yetkin yok.`**; missing piece **`Eser bulunamadı.`**; generic **`Bir şeyler ters gitti, tekrar dene.`**

---

## 7. Home card `Çalışılan eserler`

Replaces the preview grid (and the `Örnek veri` line).
- Header: h2 **`Çalışılan eserler`** (`text-2xl font-medium`) + link `Tümü` `ChevronRight` → `/repertuvar` (`min-h-11`).
- Body: the §2.2 row in a `ul.divide-y.rounded-2xl.border.bg-card`, up to 5 `learning` pieces by title, **without** `MetaChips` (title + composer + `Partisyonum`), `min-h-16`. A list, not 3 cards: a list puts `Partisyonum` in the same place on every row, which a 3-column card grid on desktop does not.
- More than 5: last line `text-sm text-primary` **`+{n} eser daha`** → `/repertuvar`.
- Empty: members: section hidden. Managers: dashed card **`Şu an çalışılan eser yok.`** + **`Eser ekle`**.

---

## 8. Accessibility and quality checklist (for review)

- Every external link: `target="_blank" rel="noopener noreferrer"` and a visible `ArrowUpRight`; screen readers get the `aria-label` from §3.2/§4.3, no extra "new tab" text needed beyond the icon `aria-hidden` + `sr-only` **`(yeni sekmede açılır)`** on `Aç` and `Partisyonum`.
- Focus order on a row: row link → `Partisyonum`. No nested interactive elements.
- No horizontal scroll at 375 in either theme; long URLs always `break-all` or `truncate`.
- Iframes: none in the DOM before `Önizle` (AC7); `title` set.
- Colour never alone: status chips have icons; part dots always sit next to part text.
