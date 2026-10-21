# Phase 7 UX review: Yedekleme

Author: UX designer. Date: 2026-10-21. Reads: `ux.md`, `po-decisions.md` (D1–D16), `implementation-notes.md`, the components in `src/components/backup/`, `src/app/(portal)/yedek/page.tsx`, `src/lib/backup/email.ts`, `src/lib/backup/messages.ts`.

**Verdict: accept.** No P1. The build follows `ux.md` as amended by the PO almost to the letter: section order, Durum states, `Tamam`/`Eksik` as text, mono variable names only under Kurulum, `Gönderilemedi` chip, month-first run rows, confirm dialog with saved addresses and dirty warning, banners (a)/(b)/setup with the right tokens and roles, plural emails. The findings below are copy and small-hierarchy fixes.

## What I checked

Screens at 375 px (Playwright + real Chrome, `isMobile`, DPR 2) and 1280 px, light and dark. My screenshots: `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/p7review-ux/`. I also read the arranged-state screenshots in `.../scratchpad/p7shots/` (failed + stale + sent runs, 40-character address, all three banners, desktop dark).

| Screen | Role | Result |
|---|---|---|
| `/yedek` not configured | sef@, yk@ | ok; `scrollWidth` = viewport at 375 and 1280 |
| `/yedek` invalid address → save → saved → dirty → confirm dialog → pending → sent + cooldown | sef@ | ok; focus moves to `Alıcı 1` on error; stored list normalised (`Sef@Arkhe.local ` → `sef@arkhe.local`) |
| `/yedek` sent, read-only list | yk@ | ok; no form, no Şimdi gönder section |
| `/yedek` | korist@ | redirected to `/` (D2) |
| `/` setup banner (şef), failed (a), overdue (b) | sef@, yk@ | ok; yk@ gets no setup banner (AC 21) |
| `/profil` manager links | sef@ | `Yedekleme · Aylık rapor ve yedek e-postası` after `Raporlar` |
| Monthly email (manual) and change notice | — | read from `data/outbox/*.eml`, decoded |

Note on the environment: while I was testing, another process rewrote the backup state (my `backup_runs` row disappeared, recipients became `sayman@gmail.com` with a backdated `created_at`), and the dev overlay once showed `1 Issue` in dark mode. I could not reproduce the issue with console capture afterwards (0 errors, 0 page errors), so it is not a finding. See the hand-back for the cleanup status.

---

## P1

None.

## P2

**P2-1. First-run şef: the only action is 2.5 screens below the status that asks for it.**
`src/components/backup/status-card.tsx:26`. On a fresh setup at 375 px, Durum says `Aşağıdan en az bir alıcı ekleyip kaydet.`, then the Kurulum card (~700 px with dev notes and variable names) sits between it and the form. A şef on a phone has to scroll past technical text to find the one thing they can do.
Fix (keeps the AC 16 order): make that line a link to the form. For `canEdit` render
`<a href="#alicilar" className="font-medium text-foreground underline underline-offset-4">Alıcı ekle</a>` after `Aşağıdan en az bir alıcı ekleyip kaydet.`, and give the `Alıcılar` section `scroll-mt-20` so the sticky header doesn't cover the heading. The board variant stays text-only.

**P2-2. Board, empty list: the same sentence three times.**
`src/components/backup/recipients-list.tsx:22-24` plus `status-card.tsx:27`. yk@ on an unconfigured page reads `Alıcıları koro şefi ekler.` (Durum), `Henüz alıcı yok. Alıcıları koro şefi ekler.` and `Alıcıları yalnızca koro şefi değiştirebilir.` (Alıcılar).
Fix: when `recipients.length === 0`, render only `Henüz alıcı yok.` and the existing `Alıcıları yalnızca koro şefi değiştirebilir.` line. Remove `Alıcıları koro şefi ekler.` from the empty `p`.

**P2-3. Board sees an instruction it cannot follow.**
`src/app/(portal)/yedek/page.tsx:51-54`. The hint ends with `…yalnızca yönetimdeki kişilerin adreslerini ekle.`, which is shown to the board too, directly above a read-only list.
Fix: keep the şef text; for `!canEdit` use
`Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; bu yüzden listede yalnızca yönetimdeki kişiler olmalı.`

