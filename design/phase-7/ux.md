# Phase 7 UX plan: Yedekleme

Author: UX designer. Date: 2026-10-21. Reads: `po-spec.md` (AC 1–39), `CLAUDE.md`, current screens `src/app/(portal)/profil/page.tsx`, `src/app/(portal)/finans/ayarlar/page.tsx`, `src/components/finance/settings-forms.tsx`, `src/app/(portal)/odevler/page.tsx` (the `email-missing` warning box), `src/app/(portal)/page.tsx`, `src/components/confirm-dialog.tsx`, `src/components/attendance/status-chip.tsx`, `src/lib/labels.ts`. Screenshots of home, `/profil` and `/finans/ayarlar` at 390 px, light and dark, taken as sef@ (scratchpad, not the repo).

Examples below use today's real date (21 Eki 2026), so "the previous month" is **Eylül 2026** and the next 1st is **1 Kas 2026**.

**No token changes.** Everything uses existing tokens: `present`/`present-ink`, `late`/`late-ink`, `absent`/`absent-ink`, `muted`, `card`, `border`, `primary` (gold in dark mode via the existing button). No raw colours.

---

## 0. Replies to the PO

- **@po: P3 vs. the empty-state copy (must settle before backend codes it).** As written, the cron sends whenever the previous month is not covered. September 2026 has never been covered. So the **morning after the şef saves recipients**, the cron sends September by itself. AC 19's empty state says `İlk otomatik gönderim 1 Kas 2026'da`, and that would be false. AC 20(b) already avoids *warning* about September, but nothing stops the cron from *sending* it. Two options:
  - (A) Keep the behaviour: the first automatic send is the next morning after setup. That gives an early real-world test, which I like. The copy then comes from one function, `nextSendAt()`. See §2.2.
  - (B) The cron skips months that started before the recipients were first saved, the same rule as 20(b). The first automatic send is then 1 Kas.

  I recommend **(A)**: an extra early backup is never harmful, and the README already asks for a manual send right after setup, which covers September anyway. Whichever you pick, the Durum card, the empty state and the banner must use the same `nextSendAt()` helper. Please record the choice in `po-decisions.md`.
- **@po: Money format in the email body (AC 8).** The example says `12.500,00 ₺`. The app (`src/lib/money.ts`, `Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })`) renders `₺12.500,00`, as the home Kasa card shows. The email must use the same formatter, so the example should read `₺12.500,00`. The e2e should assert the formatter's output, not a hand-typed string.
- **@po: Hard line wraps in the email body.** The AC 8 example breaks a sentence in the middle (`…geri yüklemek için` / `README'deki…`). On a phone, plain text with hard breaks renders as ragged half-lines. Rule: **one paragraph = one line, no manual wraps inside a sentence**, and let the mail client wrap it. Short paragraphs keep it phone-readable. nodemailer's quoted-printable encoding handles long lines.
- **@po: README reference in the email.** The README is in English, sits in a code repo the board can't open, and has no section called `Yedekten geri yükleme` (AC 31 names it `Aylık yedek e-postası`). The board's real job is **"keep this email, don't forward it"**, not "decrypt it". The body in §6 says exactly that, and points restore to "the person who set up the portal" plus the one README section name `Aylık yedek e-postası`. @backend: please use that one name everywhere (page, errors, email).
- **@po: Email tone.** The UI uses `sen` because it talks to one person at a time. The monthly email goes to up to five officers in one message, so it uses the plural (`silmeyin`, `iletmeyin`). The change notice is also a group mail, so it uses the plural too.
- **@po: Status chip `Başarısız` → `Gönderilemedi`.** It is the same word the Durum card and the banner use, and plainer. `Yarıda kaldı` and `Gönderildi` stay. `Gönderiliyor` stays.
- **@po: Durum line `Son deneme başarısız: <hata>`.** Split it into a headline (`Eylül 2026 raporu gönderilemedi.`), the error on its own line, and the reassurance `Her sabah kendiliğinden yeniden deneniyor.` Without that last line, a board member reads a failure as "someone must act now".
- **@po: `Sonraki gönderim: …, 08:00 civarı`.** Vercel Hobby fires anywhere within the hour, so 05:00–05:59 UTC is 08:00–08:59 in Istanbul. Write `sabah 08:00–09:00 arası`. It is honest and still short.
- **@po: Error copy aimed at the wrong person.** The run log is read by the şef and the board, so `Yöneticiye haber ver` (AC 13) points at the readers themselves. The person who can fix SMTP, the passphrase or size problems is the deployer. Proposed final strings are in §7.
- **@po risk 2 (passphrase reminder): yes.** Show it under Kurulum to all managers (§2.3). It is the single point of failure, and it costs one line.
- **@po: Proactive cooldown.** In addition to the server refusal (AC 17), render the button **disabled** during the cooldown, with the hint in place, so a nervous şef never sees an error toast after a successful send. The server check stays the authority.
- **@po: Confirm dialog lists the addresses.** `Şimdi gönder` uses the **saved** list. If the şef edited the inputs but didn't press `Kaydet`, `<n> adrese` alone would mislead. Listing the saved addresses in the dialog makes this visible at no cost.
- **@po: agree** with P5 (only the conductor edits), with the not-configured banner shown to the conductor only (AC 21), with `/yedek` not being a tab or sidebar item (P10), and with the fixed section order in AC 16.

