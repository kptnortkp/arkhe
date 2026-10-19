# Phase 2 UX: rehearsals and attendance

Author: arkhe-ux-designer. Input: `po-spec.md`. No `db.md`, `backend.md` or `ui.md` existed when I wrote this; @ui, @backend, @dba: reply in your files.

This spec is designed against the brand refresh now landing:
- the striped ARKHE SVG logo;
- Jost for headings;
- `--stage` shifted to the Instagram navy-violet (`oklch(0.28 0.08 285)` light / `oklch(0.22 0.065 288)` dark);
- `--brand-teal → --brand-butter` gradient tokens and the `.bg-brand-gradient` utility (`design/brand-integration.md` A4).

The gradient stays decorative and appears only on stage surfaces, never as text on ivory.

It is written mobile-first at 375px, with `md` (768px+) notes. The live screen is the exception: it is designed tablet-landscape first (1024×768).

---

## 0. Decisions and replies

**@po:**
- **Q8, IA:** agree. The `Yoklama` tab becomes **`Çalışmalar`** (`/calismalar`, icon `CalendarDays`). A singer thinks "when is rehearsal", not "attendance".
  - Bottom tabs, members: `Ana sayfa · Çalışmalar · Repertuvar`.
  - Bottom tabs, managers: `Ana sayfa · Çalışmalar · Repertuvar · Üyeler`.
  - `Raporlar` gets no tab. Managers reach it from a header link on `/calismalar`, and from a sidebar item on md+ (under `Üyeler`, icon `ChartColumn`). Five bottom tabs is too many for this audience.
- **Q3, concerts and genel prova weight:** agree, weight 1. In history and reports the type chip is always visible, so a missed `Genel prova` stands out without a separate rule.
- **Q4, thresholds:** fine. Two UX asks:
  - The live screen shows the late cut-off as text (`19:45'ten sonra geç sayılır`), so the person at the tablet can answer "am I late?".
  - The member-facing warning is never red. It uses `bg-accent` and the copy in §8.
- **Q5, board on the roster:** agree. No special UI; they appear in their part group and tap their own row.
- **Q1, code sharing (new UX ask):** the live screen will often face the choir, or be projected. The roster names who is missing, so showing it to the room is a privacy problem. I add a **`Sadece kod` display mode** (§3.4). The tablet shows only code + QR, and the person marking uses their own phone on the same live page. This also covers the common case: "the conductor conducts, a board member marks from their phone".
- **§3.5, member not on the roster:** agree. On the live list they appear in a group `LİSTEDE OLMAYANLAR` at the end, with the same row control.
- **Excuse reason length:** 200 characters is fine. Show the counter only from 150 characters on.

---

## 1. New tokens and shared components

### 1.1 Status tokens
Attendance status appears on every list in this phase. Rules:
- It needs its own colours, distinct from the voice-part colours.
- Status is **never** carried by colour alone: every status chip and segment has an icon and a label.

Ink values sit at the same lightness as the Phase 1 `--*-ink` tokens, which measured ≥ 5.5:1 on a 12% tint. @ui: please re-verify.

| Status | Token (fill / dot) light · dark | Ink token (text on tint) light · dark | Icon | Label |
|---|---|---|---|---|
| `present` | `--present` = existing `--success` `oklch(0.58 0.13 155)` · `oklch(0.7 0.13 155)` | `--present-ink` `oklch(0.5 0.13 155)` · `oklch(0.86 0.09 155)` | `Check` | `Geldi` |
| `late` | `--late` `oklch(0.74 0.14 85)` · `oklch(0.78 0.13 85)` | `--late-ink` `oklch(0.48 0.1 75)` · `oklch(0.87 0.1 85)` | `Clock` | `Geç` (chip) / `Geç geldi` (history) |
| `excused` | `--excused` `oklch(0.6 0.1 300)` · `oklch(0.72 0.1 300)` | `--excused-ink` `oklch(0.47 0.12 300)` · `oklch(0.85 0.07 300)` | `MessageSquareText` | `Mazeretli` |
| `absent` | `--absent` = `--destructive` | `--absent-ink` `oklch(0.5 0.19 25)` · `oklch(0.8 0.1 25)` | `X` | `Gelmedi` |
| unmarked | `--border`, dashed | `text-muted-foreground` | `Minus` | `İşaretlenmedi` |

Register them as `--color-present`, `--color-present-ink`, and so on.

Excused uses violet (hue 300) on purpose:
- It matches the new stage family.
- It stays away from bass blue (250).
- It reads as "known, not a problem", unlike red.

Late uses yellow-amber (85), not alto orange (55). The two never share a column anyway: part shows as a dot, status as a chip.

