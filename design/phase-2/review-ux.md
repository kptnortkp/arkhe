# Phase 2 UX review: rehearsals, attendance, reports and the brand refresh

Reviewed 2026-10-18 against http://127.0.0.1:3100. The yardsticks are `ux.md` and `po-decisions.md`; where they disagree, `po-decisions.md` wins.

**Accounts used:** `sef@`, `yk@` and `korist@`.

**Screens walked:**
- `/` (home)
- `/calismalar`, both tabs
- `/calismalar/yeni`, single and series
- rehearsal detail in five states: startable/open, closed, never opened, cancelled, member view
- the live screen at 1024×768, 768×1024, 1440×900, 1920×1080 and 390px, including the `?gorunum=kod` code-only view
- the code sheet: wrong code, then success
- the QR landing, logged out and then logged in
- `/raporlar`
- `/giris` after the brand refresh

**Coverage:** 390px and desktop, light and dark.

**Screenshots:** session scratchpad `team/ux/p2/*.png`. My test rehearsals used an `E2E` prefix. A concurrent e2e cleanup deleted them mid-session, which explains the 404s noted at the end.

**Overall:** this is a strong phase.
- **Calendar.** It reads well. The date blocks, the `Yoklama açık` chip and the plum concert block make the list easy to scan.
- **Member check-in.** Three taps, and the copy is right.
- **Reports.** They answer "who is slipping?" at a glance, with tiles first, then the warning card, then the table.
- **Live screen.** The core works: the code rotates, the countdown uses the gradient, the counters are live, bulk marking has undo, and the close dialog states the count. But it has layout bugs exactly where it matters: on the tablet and the phone.

---

## P1

### 1. Live screen at 1024×768: the code panel covers the roster
The left stage panel is 454px wide and the roster starts at x=433, so the panel covers the roster's first ~20px.

What you see in the screenshot:
- the counter reads `eldi 7 / 23`;
- the group headers read `OPRANO`;
- the avatars are cut in half.

This is the PO's target device (AC30).

The grid's fixed left column plus `p-8` ends up wider than its track. Fix:
- use `grid-cols-[minmax(0,40%)_minmax(0,1fr)]` with `min-w-0` on both children;
- or give the panel `overflow-hidden` and size the code with `clamp(96px, 11vw, 140px)` so it fits 40% of 1024px.

Re-check at 1024×768 and 1180×820 (iPad Air).

### 2. `Sadece kod` doesn't fit its own screen
- **1024×768:** the code renders at about 200px tall and the QR starts at y≈520. The bottom half of the QR is below the fold, so the one view meant to face the choir needs scrolling.
- **390px:** the code and the QR overflow to the right, giving horizontal scroll.

Fix: size by the viewport's height and width together.
- Make the view a column with `h-[calc(100dvh-3.5rem)]`.
- Code: `font-size: min(22vw, 24vh)`.
- QR: `size-[min(70vw,42vh)]`.
- Add `overflow-hidden` on the panel.

1920×1080 already looks right; keep that.

### 3. On phones the roster rows hide the names
On `/calismalar/[id]` at 390px, the name column shrinks to 3–4 characters, for example `Def…`, `C…`, `B…`. That happens because the selected segment shows its label, and the row also carries the avatar and `Elle · …`.

A manager correcting last week from a phone (C5) can't tell `Demo Korist` from `Demo Yönetim`. The live screen at 390px has the same problem, at about 8 characters.

Fix, below `sm`:
- stack each row: avatar + full name + meta line on top;
- put `StatusSegment` full width under it, as `grid grid-cols-4`, with an icon + short label in every segment (`Geldi / Geç / Maz. / Yok`);
- show `İşareti kaldır` as a ghost text button on the name line.

The row gets taller (about 104px), but every name is readable. Keep the one-line layout from `sm` up.

---

## P2

4. **`İşareti kaldır` uses the same `X` icon as `Gelmedi`, right next to it.** On a marked row there are two identical X's side by side; one sets "absent", the other clears the mark.
   - Change the clear button's icon to `Eraser` or `RotateCcw`.
   - Separate it from the segment with `ml-2` and a `border-l`.
   - Keep its accessible name `İşareti kaldır`.

5. **Rows jump after a tap.** I specced "unmarked first, then marked". In practice, the row you just tapped slides to the bottom of its group, and the next name moves under your finger. Fast taps at the piano will then mark the wrong person. That's my spec error.
   - Use stable alphabetical order inside each group.
   - If you want "who's left", add a small toggle `Sadece işaretlenmeyenler` above the list.

6. **Live screen on a phone or in portrait.**
   - At 390px and at 768×1024 the full code panel (code + QR) takes the first 600–700px, so the roster starts below the fold.
   - ux §3.4 calls for a collapsed `h-20` stage strip on phones: the code at `text-5xl` + the countdown + a `QrCode` button that opens the code-only view.
   - In portrait on a tablet, use a side-by-side layout with a smaller QR (`size-40`).

7. **Week headers are off by one day.** The headers read `13 EKİM HAFTASI` for Sunday 18 Ekim, then `20 Ekim`, `29 Eylül`, `12 Mayıs`, which are all Tuesdays. The week start is computed one day late, probably UTC midnight against Istanbul midnight.
   - Compute the Monday in `Europe/Istanbul` in `src/lib/format.ts`.
   - Label it `12 Ekim haftası`.
   - Use `Bu hafta` / `Gelecek hafta` for the current and next week.

