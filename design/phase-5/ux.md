# Phase 5 UX: Finans

Author: arkhe-ux-designer. Inputs: `po-spec.md`, Phase 4 `ux.md`/`po-decisions.md`, `/odevler`, `/raporlar`, home cards, `/profil`, `globals.css`. No `ui.md`/`db.md`/`backend.md` yet.

Mobile first at 375px (`px-4`, 343px content, page `pb-28`), touch targets ≥ 44px, `max-w-3xl` from `md` (`/finans/rapor` and the dues table `max-w-5xl`). Reuse: `FilterChip`, `ChoiceGroup`, `Field`, `FormMessage`, `PartDot`, `BackLink`, `ConfirmDialog`, `Sheet` (bottom < md, `Dialog sm:max-w-md` ≥ md), `DeadlineChip` look (Phase 4 §2), sonner toasts, `use-focus-error`. **No new tokens** (§9).

## 0. Replies and decisions

**@po:**
- **Q5 dues default `Kasa`:** agree. Cash at rehearsal is the common case; the `Hesap` choice stays visible in the payment sheet (one tap to `Banka`). Generic `Gelir`/`Gider` default `Banka` as specified, but the form remembers the last account used by this manager in `localStorage` (`arkhe:finans:hesap`) for the next generic entry; dues always start at `Kasa`.
- **Q6 `/profil#aidat` vs `/aidatim`:** agree with `/profil#aidat`, with the section placed **first** on `/profil` (above `Bilgilerin`): it's the reason a singer opens the page. No new route, no new nav item. Home card and user-menu both deep-link to `/profil#aidat`.
- **Q1–Q4:** no UX objection; Q2 live owed amount is fine as long as the member sees the period's owed amount next to the status (§8), so a rate change is visible, not silent.
- **Change 1, expense colour:** expenses are normal business, not errors. Income amounts `text-present-ink`; expense amounts `text-foreground` (no red). Red (`absent-ink`) is reserved for **negative balance, `Zarar`, `Gecikti`**. Signs are text (`+`, `−` U+2212), plus a kind icon per row (§2).
- **Change 2, amount parser:** iOS/Android with English region show a `.` key on `inputMode="decimal"` and **no comma**. Rejecting `1250.50` locks those phones out. Accept `.` as decimal when it's the only separator and followed by 1–2 digits at the end (`1250.5`, `1250.50`); `.` + exactly 3 digits stays thousands (`1.250` = ₺1.250,00). AC4 cases are unchanged. Safety net: a live echo under the field (§4.2) shows the parsed value before saving.
- **Change 3, `Düzelt` order:** don't void first and then open the form (abandoning the form would make money vanish). `Düzelt` opens `/finans/yeni?duzelt={id}` prefilled; **the old entry is voided in the same transaction when the new one is saved**. Cancel = nothing changed. Copy and AC8 outcome unchanged.
- **Addition, dues table:** besides the per-period list, a members × periods table (`?gorunum=tablo`) for board meetings, same pattern as `/odevler/matris`.

## 1. Nav and mobile entry points

- `NAV_ITEMS`: `{ href: "/finans", label: "Finans", icon: Wallet, managersOnly: true, sidebarOnly: true }` after `Raporlar`. Tab bar unchanged (5 tabs).
- **Manager home card `Kasa`** (after the manager homework card): `CardHeader` pattern from `home-cards.tsx`, title **`Kasa`**, right link **`Finans`** → `/finans`. Body `Link` → `/finans`, `rounded-2xl border bg-card p-4`:
  - line 1 `text-xs text-muted-foreground` **`Toplam bakiye`**; line 2 `text-3xl font-semibold tabular-nums` `₺21.400,00` (`text-absent-ink` + `Eksi bakiye` chip when < 0).
  - line 3 `text-sm tabular-nums` **`Bu ay: +₺2.100,00 gelir · −₺3.500,00 gider`**.
  - line 4 (only when a current period exists and n > 0): `CircleAlert text-late-ink` **`{n} kişi {Ekim 2026} aidatını ödemedi`** → `/finans/aidat?filtre=borclu`. n = 0 → `CircleCheck text-present-ink` **`{Ekim 2026} aidatı tamam.`**