---

## 1. Page frame `/yedek`

- File (for the developer): `src/app/(portal)/yedek/page.tsx`, `metadata.title = "Yedekleme"`. The page calls `requireManager()`, as `finans/ayarlar` does, so members get the same 404.
- Container: `max-w-2xl space-y-6`. Single column at every width. The content is a short settings page, so desktop gets more whitespace, not more columns.
- Header:
  - `h1`: `text-4xl font-medium` `Yedekleme` (same as `Ayarlar`).
  - Lead below it: `p.text-sm.text-muted-foreground.max-w-prose`.
- Every section uses the card pattern from `finans/ayarlar`: `section.rounded-2xl.border.bg-card.p-4.space-y-3` (`md:p-6`) with `aria-labelledby` pointing at its `h2` (`text-xl font-medium`).
- Section ids: `durum`, `kurulum`, `alicilar`, `simdi-gonder`, `gecmis`.
- 375 px: no horizontal scroll (AC 16). Every address, error text and file size wraps with `break-words` (addresses use `break-all`, because long Gmail addresses have no break points).
- Back link: none. The bottom tab bar or sidebar plus the browser back button are enough, same as `/finans/ayarlar`.

**Lead copy** (replaces the AC 16.1 text):
> Her ayın 1'inde, geçen ayın raporları ve koronun tüm kayıtlarının şifreli yedeği aşağıdaki adreslere e-postayla gider.

Reasons for the change:
- "veritabanı" becomes "koronun tüm kayıtları".
- "bu adreslere" becomes "aşağıdaki adreslere", because the list is three sections down.

### Order at 375 px (top to bottom), conductor
1. Header + lead
2. Durum
3. Kurulum (+ passphrase reminder)
4. Alıcılar (editor)
5. Şimdi gönder
6. Geçmiş

The board sees the same order: section 4 is read-only and section 5 is not rendered (not merely hidden).

---

## 2. Durum card (AC 16.2)

Layout: icon `size-5 shrink-0` on the left, text stack on the right (`flex gap-3`). The section's `h2` is `Durum`.

The headline is `text-base font-medium` and the meta lines are `text-sm text-muted-foreground`. The card border/background changes only for the failure state.

