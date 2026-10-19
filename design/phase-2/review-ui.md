# Phase 2 UI review (rehearsals, live attendance, reports)

Author: arkhe-ui-engineer. Scope: `src/components/attendance/*`, `src/app/(portal)/calismalar/**`, `src/app/(live)/calismalar/[id]/canli`, `src/app/(portal)/yoklama/kod/[id]`, `src/app/(portal)/raporlar/**`, `src/app/api/calismalar/**`, home. Checked against `design/phase-2/ui.md`.

How it was checked: Playwright (`playwright-core`, Chrome, `e2e/lib.mjs`) against http://127.0.0.1:3100 (dev server). I tested:
- manager on a 1024×768 touch tablet, manager on a 390 px phone, member (`korist@`) on a 390 px phone;
- light and dark;
- offline via `context.setOffline`;
- 4× CPU throttling over CDP for the idle cost.

Test rehearsals were inserted with an `E2E` title and removed with `cleanup()`. Screenshots and scripts are in the scratchpad (`team/ui/p2/`).

What was implemented differently from ui.md and is fine:
- The server sends a precomputed **code schedule** instead of the secret. That is better: no secret in the browser, and the code keeps rotating offline (verified: 9394 → 5502 while offline).
- The code entry is a single numeric input, not input-otp. Fine: 36 px digits, `one-time-code`, autofocus on open.
- The QR landing does not write on GET and checks in from a client effect. Good.
- CSV: BOM, `;`, quoted header. Verified.

---

## P1

| # | Where | Finding (verified) | Fix |
|---|---|---|---|
| P1-1 | `src/components/attendance/live-screen.tsx:187-189, 112` | **On the target tablet (1024×768 landscape, AC 30) the code panel covers the left edge of the roster.** The counter reads "eldi 0 / 22" and group headers lose their first letters (screenshot `live-1024-light.png`). Cause: at `lg` the first column is `minmax(360px,40%)` = 410 px, but the panel's content is about 444 px (143 px code × 4 digits with `tracking-[0.08em]` + `p-8`). Grid items default to `min-width: auto`, so the panel overflows into column 2. | Add `min-w-0 overflow-hidden` on the column wrapper (`:188`). Size the code to the column, not the viewport: `text-[clamp(96px,11vw,160px)]` (still ≥ 96 px at 1024), or `grid-cols-[minmax(0,42%)_1fr]` plus `p-6`. Re-check at 1024, 1180 and 1366. |
| P1-2 | `src/components/attendance/live-screen.tsx:26-41, 66-70` | **The whole live screen re-renders 4×/s.** `useRotatingCode` sets state every 250 ms in `LiveScreen`, so `MarkingRoster`, all 22–60 `RosterRow`s and `QRCodeSVG` re-render on every tick. None of them are memoised, and the roster sort and filters run each time. Measured idle with no data changing, at 4× CPU throttle: **1.13 s of script per 5 s, 18 long tasks in 6 s (≈ 960 ms)**. On the "4-year-old iPad" from the spec this eats battery and delays mark taps. Also, `onLow` is called **during render** (`:37`) and starts a fetch from render. While offline, the `finally` resets `fetchingCodes`, so near the end of the schedule it fires a request on every render (4/s). | Move the code, QR and progress bar into their own `<CodePanel schedule offset />` component, which owns the timer, so `LiveScreen` stops ticking. Inside it, `setTimeout` to the next 30 s boundary (not 250 ms). Drive the progress bar with a CSS animation keyed by the step (`style={{ animationDuration: … , animationDelay: -elapsed }}`; static under `prefers-reduced-motion`). Fetch more codes from a `useEffect` on `index`, with a ref guard and the same backoff as the poll. Wrap `MarkingRoster`/`RosterRow` in `memo` and pass a stable `mark` (`useCallback`). Target: < 50 ms of script per 5 s idle at 4×. |
| P1-3 | `src/components/attendance/check-in-panel.tsx:242-253`, `qr-check-in.tsx:20-23` | **A member checking in on bad signal gets a crash, not the spec copy.** With the phone offline, typing the 4th digit made the Server Action reject with `TypeError: Failed to fetch` inside `startTransition`. In dev that's the runtime-error overlay. In React 19 a throw inside a transition goes to the nearest error boundary, and the app has no `error.tsx` (see the Phase 1 review, P2-7), so in production the member sees Next's generic error page. `QrCheckIn` has no `.catch`, so it stays on "Kaydediliyor…" forever. | Wrap the call: `try { result = await checkIn(…) } catch { setError("Bağlantı yok. Kodu gönderemedik; bağlantı gelince tekrar dene ya da yoklamayı alan kişiye söyle."); return; }` (spec §3.8). In `QrCheckIn` add `.catch(() => setResult({ ok: false, error: <same copy> }))` and show the `CodeEntry` fallback. Do the same for `withdrawExcuse` (`check-in-panel.tsx:145`), `ManagerControls.run` (`manager-controls.tsx:50`), the close action (`live-screen.tsx:234`) and `bulk()` (`marking-roster.tsx:194`). Add `(portal)/error.tsx` as the safety net. |

