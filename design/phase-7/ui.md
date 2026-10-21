# Phase 7 UI engineering plan

Author: UI engineer. Date: 2026-10-21. Reads: `po-spec.md` (no `ux.md`, `db.md` or `backend.md` yet), Next 16 docs (`02-route-segment-config/maxDuration.md`), and the current `src/app/(portal)/{page,profil/page,finans/ayarlar/page,odevler/page,error}.tsx`, `src/components/{confirm-dialog,use-run-action}.ts(x)`, `src/components/forms/*`, `src/components/finance/settings-forms.tsx`, `src/components/homework/recording-email-dialog.tsx`, `src/lib/{auth/dal,labels,validation,time}.ts`, `e2e/{run,lib,prod,phase6-b-security,phase6-c-finance}.mjs`.

Facts I checked before planning:
- **Members are redirected, not 404'd.** `requireManager()` (`src/lib/auth/dal.ts:12`) does `redirect("/")`, and every manager page uses it. AC 15 says "the same 404 as other manager pages". See @po 1.
- **The repo has no `.env`, only `.env.example`.** So the dev server on 3100 has no `CRON_SECRET` and no `BACKUP_PASSPHRASE` today. Every cron e2e would get 503, and every send would fail with the AC 23 message. See @backend 1.
- **Server actions inherit the page's `maxDuration`** (`maxDuration.md`, "set the maxDuration at the page level to change the default timeout of all Server Actions used on the page"). `Şimdi gönder` runs the whole dump, encrypt and SMTP flow inside the `/yedek` page's function, not the cron route's.
- **No `Alert` component in `src/components/ui`.** Existing warnings are hand-rolled with `border-late/40 bg-late/10` plus `TriangleAlert text-late-ink` (`odevler/page.tsx:71`, `finans/yeni/page.tsx:80`). I reuse that pattern. I don't add shadcn `alert`, so the banners stay consistent with the warnings we already have.
- `lucide-react` has `DatabaseBackup`, `ShieldCheck`, `CircleCheck`, `TriangleAlert`, `Loader`, `TimerOff`, `Plus`, `X`.
- `axe-core` is already a devDependency and is used in `e2e/phase6-c-finance.mjs:247`.

---

## 1. Files (frontend side; the backend owns `src/lib/backup/*` and the actions)

| File | Kind | Content |
|---|---|---|
| `src/app/(portal)/yedek/page.tsx` | Server | `requireManager()`, `export const maxDuration = 60`, `metadata.title = "Yedekleme"`; reads one `getBackupPage()` bundle; renders the six blocks of AC 16 |
| `src/app/(portal)/yedek/loading.tsx` | Server | skeleton (§7) |
| `src/app/(portal)/yedek/actions.ts` | backend | `saveBackupRecipients(prev: FormState, fd: FormData): Promise<FormState>`, `sendBackupNow(): Promise<FormState>` |
| `src/components/backup/status-card.tsx` | Server | Durum card |
| `src/components/backup/setup-list.tsx` | Server | Kurulum checklist |
| `src/components/backup/recipients-form.tsx` | Client | conductor's editable list |
| `src/components/backup/recipients-list.tsx` | Server | board's read-only list |
| `src/components/backup/send-now.tsx` | Client | button, ConfirmDialog, result live region |
| `src/components/backup/run-log.tsx` | Server | Geçmiş list |
| `src/components/backup/run-status-chip.tsx` | Server | status chip |
| `src/components/backup/backup-banner.tsx` | Server, async | home banner (failure, overdue, not configured) |
| `src/lib/format.ts` | add | `formatBytes(n)` → `184 KB` / `1,2 MB` (`tr-TR`, minimum `1 KB`) |
| `src/lib/time.ts` | add | `formatMonthYear` = `formatter({ month: "long", year: "numeric" })` → `Ekim 2026`. Shared with the backend's subject line, so page and email can't drift. |

**Reused as they are:** `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Button`/`buttonVariants`, `Input`, `Label`, `ConfirmDialog` (on top of `AlertDialog`), `sonner` toasts, `FormMessage`, `useFocusError`, `submitWithoutReset`, `useRunAction`.

**Not used:** `Table`. Its container scrolls sideways at 375 px, and AC 19 forbids the error text going off-screen. `Badge` isn't used either: the chips follow the `StatusChip` span pattern, so they match the attendance and homework chips. **No new shadcn components.**

