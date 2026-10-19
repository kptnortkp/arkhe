# Phase 5 — UI review (arkhe-ui-engineer)

Read: `po-decisions.md` (binding), `ui.md`, `implementation-notes.md`, and all of `src/components/finance/*`, the `/finans/**` pages, `copy-button.tsx`, `flash-toast.tsx`, `lib/flash.ts`, `confirm-dialog.tsx`, `(portal)/layout.tsx`, home and `/profil`.

How I checked:
- playwright-core + Chrome at 390 px (mobile, touch) and 1280 px, in light and dark, plus 820 and 1024 px for the report.
- Pages as `yk@`: `/`, `/profil`, `/finans`, `/hareketler` (default, `?iptal=1`, `?belgesiz=1`), `/yeni?tur=gider`, `/aidat`, `/aidat/donemler`, `/etkinlikler`, `/sponsorlar`, `/rapor` (Toplam and `?hesap=kasa`), `/ayarlar`. Pages as `korist@`: `/` and `/profil`.
- axe-core on every page (wcag2a/aa, 21aa, 22aa, best-practice), a check for page-level horizontal scroll, and a scan for targets under 44 px.
- Keyboard and focus flows: payment sheet, member sheet, void dialog, edit sheet, entry form errors, `+ Yeni sponsor`, Düzelt plus the flash toast, waiver.

Test data I created:
- One `E2E review düzelt` expense (₺1 → corrected to ₺2), then voided with `E2E review temizlik`.
- One waiver `E2E review muaf` on Ozan Yılmaz for the current period, then removed. I checked with sqlite that it is gone.

`npm run lint` and `npm run typecheck` pass.

## What holds
- **No page-level horizontal scroll** at 390 px in either theme on any finance page, the home cards or `/profil#aidat`.
- **axe:** clean everywhere except one finding (P3-1).
- **Targets:** every finance target is ≥ 44 px. The only 36–40 px links are on the home page (`21 Ekim Çarşamba`, `Geçmişim`, `Raporlar`) and predate Phase 5.
- **Hydration:** no console errors and no hydration warnings on any screen. Money in server components is formatted on the server. Client islands format only what the user is typing, or content that exists only after an interaction (sheet contents, button labels). `AmountInput` takes its first echo from the server.
- **Sticky submit bar:** at 390×844 the bar on `/finans/yeni` ends at y = 768. The fixed tab bar starts at 774.5, so they don't overlap. From `md` up the bar is static.
- **Money display:**
  - `MoneyAmount` always prints the sign as text (`+` / U+2212) and adds an sr-only kind word.
  - `tabular-nums` and `whitespace-nowrap` are on every amount.
  - Status chips are icon + word. Voided rows have a text `İptal` chip. Negative balances get `Eksi bakiye`, and P/L shows `Kâr` / `Zarar`.
- **Focus that works:**
  - `useFocusError` puts focus on `Tutar` after an empty submit.
  - The payment sheet opens on its first radio. Escape returns focus to `Ödeme al: {Ad}`.
  - The URL member sheet returns focus to the member's name link after `router.replace`.
  - The edit sheet and the void dialog return focus to their triggers.
  - The void dialog opens on the textarea.
- **Server Components:** the overview, ledger, detail, report, events, sponsors and `Aidatım` render with no client JS. The ledger filter is a GET `<details>` form. `FinanceNav` gets `active` as a prop, so it needs no `usePathname` island.
- **Flash cookie:** `setFlash` + `redirect()` in `correctEntry` (`actions.ts:244-245`) uses the documented Server Action pattern of setting a cookie and then redirecting. The cookie is short-lived (30 s), `SameSite=Lax`, and holds text only, which sonner renders as text.

## P1
1. **Saving a waiver starts an endless refresh and toast loop.** File: `src/components/finance/member-dues-forms.tsx:131`.
   - Problem: `useToastOnSuccess({ ...state, error: undefined })` passes a new object on every render. So `seen.current === state` is never true and the effect runs after every render. Each run calls `toast.success` and `router.refresh()`, which renders again.
   - Measured: after `Muaf tut`, **90 requests and 75 `Muaf tutuldu.` toasts in 5 s**. The loop keeps going for as long as the member sheet is mounted, even after `Muafiyeti kaldır`, because `state.success` stays set. The e2e misses it because it only asserts the first toast or the row.
   - Fix: pass `state` itself, and toast errors only where wanted. For example, give `useToastOnSuccess(state, { errors: false })` a flag, or key the guard on `state` before spreading:
     ```ts
     useToastOnSuccess(state, false) // and inside: if (state.error && showErrors) toast.error(...)
     ```