**Concert surface:** add `--plum` `oklch(0.3 0.07 344)` · `oklch(0.34 0.07 344)` with `--plum-foreground` = `--stage-foreground` (brand-integration A2). Use it for the `Konser` type chip and for concert rows' date block.

### 1.2 Components (new, in `src/components/attendance/` or similar; @ui owns names)

| Component | What | Notes |
|---|---|---|
| `StatusChip` | `rounded-full px-2.5 py-0.5 text-xs font-medium` with `bg-{status}/14 text-{status}-ink`, icon `size-3.5` + label | Read-only display |
| `StatusSegment` | 4-way radio group `Geldi / Geç / Mazeretli / Gelmedi` | §3.3; one component for the live screen and the detail page |
| `TypeChip` | Rehearsal type: `Tutti` (`bg-muted text-foreground`), `Partisyon` (part dots + `Partisyon`), `Genel prova` (`bg-accent text-accent-foreground`), `Konser` (`bg-plum text-plum-foreground`) | |
| `DateBlock` | `w-14` column: weekday `text-[11px] uppercase tracking-[0.2em] text-muted-foreground` (`SAL`), day `font-heading text-3xl` (Jost), month `text-xs` (`Eki`) | All formatting in `Europe/Istanbul` via `src/lib/format.ts` |
| `AttendanceStrip` | Last N statuses as 10px dots (`rounded-full`), colours from §1.1, unmarked = ring only; `role="img" aria-label="Son 8 çalışma: 6 geldi, 1 mazeretli, 1 gelmedi"` | Home, history, reports, member detail |
| `CodeInput` | shadcn `input-otp`, 4 slots `size-14 rounded-2xl text-3xl font-heading tabular-nums`, `inputMode="numeric" autoComplete="one-time-code"`, auto-submit on the 4th digit | Code sheet + QR landing fallback |
| `RehearsalHero` | Home hero states (§6) | From review-phase0 §1 |

---

## 2. Çalışmalar (calendar), `/calismalar`

### 2.1 375px
1. **Header:** h1 `Çalışmalar` (Jost `text-4xl font-medium`).
   - Managers, right side: `Button h-10 rounded-full px-4` `Plus` `Ekle`.
   - Managers, under the h1: a text link `Raporlar →` (`inline-flex min-h-11 items-center text-sm font-medium text-primary`).
2. **Tabs** (existing `Tabs`, full width): `Yaklaşan` / `Geçmiş`. The URL keeps the state: `?sekme=gecmis`.
3. **Yaklaşan:** month group headers in eyebrow style (`EKİM 2026`), then a card list (`rounded-2xl border bg-card divide-y`). Row = link to `/calismalar/[id]`, `min-h-20 px-4 py-3 flex gap-4`:
   - Left: `DateBlock`.
   - Middle:
     - Title `font-medium` (derived title, e.g. `Tutti`, `Partisyon çalışması · Tenor, Bas`, `Konser · Çanakkale`).
     - Line 2, `text-sm text-muted-foreground`: `19:30–22:00 · Mülkiye, Cebeci`.
     - Line 3 (only when relevant): chips row with `TypeChip` (non-tutti only) and the member's own `StatusChip`.
   - Right: `ChevronRight`.
   - Row states:
     - **Not your part** (sectional for other parts): the row stays visible with `opacity-60` and line 3 `Senin partisyonun değil` (`text-xs`). No actions anywhere for it.
     - **Cancelled:** title `line-through text-muted-foreground`. Line 3 is a chip `İptal edildi` (`bg-muted text-muted-foreground`, icon `Ban`), followed by the cancellation note if any.
     - **Today:** the date block gets `bg-stage text-stage-foreground rounded-xl` and the eyebrow `BUGÜN`.
     - **Attendance open:** add a chip `Yoklama açık` with a 6px `bg-gold animate-pulse` dot. Tapping the row on a member's phone opens the detail page, where `Geldim` is the primary action.
4. **Geçmiş:**
   - Members get their history (§8).
   - Managers get past rehearsals newest first. The same row shows, instead of the member's chip:
     - `28/41 · %68` (`text-sm tabular-nums`); or
     - a warning chip `Yoklama alınmadı` (`bg-accent text-accent-foreground`, icon `CircleAlert`) for past, never-opened rehearsals.
   - Paginate with `Daha eski çalışmalar` (button, 20 per page).

### 2.2 md+
- `max-w-3xl`, same list.
- Managers: `Raporlar` becomes an outline button next to `Ekle`.
- No calendar month grid this phase. A list is faster to scan on all screens, and a weekly choir has at most 6 rows a month.

### 2.3 States
| State | UI |
|---|---|
| Loading | 4 skeleton rows (`DateBlock` box `size-14 rounded-xl bg-muted` + two bars) |
| No upcoming | Empty state, icon `CalendarDays`, `Planlı çalışma yok`, text `Yeni çalışma eklendiğinde burada görünecek.`; managers get primary `Çalışma ekle` |
| No past (members) | `Henüz geçmiş çalışman yok.` |