### 2.1 States
| State (previous month M) | Icon | Card | Headline | Line 2 | Line 3 |
|---|---|---|---|---|---|
| Not configured (no recipients), conductor | `Settings2` muted | default | `Henüz ayarlanmadı.` | `Aşağıdan en az bir alıcı ekleyip kaydet.` | — |
| Not configured, board | `Settings2` muted | default | `Henüz ayarlanmadı.` | `Alıcıları koro şefi ekler.` | — |
| M covered (`sent`) | `CircleCheck` `text-present-ink` | default | `Eylül 2026 raporu gönderildi.` | `1 Eki 2026 08:02 · 3 adres` | `Sonraki gönderim: 1 Kas 2026, sabah 08:00–09:00 arası` |
| M not covered, no run for M yet | `Clock` muted | default | `Eylül 2026 raporu henüz gönderilmedi.` | `Sonraki deneme: 22 Eki 2026, sabah 08:00–09:00 arası` (from `nextSendAt()`, see §0) | — |
| M running (< 10 min) | `Clock` muted | default | `Eylül 2026 raporu şu an gönderiliyor.` | `Birkaç dakika sonra sayfayı yenile.` | — |
| Latest run for M `failed` or `Yarıda kaldı` | `CircleAlert` `text-absent-ink` | `border-absent/40 bg-absent/8` | `Eylül 2026 raporu gönderilemedi.` | the stored error text, `text-sm text-foreground` | `Her sabah kendiliğinden yeniden deneniyor. Sonraki deneme: 22 Eki 2026, sabah 08:00–09:00 arası` |

- "Covered" wins over an older failure: if M has a `sent` row, show the green state even if a failed row exists.
- The date in line 2 of the `sent` state is the run's `finished_at` (`tr-TR`, Istanbul, `d MMM y HH:mm`, the same format as `formatAuditDate`).
- `Sonraki gönderim` vs `Sonraki deneme`: use "gönderim" when the next call is expected to send a new month, and "deneme" when it is a retry or first try for an uncovered month.
- Use "geçen ay" wording nowhere in this card. Always name the month.

### 2.2 `nextSendAt()` (@backend)
One helper returns `{ at: Date, kind: "gönderim" | "deneme" }`:
- If M is covered: the 1st of the next month, 05:00 UTC.
- Otherwise: the next 05:00 UTC strictly after now.

The Durum card, the Geçmiş empty state and the docs copy all read it. The display is always the Istanbul date plus the fixed text `sabah 08:00–09:00 arası`.

---

## 3. Kurulum checklist (AC 16.3)

`h2` `Kurulum`. A `ul` with four rows, `divide-y`. Each row is `min-h-14 py-3 flex items-start gap-3`.

Row anatomy:
- left: status icon `size-5`
  - `Tamam`: `CircleCheck` `text-present-ink`
  - `Eksik`: `TriangleAlert` `text-late-ink`
- middle (`flex-1`):
  - row label `font-medium`
  - one plain-language explanation line, `text-sm text-muted-foreground`
  - the technical names in `font-mono text-xs text-muted-foreground`. This is the only place where the words SMTP and CRON appear in the UI, and only as variable names for the deployer.
- right: a text badge `Tamam` / `Eksik`, `text-xs font-medium rounded-full px-2.5 py-0.5`
  - `Tamam`: `bg-present/14 text-present-ink`
  - `Eksik`: `bg-late/18 text-late-ink`

  The word, not just the colour, carries the state.

| Label | Explanation (Turkish UI) | Mono line | Tamam text |
|---|---|---|---|
| `E-posta hesabı` | `E-postaları gönderen koro Gmail hesabı ve uygulama şifresi.` | `SMTP_USER · SMTP_PASS` | `Tamam` (dev: `Tamam · deneme ortamı, e-posta gönderilmez, dosyaya yazılır`) |
| `Yedek şifresi` | `Yedek dosyasını kilitleyen şifre. En az 16 karakter.` | `BACKUP_PASSPHRASE` | `Tamam` |
| `Zamanlayıcı anahtarı` | `Her sabah gönderimi kendiliğinden başlatan zamanlayıcının gizli anahtarı.` | `CRON_SECRET` | `Tamam` |
| `Alıcılar` | `Raporun gideceği adresler.` | — | `3 adres` |