8. **The QR landing has a bare success state, and the not-found page is an unbranded English 404.**
   - Success: `/yoklama/kod/[id]` shows only a card reading `Yoklamaya katıldın · Geldi`. ux §7 asks for a stage page with:
     - a `size-20` icon tile;
     - the h1 `Yoklamaya katıldın`;
     - the line `Tutti · 18 Ekim · 00:13`;
     - a primary button `Ana sayfaya git`, in place of the gold text link.
   - The thumb is at the bottom on a phone, so make that button full width.
   - Not found: an unknown or deleted rehearsal shows Next's default white `404 · This page could not be found.`, in English, with no theme.
     - Add `app/not-found.tsx` in the app style: `Sayfa bulunamadı` + `Ana sayfaya git`.
     - Add a route-level not-found for the QR landing that reads `Bu yoklama bulunamadı` (ux §7).

9. **The login page loses the QR context.** Opening a QR link while logged out lands on the plain login page. ux §7 asks for an info alert when `next` points at `/yoklama/kod`: `Yoklamaya katılmak için önce giriş yap.`

10. **The code sheet sits in the middle of the screen on phones.** It is a centred dialog with a single wide input, so the iOS keyboard covers the `Gönder` button.
    - Use a bottom sheet below `md`.
    - Use the 4-slot `input-otp` from ux §1.2 (`size-14 text-3xl tabular-nums`) instead of one long field.
    - Large digits help this age group; auto-submit on the 4th digit already works.

11. **A never-opened past rehearsal gets no banner, and closing it is one tap away.** The detail page shows only the chip `Yoklama alınmadı`, with `Yoklamayı kapat` as the first button. Closing marks all 13 people `Gelmedi`. The dialog does state the count, but the page never explains why the rehearsal is excluded or what closing does. Add the banner from ux §4.3: `Bu çalışmada yoklama alınmadı. Raporlarda sayılmıyor. İşaretleyip kapatınca sayılır.`

12. **The desktop home hero crops faces out.** At 1280px, the Çanakkale photo shows torsos with the heads cut off at the top edge. Set `object-position: center 20%`, or crop the asset so the back row's heads sit in the top third. On mobile the faces show.

13. **A deleted rehearsal reads as an offline tablet.** When the poll returns 404, the live screen shows `Bağlantı yok` and the offline banner. Treat 404 as its own state: a banner `Bu çalışma silindi ya da iptal edildi.` and a link back. It's rare, but the "offline" message sends people to check the Wi-Fi.

## P3

14. In the calendar, other parts' sectionals aren't dimmed (ux §2.1: `opacity-60`), and `İptal edildi` uses the destructive tint where muted was specced. Red reads as "problem" rather than "holiday".
15. Member history mixes terms. The May rehearsals sit right under October ones with no break. Add a `2025–26 BAHAR` divider at term boundaries, and add `Sayılmıyor` under `Yoklama alınmadı` rows.
16. Reports: the `Son çalışmalar` dot strip has no direction cue. Add `eski → yeni` to the column header and an `aria-label` per strip. In the warning card, make the names links to `/uyeler/[id]#devam`. A `Sırala: Devam` toggle (worst first) would save scrolling with 60 people.
17. The `checked_in` hero has no gradient hairline and no large check (ux §6). Pure polish.
18. On the mobile header the logo is about 20px tall, so the 5-line strokes merge into a grey block that reads as a low-contrast solid "ARKHE". This was predicted in brand-integration A1. Below 28px height, use a 3-line stroke variant, or the solid wordmark at `text-foreground`.
19. The piano photo on desktop `/giris` has blurred lettering from the piano's brand plate visible mid-panel (reads like "Salrona"). Crop it out or blur that region harder at export.
20. The Next dev "1 Issue" badge still shows on several pages. It is probably the Playwright caret-color hydration warning, which is dev-only, but worth a look so real hydration errors don't get ignored.

## Brand refresh verdict

**Approve.** It's a clear step up, and the portal now feels like the choir's Instagram rather than a template.
- **Logo.** The striped ARKHE + `MÜLKİYE ÇOKSESLİ KOROSU` lockup in the sidebar and on the login band is crisp in both themes; only the small mobile size suffers (P3-18).
- **Typeface.** Jost headings fit the logo's geometry. Turkish diacritics render well (`Çalışmalar`, `İptal`).
- **Colour.** The navy-violet stage reads richer than the old indigo, and gold on it still pops.
- **Gradient.** It is used with restraint: the login quote word, its hairline, and the live countdown. It never appears as text on ivory. Keep it that way.
- **Photos.** The piano on login and the stage photo on the hero sit under a strong scrim with good text contrast. They need only the crops in P2-12 and P3-19.
- **Status colours.** These were new in this phase and hold up in dark: green geldi, amber geç, violet mazeretli, red gelmedi, always with an icon.

## Not verified (test data was removed mid-session by a concurrent e2e cleanup)
QR landing states: code expired, closed, rate limited. Offline marking on the live screen. `Düzeltildi` marker on a corrected row.