---

## 3. Live attendance screen, `/calismalar/[id]/canli` (managers)

This is the screen that makes or breaks the phase. It runs on a tablet on the piano, landscape, or on a laptop. It has to be readable from 3m and usable with one hand while people talk to you.

### 3.1 Chrome
- No app shell. No sidebar or bottom nav: full-screen route, `min-h-dvh`. `bg-background` for the list side, `bg-stage on-stage` for the code side.
- Top bar, `h-14 px-4 flex items-center gap-3 border-b`:
  - ghost icon button `ArrowLeft` → `/calismalar/[id]`, `aria-label="Çalışmaya dön"`;
  - title `Tutti · 21 Ekim` (`font-medium truncate`);
  - connection indicator: `size-2 rounded-full bg-present` + `Canlı` (`text-xs text-muted-foreground`); offline state in §3.6;
  - on the right, the view switch, a segmented pair `Liste + kod` / `Sadece kod` (§3.4);
  - then `Button variant="outline" h-10 rounded-full` `Yoklamayı kapat`.
- Request a Wake Lock (`navigator.wakeLock.request("screen")`, free, Safari 16.4+) so the tablet doesn't sleep. When unsupported, show nothing.

### 3.2 Landscape layout (≥ 1024px wide, or `md` landscape)
`grid grid-cols-[minmax(360px,40%)_1fr] h-[calc(100dvh-3.5rem)]`.

**Left: code panel** (`bg-stage text-stage-foreground on-stage`, `flex flex-col items-center justify-center gap-6 p-8`), top to bottom:
1. Eyebrow `YOKLAMA KODU` (`tracking-[0.2em] text-xs text-stage-foreground/70`).
2. The code: `data-testid="live-code"`, Jost, `text-[clamp(96px,14vw,160px)] font-medium tabular-nums tracking-[0.08em] leading-none`.
   - Digits are grouped `48 27`, using a thin space, for reading aloud. The `textContent` stays `4827` (the space is CSS `letter-spacing` / a `gap` between two spans). e2e needs the plain code.
   - The code is the only element in this panel with `aria-live="off"`. It must not announce every 30s.
3. Countdown: a 4px bar `w-48 rounded-full bg-stage-foreground/15`, with an inner `.bg-brand-gradient` bar shrinking from 100% to 0% over the 30s step. CSS `transition: width linear`, reset on change, `aria-hidden`.
   - This is the gradient's best use in the app: decorative, on stage, and meaningful.
   - In the last 5s the bar keeps going, with no flashing.
4. QR: `size-[min(260px,32vh)]`, white quiet-zone tile `rounded-2xl bg-white p-3` (QR needs a light background in both themes), `aria-label="Yoklama QR kodu"`.
   - Encodes `https://<host>/yoklama/kod/<id>?c=<code>`.
   - Generate it client-side with a free library (`qrcode` npm, MIT), redrawn on each step.
5. Footer lines, `text-sm text-stage-foreground/70 text-center`:
   - `Telefonunla QR'ı okut ya da Arkhe'de Geldim'e bas, kodu gir.`
   - `19:45'ten sonra geç sayılır.`

**Right: roster panel** (`overflow-y-auto`):
1. **Counters bar** (sticky top, `bg-background/95 backdrop-blur border-b px-5 py-3`):
   - big `Geldi 28 / 41` (`font-heading text-3xl tabular-nums`; `28` counts present + late);
   - small `3 geç · 2 mazeretli · 8 işaretlenmedi` (`text-sm text-muted-foreground`);
   - then per-part chips, one per targeted part: `● S 9/12  ● A 8/11  ● T 5/8  ● B 6/10` (`rounded-full border px-3 h-8 text-sm tabular-nums`, part dot).
   - Tapping a part chip scrolls to that group (`scrollIntoView`). The chip is a filter-free shortcut, not a filter.
2. **Search:** `Input h-11` `İsim ara`, with the same diacritic folding as members (phase 1 review §6). This is the fastest way to answer "did Ayşe check in?".
3. **Groups**, in order S, A, T, B, then `PARTİSYON YOK` for all-parts rehearsals, then `LİSTEDE OLMAYANLAR`.
   - Group header (sticky under the counters, `py-2`):
     - eyebrow `SOPRANO · 9/12`;
     - on the right, ghost button `h-9` `Kalanları geldi işaretle` (`CheckCheck` icon), disabled when no one is unmarked. A tap runs immediately (no dialog), then shows a toast with undo: `Soprano: 3 kişi geldi olarak işaretlendi.` + action `Geri al` (5s). Undo is cheaper than a confirm at the piano.
   - Inside a group, order unmarked first, then marked, alphabetical (Turkish collation) within each. People still to act on stay at the top.