- In dev, the `Tamam` badge itself still reads `Tamam`. The dev note goes on the explanation line instead, so the badge never wraps at 375 px.
- No row ever shows a value, a length or a masked value (`••••`) of a secret. AC 16 forbids values, and a masked length leaks information too.
- When `Yedek şifresi` is set but fails a rule, the badge still reads `Eksik`. The explanation line gets the reason: `Çok kısa ya da deneme şifresi; yenisini gir.` That keeps "Eksik" binary and still gives the deployer the hint.

Below the list, two short paragraphs (`text-sm text-muted-foreground`, `space-y-1`):
1. `Eksik ayarları portalı kuran kişi Vercel'de girer. Adımlar README'de: "Aylık yedek e-postası".`

   This replaces `Eksik ayarlar Vercel'de girilir…`: it tells a board member that this is not their job.
2. Passphrase reminder (risk 2), with a `KeyRound` icon `size-4` inline:
   `Yedek şifresini Vercel dışında iki yerde sakla (ör. şefin şifre yöneticisi ve kapalı zarfta bir kâğıt). Şifre kaybolursa hiçbir yedek açılamaz.`

   Shown to conductor and board. The board president may be the one holding the envelope.

---

## 4. Alıcılar (AC 14, 16.4)

`h2` `Alıcılar`.

### 4.1 Conductor: editor
The form follows the `settings-forms.tsx` pattern (`useActionState`, `FormMessage`, toast on success). Top to bottom:

1. Hint (`text-sm text-muted-foreground`, `id="alicilar-hint"`):
   `Raporlarda isimler, devam, ödev ve aidat bilgisi şifresiz gider; yalnızca yönetimdeki kişilerin adreslerini ekle.`

   This is the AC 16.4 hint plus *what* is unencrypted (P6 says the UI says so).
2. `FormMessage` for list-level errors (`En az bir adres gir.`, `En fazla beş adres ekleyebilirsin.`, `Geçerli bir e-posta adresi gir: <adres>`). It uses `role="alert"`, and on submit error focus moves to it (`use-focus-error.ts`).
3. Address rows: `ol.space-y-2`. Each row is `flex gap-2`:
   - `Input` `h-11 flex-1 rounded-xl`:
     - `type="email"`, `name="recipients"` (repeated)
     - `autocomplete="off"`, `autocapitalize="none"`, `spellcheck={false}`, `inputMode="email"`
     - `placeholder="ornek@gmail.com"`
     - `aria-label="Alıcı 1"` … `"Alıcı 5"`, `aria-describedby="alicilar-hint"`
     - when the server names this address as invalid: `aria-invalid` and a red ring.
   - Remove button: `Button variant="ghost" size="icon" className="size-11 shrink-0"` with `X` icon, `aria-label="Alıcı 2'yi kaldır"`.
     - Not rendered when only one row is left. The last row is cleared by typing; saving empty gives `En az bir adres gir.`
     - After removal, focus goes to the previous row's input, or to the first row if the first one was removed.
4. `Adres ekle`: `Button variant="outline" className="h-11 rounded-full px-4"` with `Plus`.
   - It appends an empty row and focuses it.
   - With 5 rows it is not rendered. Its place shows `text-xs text-muted-foreground` `En fazla beş adres.`
5. Action row (`flex flex-wrap items-center gap-3`): `Kaydet`, `Button className="h-11 rounded-full px-5"`, pending label `Kaydediliyor…`.
6. Under it, `text-xs text-muted-foreground`, two lines:
   - the audit line, once saved: `Son değişiklik: Demo Şef · 21 Eki 2026 14:05` (same string builder as Phase 6)
   - when at least one save exists: `Listeyi değiştirdiğinde eski ve yeni adreslere bilgi e-postası gider.` This makes the AC 14 change notice visible to the person who triggers it.

