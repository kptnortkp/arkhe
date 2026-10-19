# Phase 5 UX review: Finans

Author: arkhe-ux-designer. Checked against `po-decisions.md` (binding) and my `ux.md`. Real Chrome via playwright-core at 390 × 844 (DPR 2, touch) and 1280 × 900, light and dark. Accounts: `yk@` (treasurer flows), `sef@`, `korist@`, `ece.demir@`, `baris.gunes@`. Data I created used the `E2E` prefix; my two korist test payments were voided again with reason `E2E ux review geri al`. Other reviewers were writing to the same DB at the same time, so a few totals in my screenshots differ from `financeExpected`. That is not a defect.

Screens checked: `/` (manager `Kasa` card, member `Aidatım` card), `/finans`, `/hareketler` (+ `belgesiz`, `iptal`, filter disclosure), `/yeni` (gider, virman, `duzelt`, error state), `/[id]` (plain, dues, voided, corrected), void dialog, `Düzenle` sheet, `/aidat` (+ `borclu`, `Ödeme al` single/multi/overpay/success/`Sonraki borçlu`, member sheet), `/aidat/donemler` + `Toplu oluştur` preview, `/etkinlikler` + `Konserden oluştur`, event P/L, `/sponsorlar(/[id])`, `/rapor` (+ `kasa`, `#csv`), `/ayarlar`, `/profil` for all five accounts.

## Verdict

**No P1.** All eight treasurer flows (T1–T8) and the member `Aidatım` views can be completed at 390px in both themes. I found no page-level horizontal scroll on any route, at either width or in either theme. Targets are ≥ 44px. Amounts use `tabular-nums`. Sign, kind, status and voided state are always shown as text. The copy matches `po-decisions` §2 everywhere I checked (`Kaydedilecek:`, `Kalan borç ₺200,00; daha fazlası girilemez.`, `Sonraki borçlu: {Ad}`, `zaten var, atlanacak`, `Bu kaydın yerine:` / `Düzeltilmiş kayıt:`, `Aidattan muafsın.`, `Borcun yok. Teşekkürler!`, `Ödemen yönetim kaydedince burada görünür.`). Dark mode holds up: the solid `Gecikti` chip on the member's own card, the gold primary and the `bg-stage` total tile all read well. The seven P2s below are small and should land this phase.

## P2: should fix this phase

**P2-1 · `Ödeme al` success state shows a stale `kalan`.** File: `src/components/finance/dues-list.tsx:175-178`.
- What's wrong: after saving, the `SheetDescription` still says `Defne Arslan · kalan ₺300,00` directly above `Ödeme alındı: Defne Arslan · ₺300,00.`. The sum is computed from `paying.row`, which is captured before the payment.
- Fix: in the `paying.done` state, either hide the `kalan` part (`{paying.row.name}` only) or show the new remaining: `Defne Arslan · kalan ₺0,00`.

**P2-2 · The `Sonraki borçlu` loop silently pays an older period.** Files: `dues-list.tsx`, `payment-form.tsx:37`, success copy at `finans/aidat/actions.ts:80,125`.
- What happens: on the `Ekim 2026` list, `Sonraki borçlu: İrem Şahin` opens with `Eylül 2026` preselected, which is correct per D17 (oldest open period). After `₺300,00 al`, İrem's Ekim row still shows `Ödenmedi`. The treasurer saw "paid" and now sees "not paid", and nothing on the list row explains why.
- Fix 1 (copy): name the periods in the success line and the toast. `Ödeme alındı: İrem Şahin · ₺300,00 (Eylül 2026).` For multi-period payments: `(Eylül 2026, Ekim 2026)`.
- Fix 2 (row flag): in the per-period list, add a flag to the row's `flags` line when the member owes an older period: `Eylül 2026 borcu var` (`text-xs text-late-ink`). That way the oldest-first preselection is expected before the tap.