4. **Row:** `min-h-16 px-5 py-2 flex items-center gap-3`, `divide-y`.
   - Avatar `size-9` (part tint).
   - Name `font-medium` (truncate). Under it, `text-xs text-muted-foreground`, one of:
     - `QR · 19:31`, `Kod · 19:34`, `Elle · Mert` (method + time + who);
     - the excuse reason in quotes, `line-clamp-1`, for `excused`;
     - empty for unmarked.
   - Right: `StatusSegment`.
   - A row that changed in the last poll flashes `bg-present/10` for 1s (`transition-colors`), so the person at the tablet sees check-ins arrive. With `prefers-reduced-motion`, no flash.

### 3.3 `StatusSegment`
- Markup: `role="radiogroup"` `aria-label="{name} yoklama durumu"`, 4 `role="radio"` buttons.
- Container: `inline-flex rounded-xl border bg-card p-0.5 gap-0.5`.
- Segment: `h-11 min-w-11 px-2.5 rounded-lg text-sm inline-flex items-center gap-1.5`, with icon + label.
  - Below 1100px panel width, show the label only on the selected segment. Unselected segments show the icon only, with `aria-label`. That keeps the row on one line on a 768px portrait tablet.
- Selected: `bg-{status} text-white` for present/absent/excused. Late uses `bg-late text-gold-foreground`, because white on amber fails.
- Unselected: `text-muted-foreground hover:bg-muted`.
- Tap = save, optimistically. Tapping the selected segment again clears it (only while open). This toggle is in the PO spec, but it isn't discoverable. Add the helper under the counters, once per session and dismissible: `İşareti kaldırmak için seçili olana tekrar dokun.`
- Saving states per row:
  - pending: a 2px spinner dot left of the segment;
  - failed: the row gets `Kaydedilmedi` + `RotateCw` retry (§3.6).
- Late on a self check-in is set by the server. The manager can still change it.

### 3.4 Views
- **`Liste + kod`** (default on ≥ 1024px): as above.
- **`Sadece kod`**: the code panel fills the whole screen, with the code at `clamp(140px,22vw,260px)` and the QR at `min(420px,45vh)`. The top bar shrinks to the back button and the view switch.
  - Use it when the tablet faces the choir or is projected.
  - Same URL with `?gorunum=kod`, so it can be opened on a laptop connected to the hall's projector while a phone does the marking.
- **Phone / portrait < 768px** (a board member marking from their phone):
  - The code panel collapses to a `bg-stage` strip `h-20` with the code at `text-5xl` + countdown bar + a `QrCode` button. The button opens `Sadece kod` full screen, to hold the phone up.
  - The roster takes the rest.
  - `Yoklamayı kapat` moves to the bottom of the list as a full-width outline button.

### 3.5 Starting and closing
- **Start:** from the detail page (§4.3), primary `Yoklamayı başlat` → server sets `openedAt` → navigate to `/canli`.
  - Before 2h ahead of start: the button is disabled, with helper `Yoklama çalışmadan 2 saat önce başlatılabilir.`
  - If it is already open: `Canlı ekranı aç`.
- **Close:** `Yoklamayı kapat` → `Dialog`:
  - Title `Yoklama kapatılsın mı?`
  - Text: `12 kişi işaretlenmedi. Gelmedi olarak kaydedilecek.` If the count is 0: `Herkes işaretlendi.`
  - Then: `Kapattıktan sonra da düzeltme yapabilirsin.`
  - Actions: `Kapat` (primary) / `Vazgeç`.
  - Success: navigate to the detail page, toast `Yoklama kapandı. Geldi 32 / 41.`
- **Leaving without closing:** the back arrow simply leaves, and attendance stays open. The detail page and home show `Yoklama açık`.
  - When the rehearsal is open and its `endsAt` has passed, show on the detail page an accent banner `Yoklama hâlâ açık.` + button `Şimdi kapat`.
  - @po: the spec has no auto-close. I suggest auto-closing at the end of the day as a server rule; it removes a forgotten step. Your call.

### 3.6 Offline (spec §3.8)
- The connection indicator becomes `size-2 bg-destructive` + `Bağlantı yok`.
- A banner sits under the top bar, `bg-accent text-accent-foreground px-5 py-2 text-sm`, icon `WifiOff`: `Bağlantı yok — işaretlemeler bağlantı gelince kaydedilecek. Bu sekmeyi kapatma.`
- Unsaved rows show `Kaydedilmedi` (`text-xs text-destructive`) + icon button `RotateCw` `aria-label="Tekrar dene"`.
- The code and QR keep rotating (computed locally).
- When back online, rows save automatically and the banner disappears, followed by the toast `Bekleyen 3 işaret kaydedildi.`
- Counters include unsaved marks, with a `*` suffix and the footnote `* kaydedilmemiş işaretler dahil`.