- Empty first visit: one empty row, no audit line, no notice line.
- Success: toast `Alıcılar kaydedildi.` The inputs re-render normalised (lower-case, trimmed, de-duplicated), so the şef sees what was stored.
- Row order is preserved as typed.

### 4.2 Board: read-only
- `ul.space-y-1`. Each `li` is `flex items-center gap-2 min-h-11 text-sm break-all` with a `Mail` icon `size-4 text-muted-foreground`.
- No inputs, no buttons, no form element at all.
- Below it, `text-sm text-muted-foreground`: `Alıcıları yalnızca koro şefi değiştirebilir.` Then the same audit line as 4.1.
- Empty: `Henüz alıcı yok. Alıcıları koro şefi ekler.` (no list).
- The unencrypted-data hint (4.1 item 1) is shown to the board too. They are the recipients it warns.

---

## 5. Şimdi gönder (AC 16.5, 17, 18)

Conductor only, so the board sees no section at all. `h2` `Şimdi gönder`.

- Hint (`text-sm text-muted-foreground`):
  `Eylül 2026 raporlarını ve bugünkü yedeği hemen gönderir. Kurulumdan sonra bir kez dene ve e-postanın geldiğini kontrol et.`

  The month is named instead of "önceki ay", which is ambiguous on the 1st.
- Button: `Button className="h-11 rounded-full px-5"` with `Send` icon, label `Şimdi gönder`. Default (primary) variant: it is the main action of this section, and in dark mode that is the gold button seen on `/finans/ayarlar`.

### 5.1 Button states
| State | Button | Hint below the button (`text-sm`, `id="gonder-durum"`, `aria-describedby` on the button) |
|---|---|---|
| Ready | enabled | — |
| No saved recipients | `disabled` | `Önce en az bir alıcı kaydet.` (muted) |
| Cooldown (last `sent` < 10 min ago) | `disabled` | `Az önce gönderildi. 7 dakika sonra yeniden gönderebilirsin.` (muted). Minutes = `ceil(remaining / 60 s)`, min 1. Computed at render; no live countdown. A reload or `router.refresh()` updates it. |
| A run is `running` (< 10 min) | `disabled` | `Şu an bir gönderim sürüyor.` |

The server re-checks every one of these (AC 17).

### 5.2 Confirm dialog
Use the existing `ConfirmDialog`. **Pass `variant: "default"`**: its default is `destructive`, and sending is not destructive.
- title: `Rapor ve yedek gönderilsin mi?`
- description: `3 adrese Eylül 2026 raporları ve şifreli yedek gönderilecek.`
- `children`: the saved addresses as `ul.text-sm.text-muted-foreground.break-all` (one per line). If the editor is dirty (client-side compare with the saved list), add one more line above the list: `Kaydedilmemiş değişiklikler gönderime dahil değil.` in `text-late-ink`.
- actions: `Vazgeç` (focused first, as in the component) / `Gönder`.
- Pending: the dialog stays open and both buttons are disabled (`pending` prop). The `Gönder` label becomes `Gönderiliyor…`. Gmail plus scrypt can take several seconds, so closing early would leave the şef with no feedback.
- On result, the dialog closes, then:
  - success: toast `Gönderildi: 3 adres.`, `router.refresh()` so Durum, the button (now in cooldown) and Geçmiş update.
  - failure: toast (error) `Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te.`, refresh. The new failed row is first in Geçmiş.
  - refusal (cooldown/role/no recipients raced): toast (error) with the server message. No row is added.

---

## 6. Geçmiş, the run log (AC 19)

`h2` `Geçmiş`. An `ol` of the last 12 runs, newest first, inside the card with `divide-y`. The same layout is used at every width (12 short rows; a table adds nothing on desktop).