**P2-3 · The active quick filter is off-screen at 375px.** File: `/finans/hareketler`, `src/app/(portal)/finans/hareketler/page.tsx:127-150`.
- What's wrong: `Belgesiz giderler` and `İptal edilenler` are the 5th and 6th chips, so they sit past the right edge of the scroll row. With `?belgesiz=1` the screen only says `Tüm aylar`. With `?iptal=1` in a month with no voids it says `Bu filtreye uyan hareket yok.` In neither case does the screen say which filter is on. T3 ("Belgesiz filter") lands on a list with no label.
- Fix (heading): make the heading reflect the quick filter: `Belgesiz giderler · Tüm aylar`, `İptal edilenler · Ekim 2026`.
- Fix (scroll): add `scrollIntoView({ inline: "center", block: "nearest" })` on the active chip at mount. This is a tiny client effect and could also go into `FilterChip`.
- Empty-state copy for `iptal`: `Bu ay iptal edilen kayıt yok.`

**P2-4 · The sticky submit bar takes about a third of the phone screen.** File: `src/components/finance/entry-form.tsx:445`.
- What's wrong: on Gelir/Gider the bar stacks `Kaydet` (h-12) and `Kaydet ve yenisini ekle` (ghost, h-11) plus padding, about 125px, on top of the 76px tab bar and 56px header. That leaves about 590px of 844 for the form. Once the iOS keyboard is up (about 300px), the field being typed in (`Kime`, `Açıklama`, `Belge`) sits under the bar. In the screenshots `Kime` and the description input are already half covered.
- Fix: one row on mobile, `grid grid-cols-[1fr_auto] gap-2`. Primary `Kaydet` h-12, secondary `Button variant="outline" h-12` labelled **`+ Yeni`** with `aria-label="Kaydet ve yenisini ekle"`. Keep the full label from `md`, where the bar is static.

**P2-5 · No `Belge ekle` on the detail page.** File: `src/app/(portal)/finans/[id]/page.tsx:88`.
- What's wrong: an entry without a document shows only the text `Belge eklenmedi`. `ux.md` §4.3 promised `Belge ekle`, which opens `Düzenle`. Without it, adding a receipt later (the point of the `Belgesiz` filter in T3) takes three steps: `Düzenle`, find the field, type.
- Fix: put a `Button variant="link" h-11` **`Belge ekle`** next to `Belge eklenmedi` that opens the `Düzenle` sheet with focus in `Belge`. The sheet currently autofocuses `Açıklama`, so add a `focus="documentUrl"` prop.

**P2-6 · The member sheet has no `Ödeme al`.** File: `/finans/aidat?uye=`, `src/app/(portal)/finans/aidat/page.tsx:207`.
- What's wrong: `Kalan borç ₺600,00` is shown in red with no action under it (`ux.md` §6.2.1). A treasurer who opened the member to check history has to close the sheet and find the `+` on the row.
- Fix: put a primary `Button h-12 w-full rounded-xl` **`Ödeme al`** right under `Kalan borç`. It should open the same `PaymentForm` inside the sheet (or close this sheet and open the payment sheet for that row). Hide it when remaining = 0.

**P2-7 · The waiver section title reads as a fact.** File: `src/components/finance/member-dues-forms.tsx:167`.
- What's wrong: `Ekim 2026: bu dönem muaf` is shown above an empty `Neden` field for a member who is *not* exempt.
- Fix: rename the title to **`Ekim 2026 için muafiyet`**. Keep `Bu dönem muaf: {neden}` + `Muafiyeti kaldır` for when a waiver exists.

## P3: later