- **`/profil` (managers):** a link row above `Çıkış yap`, `min-h-14 rounded-2xl border bg-card px-4 flex items-center gap-3`: `Wallet` + **`Finans`** + `text-sm text-muted-foreground` **`Kasa, aidat, raporlar`** + `ChevronRight`. Add the same row for **`Raporlar`** (`ChartColumn`, **`Devam ve uyarılar`**) since it's also sidebar-only.
- **Finans sub-nav** on every `/finans/*` page under the h1: `nav aria-label="Finans bölümleri"` `-mx-4 flex gap-2 overflow-x-auto px-4 pb-1`, `FilterChip`s: **`Özet`** · **`Hareketler`** · **`Aidat`** · **`Etkinlikler`** · **`Sponsorlar`** · **`Rapor`** · **`Ayarlar`**. Same on all widths (one pattern instead of segmented + list; scrolls inside itself at 375).

## 2. Money formatting (`formatMoney`, `MoneyAmount`)

- Format the absolute value with `Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"})` → `₺1.250,50`, then prepend the sign yourself: income `+`, expense `−` (U+2212, not the hyphen `Intl` emits). Balances/P&L: no sign when ≥ 0, `−` when < 0. Transfers: no sign.
- Always `tabular-nums`, right-aligned in lists (`text-right whitespace-nowrap`), Geist (`font-sans`) even in headings: Fraunces numerals are too wide for 343px.
- `MoneyAmount` (`span`, `data-kind="income|expense|transfer|balance"`), with `sr-only` prefix for screen readers: **`Gelir`**, **`Gider`**, **`Virman`**.

| Kind | Colour | Row icon (`size-9 rounded-full grid place-items-center`) | Example |
|---|---|---|---|
| Gelir | `text-present-ink` | `ArrowDownLeft` on `bg-present/14 text-present-ink` | `+₺6.000,00` |
| Gider | `text-foreground` | `ArrowUpRight` on `bg-muted text-foreground` | `−₺3.500,00` |
| Virman | `text-muted-foreground` | `ArrowLeftRight` on `bg-muted` | `₺1.500,00` + `Kasa → Banka` |
| Açılış | `text-muted-foreground` | `Flag` on `bg-muted` | `₺2.500,00` |
| Negative balance / Zarar | `text-absent-ink` | — | `−₺1.300,00` + chip **`Eksi bakiye`** / word **`Zarar`** |

Accounts: `Banknote` **`Kasa`**, `Landmark` **`Banka`** (icon + word, `text-xs text-muted-foreground`). Voided: whole row `opacity-60`, amount `line-through`, chip **`İptal`** (`bg-muted text-muted-foreground`, `Ban` icon).

## 3. `/finans` Özet

1. h1 **`Finans`**, sub `text-sm text-muted-foreground` **`{Ekim 2026} · son kayıt {12 Eki}`**. Sub-nav (§1).
2. **Toplam tile** `on-stage rounded-3xl bg-stage p-5 text-stage-foreground`: eyebrow **`TOPLAM BAKİYE`**, `text-4xl font-semibold tabular-nums` amount (`data-testid="balance-total"`). Below, `grid grid-cols-2 gap-3` tiles `rounded-2xl border bg-card p-4`: `Banknote` **`Kasa`** / `Landmark` **`Banka`**, amount `text-2xl font-semibold tabular-nums` (`balance-cash`, `balance-bank`). At 375 each tile is 165px, `₺18.000,00` at text-2xl ≈ 130px: fits. Negative: amount `text-absent-ink` + chip **`Eksi bakiye`** (`bg-absent/12 text-absent-ink`, `CircleAlert`).
3. **Actions** `grid grid-cols-2 gap-3`: `Button h-12 rounded-2xl` `Plus` **`Gelir ekle`**, `Button h-12 rounded-2xl variant="outline"` `Minus` **`Gider ekle`**; full-width `Button variant="ghost" h-11` `ArrowLeftRight` **`Virman (Kasa ↔ Banka)`**. From `md` the three sit in one row right of the h1.
4. **Bu ay** card: three rows `flex justify-between`: **`Gelir`** `+₺…`, **`Gider`** `−₺…`, divider, **`Net`** (`font-semibold`; red when < 0). Link **`Aylık rapor`** → `/finans/rapor`.
5. **Aidat** card (current period): **`{Ekim 2026} aidatı`**, `text-sm tabular-nums` **`18/32 ödendi · ₺3.900,00 kalan`**, bar `h-1.5 bg-muted` with `bg-present` fill, `Gecikti` count when > 0, button **`Ödeme al`** (opens §5.3 with member search), link **`Aidat listesi`**.
6. **`SON HAREKETLER`** eyebrow, last 10 rows (§4.1), link **`Tüm hareketler`**.
- Empty (no entries, no opening): dashed card `Wallet` **`Henüz kayıt yok.`** / **`Önce Ayarlar'dan açılış bakiyesini gir, sonra gelir ve giderleri ekle.`** + **`Açılış bakiyesi gir`** → `/finans/ayarlar`.

