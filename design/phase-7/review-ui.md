# Phase 7 review: UI engineering (arkhe-ui-engineer, fresh eyes)

Date: 2026-10-21. Read-only on `src/` and `e2e/`. Inputs: `po-spec.md`, `po-decisions.md`, `implementation-notes.md`, `e2e-results.txt`, the code listed below, and the running dev server.

## What I checked

- **Code:** `src/app/(portal)/yedek/{page,loading,actions}.tsx|ts`, `src/components/backup/*`, the banner wiring in `src/app/(portal)/page.tsx`, `src/app/(portal)/profil/page.tsx`, `src/components/confirm-dialog.tsx` (and all 10 callers), `src/lib/format.ts`, `src/lib/backup/queries.ts`.
- **Tests:** `e2e/mail.mjs`, `e2e/phase7-{a,b,c}-*.mjs`, the phase 7 block in `e2e/prod.mjs`.
- **Screens** (Playwright with real Chrome against :3100; the screenshots are in the scratchpad, not the repo):
  - `/yedek` as sef@ and yk@ at 390 px and 1280 px, light and dark. The arranged state had a failed current month, an older sent run, an unreaped stale run and a 48-character recipient.
  - `/` with the failure banner (light) and the overdue banner (dark), at 390 px.
  - The `Şimdi gönder` dialog with the dirty warning, and in its pending state. I held the action POST with `page.route` to see it.
  - The page after a send, and `/profil`.
  - No horizontal overflow in any of the 8 `/yedek` combinations. I found no raw hex in the new files, and every colour comes from a token (`absent`, `late`, `present`, `-ink`, `muted`).
- **Interaction probes:**
  - **Focus after `Adres ekle`:** moves to the new row (`Alıcı 3`). Correct.
  - **Focus after removing row 3:** moves to `Alıcı 2`. Correct.
  - **Focus after removing row 1:** moves to the new `Alıcı 1`. Correct.
  - **Initial focus in the dialog:** `Vazgeç`. Correct.
  - **Escape while pending:** the dialog stays open. Correct.
  - **Focus while pending, and after the dialog closes:** `<body>`. See P2-1.
- After the probes I restored the dev DB: the `backup_recipients` row and the one `2026-09` run are back as they were, and the `.eml` my send wrote is deleted. Side effect: I also deleted any `backup-%` throttle rows in `login_attempts`.

**Server/client boundaries are right.**
- `page.tsx`, `status-card`, `setup-list`, `recipients-list`, `run-log` and `backup-banner` are server components. Only `recipients-form` and `send-now` are client components.
- No secret value, length or mask reaches the client: `setup` is booleans and enum states.
- Both actions authorize before parsing.
- Members get `null` from `backupBannerState` before any query, so **the banner adds no latency for members.**

**ConfirmDialog change (Vazgeç disabled while pending).** I checked all callers:
- **Unaffected.** These close the dialog before running, so `pending` is never true while it's open: `program-editor`, `links-editor`, `piece-menu`, and the archive path of `danger-zone`.
- **Behaviour change.** These keep the dialog open while pending: `event-forms`, `assignment-menu`, `member-dues-forms`, `period-forms`, `entry-actions`, and the delete path of `danger-zone`. In all of them `Vazgeç` is now disabled during the action, but Escape still closes the dialog (they pass `setX` straight through). That is consistent with the intent and harmless, because the action keeps running either way. The full suite is green (648/648).
- One accessibility side effect, which existed before for the action button: P2-1.

## Findings

### P1
None.

### P2

**P2-1. Keyboard and screen-reader focus falls to `<body>` while sending and after the dialog closes.**
- **Where:** `src/components/confirm-dialog.tsx:48-58`, `src/components/backup/send-now.tsx:53-61,91-109`.
- **What happens:**
  - Once `pending` is true, both footer buttons get native `disabled`, so the focused button blurs and `document.activeElement` becomes `body` (measured).
  - When the dialog closes, base-ui returns focus to the trigger. But `Şimdi gönder` is itself `disabled={… || pending}`, and after a success it stays disabled for the cooldown, so focus stays on `body` (measured).
  - A screen-reader user loses their place right after the most important action on the page. The live region still announces the result.
- **Fix:**
  1. In `ConfirmDialog`, pass `focusableWhenDisabled` to `AlertDialogCancel` and to each action `Button`. base-ui then uses `aria-disabled`, and focus stays on the button.
  2. Add an optional `finalFocus` prop to `ConfirmDialog`, forwarded to `AlertDialogPrimitive.Popup`. In `SendNow`, point it at the result `<p role="status">`, give that element `tabIndex={-1}`, and attach a ref to it.
  3. Optionally, also give the `Şimdi gönder` trigger `focusableWhenDisabled`, so that the cooldown hint (`aria-describedby`) can be reached with Tab.