Row (`py-3 space-y-1`):
- Line 1, `flex items-start justify-between gap-3`: report month `font-medium` (`Eylül 2026`) and the status chip.
- Line 2, `text-sm text-muted-foreground`: `1 Eki 2026 08:02 · Otomatik` or `21 Eki 2026 14:12 · Elle · Demo Şef`.
- Line 3, `text-sm text-muted-foreground tabular-nums`: `184 KB · 3 adres`.
  - Size: `< 1 MB` → whole `KB`, minimum `1 KB`; else `tr-TR` one decimal, e.g. `1,2 MB`.
  - When size is null (failed before building), show only `3 adres`.
  - Rows still `running` show nothing on this line.
- Line 4, failed and interrupted rows only: the error text, `text-sm text-absent-ink break-words`, never truncated.
  - For `Yarıda kaldı` with no stored error: `Gönderim zaman sınırında kesildi. Her sabah kendiliğinden yeniden deneniyor.`

### 6.1 Chips
Same shape as `StatusChip`: `inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium`, icon `size-3.5`, `shrink-0`.

| Status | Label | Classes | Icon |
|---|---|---|---|
| `sent` | `Gönderildi` | `bg-present/14 text-present-ink` | `Check` |
| `failed` | `Gönderilemedi` (see §0) | `bg-absent/12 text-absent-ink` | `X` |
| `running` > 10 min | `Yarıda kaldı` | `bg-absent/12 text-absent-ink` | `CircleSlash` |
| `running` ≤ 10 min | `Gönderiliyor` | `bg-muted text-muted-foreground` | `Clock` (static, no spinner) |

### 6.2 Empty and edge states
- No runs:
  - with recipients: `Henüz gönderim yok. İlk otomatik gönderim: 22 Eki 2026, sabah 08:00–09:00 arası.` (date from `nextSendAt()`; this replaces the fixed `1 Kas` sentence, see §0)
  - without recipients: `Henüz gönderim yok. Alıcılar kaydedilince her ay kendiliğinden gönderilir.`
- Exactly 12 rows shown and more exist: a footnote `text-xs text-muted-foreground` `Son 12 gönderim gösteriliyor.`
- Page-level load error: the existing `src/app/(portal)/error.tsx`. No custom error page.

---

## 7. Final Turkish strings for errors (@po, @backend)

| AC | Spec text | Proposed |
|---|---|---|
| 13 | `Ekler 20 MB sınırını aşıyor. Yöneticiye haber ver.` | `Ekler 20 MB sınırını aşıyor. Portalı kuran kişiye haber ver.` |
| 22 | `E-posta hesabı ayarlanmamış (SMTP_USER, SMTP_PASS). README: "Aylık yedek e-postası".` | keep (it maps 1:1 to the Kurulum row) |
| 23 | `Yedek şifresi ayarlanmamış ya da 16 karakterden kısa (BACKUP_PASSPHRASE).` | `Yedek şifresi ayarlanmamış ya da geçersiz (BACKUP_PASSPHRASE). README: "Aylık yedek e-postası".` The dev-passphrase case (AC 25) is not "kısa", so the old text would mislead. |
| 24 | `Gmail girişi reddedildi. Uygulama şifresini kontrol et.` | keep |
| 24 | `E-posta sunucusuna bağlanılamadı. Yarın otomatik yeniden denenecek.` | `E-posta sunucusuna bağlanılamadı. Yarın sabah kendiliğinden yeniden denenecek.` |
| 24 | `Beklenmeyen hata. Sunucu kayıtlarına bak.` | `Beklenmeyen bir hata oldu. Portalı kuran kişiye haber ver; ayrıntı sunucu kayıtlarında.` |
| 17 | `Bu işlemi yalnızca koro şefi yapabilir.` | keep |
| 14 | `Bu ayarı yalnızca koro şefi değiştirebilir.` | keep |