## 4. Ledger

### 4.1 `/finans/hareketler`
- h1 **`Hareketler`**, month stepper `flex items-center gap-1`: `ChevronLeft` `size-11` (`aria-label="Önceki ay"`), **`Ekim 2026`** (`min-w-28 text-center font-medium`), `ChevronRight` (`Sonraki ay`, disabled for future). Header right: `Plus` **`Ekle`** (menu: **`Gelir`**, **`Gider`**, **`Virman`**), `Download` **`CSV`** (→ `/finans/rapor#csv`).
- Filters, chip row scrolling: **`Tümü`** · **`Gelir`** · **`Gider`** · **`Virman`** · **`Belgesiz giderler {n}`** · **`İptal edilenler`**; then `SlidersHorizontal` **`Filtre`** chip opening a Sheet with selects **`Kategori`**, **`Hesap`** (`Tümü/Kasa/Banka`), **`Etkinlik`**, and **`Uygula`** / **`Temizle`**. Active sheet filters show as removable chips (`X`, `aria-label="Filtreyi kaldır: Salon / mekân"`).
- Groups per day: eyebrow `text-xs tracking-[0.2em] uppercase` **`12 EKİM PAZAR`**, `ul.divide-y.rounded-2xl.border.bg-card`.
- **Row** (whole row `Link` → `/finans/[id]`, `min-h-16 px-4 py-3 flex gap-3`): kind icon (§2); middle `min-w-0 flex-1`: line 1 `font-medium truncate` description or category label when empty; line 2 `text-xs text-muted-foreground truncate` `{Kategori} · {Kimden/Kime | Sponsor | Üye · Dönem}`; line 3 `text-xs` account icon+word, `Paperclip` (`aria-label="Belge var"`) or for expenses without a document `FileWarning text-late-ink` **`Belge yok`**. Right: `MoneyAmount`. Width at 375: 343 − 32 − 36 − 12 − 12 − 104 = 147px text column.
- Footer card `tabular-nums`: **`Ekim toplamı: +₺8.100,00 gelir · −₺6.800,00 gider · Net +₺1.300,00`** (voided and transfers excluded; under `İptal edilenler` the footer is hidden).
- Empty: **`Bu ay hareket yok.`**; filtered: **`Bu filtreye uyan hareket yok.`** + **`Filtreleri temizle`**; `belgesiz` empty: `CircleCheck` **`Bütün giderlerin belgesi var.`**

### 4.2 Entry form `/finans/yeni?tur=gelir|gider|virman` (also `&etkinlik=`, `&sponsor=`, `&duzelt=`)
h1 **`Gelir ekle`** / **`Gider ekle`** / **`Virman`** / **`Kaydı düzelt`**. `BackLink` to the origin (`?geri=` path, default `Hareketler`). One column `max-w-xl`. Top: segmented `ChoiceGroup` **`Tür`**: `Gelir` · `Gider` · `Virman` (switching keeps amount/date/description).