- **P3-1 · Dues rows repeat `Aidat` twice** (`src/components/finance/entry-row.tsx:38-49`, all ledgers, Özet and the event list). A dues entry has no description, so its title is `Aidat` and line 2 is `Aidat · Elif Yıldız · Ekim 2026`. Fix: in `entryTitle`, use `memberName` as the title for dues entries, so line 2 becomes `Aidat · Ekim 2026`. Ten nearly identical rows on Özet then become scannable by name. (I'd almost call this P2; it costs 3 lines.)
- **P3-2 · Account/category chips: the selected state is weak in light mode.** `has-checked:bg-primary/8` plus a primary border sits close to the unselected `bg-card` + `border` (`Kasa` vs `Banka`, `Salon / mekân`). For money going to the wrong account, add a leading `Check` icon on the checked chip, visible only via `has-checked:` (`hidden group-has-checked:inline size-4`). Same component as Phase 4 `ChoiceGroup`, so change both together. No token change.
- **P3-3 · `Düzenle` vs `Düzelt`** differ by one letter, and their icons (`Pencil`/`PenLine`) look almost the same. Proposed labels: `Düzenle` → **`Not / belge`**, `Düzelt` → **`Tutarı düzelt`**. Keep the sheet hint `Tutar, tarih, hesap veya kategori yanlışsa "Düzelt"i kullan.` updated to the new label.
- **P3-4 · `Toplu oluştur` preview** says `Kasım 2026 · son ödeme 15`. Make it `son ödeme 15 Kas` (`ux.md` §6.4) so a due day after the month end (D9) is unambiguous. `input type="month"` renders `October 2026` in an English-locale browser; that is OS-native and acceptable.
- **P3-5 · Exempt member (`baris.gunes@`)** still sees `Nasıl ödenir?` with the IBAN and `Ödemen yönetim kaydedince burada görünür.`. Hide the card when the member is `Muaf` and has no open periods.
- **P3-6 · Period trash icon** shows on periods with payments, and the refusal (`Bu döneme ödeme girilmiş.`) only comes after the confirm. Disable it with `aria-disabled` + `title="Bu döneme ödeme girilmiş."`, or hide it when entries exist (the page already knows the paid counts).
- **P3-7 · Event P/L** has no subtotals under `GELİR` / `GİDER` (`ux.md` §6). Add a `font-medium` row `Toplam gelir +₺11.000,00` / `Toplam gider −₺6.800,00` before the divider.
- **P3-8 · Report phone cards** have no `Net` row; the desktop table has one. Add `Net` between `Gider` and `Kapanış` for parity.
- **P3-9 · Desktop width.** `/finans` and `/finans/aidat` stretch to about 940px at 1280, which leaves 800px between a row's name and its amount. Cap the content at `max-w-4xl` (ux asked for `max-w-3xl`; the report keeps `max-w-5xl`). At ≥ md, open `Ödeme al` as a centred dialog instead of a bottom sheet (`ux.md` header note).
- **P3-10 · Hareketler `Ekle`** goes straight to `Gider ekle`. That is fine: Tür is switchable in the form and expenses are the common case. Rename it to **`Gider ekle`** so the label matches where it lands, or keep `Ekle` and land on a neutral `Kayıt ekle` heading.

## Not issues (checked, keep)
- Ödeme al sheet: the period radio gets focus first (no keyboard pop on open). `Birden fazla dönem` → `Toplam ₺500,00 (2 dönem)` with the button `₺500,00 al`. The overpay error sits under the amount and the echo still shows `Kaydedilecek: ₺900,00`. Good.
- `Sonraki borçlu` gets focus after success. A toast fires too, with no action (D16).
- Düzelt: the warm `bg-late/10` banner reads well in both themes. After saving, the flash toast `Kayıt düzeltildi.` lands on the new entry. The old entry shows struck-through `−₺12,75` + `İptal` + `Düzeltildi` + a back-link.
- The CSV link from Hareketler scrolls to `#csv` on the report.
- Home `Kasa` card and `/profil` rows `Finans` / `Raporlar` (D25), and the member `Aidatım` card + `/profil#aidat` first (D20), are correct for all five accounts. `sef@` has no `Aidatım` section; `yk@` shows `Borcun yok. Teşekkürler!`.
- No token changes needed.