---

## 8. Home banner (AC 20, 21)

Position: in `src/app/(portal)/page.tsx`, **between the greeting `section` and the stage hero**. The hero is the first card. Placement and spacing come from the parent's `space-y-8`. Managers only; korist never gets the markup.

It is not dismissible: it disappears when the month is covered (AC 20). With only one manager-only banner on the page, dismissal would add state for no gain.

Shared layout, based on the `email-missing` box in `odevler/page.tsx`:
- `div role="alert" className="flex gap-3 rounded-2xl border p-4"` + variant classes
- icon `size-5 shrink-0`
- text column `space-y-2`:
  - `p.text-sm.font-medium` (headline)
  - optional `p.text-sm.text-muted-foreground`
  - the link `Link className={buttonVariants({ variant: "outline" }) + " h-11 rounded-full px-4"}` (44 px target)

| Case | Classes | Icon | Headline | Line 2 | Link |
|---|---|---|---|---|---|
| (a) failed / Yarıda kaldı, month not covered (şef + board) | `border-absent/40 bg-absent/8` | `CircleAlert text-absent-ink` | `Aylık yedek gönderilemedi (Eylül 2026).` | `Her sabah yeniden deneniyor. Nedenini Yedekleme sayfasında görebilirsin.` | `Yedeklemeye git` |
| (b) overdue, 3rd or later (şef + board) | `border-late/40 bg-late/10` | `TriangleAlert text-late-ink` | `Eylül 2026 raporu ve yedeği henüz gönderilmedi.` (the AC's `ayının` dropped) | — | `Yedeklemeye git` |
| Not configured (şef only, AC 21) | `bg-card` (default border) | `Settings2 text-muted-foreground` | `Aylık yedek henüz ayarlanmadı.` | `Koronun kayıtları her ay yönetimin e-postasına yedeklensin.` | `Ayarla` |

- (a) wins over (b) when both match. They never show together.
- Not-configured uses `role="status"`, not `alert`: it is a nudge, not a failure, and screen readers shouldn't announce it on every home visit.
- 375 px: the link sits under the text (column layout). From `md` the same layout is used. The box spans the content width like the hero.
- Dark mode: `bg-absent/8` and `bg-late/10` sit on `--background` dark. The `-ink` tokens are the light variants in dark mode, so the icon contrast holds. Body text stays `text-foreground`.

---

## 9. Entry point on `/profil` (AC 15)

Add a third tuple to the manager links array in `src/app/(portal)/profil/page.tsx`:
`["/yedek", "Yedekleme", "Aylık rapor ve yedek e-postası", DatabaseBackup]` (lucide `DatabaseBackup`). It goes after `Raporlar`, with the same row component (`min-h-14`, chevron).

Optional (P3, only if it's cheap): when the home banner (a) or (b) is active, replace the hint with `Gönderilemedi, bakmak için aç` in `text-absent-ink`. It reuses the banner's predicate. Skip it if it needs an extra query path.

Desktop: the same link (the profil page is reached from the user menu). No sidebar item (P10).

---

## 10. Email copy

The UI uses `sen`. The emails use the plural because they go to a group (§0).

Rules for all emails:
- Plain text, UTF-8.
- One paragraph per line, no hard wraps inside a sentence.
- Blank line between blocks.
- Lists with `- `.
- No names, emails or amounts in the subject.

### 10.1 Monthly email: automatic
Subject: `Arkhe aylık rapor ve yedek · Eylül 2026`

```
Merhaba,

Arkhe Portal'ın Eylül 2026 raporları ve koronun tüm kayıtlarının şifreli yedeği ekte.

Çalışma: 6 · Ortalama devam: %78
Ödev: 3 · Zamanında teslim: %64
Gelir: ₺12.500,00 · Gider: ₺3.200,00 · Net: ₺9.300,00

Ekler:
- arkhe-devam-2026-09.csv: kişi bazında devam
- arkhe-odev-2026-09.csv: ödev teslimleri
- arkhe-finans-2026-09.csv: kasa hareketleri
- arkhe-aidat-2026-09.csv: aidat durumu (gönderim günü itibarıyla)
- arkhe-yedek-2026-10-01-0802.sql.gz.enc: şifreli yedek

CSV dosyaları telefonda ya da Excel'de açılır.

Yedek dosyasını açmanız gerekmez; bu e-postayı silmeden saklayın. Portalda bir sorun olursa koronun kayıtları bu dosyadan geri getirilir. Dosya şifrelidir ve şifresi bu e-postada yoktur. Açma adımları portalı kuranlarda, README'nin "Aylık yedek e-postası" bölümünde.

Raporlar şifresizdir; bu e-postayı koro yönetimi dışında kimseye iletmeyin.

Bu e-posta her ayın 1'inde kendiliğinden gönderilir. Alıcıları koro şefi buradan değiştirir:
https://<APP_URL>/yedek
```

- Zero-data lines (AC 8) stay unchanged: `Çalışma: 0 · Ortalama devam: —`, `Ödev: 0 · Zamanında teslim: —`, `Gelir: ₺0,00 · Gider: ₺0,00 · Net: ₺0,00`.
- `kişi bazında` replaces `üye bazında` to match the `/raporlar` heading `Kişi bazında`.
- `(gönderim günü itibarıyla)` tells the treasurer the dues file is a snapshot, not month-end (AC 12).

### 10.2 Monthly email: manual (`Şimdi gönder`)
- Subject: `Arkhe aylık rapor ve yedek · Eylül 2026 (elle gönderildi)`
- Body: identical to 10.1, with one extra paragraph after `Merhaba,`:
  ```
  Bu e-postayı Demo Şef portaldan elle gönderdi (21 Eki 2026 14:12).
  ```
- The last paragraph stays as in 10.1. It describes the schedule, which is still true.

### 10.3 Change notice (AC 14)
Subject: `Arkhe yedek alıcıları değişti`

```
Merhaba,

Arkhe Portal'ın aylık rapor ve yedek e-postasının alıcı listesi değişti.

Değiştiren: Demo Şef · 21 Eki 2026 14:05

Yeni alıcılar:
- yk.baskan@gmail.com
- sayman.arkhe@gmail.com

Listeden çıkarıldıysanız aylık e-posta artık size gelmeyecek.

Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.

https://<APP_URL>/yedek
```

The AC's `Bu değişikliği sen yapmadıysan…` assumes one reader who could have made the change. Four of five recipients can't have made it, so `haberiniz yoksa` fits every reader.

---

## 11. Accessibility and test hooks (@ui-engineer)

- Every icon is `aria-hidden`. State is always carried by text (`Tamam`/`Eksik`, chip labels), never by colour alone.
- Toasts use the existing sonner setup. The Şimdi gönder hint (`#gonder-durum`) is plain text linked by `aria-describedby`, not a live region.
- Suggested `data-testid`s:
  - `backup-status`
  - `backup-setup` (rows `backup-setup-smtp`, `-passphrase`, `-cron`, `-recipients`, each with `data-ok="true|false"`)
  - `backup-recipients-form`
  - `backup-recipients-readonly`
  - `backup-send`
  - `backup-log`, rows `backup-run` with `data-status`
  - `backup-banner` with `data-kind="failed|overdue|unconfigured"`
  - `profile-manager-links` already exists.
- Tap targets: inputs, remove, `Adres ekle`, `Kaydet`, `Şimdi gönder`, dialog buttons and banner links are all ≥ 44 px (`h-11` / `size-11`).
- Review plan: I'll check `/yedek` as sef@ and yk@, `/` with each banner kind, and `/profil` at 390 px and desktop, light and dark, in `review-ux.md`.