**P2-2. Two to three extra serial DB round trips on every manager render of `/`.**
- **Where:** `src/app/(portal)/page.tsx:98`, `src/lib/backup/queries.ts:154-180`.
- **What happens:**
  - `<BackupBanner>` only starts after `HomePage` has finished its ~10 sequential awaits, and there is no Suspense boundary or route `loading.tsx` at `/`.
  - The banner then runs `loadRecipients` → `isCovered` → the latest cron, in sequence. In steady state (the month is covered) that is 2 round trips; when it isn't covered, 3.
  - On Vercel iad1 → Turso Stockholm, that is roughly 150–300 ms added to the conductor's and the board's TTFB. Members are unaffected.
- **Fix:**
  - Start it early: `const bannerState = backupBannerState(user);` right after `requireUser()`, then render `<BackupBanner state={await bannerState} />` with a synchronous component.
  - Also collapse `isCovered` and `latestCron` into one SQL statement (two scalar subqueries), so the steady state is a single round trip after `loadRecipients`.
  - Don't use a `Suspense` fallback here: the banner sits above the hero and would cause layout shift.

**P2-3. The AC 17 pending state is untested.**
- **Where:** `e2e/phase7-b-page.mjs:391-394`.
- **What's missing:** AC 17 says: "While the send is pending, the dialog stays open, both buttons are disabled, and `Gönder` reads `Gönderiliyor…`". No test checks it. The dev send takes about 230 ms, so the state is never observed. I verified it by hand (both disabled, label `Gönderiliyor…`, Escape ignored), but a regression would go unnoticed.
- **Fix:** before clicking `Gönder`:
  1. Hold the response: `await sef.route(`${BASE}/yedek`, async r => { if (r.request().method() === "POST") await held; await r.continue(); })`.
  2. Assert `dialog.getByRole("button", { name: "Gönderiliyor…" })` is disabled, `Vazgeç` is disabled, and the dialog is still visible after `keyboard.press("Escape")`.
  3. Release, then `unroute`.

**P2-4. The "identical save sends nothing" check can pass without testing anything.**
- **Where:** `e2e/phase7-b-page.mjs:273-277`. Line 251 has the same pattern but runs on a fresh page.
- **What happens:**
  - The previous save's `Alıcılar kaydedildi.` toast is still on screen (sonner keeps toasts for about 4 s). So `toast()` resolves immediately, before the second save's action has even run.
  - The outbox is then diffed after a fixed 300 ms. A regression that sends a notice on an identical save would only be caught if it finished within 300 ms.
  - The return value of `toast()` isn't checked either.
- **Fix:** wait for the action itself:
  - `const resp = sef.waitForResponse(r => r.request().method() === "POST" && r.request().headers()["next-action"]); await save(sef); await resp;`
  - or wait until `Kaydet` is enabled again after reading `Kaydediliyor…`.
  - Then drop the `waitForTimeout(300)` calls at lines 252 and 276.

**P2-5. AC 20 is skipped without failing on the 1st and 2nd of the month, including the parts that don't depend on the date.**
- **Where:** `e2e/phase7-b-page.mjs:555-614, 653-662`.
- **What happens:** with `DAY < 3`, the whole AC 20 block is skipped and only `console.log` notes it:
  - banner (a)
  - the korist@ check
  - the "gone after a covering sent row" check
  - the 44 px link check
  - axe on the banner
  
  A run on the 1st or 2nd (the day the cron actually fires) reports green with AC 20 untested.
- **Fix:**
  - Run (a), korist@, the link size, axe and the "gone" check unconditionally. Arrange them with `createdAt` this month, so that (b) can't match and (a) is proven on its own. Rule (b) has no `today` hook (the banner uses the real clock), so only the (b) branch needs `DAY >= 3`.
  - Turn the skip into `check(true, "AC20(b) SKIPPED: day N")`, so it shows in `e2e-results.txt`.

### P3

**P3-1. Wrong Turkish suffix on the remove buttons' accessible names.**
- **Where:** `src/components/backup/recipients-form.tsx:118`.
- **What's wrong:** `Alıcı ${i + 1}'i kaldır` is only right for 1 and 5. It should read `2'yi`, `3'ü`, `4'ü`.
- **Fix:** `aria-label={`Alıcı ${i + 1} adresini kaldır`}`, and update the regexes in `e2e/phase7-b-page.mjs:98` and `e2e/prod.mjs:220` to `/^Alıcı \d+ adresini kaldır$/`.