---

## 4. Rehearsal detail, `/calismalar/[id]`

### 4.1 Header (everyone)
A stage card (`rounded-3xl bg-stage text-stage-foreground on-stage p-5`):
- eyebrow by type (`TUTTİ`, `PARTİSYON ÇALIŞMASI · TENOR, BAS`, `KONSER`); a concert card uses `bg-plum`;
- h1 date `Salı, 21 Ekim` (Jost `text-3xl`);
- `19:30–22:00` and `MapPin` location. Tapping the location opens `https://maps.google.com/?q=<encoded>` (free).
- If there is a note, it goes below in `rounded-xl bg-white/8 p-3 text-sm` with the label `ŞEFİN NOTU`.

### 4.2 Member part
Under the header: a card `Durumun` with the member's state and one action, following the `RehearsalHero` state table (§6). On this page:
- `Gelemeyeceğim` is an outline full-width `h-11` button.
- `Geldim` is full-width `h-14 bg-gold`.
- Cancelled rehearsal: the card reads `Bu çalışma iptal edildi.`, plus the reason if any, and has no actions.
- Not my part: `Bu çalışma senin partisyonun için değil. Gelmek istersen yine de yoklamaya katılabilirsin.` The member can still check in when it is open (spec §3.5), but gets no `Gelemeyeceğim`.

### 4.3 Manager part
- **Action row**, stacked on mobile and inline on md+, by state:
  - upcoming, outside the window: disabled `Yoklamayı başlat` + helper;
  - startable: primary `Yoklamayı başlat` (`Play` icon);
  - open: primary `Canlı ekranı aç` + outline `Yoklamayı kapat`;
  - closed: no primary action.
- **Overflow** (`MoreHorizontal` `DropdownMenu`, 44px trigger, top-right of the header card):
  - `Düzenle` → `/calismalar/[id]/duzenle`, same form as §5;
  - `İptal et` (only if no records) → Dialog: title `Çalışma iptal edilsin mi?`, optional textarea `Not (koristler görür)` (`Ör. Bayram tatili`), buttons `İptal et` (destructive) / `Vazgeç`; toast `Çalışma iptal edildi.`;
  - `Seriyi bitir` (series only) → Dialog: `Bu tarihten sonraki 6 çalışma silinecek. Yoklama kaydı olanlar silinmez.`, actions `Seriyi bitir` (destructive) / `Vazgeç`;
  - `İptali geri al` on a cancelled one.
- **Roster**, under the action row: the same groups, rows and `StatusSegment` as the live screen, with no code panel.
  - Counters are a compact line: `Geldi 32 / 41 · 3 geç · 2 mazeretli · 4 gelmedi`.
  - **Before start**: segments for excused people are already filled, from advance excuses. This is how the conductor sees "who said they won't come" ahead of time. Above the roster, show an accent card listing excuses: `Mazeret bildirenler (3)` with name + reason. That is the conductor's pre-rehearsal check.
  - **Closed**: a segment change saves immediately, and the row gains `Düzeltildi · Mert` (`text-xs text-muted-foreground`, icon `PencilLine`). Toast: `Ayşe Yılmaz: Geldi olarak düzeltildi.`
  - **Never opened, in the past**: accent banner `Bu çalışmada yoklama alınmadı. Raporlarda sayılmıyor.` + outline `Yoklamayı elle gir`. The button reveals the roster with all rows unmarked. The first mark includes the rehearsal in reports. After the first mark, show a secondary banner with `İşaretlenmeyenleri gelmedi say`, which works the same as close.

### 4.4 md+
Two columns, `grid-cols-[minmax(0,380px)_1fr] gap-8`: header card + member/action card on the left (sticky), roster on the right.

---

## 5. Add / edit rehearsal, `/calismalar/yeni`

This is a page, not a sheet, the same pattern as `/uyeler/yeni`, with `max-w-xl`.