## P2

| # | Where | Finding | Fix |
|---|---|---|---|
| P2-1 | `src/components/attendance/marking-roster.tsx:260-263` | **The row jumps away from under the finger.** Rows are sorted unmarked-first, so tapping `Geldi` moves the person to the end of the group (measured: 362 px down), and the next person slides into the tapped spot. On a tablet with quick successive taps this leads to wrong marks. | Keep a stable alphabetical order while the screen is open. Let the unmarked count (and an `İşaretlenmeyen` filter chip) do the "who's left" job. If you want unmarked-first, sort only on load or on poll, not on local marks. |
| P2-2 | `marking-roster.tsx:395-433` (`StatusSegment`) | `role="radiogroup"` without the radio keyboard pattern. Every option is a tab stop (4 per row + the clear button: about 300 tab stops for 60 people), and arrow keys do nothing (verified: `ArrowRight` stays on `Geldi`). | Roving tabindex: `tabIndex={selected \|\| (value === null && i === 0) ? 0 : -1}`, and `onKeyDown` handles Left/Right/Up/Down to move focus and select (WAI-ARIA radio group). Or use native `input type=radio` like `ChoiceGroup`, which gives it for free. |
| P2-3 | `marking-roster.tsx:427`, `:379-389` | Below `xl` (1280 px, so on every tablet) the four options are **icon-only**: ✓, clock, speech bubble, ✗. `Gelmedi` uses the same ✗ as the separate "İşareti kaldır" button next to it (`live-1024-light.png`), so a quick tap on the wrong ✗ either marks absent or clears the mark. | Show short text labels from `md` (`Geldi · Geç · Mzrt · Yok`; the segment fits at 1024 if the avatar circle is dropped at `lg`). Use a different icon for clear (`Eraser` / `RotateCcw`), or move clear into a long-press or row menu. |
| P2-4 | `marking-roster.tsx:49, 127` (`useLiveSnapshot` / `flush`) | Stale poll overwrites a newer state. A poll that started before a mark and returns after its flush replaced `snapshot.rows` with pre-mark data. The pending entry is already gone, so the row flips back for up to 5 s. | Have the server include `serverNow` (or a monotonic `version`) in every snapshot, and ignore any snapshot older than the last one applied (`if (next.serverNow < prev.serverNow) return prev`). Abort the in-flight poll when a flush starts. |
| P2-5 | `live-screen.tsx:156-171` | At < 640 px the `Sadece kod` link has **no accessible name** (the text span is `hidden sm:inline`, so it's `display:none`; ariaSnapshot shows `link:` with no name). It's also 40 px tall, and `Yoklamayı kapat` (`:177`) is `h-10`. | `aria-label="Sadece kodu göster"` / `"Liste ve kodu göster"`; `h-11`. |
| P2-6 | `check-in-panel.tsx:276` | The code input is `disabled={pending}`. After a wrong code, focus ends on `<body>` (verified): `inputRef.focus()` runs while the input is still disabled. On a phone the numeric keyboard closes on every attempt, so the member has to tap the field again. Same after success: focus falls to body when the dialog's trigger (`Geldim`) disappears. | `readOnly={pending}` instead of `disabled` (keeps focus and keyboard). After success, move focus to the new `checkin-state` heading (`tabIndex={-1}` + focus in an effect). |
| P2-7 | `rehearsal-form.tsx:95` | **Value loss on validation error.** Sectional part checkboxes use `defaultChecked={defaults.parts…}`, not `v?.parts`. After an invalid submit (end before start), the form reset unchecks the user's Tenor (verified). Type and times are kept. | Echo `parts` in `state.values` (`formValues` keeps only the last value of repeated keys, so store `formData.getAll("parts").join(",")`) and use `defaultChecked={(v?.parts?.split(",") ?? defaults.parts).includes(p)}`. Or make the checkboxes controlled like `type`. |
| P2-8 | `live-screen.tsx:27-28, 40, 116-121` | Hydration risk: `useState(() => Date.now())` in an SSR'd client component. The progress bar `style.width` (and the code, at a step boundary) differ between server and client. One "attributes of the server rendered HTML didn't match" warning came up in the tablet run; it didn't reproduce in a second pass. | P1-2 already fixes this if the code panel renders its time-dependent parts only after mount: `useSyncExternalStore(subscribe, () => Date.now(), () => null)`, and render the placeholder `––––` on the server. |
| P2-9 | `marking-roster.tsx:283-291`, `raporlar/page.tsx:56,78,122` | Touch targets: bulk `Kalanları geldi işaretle` `h-9` (36 px), CSV and period chips `h-10` / `min-h-10`. The bulk button has no pending state, so a double tap sends two actions. | `h-11` / `min-h-11`. In `bulk()` use `useTransition` and disable while pending. |
| P2-10 | `live-screen.tsx:78-99` | Wake lock is requested but neither result is shown, and there's no fallback hint (ui.md §2.5). On an iPad home-screen app before iOS 18.4, or in Safari where `request` rejects, the screen sleeps mid-rehearsal and nobody knows why. | Keep `wakeOk` state. Show a small pill `Ekran açık kalacak` / `Ekran kapanabilir` with a hint to set Auto-Lock to "Never" when unsupported or rejected. |

## P3

- `check-in-panel.tsx:77`: `animate-pulse` on the "Yoklama açık" dot ignores reduced motion. Use `motion-safe:animate-pulse`.
- `marking-roster.tsx:359-362`: `Kaydedilmedi` shows a retry icon but it isn't a button (spec §3.8 "retry button"). Make it a 44 px `button` that calls `flush()`. Auto-retry works (verified: saved about 10 s after reconnect, banner shown while offline).
- `marking-roster.tsx:154-161`: offline is detected only by a failed fetch (up to 5 s). Also listen to the `offline` event to show the banner at once.
- `marking-roster.tsx:157`: the retry interval is a fixed 10 s on top of the poll backoff; fine, but use the same backoff. `useLiveSnapshot`'s `fetch` isn't aborted on unmount.
- `api/calismalar/[id]/durum/route.ts:14`: `autoCloseStale()` on every 5 s poll is an extra query per poll (@backend: run it on page loads and in `close`, not in the poll).
- `live-screen.tsx:28`: the clock offset is computed once from the page-load `serverNow` (includes server render time). Recompute from each `?kodlar=1` refill.
- `raporlar/page.tsx:139, 155`: on mobile the header row is hidden and `tr` becomes `display:grid`. Chrome keeps table semantics (verified with ariaSnapshot), but cells are announced without column names ("6/6", "%100"). Add sr-only labels in the mobile cells (`<span className="sr-only md:hidden">Geldi/Beklenen </span>`). Safari has historically dropped table roles when `display` changes; add explicit `role="row"`/`role="cell"`.
- `raporlar/page.tsx:120`: `aria-pressed` on a link is invalid ARIA. Use `aria-current="true"` or make it a toggle in a GET form.
- `live-screen.tsx:124`: `bg-white` raw colour on the QR plate is intentional (scanners need dark-on-white in both themes). Keep it with a one-line comment, or add a `--qr-plate` token.
- `(live)/layout.tsx`: no skip link or landmark issues. `<main>` exists, and the header is a plain `header`. OK.

## Checked and fine

- Authorization: live page, poll and mark routes, CSV and reports all call `requireManager` / `managerOrError`. The live code reaches only managers.
- The manager saw a member's self check-in after **4.4 s** (≤ 10 s, AC 8). The code changes every 30 s and keeps rotating offline. The offline banner is `role="status"`.
- Close dialog: focus goes to `Vazgeç` on open and returns to `Yoklamayı kapat` on Escape.
- `useFocusError` is now used in the rehearsal form (focus moved to `#end` after an invalid time).
- No horizontal scroll at 390 px on `/calismalar`, the live screen or `/raporlar`. The code font is 143 px at 1024 (≥ 96, AC 30).
- Home hero (dark, 390 px): `YOKLAMAYA KATILDIN` state, term % card with the attendance strip (`role="img"` with a text label), readable over the photo.
- CSV: `text/csv; charset=utf-8`, BOM, `;`-separated, all fields quoted.