**P3-2. A stale row for an older, abandoned month promises a retry that won't happen.**
- **Where:** `src/components/backup/run-log.tsx:14,36`.
- **What's wrong:** `STALE_RUN_TEXT` ("… Her sabah kendiliğinden yeniden deneniyor.") is shown on every unreaped stale row. In the screenshot it appears for `Temmuz 2026` while the target month is `Eylül 2026`. Per D7 that month is abandoned, so the sentence is false.
- **Fix:** pass `previousMonth` into `RunLog` and show the retry sentence only when `run.month === previousMonth`. Otherwise show `Gönderim yarıda kaldı.` @po: AC 19's wording assumes the current month. Please confirm.

**P3-3. The list-level error isn't linked to the invalid field.**
- **Where:** `src/components/backup/recipients-form.tsx:41,85,107`.
- **What's wrong:** on `En az bir adres gir.`, row 1 gets `aria-invalid` and focus, but its `aria-describedby` only points at the hint. The message is announced once by `role=alert`, but it isn't re-read when the user returns to the field.
- **Fix:** give `<FormMessage>` an id (for example `alicilar-error`) and include it in row 1's `aria-describedby` when `state.error` is set.

**P3-4. `formatBytes` can show `1024 KB`.**
- **Where:** `src/lib/format.ts:50-53`.
- **What's wrong:** sizes from 1,048,064 to 1,048,575 bytes round to `1024 KB` instead of `1 MB`.
- **Fix:** `const kb = Math.max(1, Math.round(bytes / 1024)); if (kb < 1024) return `${kb} KB`;`, then fall through to MB.

**P3-5. Escape behaviour during pending differs between callers.**
- **Where:** `src/components/confirm-dialog.tsx:40`.
- **What's wrong:** only `SendNow` guards `onOpenChange` while pending. In the other callers, Escape closes the dialog even though `Vazgeç` is disabled.
- **Fix:** guard it once in `ConfirmDialog` (`onOpenChange={(o) => { if (!pending) onOpenChange(o); }}`), then drop the special case at `send-now.tsx:93-95`. Also update the doc comment at `confirm-dialog.tsx:20` ("Destructive confirms"): the dialog now also hosts a `default` action.

**P3-6. The dirty check reads another component's DOM.**
- **Where:** `src/components/backup/send-now.tsx:27-33`.
- **What's wrong:** the check depends on `data-testid=backup-recipients-form` and `name=recipients`, which is coupling through a test id. It's acceptable as documented. I'd still switch to a non-test selector, for example `form#backup-recipients input[name=recipients]` with an `id` on the form, so that renaming the test id can't silently disable the warning.

**P3-7. Small test gaps that are cheap to close.**
1. **AC 19 overflow.**
   - The "200-character error" in `phase7-b:502` has a space every ~30 characters, so `break-words` is never exercised.
   - A `<p>`'s bounding box can't show text overflowing it.
   - Fix: use one 200-character token, and assert `el.scrollWidth <= el.clientWidth`.
2. **AC 16:** the Durum `running` state (`… raporu şu an gönderiliyor.`) is never asserted.
3. **AC 8:**
   - `phase7-a:355` `!l.endsWith("=")` is vacuous after QP decoding.
   - The last three paragraphs (`Yedek dosyasını açmanız gerekmez…`, `Raporlar şifresizdir…`, `Bu e-posta her ayın 1'inde…`) aren't asserted as whole lines.
   - The empty-month mail isn't leak-checked, although the AC asks for it.
   - Fix: assert the full body against the template, line by line.
4. **AC 10:** the `Ödev` (`barsLabel`) and `Teslim tarihi` cells, the sort by due date across two assignments, and the exclusion of feedback (seed one feedback note and grep for it) are untested.
5. **AC 20(a):** a stale `running` cron row for M is untested, and so is a **manual** failed row for M, which must not raise (a).
6. **AC 2 (prod):** a `CRON_SECRET` under 32 characters → 503 is untested. Fix: make server B's secret 31 characters instead of unset; the boot-warning check still holds.
7. **AC 24 (dev):** the check at `phase7-a:466` only sees the fixture errors, so it can't fail. That is fine, since prod covers it, but say so in the check message.
8. **Accessibility:** axe never runs with the confirm dialog open. Run it once at 375 px, in light and dark.

**P3-8. Out of scope, noticed on the way.** A hydration-mismatch console error appears on `/profil` at the mobile viewport, from `InstallCard`. It predates Phase 7 and the e2e console filter doesn't catch it only because the phase tests don't hit that path. Backlog.

## Visual verdict

Both themes read well at 390 px and 1280 px:
- the Durum failure card (`absent/8` background, `absent-ink` icon)
- the `Tamam`/`Eksik` badges
- the run-log chips
- the overdue banner (`late`) against the failure banner (`absent`)
- the dialog with the dirty warning in `late-ink`

All controls measure 44 px or more. The long recipient wraps in the board's list and in the dialog. In the conductor's input it is clipped, which is expected for an `<input>` and still editable. The layout matches `ux.md` and D14.