1. h1 `Yeni çalışma`, back link `Çalışmalar`.
2. `Tür`: `ChoiceGroup` with chips `Tutti` / `Partisyon` / `Genel prova` / `Konser`. Default `Tutti`.
3. `Partisyonlar` (only when `Partisyon` is selected): multi-select chips with part dots (checkboxes styled like `ChoiceGroup`). Error `En az bir partisyon seç.`
4. `Tarih`: native `<input type="date">` `h-11`, default the next same weekday as the last rehearsal, or today.
5. `Başlangıç` / `Bitiş`: native `type="time"` side by side (`grid grid-cols-2 gap-3`). Bitiş defaults to start + 2:30 and follows start changes until edited by hand. Error `Bitiş başlangıçtan sonra olmalı.`
6. `Yer`: text, prefilled with the last used location; `datalist` with the 5 most used locations.
7. `Başlık` (optional): placeholder = derived title (`Tutti`), helper `Boş bırakırsan türden oluşur.`
8. `Koristlere not` (optional): `Textarea` 3 rows, placeholder `Ör. Requiem notalarınızı getirin.`
9. `Her hafta tekrarla`: `Switch` with label. When on, show:
   - `Son tarih`: date, required, max 26 weeks; error `En fazla 26 hafta ileri tarih seçebilirsin.`;
   - a live preview card `rounded-xl bg-muted p-3 text-sm`: `Her salı 19:30 · 9 çalışma oluşturulacak (21 Ekim – 16 Aralık).` This preview prevents "oops, 26 rehearsals" mistakes.
10. Submit (full width on mobile, `h-11 rounded-xl`): `Çalışmayı ekle`, or for a series `9 çalışmayı ekle`. Pending: `Ekleniyor…`. Success → `/calismalar`, toast `Çalışma eklendi.` / `9 çalışma eklendi.`

Edit (`/calismalar/[id]/duzenle`): same form without the repeat switch. The header reads `Bu çalışmayı düzenliyorsun; serinin diğerleri değişmez.` for series members. Submit `Kaydet`.

---

## 6. Home, `RehearsalHero` becomes real

Use the state table in `review-phase0.md` §1, with these changes:

- **Visual:** the stage hero with Jost h2. Replace the old `.staff-lines` with the 5-line stave taken from the logo stroke (brand-integration A1).
- **`open`:** eyebrow `YOKLAMA AÇIK` with a pulsing gold dot.
  - Primary `Geldim`: full-width `h-14 rounded-2xl bg-gold text-gold-foreground text-base font-semibold`, icon `Check` (not `QrCode`).
  - Below it, small: `ya da şefin ekranındaki QR'ı telefon kameranla okut`.
  - A member who is excused but present also sees `Geldim`.
- **`checked_in`:** eyebrow `YOKLAMAYA KATILDIN`, a big `CircleCheck` `text-gold` and `19:34'te kaydedildi.`
  - Late: `19:52'de kaydedildi · geç sayıldı.` The tone is neutral, with no red.
  - A 3px `.bg-brand-gradient` hairline at the card's bottom edge as a small reward. This is the only place outside the live screen where the gradient appears.
- **`upcoming` / `today`:** outline `Gelemeyeceğim` (`border-stage-foreground/25`). Add the type chip when it's not tutti, and the conductor's note as one line (`line-clamp-2`, `text-stage-foreground/80`).
- **`excused`:** eyebrow `MAZERETİN İLETİLDİ`, the reason in quotes, ghost `Mazereti geri al` (until start).
- **Not-my-part sectional as next rehearsal:** skip it. The hero shows the next rehearsal the member is expected at. Others appear only in the list.
- **Cards under the hero:**
  - Member: `Bu dönem devamın`, the existing card with real data: `%88`, `14/16 çalışma`, `AttendanceStrip` of the term. The footnote is either:
    - `Son 6 çalışmaya üst üste geldin.` (streak, only when ≥ 3); or
    - the gentle warning (§8).
  - Managers additionally get `Son çalışma · 21 Ekim` with per-part turnout bars (existing card) and a link `Raporlar →`.
- Remove the `örnek veri` pill for attendance. It stays only on the repertoire cards until Phase 3.

### 6.1 Code sheet (member)
- `Sheet side="bottom"` on mobile, `Dialog` md+.
- Title `Kodu gir`. Sub: `Şefin ekranındaki 4 haneli kod.`
- Body: `CodeInput`, autofocused.

| State | UI |
|---|---|
| Verifying | Slots `opacity-60`; under them `Loader2` + `Kontrol ediliyor…` |
| Success | Sheet closes; hero flips to `checked_in`; toast `Geldin olarak kaydedildi.` (late: `Geç olarak kaydedildi.`); `navigator.vibrate?.(30)` |
| Wrong / expired | Slots shake once (`motion-safe:animate-[shake_.3s]`), clear, refocus first slot; inline `text-sm text-destructive` `Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.` |
| Rate limited | Slots disabled; `FormAlert`: `Çok fazla hatalı deneme. Birkaç dakika bekle ya da yoklamayı alan kişiye söyle.` |
| Closed meanwhile | `FormAlert`: `Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle.` + `Kapat` |
| Network | `FormAlert` (info style): `Bağlantı yok. Kodu gönderemedik; bağlantı gelince tekrar dene ya da yoklamayı alan kişiye söyle.` Keep the digits, and show `Tekrar dene` |