| Field | Control | Help / placeholder | Errors |
|---|---|---|---|
| **Tutar** | `Input inputMode="decimal" autoComplete="off" h-14 text-2xl tabular-nums` with fixed `₺` prefix inside; autofocus | echo `text-sm tabular-nums` **`Kaydedilecek: ₺1.250,50`** (updates on input; hidden when empty/invalid) | **`Tutar gir.`** · **`Tutar sıfırdan büyük olmalı.`** · **`Tutarı 1.250,50 biçiminde gir.`** · **`Tutar en fazla ₺10.000.000,00 olabilir.`** |
| **Kategori** (gelir/gider) | `ChoiceGroup` chips, 5 income (no `Aidat`) / 11 expense; wraps to 3–4 rows at 375 | under income: **`Aidat ödemeleri Aidat sayfasından alınır.`** (link) | **`Kategori seç.`** |
| **Tarih** | `input type="date"`, default today; chips **`Bugün`** · **`Dün`** | — | **`Tarih gir.`** · **`Tarih çok ileride.`** |
| **Hesap** / **Kaynak hesap** | `ChoiceGroup` `Kasa` · `Banka` | — | — |
| **Hedef hesap** (virman) | `ChoiceGroup`, preselects the other account | — | **`Kaynak ve hedef hesap aynı olamaz.`** |
| **Sponsor** (category `Sponsorluk` only, shown inline right after it) | field-looking button → Sheet with search **`Sponsor ara`**, active sponsors, last row **`+ Yeni sponsor`** (inline name `Input` + **`Ekle`**) | — | **`Sponsor seç.`** · **`Bu adla bir sponsor zaten var.`** |
| **Etkinlik** (gelir/gider, optional) | `Select` **`Etkinlik yok`** + events newest first; prefilled from `?etkinlik=` | — | — |
| **Kimden** / **Kime** (label by kind) | `Input` | `ör. Mülkiye Vakfı` / `ör. Ahmet Yılmaz (korrepetitör)` | **`En fazla 120 karakter.`** |
| **Açıklama** | `Input` (one line), counter from 160 | `ör. Salon kirası, 12 Aralık genel prova` | **`En fazla 200 karakter.`** |
| **Belge** | `Input type="url" inputMode="url"`, `Paperclip` prefix | **`Makbuz veya faturanın Drive bağlantısı. Sonra da ekleyebilirsin.`** | **`Geçerli bir https bağlantısı gir.`** |

- Submit sticky at the bottom on mobile (`sticky bottom-[calc(env(safe-area-inset-bottom)+76px)]` above the tab bar, `bg-background/95 backdrop-blur pt-3`): `Button h-12 w-full rounded-xl` **`Kaydet`**; with `duzelt`: **`Düzeltilmiş kaydı kaydet`**. Secondary for gelir/gider: `variant="ghost"` **`Kaydet ve yenisini ekle`** (keeps tür/kategori/hesap/tarih, clears amount/description, refocuses Tutar).
- Toast **`Kaydedildi.`**; correction **`Kayıt düzeltildi.`** Banner on errors **`Bazı alanları düzeltmen gerekiyor.`**
- `?duzelt=` banner at top `rounded-2xl border border-late/40 bg-late/10 p-4`: **`Bu kaydı düzeltiyorsun: {−₺1.500,00 · Salon / mekân · 12 Eki}. Kaydettiğinde eski kayıt "Düzeltildi" nedeniyle iptal edilir.`** All fields editable except `Tür` when it was `Aidat`-category (dues corrections stay dues: member/period shown read-only, amount/date/account editable).

