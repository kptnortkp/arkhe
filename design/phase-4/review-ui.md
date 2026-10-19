# Phase 4 — UI review (arkhe-ui-engineer)

Read: `implementation-notes.md`, `po-decisions.md` (wins), `ui.md`. Checked in the running app with playwright-core + Chrome as `korist@`, `yk@` and `sef@` at 375 px (mobile, touch) and 1280 px, light and dark. Screens: `/odevler` (both lists), A/D/E/F detail (singer), D detail (manager, with the note sheet open), `/odevler/yeni` (with errors), A `duzenle`, `/odevler/matris`, home. Also checked keyboard flows for the toggle, the row toast, the sheet and the form. One `E2E review-ui…` homework was created to test a double submit and then deleted; korist's A/B submissions were undone, so the seed is back to how it was. `npm run lint` and `npm run typecheck` pass.

## What holds
- There is no page-level horizontal scroll on any screen at 375 px in either theme. The matrix scrolls only inside its focusable `role=region` (scrollWidth 585 / clientWidth 341, `tabIndex=0`, labelled by the h1).
- **D4 passes.** The solid overdue badge measures 5.16:1 in light (`bg-absent` / white) and 6.22:1 in dark (`bg-absent` / `text-background`). The soft red (5.38 / 8.13) and amber (5.66 / 8.75) also pass, so no fallback is needed.
- Hydration: every date and tone label is computed on the server. The client islands (`SubmitToggle`, `Roster`) only get finished strings. There were no console or hydration errors on any screen.
- Double submit on create: the button is disabled straight after `dblclick`, and only one row was created (the D15 client id backs this up). `submitWithoutReset` keeps the ticked parts after a failed submit: all 4 were still checked after the bars error. `LinkForm` remounts via `key` after an add, so dropping the auto reset changes nothing there.
- Nav badge: `data-nav-badge` shows 4 for korist and 2 for yk. The link names are `Ödevler, 4 bekleyen ödev` and the visible pill is `aria-hidden`. After a submit the badge updates to 3.
- Toast undo on a list row works. The sonner region is `aria-live=polite`.
- The sheet has a dialog name (the singer's name), traps focus, and returns focus to the roster row on Escape.

## P1
None.

## P2
1. **The detail toggle drops focus to `<body>` after `Teslim ettim` and after `Geri al`, and undo is never announced.** File: `src/components/homework/singer-steps.tsx:109-151`.
   - Problem: when `submitted` changes, `SingerSteps` switches between `<ol>` and `<div>`, so the `SubmitToggle` (and its `role=status`) remounts after `router.refresh()`. A live region that mounts with text already in it is usually not read out. The status text is `""` when not done (`submit-button.tsx:95-97`), so undo is silent.
   - Fix:
     - Render the toggle in the same tree position in both states. For example, always use the `<ol>`, show steps 1–2 collapsed or hidden when submitted, and keep the toggle in the third `<li>`. Or hoist the toggle outside the conditional.
     - Keep the `role=status` span mounted once, outside the toggle.
     - Set the status text from the action result: `Teslim edildi` or `Teslim geri alındı` (ui.md §4).
2. **`useFocusError` never focuses the invalid field in `AssignmentForm`.** Files: `src/components/forms/use-focus-error.ts:11-13`, `src/components/homework/assignment-form.tsx:97-101,130-133`.
   - Problem: on field errors the form renders a `role=alert` summary (`Bazı alanları düzeltmen gerekiyor.`). It comes first in the DOM, so focus always lands on that `<p>`. This was confirmed for bars, parts and past-date errors. Even without the summary, `[aria-invalid=true]` matches the bars and parts `<fieldset>` before its inputs, and `focus()` on a fieldset does nothing.
   - Fix: in the hook, query `input,select,textarea` with `[aria-invalid=true]` first, then `fieldset[aria-invalid=true] input`, then fall back to `[role=alert]`. Put `aria-invalid` and `aria-describedby="bars-error"` on `#barFrom` / `#barTo` as well.

## P3
1. `src/components/homework/submit-button.tsx:14-45`: the row `Teslim ettim` waits for the server and then refreshes. There is no optimistic move (D17). Also, focus falls to `<body>` once the row moves. Fix: use `useOptimistic` in the page-level list, or at least move focus to the next row's button (or to the `YAPILACAK` heading) after the refresh.
2. `src/components/homework/roster.tsx:210-222`: when the sheet opens, focus lands on `Teslimi kaldır` / `Teslim edildi olarak işaretle`. A stray Enter flips the record with no confirmation. Fix: give `SheetContent` `initialFocus` on the textarea, or on the close button.
3. `src/components/homework/roster.tsx:198`: the sheet uses `side="bottom"` on desktop too. ui.md §5 says it should open from the right at `md` and above. Fix: pick the side with a `useMediaQuery("(min-width: 768px)")`, or keep bottom and note it as accepted.
4. `src/components/homework/roster.tsx:74`: `NoteForm` still uses `<form action>`, so React's auto reset can clear the textarea on an error result. `feedback` errors also set no `aria-invalid`, and the form doesn't take part in focus-on-error. Fix: use `onSubmit={(e) => submitWithoutReset(e, action)}` plus `useFocusError`, and add `aria-invalid` on the `Textarea`.
5. `src/components/homework/roster.tsx:215-219`: in `?filtre=eksik`, marking a singer removes the row and focus is lost on close. Fix: after `run`, focus the next row or the `Teslimler` heading.
6. `src/app/(portal)/odevler/matris/page.tsx:93-96`: the column-header links are 56×38 px, below 44 px. Fix: add `min-h-11 justify-end` to the link.
7. `src/components/homework/homework-rows.tsx:45-48` (and `ManagerRow` :112-115): with two part chips the line wraps after `Tüm eser ·`, leaving a dangling `·` (seen on Aman Gülüm at 375 px). Fix: wrap the separator together with `PartList` in one `inline-flex`, or drop the dot and use `gap-x-1.5`.
8. `src/components/homework/assignment-form.tsx:238-245`: the `dueTime` input has no `aria-describedby` when the error is keyed to `dueTime`. Fix: point it at `dueDate-error`.
9. `src/components/homework/assignment-form.tsx:281`: after a successful edit the button re-enables before `router.push` lands. A second tap sends the old `version` and flashes the D16 stale error. Fix: keep the button disabled while `state.success` is set.