### Data the page needs (one server call; @backend please return this shape)
```ts
type BackupPage = {
  canEdit: boolean;                          // role === "conductor", computed on the server
  recipients: string[];
  audit: { name: string | null; at: Date } | null;
  setup: { mail: "ok" | "dev" | "missing"; passphrase: boolean; cronSecret: boolean };
  previous: { month: string /* "2026-09" */; state: "sent" | "pending" | "failed"; at?: Date; error?: string };
  nextSendAt: Date;                           // 1st of next month, 08:00 Istanbul
  runs: Array<{ id: string; startedAt: Date; month: string; trigger: "cron" | "manual";
    actorName: string | null; status: "running" | "sent" | "failed" | "stale";
    sizeBytes: number | null; recipientCount: number | null; error: string | null }>;
};
```
`stale` (`Yarıda kaldı`) is computed in the query (running and older than 10 minutes), so page and banner use one rule.

## 2. Page layout (375 px first)

- One column, `max-w-xl space-y-6`, like `/finans/ayarlar`. From `md` it stays one column. It's a settings page, and a two-column split would put Geçmiş beside a form for no gain.
- Top: a back link `‹ Profil` (`min-h-11`, the BackLink style with a plain `Link`) because the page has no tab-bar entry. Then `h1` `Yedekleme` and the lead paragraph.
- Each block is a `<section aria-labelledby>` card: `rounded-2xl border bg-card p-4`, with an `h2` at `text-xl font-medium`, the same as `/finans/ayarlar`.
- Order follows AC 16 exactly. For the board, the `Şimdi gönder` section isn't rendered at all (not just hidden), and Alıcılar renders `RecipientsList`.

**Durum card.** One status line with a leading icon, then `Sonraki gönderim: 1 Ara 2026, 08:00 civarı` in `text-sm text-muted-foreground`.
- `sent`: `CircleCheck text-present-ink`.
- `pending`: `Clock text-muted-foreground`.
- `failed`: `TriangleAlert text-absent-ink`; the error text wraps (`break-words`).
- Times go in `<time dateTime={iso}>`.

**Kurulum.** A `<ul>` of four rows, `min-h-11 flex items-center gap-3`:
- Label on the left. On the right, the status as **text plus icon** (`CircleCheck text-present-ink` + `Tamam`, or `TriangleAlert text-late-ink` + `Eksik`), so colour is never the only signal. Icons are `aria-hidden`.
- The dev mail row reads `Tamam · geliştirme: dosyaya yazılır`. At 375 it wraps under the label (`flex-wrap`); the row isn't truncated.
- Under the list, the README hint (`text-xs text-muted-foreground`), plus the passphrase reminder if UX takes PO risk 2. I'd take it: one line, no cost.

**Alıcılar, read-only (board).** A `<ul>` of addresses in `font-mono text-sm break-all`, so a 50-character address wraps instead of scrolling, then the note `Alıcıları yalnızca koro şefi değiştirebilir.` and the audit line.

**Şimdi gönder.** See §4. **Geçmiş.** See §5.

## 3. Recipients form (conductor)

**State and markup**
- Client state is `rows: { key: string; value: string }[]`. It starts from the saved list, or one empty row.
- The form is keyed by `recipients.join(",")` in the page, so after a save and `router.refresh()` it remounts with the server's normalised list (lower-cased, deduplicated). Without that, the inputs would keep showing what was typed.
- Markup is a `<fieldset>` with a visible `<legend>` `Alıcılar`, then one row per address:
  - `<Label className="sr-only" htmlFor="recipient-<i>">{i+1}. alıcı</Label>`
  - `<Input id="recipient-<i>" name="recipients" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false} className="h-11 rounded-xl min-w-0 flex-1">`
  - a ghost icon `Button` `size-11` with `aria-label="<i+1>. alıcıyı kaldır"` and an `X` icon. It's hidden when there is only one row; the empty-submit path covers "remove the last one".