### 4.3 Detail `/finans/[id]`
- `BackLink` **`Hareketler`**. Eyebrow **`GİDER · SALON / MEKÂN`**; amount `text-4xl font-semibold tabular-nums`; `İptal` chip when voided.
- `dl` rows (`grid grid-cols-[7rem_1fr] gap-y-3 text-sm`): **`Tarih`** `12 Ekim 2026 Pazar` · **`Hesap`** · **`Kimden`/`Kime`** · **`Açıklama`** · **`Sponsor`** (link) · **`Etkinlik`** (link) · **`Üye`**/**`Aidat dönemi`** · **`Belge`**: Drive → existing preview `LinkRow` **`Belgeyi aç`**; none → **`Belge eklenmedi`** + **`Belge ekle`** (opens Düzenle).
- Audit, `text-xs text-muted-foreground space-y-1`: **`Kaydeden: {Ad} · 12 Eki 21:40`**, **`Son düzenleme: {Ad} · 14 Eki 09:02`**, **`İptal: {Ad} · 15 Eki · {neden}`**, links **`Bu kaydın yerine: −₺150,00 · 12 Eki`** / **`Düzeltilmiş kayıt: −₺150,00 · 12 Eki`**.
- Actions (not voided) `flex flex-wrap gap-2`: `Pencil` **`Düzenle`** (outline), `PenLine` **`Düzelt`** (outline), `Ban` **`İptal et`** (ghost, `text-destructive`). No delete anywhere. Opening entries: only **`Ayarlar'dan değiştir`**. Voided: no actions.
- **Düzenle** = Sheet **`Kaydı düzenle`**, fields Açıklama, Kimden/Kime, Etkinlik, Belge; note **`Tutar, tarih, hesap veya kategori yanlışsa "Düzelt"i kullan.`**; **`Kaydet`** → toast **`Kaydedildi.`**
- **İptal et** = `ConfirmDialog` title **`Bu kayıt iptal edilsin mi?`**, description **`{−₺1.500,00 · Salon / mekân · 12 Eki} toplamlardan çıkar. İptal geri alınamaz; gerekirse yeniden girersin.`**, `Textarea` **`İptal nedeni`** placeholder `ör. Aynı ödeme iki kez girilmiş`, buttons **`Vazgeç`** / **`İptal et`** (destructive). Error **`İptal nedeni yaz (en az 5 karakter).`** Toast **`Kayıt iptal edildi.`**

## 5. Dues `/finans/aidat`

### 6.1 Period list view (default)
- h1 **`Aidat`**; period selector = chip row (newest left, current preselected, `?donem=`), last chip **`Dönemler`** → §5.4. Header right `Download` **`CSV`** (dues CSV of the period), toggle **`Liste`** / **`Tablo`**.
- Summary card: **`Toplanan ₺6.300,00 / ₺9.600,00`** (`tabular-nums`), bar, line **`18 ödedi · 4 kısmi · 6 ödemedi · 2 muaf`**, **`Son ödeme: 15 Ekim`** (`Gecikti` words when past).
- Chips **`Tümü {n}`** · **`Borçlular {n}`** (`?filtre=borclu`), search `Input` **`Üye ara`** (client filter; at 375 under the chips).
- Groups `S/A/T/B` (`PartDot` **`Alto · 6/9 ödedi`**), `ul.divide-y.rounded-2xl.border.bg-card`; no-part members last under **`Partisyonsuz`**.
- **Row** `min-h-16 px-4 flex items-center gap-3`: name button (opens §5.2) `flex-1 min-w-0`: `font-medium truncate`, below `text-xs text-muted-foreground` rate/flags **`İndirimli · Öğrenci`**, **`Ayrıldı`**, **`Bu dönem muaf: yurt dışında`**; status chip (`data-tone`, §5.5); right `Button variant="outline" size-11 rounded-full` `Plus` (`aria-label="Ödeme al: {Ad}"`) for owing rows only. T1: tap the row's `+` → sheet with amount prefilled → **`₺300,00 al`** = 2 taps per member.
- Filtered empty: `CircleCheck` **`Bu dönem borçlu kimse yok.`**; no periods: **`Henüz aidat dönemi yok.`** + **`Dönem oluştur`**.

### 6.2 Member sheet
`SheetTitle` name, `SheetDescription` **`Alto · Tam aidat`**. Sections:
1. **`Kalan borç ₺500,00`** (`text-2xl tabular-nums`, red when any `Gecikti`), primary **`Ödeme al`** (§5.3).
2. **`Dönemler`**: last 12 periods + older unpaid, rows `{Ekim 2026}` · `{owed}` · status chip.
3. **`Ödemeler`**: `{12 Eki} · {Ekim 2026} · Kasa · ₺300,00`, each links to the entry.
4. **`Aidat oranı`**: `ChoiceGroup` **`Tam`** · **`İndirimli`** · **`Muaf`**, `Input` **`Not (yalnız yönetim görür)`** placeholder `ör. Öğrenci`, **`Kaydet`** → toast **`Aidat oranı güncellendi.`**; hint **`Ödenmemiş dönemlerin borcu yeni orana göre hesaplanır.`**
5. **`Bu dönem muaf`** (selected period): `Input` **`Neden`** placeholder `ör. Uzun hastalık`, **`Muaf tut`**; when set: **`Bu dönem muaf: {neden}`** + **`Muafiyeti kaldır`**. Toasts **`Muaf tutuldu.`** / **`Muafiyet kaldırıldı.`** Error **`Bu dönem için ödeme var; önce ödemeyi iptal et.`**

### 6.3 `Ödeme al` sheet
Title **`Ödeme al`**, description `{Ad} · kalan ₺500,00`. From the overview (no member) a first step **`Üye seç`** with search.
- **`Dönem`**: single-select open periods, oldest preselected, each `{Eylül 2026} · ₺200,00 kaldı`. Switch `Checkbox` **`Birden fazla dönem`**: turns rows into checkboxes, amount becomes read-only sum **`Toplam ₺500,00 (2 dönem)`**.
- **`Tutar`** (single period): same amount input as §4.2, prefilled with the remaining; error **`Kalan borç ₺300,00; daha fazlası girilemez.`**
- **`Tarih`** (today, `Bugün`/`Dün` chips) and **`Hesap`** `Kasa` (default) / `Banka`.
- Primary `h-12 w-full` **`₺300,00 al`** (label follows the amount). Toast **`Ödeme alındı: {Ad} · ₺500,00.`** with action **`Sonraki borçlu`** (opens the next owing member in list order; the T1 loop).

### 6.4 Periods `/finans/aidat/donemler`
- List rows `{Ekim 2026}` · `1–31 Eki · son ödeme 15 Eki` · `₺300,00 / ₺150,00` · `18/32 ödendi`. Buttons **`Yeni dönem`**, **`Toplu oluştur`**.
- **Dönem form** (Sheet): **`Ad`** (`ör. Ekim 2026`), **`Başlangıç`**, **`Bitiş`**, **`Son ödeme`**, **`Tam aidat`**, **`İndirimli aidat`** (hint **`Boş bırakırsan indirimli üyeler de tam öder.`**). Errors **`Ad gir.`**, **`Bu adla bir dönem var.`**, **`Bitiş başlangıçtan önce olamaz.`**, **`Son ödeme dönem içinde olmalı.`**, **`İndirimli aidat tam aidattan az olmalı.`** With payments: fields disabled, note **`Bu döneme ödeme girilmiş; değiştirilemez.`**; delete (`ConfirmDialog` **`{Ekim 2026} silinsin mi?`** / **`Sil`**) refused with **`Bu döneme ödeme girilmiş.`**
- **Toplu oluştur**: **`İlk ay`** / **`Son ay`** (`input type="month"`), **`Tam aidat`**, **`İndirimli aidat`**, **`Son ödeme günü`** (default 15); preview list **`Ocak 2027 · son ödeme 15 Oca · ₺350,00 / ₺175,00`**; existing names flagged **`zaten var, atlanacak`**. Button **`{n} dönem oluştur`**, toast **`{n} dönem oluşturuldu.`**

### 6.5 Status chips (shared `DuesChip`, Phase 4 look)
| Status | `data-tone` | Classes | Icon | Copy |
|---|---|---|---|---|
| Muaf | `muted` | `bg-muted text-muted-foreground` | `MinusCircle` | **`Muaf`** |
| Ödendi | `done` | `bg-muted text-foreground` | `CircleCheck` (`text-present-ink`) | **`Ödendi`** |
| Kısmi | `amber` | `bg-late/18 text-late-ink` | `CircleDashed` | **`Kısmi · ₺200,00 kaldı`** |
| Ödenmedi | `amber` | `bg-late/18 text-late-ink` | `Clock` | **`Ödenmedi`** |
| Gecikti | `red` | `bg-absent/12 text-absent-ink` (lists); solid `bg-absent text-white dark:text-background` on the member's own card | `CircleAlert` | **`Gecikti · ₺200,00 kaldı`** |

### 6.6 Table view `?gorunum=tablo`
Like `/odevler/matris`: box `-mx-4 overflow-x-auto`, sticky name column `w-[120px] bg-card`, last 6 periods newest left, cells `size-12` icon-only (status icons above, `aria-label="{Ad}, {Ekim 2026}: {durum}"`), tap → §5.2. Sticky right **`₺500`** remaining (`text-absent-ink` when any late). Legend with the five statuses.

## 6. Events and sponsors

- **`/finans/etkinlikler`**: rows `{Kış Konseri 2026}` · `{14 Ara 2026}` · right net **`Kâr ₺4.200,00`** (`text-present-ink`) / **`Zarar −₺1.300,00`** (`text-absent-ink`) / **`Hareket yok`** (muted). Buttons **`Yeni etkinlik`**, **`Konserden oluştur`** (Sheet listing concert rehearsals without event: `{Kış Konseri} · 14 Ara Pzt`; tap prefills the form). Form: **`Ad`** (`ör. Kış Konseri 2026`), **`Tarih`**, **`Konser`** select (optional). Errors **`Ad gir.`**, **`En fazla 80 karakter.`** Toast **`Etkinlik oluşturuldu.`** Empty **`Henüz etkinlik yok.`**
- **`/finans/etkinlikler/[id]`**: h1 name, sub date + linked concert link. P/L card: **`GELİR`** lines `{Bilet satışı} +₺6.000,00`, `{Sponsorluk} +₺5.000,00`, subtotal; **`GİDER`** lines; divider; result `text-2xl font-semibold` **`Kâr ₺4.200,00`** or **`Zarar −₺800,00`** (word + sign + colour). Buttons **`Gelir ekle`** / **`Gider ekle`** → `/finans/yeni?tur=…&etkinlik={id}&geri=…`. Entries list (§4.1 rows). Menu **`Yeniden adlandır`**, **`Sil`** (refused: **`Bu etkinliğe bağlı hareketler var.`**).
- **`/finans/sponsorlar`**: chips **`Aktif`** · **`Tümü`**; rows name, `contactName`, right **`2026: ₺5.000,00`**. **`Yeni sponsor`** Sheet: **`Ad`**, **`İlgili kişi`**, **`Telefon veya e-posta`**, **`Not`**, switch **`Aktif`**. Errors **`Ad gir.`**, **`Bu adla bir sponsor zaten var.`** Toast **`Sponsor kaydedildi.`** Empty **`Henüz sponsor yok.`**
- **Sponsor detail**: contact (phone `tel:`, email `mailto:` links, `min-h-11`), note, per-year totals **`2026 · ₺5.000,00`**, entries, **`Sponsorluk geliri ekle`** → `/finans/yeni?tur=gelir&sponsor={id}`.

## 7. Report and CSV

- **`/finans/rapor?yil=2026`**: year chips (years with entries + current). Header **`Muhasebe CSV`** button scrolls to `#csv`.
- **Monthly** — phone: one card per month (newest first), `{Ekim}` + `dl` **`Devir`**, **`Gelir`**, **`Gider`**, **`Net`**, **`Kapanış`**; a `ChoiceGroup` above **`Toplam`** · **`Kasa`** · **`Banka`** (`?hesap=`). From `md`: `table` with those columns, `tabular-nums text-right`, sticky header, total row **`Yıl`**. Months without entries still render (Devir = Kapanış) until the current month.
- **Category totals**: two lists **`Gelir kalemleri`** / **`Gider kalemleri`**, row label + amount + share bar `h-1.5` (`bg-present` / `bg-foreground/40`) + `%` text; month select **`Tüm yıl`** / months.
- **`#csv` card**: **`Muhasebe CSV`**, **`Başlangıç`** / **`Bitiş`** dates (default 1 Oca – 31 Ara of `yil`), `Download` **`CSV indir`** (`<a download>`), hint **`İptal edilen kayıtlar dahil değil. Excel'de Türkçe açılır.`** Error toast for bad range **`Bitiş başlangıçtan önce olamaz.`**
- Dues CSV button lives on `/finans/aidat` (`CSV`, period of the screen).
- **`/finans/ayarlar`**: **`Açılış bakiyesi`** card: **`Tarih`**, **`Kasa`**, **`Banka`** amounts, **`Kaydet`**; locked note **`Bu tarihten önce kayıt olduğu için değiştirilemez.`**; toast **`Açılış bakiyesi kaydedildi.`** **`Ödeme bilgisi`** card: `Textarea rows=4` counter at 400, placeholder `IBAN TR00 0000 … · Alıcı: Arkhe Korosu · Açıklamaya adını ve ayı yaz.`, hint **`Koristler Aidatım bölümünde bunu görür.`**, preview as members see it; toast **`Ödeme bilgisi güncellendi.`**; error **`En fazla 500 karakter.`**

## 8. Member `Aidatım`

- **Home card** (after `Ödevlerim`; only when remaining > 0): `CardHeader` **`Aidatım`** + link **`Ayrıntı`** → `/profil#aidat`. Body: **`Kalan borcun ₺400,00`** (`text-2xl tabular-nums`), most urgent period line `{Eylül 2026}` + `DuesChip`, **`+1 dönem daha`**, button `variant="outline" h-11` `Copy` **`IBAN'ı kopyala`** (copies the whole payment info; hidden if empty).
- **`/profil` section `id="aidat"`** (first section; also for YK who pay; conductor hidden):
  - h2 **`Aidatım`**; summary: remaining > 0 → **`Kalan borcun ₺400,00`**; 0 → `CircleCheck text-present-ink` **`Borcun yok. Teşekkürler!`**; exempt → **`Aidattan muafsın.`** (no periods list); no periods → **`Henüz aidat dönemi yok.`**
  - Rows (`ul.divide-y.rounded-2xl.border.bg-card`, `min-h-14`): `{Ekim 2026}` + `text-xs` **`Son ödeme 15 Eki · ₺300,00`** (owed incl. `İndirimli` word when reduced) + `DuesChip` (own `Gecikti` uses the solid look). Waived: **`Bu dönem muaf`**.
  - **`Ödemelerim`**: `{12 Eki} · {Eylül 2026} · ₺100,00`; empty **`Henüz ödeme kaydın yok.`**
  - **`Nasıl ödenir?`** card `rounded-xl bg-muted p-4`: text `whitespace-pre-line select-all font-mono text-sm break-words`, `Button h-11` `Copy` **`Kopyala`** → toast **`Kopyalandı.`** Empty: **`Ödeme bilgisi henüz eklenmedi. Saymanına sor.`** Footer `text-xs` **`Ödemen yönetim kaydedince burada görünür.`**

## 9. Tokens, themes, errors

- **No token changes.** Income `present-ink`, warnings `late-ink`, negative/late `absent-ink`, soft fills `/12–/18` exactly as Phase 4 (both themes verified there). The Toplam tile uses `bg-stage` + `stage-foreground` (≥ 12:1 both themes). Dark: expense amounts `text-foreground` (cream), income `present-ink` dark L 0.86 on `card` L 0.2 ≈ 10:1.
- Dark check for @ui: solid `Gecikti` on member card uses `dark:text-background` (Phase 4 fix); the sticky submit bar must use `bg-background/95`, not transparent; report table sticky header `bg-card`.
- Loading (`loading.tsx` each route): tiles `h-24 rounded-2xl`, 6 skeleton rows `h-16`.
- Server errors via `toast.error`: **`Bu işlem için yetkin yok.`** · **`Bu kayıt artık yok.`** · **`Bu kayıt zaten iptal edilmiş.`** (double void / correcting a voided entry) · **`Bir sorun oldu. Tekrar dene.`**
- Accessibility: every amount has its kind in text (`sr-only` or visible sign); chips carry icon + word; month stepper and `+` buttons have `aria-label`s; Sheet focus returns to the row that opened it; the `Ödeme al` amount echo is `aria-live="polite"`.