2. **The payment echo shows the wrong amount after switching period.** Files: `src/components/finance/amount-input.tsx:37`, `src/components/finance/payment-form.tsx:84-92, 142`.
   - Problem: the echo shows `initialEcho` until the user types (`touched`). Picking another period radio calls `setAmount(amountInput(p.remaining))` without touching the input. The input then reads the new remaining (`300,00`), but the echo still says the first period's `Kaydedilecek: ₺200,00`. That is exactly the seeded korist case (M−1 ₺200, M ₺300).
   - D2 makes the echo the mandatory safety net, so it must never disagree with what will be saved. The submit label `₺300,00 al` is right, which makes the mismatch more confusing.
   - I couldn't reproduce it live because every current debtor's open periods have equal remaining amounts. The code path is unambiguous.
   - Fix: once the value differs from the value at mount, derive the echo from the value. In `AmountInput`, keep `const [initial] = useState(value)` and use `const echo = value === initial ? initialEcho ?? null : parsed?.ok ? formatKurus(parsed.kurus) : null`. This keeps the hydration guarantee (the first render still uses the server string) and fixes every programmatic change, including `Kaydet ve yenisini ekle` clearing the amount.

## P2
1. **The report table is clipped between `md` and about 1100 px.** File: `src/app/(portal)/finans/rapor/page.tsx:147`.
   - Problem: the table wrapper is `hidden overflow-hidden … md:block`. The Kasa view table is 708 px wide. The box is 482 px wide at 820 px and 686 px wide at 1024 px. The `Kapanış` column is cut off and can't be scrolled to (screenshot at 1024: `Kapanı|`, `₺10.500,0|`). ui §10 assumed 944 px, but the sidebar takes 256 px.
   - Fix: switch to the table at `lg` instead of `md` (`lg:hidden` / `hidden lg:block`). Or make the wrapper `overflow-x-auto` with `role="region" tabIndex={0} aria-labelledby="aylik"` and a focus ring, as on the Phase 4 matrix.
2. **The Virman column announces "Gelir" / "Gider" and uses the income colour.** File: `src/app/(portal)/finans/rapor/page.tsx:25-28`.
   - Problem: `signedTransfer` renders `MoneyAmount kind="income"|"expense"`. A screen reader hears "Gider −₺1.500,00" for a transfer, and a positive transfer turns green. ux/D28 keep transfers muted.
   - Fix: render `<span data-testid="money" data-kind="transfer" data-kurus={kurus} className="font-sans tabular-nums whitespace-nowrap text-muted-foreground"><span className="sr-only">Virman </span>{kurus > 0 ? formatSigned(kurus,"in") : formatSigned(-kurus,"out")}</span>`. Or add an optional `signed` prop to `MoneyAmount` for `kind="transfer"`.
3. **The void dialog drops focus to `<body>` on a validation error, and the error is silent.** File: `src/components/finance/entry-actions.tsx:166-180, 209-213`.
   - Problem: the `İptal et` button is disabled while pending, so it loses focus. When `İptal nedeni yaz (en az 5 karakter).` comes back, nothing moves focus to it or announces it. Measured: `activeElement = BODY`. Inside a modal this also leaves the user outside the focus trap's content.
   - Fix: add a `textareaRef` and call `textareaRef.current?.focus()` after `setError(...)`. The textarea already has `aria-describedby` pointing to the error, so focusing it reads the error.
4. **`+ Yeni sponsor` and `Ekle` drop focus to `<body>`.** File: `src/components/finance/entry-form.tsx:261-304, 145-148`.
   - Problem: the button that was clicked unmounts. Measured after the click: `BODY`. After a successful `Ekle` the panel unmounts too.
   - Fix: add `autoFocus` on `#newSponsor`. After a successful add, focus `#sponsorId` (`requestAnimationFrame(() => document.getElementById("sponsorId")?.focus())`). After a sponsor error, focus `#newSponsor`.
5. **The flash toast shows twice in dev.** Files: `src/components/flash-toast.tsx:8-10`, `layout.tsx:63`.
   - Problem: Strict Mode runs the effect twice, so `toast.success` fires twice. Measured after `Düzelt`: `["Kayıt düzeltildi.","Kayıt düzeltildi.", …]`. Production runs effects once, but e2e runs against dev, and the same double toast would show after any remount.
   - Fix: make the toast idempotent with `toast.success(message, { id: "flash" })`. Optional: replace the client-side `document.cookie` clear with a check that the cookie still exists, so a back/forward cache restore doesn't re-toast.