---

## 7. QR landing, `/yoklama/kod/[id]?c=1234`

Opened from the phone camera, so it may be an in-app browser or a fresh tab, and the person may be logged out.

- **Logged out:** redirect to `/giris?next=…`. On the login page, show an info `FormAlert` above the form: `Yoklamaya katılmak için önce giriş yap.` After login, return here.
- **Layout:** the `AuthShell`-like full-screen stage page (`bg-stage on-stage min-h-dvh grid place-items-center px-6 text-center`), logo at the top. One state block:

| State | Icon tile (`size-20 rounded-3xl`) | h1 | Text | Action |
|---|---|---|---|---|
| Success | `CircleCheck` on `bg-white/10 text-gold` | `Yoklamaya katıldın` | `Tutti · 21 Ekim · 19:34` (late: `… · geç sayıldı`) | primary `Ana sayfaya git` |
| Already checked in | same | `Zaten kayıtlısın` | `19:31'de kaydedilmişsin.` | `Ana sayfaya git` |
| Code expired (common: scanned slowly or a photo of the QR) | `Clock` | `Kod yenilendi` | `Ekrandaki güncel kodu gir.` | inline `CodeInput` (stage variant: `bg-white/10 border-white/20`); success → Success state |
| Closed | `Lock` | `Yoklama kapandı` | `Geldiysen yoklamayı alan kişiye söyle.` | ghost `Ana sayfaya git` |
| Not found / cancelled | `CircleAlert` | `Bu yoklama bulunamadı` | — | `Ana sayfaya git` |
| Rate limited | `CircleAlert` | `Biraz bekle` | rate-limit copy | — |

The success state also gets the brand-gradient hairline under the h1, which is the "you're in" moment.

---

## 8. Member's own history (`/calismalar?sekme=gecmis`, member)

1. **Summary card** (`rounded-2xl border bg-card p-5`):
   - eyebrow `BU DÖNEM · 2026–27 GÜZ`;
   - `%88` (Jost `text-5xl`) + `14/16 çalışma`;
   - `AttendanceStrip`;
   - mini-legend line: `1 geç · 2 mazeretli · 1 gelmedi`.
   - If no term exists: eyebrow `SON 90 GÜN`.
2. **Gentle warning**, when flagged: a card `rounded-2xl bg-accent text-accent-foreground p-4 text-sm`, icon `HeartHandshake`. Copy, depending on the trigger:
   - `Son 4 çalışmanın 2'sine gelemedin. Bir sorun varsa şefinle konuş.`
   - `Bu dönem devamın %70'in altında. Bir sorun varsa şefinle konuş.`
   - Never red. No "uyarı" word on the member side.
3. **List**, newest first, reusing the row from §2 with the member's `StatusChip`:
   - The excuse reason appears under an excused row.
   - `Yoklama alınmadı` rows are greyed out with the line `Sayılmıyor`.
   - Cancelled rows are shown with a line-through and `Sayılmıyor`.
   - The chip carries no correction marker for members. The value simply changes.

---

## 9. Reports, `/raporlar` (managers)

### 9.1 375px
1. **Header:** h1 `Raporlar`. Right: outline icon button `Download` with `aria-label="CSV indir"` (md+: full button `CSV indir`).
2. **Period:** `Select` full width, `h-11`. Options are the terms, newest first, then `Son 90 gün`, then a separator and `Dönemleri yönet…`, which opens a Dialog (§9.3). Default: the current term.
3. **Part summary:** `grid grid-cols-2 gap-3`, four tiles (`rounded-2xl border bg-card p-4`):
   - part dot + `Soprano`;
   - `%84` (Jost `text-3xl tabular-nums`);
   - `12 kişi · 1 uyarı` (`text-xs text-muted-foreground`).
   - Tapping a tile filters the list below to that part. That's the same filter as the chips; the tile is just a bigger target.
4. **Dikkat** section (only if anyone is flagged):
   - eyebrow `DEVAMSIZLIK UYARISI · 3`, then a card list (`border-destructive/30`).
   - Row: name + part dot; the reason line `Son 4 çalışmanın 2'sinde yok` or `Dönem devamı %62` (`text-xs text-absent-ink`); `AttendanceStrip` (last 4, bigger dots `size-3`).
   - The row links to `/uyeler/[id]#devam`.
   - Managers need this list first; the full table is secondary.
5. **Everyone:**
   - filter chips `Tümü / S / A / T / B` + a toggle chip `Sadece uyarılılar`;
   - sort: a `Select`-less toggle button `Sırala: İsim` ⇄ `Sırala: Devam`, where devam means ascending (worst first).
   - Row: name, a line with `14/16 · 1 geç · 2 maz. · 1 gelmedi`, and on the right `%88` (`font-medium tabular-nums`).
     - Below 70% the value turns `text-absent-ink`.
     - A flagged person gets the badge `Uyarı` (`bg-absent/12 text-absent-ink`, icon `TriangleAlert`).