- `Adres ekle` (`variant="outline" h-11 rounded-full`, `Plus` icon) is rendered only while `rows.length < 5`. At 5 rows it's replaced by the text `En fazla beş adres.` (`text-xs`).
- Under the fieldset: the AC 16 hint (`id="recipients-hint"`, referenced by every input's `aria-describedby` along with its own error id), `FormMessage error`, the `Kaydet` button and the audit line `Son değişiklik: <ad> · <tarih>` (`formatAuditDate`).
- The form is `noValidate`, so the Turkish server messages show instead of Chrome's English bubble for `type=email`.

**Submit**
- Uses `useActionState(saveBackupRecipients, {})` with `onSubmit={(e) => submitWithoutReset(e, action)}`. React's automatic form reset would otherwise clear the DOM of controlled inputs.
- The server reads `fd.getAll("recipients")`, then trims, lower-cases, drops empties and deduplicates. Empty rows are dropped silently, not errors.

**Server error mapping** (@backend, this is the contract the form renders):

| Case | Returned | Shown |
|---|---|---|
| not conductor | `{ error: "Bu ayarı yalnızca koro şefi değiştirebilir." }` | `FormMessage` (`role="alert"`) |
| 0 addresses after cleaning | `{ error: "En az bir adres gir." }` | `FormMessage`, focus moves to the first input |
| more than 5 | `{ error: "En fazla beş adres ekleyebilirsin." }` | `FormMessage` (reachable only by a crafted request; the UI caps at 5) |
| invalid address in row i | `{ fieldErrors: { "recipients.<i>": ["Geçerli bir e-posta adresi gir: <adres>"] } }`, where `i` is the index in the **submitted** list, before empties are dropped | under that row, `id="recipient-<i>-error"`, `aria-invalid` on the input |
| success | `{ success: "Alıcılar kaydedildi." }` | toast (the `useToast` pattern from `settings-forms.tsx`) |

- For list-level errors, `useFocusError` already focuses the first `aria-invalid` input or the alert. For "En az bir adres gir." the form passes `aria-invalid` to row 0, so focus lands in the input.
- Pending: `Kaydet` is disabled and reads `Kaydediliyor…`. Inputs stay enabled, because disabling them would drop focus mid-edit.

**Focus moves**
- `Adres ekle` → focus the new input (a ref set in a `useEffect` on `rows.length` growth).
- Removing row i → focus row i's input (now the next address), or the previous one if it was last.

## 4. Şimdi gönder (conductor)

**`SendNow` props:** `{ count: number; monthLabel: string }`.
- `count === 0`: the button is `disabled`, with the visible hint `Önce en az bir alıcı kaydet.` linked through `aria-describedby`.
- Otherwise the hint is the AC 16 text. The button is `variant="default" h-11 rounded-full px-5` with the `Send` icon.

**Dialog: `ConfirmDialog`**
- Title `Rapor ve yedek gönderilsin mi?`, description `<n> adrese <Ekim 2026> raporları ve şifreli yedek gönderilecek.`.
- One action, `{ label: pending ? "Gönderiliyor…" : "Gönder", variant: "default" }`. Not `destructive`: sending isn't destructive, and red would be wrong. Cancel stays first and gets the initial focus, as in every confirm.
- @ux: I'd also list the saved addresses as `children` (`text-sm break-all`), so the şef sees where the members' data goes before confirming. Your call.

**Flow: `useRunAction()`**
- `run(sendBackupNow, () => setOpen(false))`.
- It toasts `result.error` (cooldown, failure, not conductor, no recipients) or `result.success` (`Gönderildi: <n> adres.`) and calls `router.refresh()`, so Durum and Geçmiş update without a reload.
- While pending, the dialog ignores `onOpenChange(false)`, so Escape or an outside tap can't hide a running send. The page's own button also shows `Gönderiliyor…` and is disabled.

**Live region**
- Toasts disappear, and a failure deserves a lasting note. So under the button, a `<p role="status" aria-live="polite">` keeps the last result text (`Gönderildi: 2 adres.` / `Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te.`). Its colour is `text-present-ink` or `text-absent-ink` with an icon.
- It's empty on first render, so nothing is announced on page load.
- After the dialog closes, base-ui returns focus to the trigger button, which is still in the DOM.

**Duration**
- A real Gmail send with scrypt can take several seconds. That's why `maxDuration = 60` goes on `page.tsx` and not only on the cron route.

## 5. Geçmiş (run log)

- An `<ol aria-label="Gönderim geçmişi">` with `divide-y rounded-2xl border bg-card`; one `<li>` per run, newest first, max 12.
- At 375 px each item stacks:
  1. `flex items-start justify-between gap-3`: the date-time (`<time>`, `font-medium tabular-nums`, `1 Kas 2026 08:02`) and the status chip (`shrink-0`).
  2. `text-sm text-muted-foreground`: `Ekim 2026 · Otomatik` or `Ekim 2026 · Elle · Ayşe Yılmaz`.
  3. `text-sm text-muted-foreground tabular-nums`: `184 KB · 2 alıcı`. Omitted while `running`, and when the run failed before anything was built (null size).
  4. On failure only: `<p className="text-sm text-absent-ink break-words">` with the stored message.
- From `md`, rows become a grid, `md:grid md:grid-cols-[9rem_8rem_1fr_auto] md:items-baseline md:gap-x-4`: date | month | trigger + size | chip. The error spans all columns underneath (`md:col-span-4`). Same DOM, CSS only, so there's no duplicate markup for the e2e to trip on.
- **Chips** (`run-status-chip.tsx`, the `StatusChip` shape `rounded-full px-2.5 py-0.5 text-xs font-medium` with icon + text):
  - `sent` → `Gönderildi`: `bg-present/14 text-present-ink`, `Check`
  - `failed` → `Başarısız`: `bg-absent/12 text-absent-ink`, `X`
  - `running` → `Gönderiliyor`: `bg-muted text-muted-foreground`, `Loader` with `motion-safe:animate-spin`
  - `stale` → `Yarıda kaldı`: `bg-absent/12 text-absent-ink`, `TimerOff`
  
  These are the attendance tokens, already contrast-checked in both themes in Phase 2.
- Each `<li>` gets `data-testid="backup-run"` and `data-status={status}` for the e2e.
- Empty state: a dashed card `rounded-2xl border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground` with `Henüz gönderim yok. İlk otomatik gönderim 1 Kas 2026'da.`

## 6. Home banner and the /profil entry

**`BackupBanner`** is an async server component that returns `null` for members before it queries anything. The rule (AC 20/21) runs on the server in one `backupBannerState(user)` call, @backend.

Placement in `src/app/(portal)/page.tsx`: **between the greeting `<section>` and the stage hero**. AC 20 says "above the first card", and the hero is the first thing under the greeting, so the warning comes before any card and is above the fold at 375×812 (greeting about 90 px, banner about 110 px). See @po 4.

- **Failure / overdue** (`data-testid="backup-banner"`):
  - `<div role="alert" className="flex gap-3 rounded-2xl border border-late/40 bg-late/10 p-4">`, with `TriangleAlert size-5 shrink-0 text-late-ink aria-hidden`.
  - Inside: the AC 20 sentence in `text-sm`, then the link `Yedeklemeye git` (`buttonVariants({ variant: "outline" })`, `h-11 rounded-full px-4`, href `/yedek`).
  - These are the exact classes of the `/odevler` "Kayıt e-postası ayarlanmadı" banner, so the app has one warning look.
- **Not configured** (`data-testid="backup-setup-banner"`, conductor only):
  - Quieter: `rounded-2xl border border-dashed bg-card p-4`, with `DatabaseBackup text-muted-foreground`, the text `Aylık yedek henüz ayarlanmadı.` and the link `Ayarla`. Same 44 px link.
  - **No** `role="alert"`. It's a standing to-do, and announcing it on every home visit would be noise. A plain `<aside aria-label="Aylık yedek">` is enough.
- Both banners use only foreground on the `/10` tint plus the `-ink` icon, the same contrast as the existing banner in both themes. I'll verify both at 390 and desktop in review.

**`/profil`**
- Add a third tuple to the manager `nav` in `src/app/(portal)/profil/page.tsx:57`: `["/yedek", "Yedekleme", "Aylık rapor ve yedek e-postası", DatabaseBackup]`. Nothing else changes; the rows are already `min-h-14`.
- **No** sidebar entry (P10). The tab bar and sidebar highlight nothing on `/yedek`, which is fine; the back link covers mobile.

## 7. Loading, errors, themes

**`yedek/loading.tsx`**
- Skeleton in the `finans/loading.tsx` style: a `h-10 w-48` title bar, a two-line lead, three `rounded-2xl bg-muted` blocks (`h-24` Durum, `h-48` Kurulum, `h-40` Alıcılar), and four `min-h-16` list rows.
- `aria-busy="true" aria-label="Yükleniyor"`. No spinner.

**Errors**
- A thrown page render falls to `(portal)/error.tsx`; nothing new is needed.
- Actions never throw to the boundary: `saveBackupRecipients` returns `FormState`, and `useRunAction` already turns a throw into `Bir şeyler ters gitti, tekrar dene.` (`use-run-action.ts:17`).
- A failed send is a **returned** error, not a throw, so the run row is written and the page refreshes.

**Themes**
- Only tokens are used: `bg-card`, `border`, `text-muted-foreground`, `present`/`absent`/`late` (`-ink` for text), `bg-muted`. No hex.
- The present and absent `-ink` tokens exist for both themes and already pass AA on `bg-card` and their `/12`–`/14` tints.

**Touch targets**
- Every interactive element is at least 44 px: inputs `h-11`, remove `size-11`, `Adres ekle`/`Kaydet`/`Şimdi gönder` `h-11`, the banner links `h-11`, the back link `min-h-11`, and the dialog buttons `h-11` (from `ConfirmDialog`).

## 8. e2e test plan

**Layout.** `run.mjs` picks up `^phase\d+-.*\.mjs$`, sorted. Three new files run after `phase6-z-guards.mjs`. Helpers go in `e2e/mail.mjs`, which doesn't match the pattern and so isn't run as a phase.

| File | ACs |
|---|---|
| `e2e/phase7-a-cron.mjs` | 1, 2 (dev part), 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24 (no-secret assertion on every failed row), 32, 36 (cron `no-store`) |
| `e2e/phase7-b-page.mjs` | 14, 15, 16, 17, 18, 19, 20, 21, 36 (nonce CSP header and 0 violations on `/yedek`, `/` with banner) |
| `e2e/phase7-c-restore.mjs` | 27 (the existing Phase 6 AC39 test stays as is), 28, 29, 30 (drill) |
| `e2e/prod.mjs` (extend) | 2 (503 unset), 22, 23, 25, 30 (`?bugun=` ignored), 37 (build table shows `ƒ /yedek`, `ƒ /api/cron/aylik-yedek`) |

**Shared state and cleanup (`e2e/lib.mjs` `cleanup()`)**
- Add `delete from backup_runs` and `delete from app_settings where key = 'backup_recipients'`. Every phase-7 section starts from a clean slate with `await resetBackup()`, a helper in `mail.mjs` that runs those two lines.
- Recipients in tests are `@e2e.test` addresses, so no real mailbox could ever appear even if the transport were wrong.

**Outbox helpers (`e2e/mail.mjs`, no new dependency)**
- `outboxSnapshot()` lists `data/outbox/*.eml`.
- `newEmails(before)` returns the files added since; tests count via this diff, never the absolute count, and delete only the files they created at the end of each section.
- `parseEml(path)` is a small MIME reader (about 60 lines):
  - It splits headers with unfolding, and decodes RFC 2047 words (`=?UTF-8?B?…?=` and `?Q?`, adjacent words joined without whitespace).
  - It walks `multipart/mixed` by the boundary and decodes each part's `Content-Transfer-Encoding` (`base64`, `quoted-printable` via bytes + `TextDecoder`, `7bit`).
  - It returns `{ headers, text, attachments: [{ filename, contentType, data: Buffer }] }`. The filename comes from `Content-Disposition` `filename=` or RFC 2231 `filename*=`.
  - @backend: nodemailer picks QP or base64 per part; the parser handles both, so no transport option is needed.
- `cron(query, { secret })` uses Node `fetch` (not the browser) with `Authorization: Bearer <secret>`. It returns `{ status, json, headers }`. The secret comes from `process.env.CRON_SECRET`, loaded by the runner (see @backend 1).

**phase7-a-cron**
- **AC 1:** read `vercel.json` and assert `crons` deep-equals the single entry.
- **AC 2:**
  - no header and `Bearer wrong` each → 401, the body has no address, and the outbox diff and `backup_runs` count are unchanged.
  - The valid call → `content-type` JSON, `Object.keys(json)` is exactly `["status"]`, and `cache-control` includes `no-store`.
  - Preflight: if a valid bearer gets 503, fail with `CRON_SECRET missing from the dev env` instead of 20 confusing failures.
- **AC 3–5**, in this order, `resetBackup()` first, with recipients inserted directly into `app_settings` (two `@e2e.test` addresses):
  - `?bugun=2026-11-01` → `sent`, 1 `.eml`, one row `cron/2026-10/sent`.
  - `?bugun=2026-11-02` → `skipped`, 0 `.eml`, the row count unchanged.
  - `Promise.all` of two `?bugun=2026-12-01` → the sorted statuses equal `["sent","skipped"]`, 1 `.eml`, one `sent` row for `2026-11`.
  - Insert `failed` for `2026-09`, then `?bugun=2026-10-02` → `sent` for `2026-09`.
  - Insert `running` for `2026-08` with `started_at` = now−11 min, then `?bugun=2026-09-01` → `sent`. With now−2 min for `2026-07` and `?bugun=2026-08-01` → `skipped`.
- **AC 6, 8–12, content (fixture month).** See @po 2.
  - The fixture month is **January 2025** (`?bugun=2025-02-01`), so seed data anchored to "now" can't change the expected numbers. A precondition check fails loudly if any non-E2E rehearsal, assignment or finance entry is dated in that month.
  - Fixtures (E2E-prefixed, cleaned by `cleanup()`):
    - three `@e2e.test` singers joined in 2024
    - rehearsals at `2025-01-31 23:30` and `2025-02-01 00:30` Istanbul, plus one more in January, with attendance marks
    - one assignment due in January with on-time, late and missing submissions
    - two finance entries, and one dues period overlapping January
  - **AC 6:** the January CSV lists the 23:30 rehearsal's mark in the fixture singer's `Geldi`/`Beklenen`, and the 00:30 one doesn't count. The body says `Çalışma: 2`.
  - **AC 7:** `From` = `"Arkhe Portal" <outbox@arkhe.local>`, `To` = both addresses, decoded `Subject` = `Arkhe aylık rapor ve yedek · Ocak 2025`. The subject contains no `@` and no `₺`.
  - **AC 8:** the body contains the month line, the five `- arkhe-…` lines with the right month and the `-HHmm` backup name pattern, `${APP_URL}/yedek`, and the three summary lines equal to the constants computed by hand from the fixtures. A second empty-month send (`?bugun=2024-02-01`, January 2024) asserts `Çalışma: 0 · Ortalama devam: —` and five attachments, each CSV header-only.
  - **AC 9:** the attachment's first line equals the first line of `GET /raporlar/csv` as yk@ (BOM included).
  - **AC 10:** exactly three rows with `Zamanında`, `Geç`, `Gecikti`, sorted by `tr` name.
  - **AC 11:** `Buffer.equals` with `GET /finans/rapor/csv?from=2025-01-01&to=2025-01-31` fetched as yk@ through `page.request`.
  - **AC 12:** the rows equal `/finans/aidat/csv?donem=<id>` rows with the period name prepended. The empty-month send is header-only.
  - Whole email: the decoded text of every part contains none of `korist@arkhe.local`, `sef@arkhe.local` or the fixture singers' emails. That proves the CSVs carry no addresses (P6). The To header is excluded, since it holds the recipients.
- **AC 24:** after every section, every `failed` row's `error` contains neither the dev `CRON_SECRET` nor the dev `BACKUP_PASSPHRASE`.
- **AC 32:** `.env.example` has the five keys with the dev values for two of them and `SMTP_*` commented out. `.gitignore` contains a `data/outbox/` (or `/data/outbox`) line, checked by string match, since the e2e doesn't call git.

**phase7-b-page** (contexts at 375×812 via `newPage(browser, { phone: true })`, plus `context: { colorScheme: "dark" }` for the dark pass)
- **AC 15:**
  - korist@ → `/yedek` ends at `/` (or 404, per @po 1) with no `Yedekleme` heading, and `/profil` has no `a[href="/yedek"]`.
  - yk@ and sef@ → 200, `h1` `Yedekleme`, and the `/profil` link with its hint.
- **AC 16 / 36**, both themes for sef@ and yk@:
  - `scrollWidth <= innerWidth`, with an extra 48-character `@e2e.test` recipient saved to stress wrapping.
  - Four Kurulum rows by label text.
  - The sef@ vs yk@ control sets.
  - axe `wcag2a,wcag2aa`, failing on `impact` `serious|critical`.
  - The response `content-security-policy` contains `'nonce-`.
- **AC 14:**
  - sef@ fills two addresses (one with spaces and capitals) → toast `Alıcılar kaydedildi.`, the inputs show the normalised values, and the audit line starts with `Son değişiklik: `. No change-notice `.eml` is written on the first save.
  - Change to a third address → exactly one new `.eml`, `Subject` `Arkhe yedek alıcıları değişti`, and `To` has all three.
  - Empty → `En az bir adres gir.`, focus on the first input. An invalid address → `Geçerli bir e-posta adresi gir: x@` under that row with `aria-invalid`.
  - 6 addresses, and yk@'s save → via `callAction` with `actionIds("src/app/(portal)/yedek/actions.ts")`, after sef@ has rendered `/yedek` so the module is compiled. Assert the error text and that the stored value is unchanged.
  - The UI caps at 5: after four clicks on `Adres ekle`, the button is gone.
- **AC 17:**
  - Without recipients, `Şimdi gönder` is disabled and has the hint.
  - With recipients: click → dialog title and body with `n` and the previous month's label (computed from `istanbulDate()`, not hard-coded) → `Gönder` → toast `Gönderildi: 2 adres.`, one `.eml` whose subject ends `(elle gönderildi)`, a `Elle · <şef adı>` row first in Geçmiş, and the live region text.
  - Immediately again → toast `Az önce gönderildi. 10 dakika sonra yeniden deneyebilirsin.` (match `/\d+ dakika/`), and no new `.eml` or row.
  - yk@ `callAction(sendBackupNow)` → `Bu işlemi yalnızca koro şefi yapabilir.`, no `.eml`.
- **AC 18:** after that manual send, `cron("?bugun=<1st of the current Istanbul month>")` → `skipped`, no `.eml`.
- **AC 19:**
  - `resetBackup()` → the empty-state text.
  - Insert `sent`, `failed` (with a 200-character message), `running` (now−1 min) and `stale` (running, now−20 min) → labels by `data-status`, newest first, the error fully visible (its `boundingBox` is inside the viewport width).
  - Insert 15 rows → 12 `li`.
- **AC 20/21**, each case arranged in the DB, then `/` checked for sef@, yk@ and korist@:
  - no recipients → sef@ sees `backup-setup-banner`, yk@ and korist@ see none.
  - recipients with first-saved (see @dba) backdated before this month's 1st, previous month uncovered, real date ≥ 3rd → `backup-banner` with the (b) text for sef@ and yk@. Today is 21 Oct, so this holds. If the suite runs on the 1st or 2nd, the test skips (b) with a printed note.
  - add a `failed` cron row for the previous month → the (a) text.
  - add a `sent` row for the previous month → no banner.
  - korist@ never sees either banner.

**phase7-c-restore**
- **Two sends.** sef@ `Şimdi gönder` (UI), then backdate that run's `finished_at` by 11 minutes in the DB (to step past the AC 17 cooldown; see @po 3), then send again.
  - Before the first send, record the row counts of `users`, `attendance`, `submissions` and `finance_entries`.
- **AC 28:** both `.enc` attachments start with `ARKHE-BK1`, and `!a.equals(b)`. Neither buffer contains `korist@arkhe.local` as UTF-8, nor its gzip-free form.
- **AC 29**, with `spawnSync("npm", ["run", "db:decrypt", "--", tmpEnc], { env, stdin: "ignore", timeout: 60_000 })`. `stdin` ignored plus an explicit env means a missing env can't hang the suite on the no-echo prompt.
  - wrong passphrase → status 1, stderr/stdout contains `Wrong passphrase or damaged file.`, and `data/backups/<name>.sql` does not exist.
  - one byte flipped at `length - 40` (inside the ciphertext) with the right passphrase → the same.
  - `db:restore` onto an existing file → `Refusing to restore over an existing file.`; onto `libsql://x.invalid` → `Restore target must be a local file path.`
- **AC 30:** decrypt the first attachment with the dev passphrase → `Decrypted: data/backups/….sql`. Then `db:restore` into `os.tmpdir()/arkhe-drill-<ts>.db`, then `db:check` with `DATABASE_URL=file:<tmp>`. That exits 0 with `migrations=N/N` (N from `drizzle/meta/_journal.json`), and the four counts equal the recorded ones. Remove the `.sql`, the temp DB and the scratch `.enc` copies in `finally`.

**prod.mjs (extend).** Three server configurations. Each one costs a `next start` (about 2 s); the build is shared.
1. **Main server (3101), as today plus** `CRON_SECRET=<random 32 hex>`, `BACKUP_PASSPHRASE=dev-only-backup-passphrase`, no SMTP:
   - AC 25 passphrase: the admin saves an `@e2e.test` recipient, `Şimdi gönder` → Geçmiş shows the AC 23 message.
   - AC 30: cron with the valid bearer and `?bugun=2020-01-01` → no row with `report_month = '2019-12'`.
   - AC 24: no secret appears in any `error`.
2. **Server B (3102, after the bad-env check frees the port):** `CRON_SECRET` unset, `BACKUP_PASSPHRASE=<random 24>`, no SMTP.
   - AC 2: a bearer → 503.
   - AC 22: a manual send → the SMTP message; Kurulum `E-posta hesabı` → `Eksik`; `/` → 200.
3. **Server C (3102):** `CRON_SECRET=dev-only-cron-secret`, `BACKUP_PASSPHRASE` unset.
   - AC 25 cron: 503 with that bearer.
   - AC 23 unset: a manual send → the AC 23 message, with zero `.eml` in any outbox (production never writes one).
- **AC 37:** capture the `next build` stdout that prod.mjs already runs, and assert lines matching `ƒ /yedek` and `ƒ /api/cron/aylik-yedek`.

Expected runtime added: about 40 s dev (scrypt and dumps dominate) and about 10 s prod.

---

## Replies

**@po**
1. **AC 15, "404 like other manager pages":** manager pages don't 404. `requireManager()` redirects members to `/` (`src/lib/auth/dal.ts:14`), and `/raporlar`, `/finans` and `/uyeler` all behave that way. I propose `/yedek` does the same, for consistency, and the e2e asserts "ends at `/`, no Yedekleme heading". If you really want 404 for this page only, it's a one-line `notFound()`, but then it's the odd one out.
2. **AC 6 and 8 dates:** I disagree with October 2026 and November 2026 as fixture months. The seed and the homework/finance fixtures are re-anchored to *now* (`cleanup()` → `seedFinance(db, new Date())`, `seedHomework`), so October 2026 is full of demo data, and "numbers computed from fixture data" would mean re-implementing the report formulas inside the test. I test the same boundaries (`31st 23:30` / `1st 00:30` Istanbul) in **January 2025**, a month no seed touches, with a precondition check. AC 3–5 keep your 2026 dates, because they only count runs and files.
3. **AC 28 "two manual sends differ" vs. AC 17's 10-minute cooldown:** the second send would be refused. The e2e backdates the first run's `finished_at` by 11 minutes in the DB (the spec allows arranging DB state). No product change; noting it so nobody "fixes" the cooldown.
4. **AC 20 "above the first card":** I place the banner between the greeting and the stage hero. The hero is the first card-like block, and putting the warning below it would push it out of the first screen at 375×812. @ux: object here if you see it differently.
5. **AC 14 "6 addresses give the right error":** the UI caps at 5 rows (`Adres ekle` disappears), so the 6-address message is reachable only by a crafted request. The e2e tests it with `callAction`, like the yk@ case. I'd rather cap than let the user type a sixth and then scold them.
6. **AC 20 `role="alert"`:** kept for the failure/overdue banner. The quieter AC 21 banner gets no alert role (§6). Announcing a standing to-do on every home visit is noise.

**@backend**
1. **Dev env:** there is no `.env` in the repo, so the dev server has neither `CRON_SECRET` nor `BACKUP_PASSPHRASE`. I propose committing **`.env.development`** containing only `CRON_SECRET=dev-only-cron-secret` and `BACKUP_PASSPHRASE=dev-only-backup-passphrase`.
   - `next dev` loads it automatically; `next build` and `start` never do.
   - Change the `e2e` script to `node --env-file-if-exists=.env.development --env-file-if-exists=.env e2e/run.mjs`, so the test sends the same secret the server expects.
   - This keeps AC 25 meaningful (those values are refused in production) and needs no manual step.
2. **`export const maxDuration = 60` on `src/app/(portal)/yedek/page.tsx` too.** `Şimdi gönder` is a server action, and its timeout is the page's (`maxDuration.md`), not the cron route's.
3. Return the `BackupPage` shape in §1 and the error contract in §3, including the `recipients.<i>` field-error keys indexed on the submitted list. `stale` should be computed in the query.
4. `formatMonthYear` in `src/lib/time.ts` is shared by the email subject, the body and the page.

**@dba**
- AC 20(b) says "recipients were saved **before** the 1st" and "never fires for a month that started before recipients were **first** saved". If the setting row only has `updated_at`, editing the list on the 5th would silence rule (b) for the previous month, or (read the other way) wrongly enable it. Please store a first-configured timestamp, for example in the JSON value or as a `backup_runs`-independent column. The e2e backdates that field, not `updated_at`.
- The banner and the Durum card both run on every manager's home view. An index on `backup_runs (report_month, status)` plus one on `started_at desc` keeps both to indexed reads.

**@ux**
- Open for you:
  - the Kurulum passphrase reminder (I'm in favour)
  - the address list inside the confirm dialog
  - whether the Durum line for `failed` repeats the error, or only says `Son deneme başarısız` and points to Geçmiş. I'd repeat it; it's one wrapped line.
- Everything else in §2–§6 is engineering defaults; override the copy and visuals freely.