**P2-4. After a successful send, three messages say the same thing, and one sounds like a failure.**
`src/components/backup/send-now.tsx:20,65-89`. After `Gönder`: toast `Gönderildi: 1 adres.`, then under the disabled button `Az önce gönderildi. 10 dakika sonra yeniden deneyebilirsin.` (muted) and `Gönderildi: 1 adres.` (green). `yeniden deneyebilirsin` ("you can try again") reads to a nervous şef as if the first try had not worked.
Fix:
- Change the cooldown text, in the hint and in the server refusal (`actions.ts`, the default branch of `sendBackupNow`), to `Az önce gönderildi. <n> dakika sonra yeniden gönderebilirsin.` This is what `ux.md` §5.1 had. The two still read the same, which was the engineer's reason for the change.
- When `result?.success` is set and `send.kind === "cooldown"`, don't render the muted hint. The green line already says it was sent; append ` <n> dakika sonra yeniden gönderebilirsin.` to it. Keep the live region.

**P2-5. Screen-reader labels with the wrong Turkish suffix.**
`src/components/backup/recipients-form.tsx:118`. `Alıcı ${i + 1}'i kaldır` gives `Alıcı 2'i kaldır`, `Alıcı 3'i`, `Alıcı 4'i`; correct forms are `2'yi`, `3'ü`, `4'ü`. (I specced `Alıcı 2'yi kaldır` as an example only; my fault for not giving the rule.)
Fix: use the ordinal form, which needs no suffix: `` `${i + 1}. alıcıyı kaldır` `` (`1. alıcıyı kaldır` … `5. alıcıyı kaldır`). Update the e2e selectors that match `kaldır` if they match the full label.

## P3

**P3-1. Confirm dialog mixes centred and left-aligned text.** `send-now.tsx:111-120`, inside the shared `ConfirmDialog`. Title and description are centred, the dirty warning and the address list are left-aligned. Add `text-center` to the `div.space-y-2` wrapper (the addresses are short lines and `break-all` still wraps).

**P3-2. Email: `Açma adımları portalı kuranlarda` is awkward Turkish, and the UI says "kuran kişi" (singular).** `src/lib/backup/email.ts:71`. Replace the last sentence of that paragraph with: `Gerekirse dosyayı portalı kuran kişi açar; adımlar README'nin "Aylık yedek e-postası" bölümünde.`

**P3-3. Change notice: `Yeni alıcılar` reads as "the newly added addresses".** `email.ts:94` lists the full new list. Use `Güncel alıcı listesi:`.

**P3-4. Change notice ends with a bare URL.** `email.ts:101`. Give it the same lead-in as the monthly email: `Alıcı listesi: https://…/yedek` on one line, or `Listeyi buradan görebilirsiniz:` and the URL on the next line, matching the monthly email's format.

**P3-5. Input width jumps when the list drops to one row.** `recipients-form.tsx:112`. With one row the remove button is not rendered, so the input grows by 52 px; adding a row shrinks it again. This is what I specced, and it is harmless. If touched anyway, render the button `invisible` with `aria-hidden` and `tabIndex={-1}` instead of not rendering it, so the column stays fixed.

---

## Copy check (Turkish, plain language)

- Page, Durum, Kurulum, banners: the board-facing text has no SMTP/CRON jargon outside the mono lines. `sabah 08:00–09:00 arası`, `Her sabah kendiliğinden yeniden deneniyor.` and `Portalı kuran kişiye haber ver` all read right for a non-technical board member.
- Error strings match `ux.md` §7 and D4 (`18 MB`). The stale message `Gönderim yarıda kaldı (10 dakika içinde tamamlanmadı).` is fine.
- Monthly email (decoded from the manual send, September 2026): subject `Arkhe aylık rapor ve yedek · Eylül 2026 (elle gönderildi)`, actor line, three number lines with `₺8.250,00` from the app formatter, `—` for no homework, five attachment lines, keep/don't-forward paragraphs in the plural, one paragraph per line (QP soft breaks only). Matches §10.1/10.2 apart from P3-2.
- Change notice: plural, `Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.`, sent to the union of old and new. Matches §10.3 apart from P3-3/P3-4.
- CSVs: UTF-8 BOM and `;`, Turkish headers, opens in Excel.

## AC 8: attendance CSV for an empty month (my view)

**Keep the current behaviour (every current member with `0`/`0` and an empty `Yüzde`) and amend the AC 8 text.** Reasons:
- The file then equals `/raporlar/csv` for the same period (AC 9), so a treasurer comparing the two never asks why one is empty.
- The roster itself is useful in a backup mail: it shows who was a member that month.
- `Beklenen 0` with an empty percentage plus the body line `Çalışma: 0 · Ortalama devam: —` can't be misread as "everyone missed everything".

Proposed AC 8 wording: "the homework, ledger and dues CSVs are header-only; the attendance CSV lists current members with `Geldi 0`, `Beklenen 0` and an empty `Yüzde`, as `/raporlar/csv` does." The e2e already asserts exactly this.

## Counts

P1: 0 · P2: 5 · P3: 5.