6. **Payment form errors that are not on `Tutar` are not linked, and some are not focused.** File: `src/components/finance/payment-form.tsx:73-107, 124-137, 147-178`.
   - Problem: in multi mode the amount error (`Kalan borç …`) is a bare `<p>`, as are the `periodIds` and `occurredOn` errors. The `Dönem` fieldset has no `aria-invalid`, and `#pay-date` has no `aria-describedby`. `useFocusError` finds no target, and there is no `role=alert` unless `state.error` is set. A multi-period over-payment or a bad date is then neither focused nor announced.
   - Fix: give the fieldset `aria-invalid` / `aria-describedby="periodIds-error"` (or use `ChoiceChips`-style markup). Give `#pay-date` `aria-describedby="pay-date-error"`. In multi mode, render the amount error inside `FormMessage` (`role=alert`) or give the `Toplam` line an `id` plus `role=alert` on the error.
7. **Closing the payment sheet after a successful payment loses focus.** File: `src/components/finance/dues-list.tsx:146-157, 166`.
   - Problem: base-ui returns focus to the `+` button that opened the sheet. After `router.refresh()` that member is paid, so their `+` has become the placeholder `<span>`. This is inferred from the code and base-ui's `finalFocus` default; I did not record a real payment to avoid creating unprefixed money rows. The `Sonraki borçlu` loop makes it worse, because the original trigger is several members back.
   - Fix: on `Sheet` set `finalFocus` to a function returning `document.querySelector(\`#uye-${paying.row.id} a\`)`. That is the last member handled, and their name link always exists.
8. **`CsvRangeForm` shows the range error without focus or announcement.** File: `src/components/finance/csv-range-form.tsx:16-22`.
   - Fix: after `setError`, focus `e.currentTarget.elements.namedItem("to")`. `Field` already wires `aria-invalid` and `aria-describedby`.

## P3
1. The disabled `Sonraki ay` in `src/app/(portal)/finans/hareketler/page.tsx:108-114` is a `<span aria-label>` with no role, which axe flags as `aria-prohibited-attr` on every ledger screen. Fix: `<span role="link" aria-disabled="true" aria-label="Sonraki ay">`, or drop the label and use a visually hidden text.
2. Sticky bar gap, `entry-form.tsx:445`: there's a 6 px strip between the bar (bottom 768) and the tab bar (774.5) where form content shows through. On a 844 px phone the two-button bar is also 120 px tall. Fix: `bottom-[calc(env(safe-area-inset-bottom)+4.375rem)]` with `pb-3`, so the bar meets the tab bar. Optionally put `Kaydet ve yenisini ekle` beside `Kaydet` (`grid-cols-[1fr_auto]`) at < `md` to save one row.
3. `dues-list.tsx:176-178`: after a payment the sheet description still shows the stale `kalan` (from `paying.row`, captured before the payment). Fix: hide the `· kalan …` line when `paying.done` is set.
4. `dues-chip.tsx:25` uses raw `text-white` for the solid overdue chip. Use a token, for example `text-primary-foreground` if it measures the same as in Phase 4 (5.16:1), or add `--absent-foreground`.
5. `entry-row.tsx:61`: voided rows use `opacity-60` on the whole link, which dims `text-muted-foreground` metadata further. axe didn't flag it at the seeded content, but drop the opacity on the text line and keep `line-through` plus the `İptal` chip as the signals.
6. `hareketler/page.tsx:161`: the filter form is a plain GET, so `Uygula` does a full document load. `next/form` `<Form action="/finans/hareketler">` gives client navigation with no new client code in the page, and can be used from a Server Component.
7. `event-forms.tsx:145-156`: picking a concert closes the picker sheet and opens `EventSheet`. When that sheet closes, focus has no trigger to return to (the concert button is gone). Fix: `finalFocus` to the `Konserden oluştur` button via a ref.
8. Sheets mounted conditionally (`period-forms.tsx:296-297, 319`, `sponsor-forms.tsx:139, 151`, `event-forms.tsx:201`) unmount on close, so the close animation is skipped. Focus return still works. Cosmetic; keep it if the simpler state is preferred.
9. `period-forms.tsx:209-224`: `type="month"` is a plain text box in desktop Safari and Firefox. Add `placeholder="2026-11"` and a `pattern` hint, or accept `11/2026` on the server.
10. `edit sheet / period / sponsor / opening / settings forms` don't use `useFocusError`. Their form-level errors are announced through `role=alert`, but field errors (e.g. a bad `Belge` URL in `Düzenle`) aren't focused. Add the hook for consistency with `EntryForm`.
11. Contrast of a negative Toplam on `bg-stage` (`text-absent-ink` on the stage tile, ui §12) couldn't be measured, because no screen has a negative total. Check it with a seeded negative once; the fallback is a chip on `bg-card` inside the tile.