6. **Empty period:** `Bu dönemde sayılan çalışma yok.` + helper `Yoklaması alınan ya da kapatılan çalışmalar burada sayılır.`

### 9.2 md+
- `max-w-5xl`. The part tiles sit in one row of 4. The Dikkat list becomes a 2-column grid.
- The everyone list becomes a `Table`:
  - columns `Ad soyad`, `Partisyon`, `Geldi` (`14/16`), `%`, `Geç`, `Mazeretli`, `Gelmedi`, `Son 8` (`AttendanceStrip`);
  - sortable by name and % via the header buttons (`aria-sort`).
- CSV columns mirror the table: `Ad soyad;Partisyon;Geldi;Beklenen;Yüzde;Geç;Mazeretli;Gelmedi;Uyarı`.
  - Use `;` as separator, since Turkish Excel uses comma decimals. @backend: please confirm. Keep the UTF-8 BOM as spec'd.
  - File name: `arkhe-devam-2026-27-guz.csv`.

### 9.3 Terms dialog
- `Dialog` `Dönemler`: a list of terms (name + `1 Eyl – 31 Oca`), each with `Düzenle`.
- At the bottom, an inline form: `Ad` (placeholder `2026–27 Bahar`), `Başlangıç`, `Bitiş`, and `Ekle`. Error `Dönemler çakışamaz.` (@backend: enforce).
- Toast `Dönem eklendi.`

### 9.4 Member detail addition (`/uyeler/[id]`, section `id="devam"`)
- A card `Devam` between the form and the `Giriş` section: term `%`, `14/16`, `AttendanceStrip` (term) and the warning reason if flagged.
- Below it, the full history list as in §8, with `Düzeltildi · Mert` markers visible to managers.

---

## 10. Advance excuse flow

Entry points: the home hero, the detail page `Durumun` card, and the long-press-free list (no swipe actions; they are hard for this audience).

- The tap opens `Sheet side="bottom"` (small content, so a sheet is fine here). On md+ it is a `Dialog`.
  - Title `Gelemeyeceğini bildir`.
  - Sub: `Tutti · Salı 21 Ekim, 19:30`.
  - `Textarea` label `Neden? (isteğe bağlı)`, placeholder `Ör. sınav haftası, hastayım`, `maxLength=200`, counter from 150 characters on.
  - Helper `text-xs text-muted-foreground`: `Sadece şef ve yönetim görür.` This answers the privacy question before it is asked.
  - Primary `Mazeretimi bildir` / pending `Gönderiliyor…`; ghost `Vazgeç`.
- Success: the sheet closes, the state flips to `excused` everywhere, toast `Mazeretin iletildi.`
- Withdraw: `Mazereti geri al` (ghost), no dialog, then toast `Mazeretin geri alındı.` with action `Geri al` (re-submits the same reason).
- After start: the withdraw button is replaced by `text-xs`: `Çalışma başladı; değişiklik için yönetime yaz.`

---

## 11. Global rules for this phase

- Every date and time goes through `src/lib/format.ts` with `Europe/Istanbul`. Weekday names are in Turkish: `Salı, 21 Ekim`.
- Relative chips: `Bugün`, `Yarın`, `3 gün sonra`. In the past, `Geçen hafta` or the date.
- Counts and percentages use `tabular-nums`. Percent is written `%88` (Turkish order) everywhere, CSV included.
- Tap targets ≥ 44px on phone and ≥ 48px for the live-screen segments.
- Live screen polling (5s) pauses when `document.hidden`. A "Canlı" dot only; no "updated 3s ago" text.
- Dark mode: the stage surfaces are already dark. Status tints use `/14` in light and `/20` in dark, so chips don't disappear on `--card` dark.
- All new screens: check at 375px and md+, light and dark. Check the live screen at 1024×768 and 768×1024, and `Sadece kod` on a 1920×1080 projector size.

## 12. Open questions (UX-relevant)
1. **@po:** auto-close attendance at the end of the rehearsal day? I'd say yes (§3.5).
2. **@po:** should members see their section's turnout (not names) on home? It's motivating ("Tenorlar %92!"), and the data is aggregate. I suggest yes for the last rehearsal only. If not, managers only.
3. **@backend:** an optimistic mark plus the 5s poll can briefly revert a just-tapped segment. The poll response must not overwrite rows with a pending local write. Please return an `updatedAt` per record, so the client can keep the newer value.
4. **@ui:** confirm the `input-otp` styling on the stage variant, and Wake Lock support on the target iPad Safari.
