# Phase 1 screen specs: identity and members

Scope from `PLAN_INPUT.md` Faz 1: login, long session, logout, invite link → set password, reset via the same link mechanism, members management, profile. Design at 375px first; `md` (768px+) notes follow each screen.

Route names are suggestions; the developer owns them. Apply the P1 token fixes from `review-phase0.md` first (`--gold-foreground`, `--*-ink`, `.on-stage` / `--staff-line`).

## 0. Shared building blocks

New components (in `src/components/`, built on existing `ui/*`):

| Component | Purpose | Built from |
|---|---|---|
| `AuthShell` | Layout for login, invite, reset: stage panel + form column | current `/giris` layout, extracted |
| `PasswordInput` | `Input` + trailing 44×44 ghost icon button toggling `Eye`/`EyeOff`; `aria-label` "Şifreyi göster" / "Şifreyi gizle" | `Input`, `Button variant="ghost" size="icon"` |
| `SubmitButton` | Full-width `h-11 rounded-xl`; pending state shows `Loader2 animate-spin` + pending label, `disabled` | `Button`, `useFormStatus` |
| `FormAlert` | Inline error/info block above the submit button: `rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm text-destructive`, icon `CircleAlert`; `role="alert"` | plain markup |
| `EmptyState` | Generalised `ComingSoon` (icon tile, title, text, optional action), without the staff texture behind text | `coming-soon.tsx` |
| `UserMenu` | Avatar trigger → `DropdownMenu`: `Profilim`, `Çıkış yap` | `Avatar`, `DropdownMenu` |
| `VoicePartPicker` | 4 segmented chips (radio group) with colour dot | `VoicePartBadge` styles, native radio inputs |
| `InviteLinkPanel` | Shows a fresh invite/reset link and the WhatsApp copy actions (§5.3) | `Input readOnly`, `Button` |

Add via shadcn: `checkbox` (if "Beni hatırla" is kept), `skeleton`, `input-otp` (Phase 2). Use `Dialog` for confirmations (no extra alert-dialog needed).

Global rules:
- Field errors: under the field, `text-sm text-destructive`, input gets `aria-invalid` (button/input already style it). Form-level errors use `FormAlert`.
- Success: toast via `sonner` (`toast.success`), top-center (already mounted). Max one line.
- All text inputs on mobile keep 16px font (no iOS zoom).
- Tap targets ≥ 44px.
- Spacing: form fields `space-y-4`, label↔input `space-y-2`, sections `space-y-8`.

---

## 1. Login — `/giris`

### Layout
**375px:** top stage band `h-36 rounded-b-3xl bg-stage text-stage-foreground on-stage staff-lines px-6 pb-6 flex items-end` with `<Logo className="text-3xl" />`. Below: `px-6 pt-8 pb-12`, max width `max-w-sm mx-auto`. Heading, helper text, form. The form is top-aligned, not centred, so the on-screen keyboard leaves the button visible.
**md+:** current two-column grid. Left panel: logo top, quote/brand bottom (brand photo later). Right: form centred, `max-w-sm`.

### Content
- h1: `Tekrar hoş geldin`
- Helper: `Hesabın yoksa şefinden ya da yönetimden davet linki iste.`
- `E-posta` — `type="email" autoComplete="email" inputMode="email"`, placeholder `ornek@mail.com`
- `Şifre` — `PasswordInput`, `autoComplete="current-password"`
- (Optional, PO decision) `Checkbox` checked by default: `Beni hatırla`
- Submit: `Giriş yap` / pending `Giriş yapılıyor…`
- Under the button, `text-sm text-muted-foreground text-center`: `Şifreni mi unuttun? Yönetimden yeni bir link iste.`

### States
| State | UI |
|---|---|
| Empty | Button enabled; browser `required` validation is enough. |
| Loading | `SubmitButton` pending; inputs `readOnly`. |
| Wrong credentials | `FormAlert`: `E-posta ya da şifre hatalı.` Keep e-mail, clear password, focus password. Never say which one is wrong. |
| Account without password yet (invited, not accepted) | Same generic error (don't leak). |
| Inactive account | Only after a correct password: `Hesabın şu an pasif. Yönetimle iletişime geç.` |
| Too many attempts | `FormAlert`: `Çok fazla deneme yaptın. Birkaç dakika sonra tekrar dene.` |
| Success | Redirect to `/` (or the `?next=` path). No toast. |
| Already logged in | Server redirects to `/`. |

---

## 2. Invite acceptance / set password — `/davet/[token]`

The person arrives from WhatsApp, on a phone, probably for the first time. One screen, one job.

### Layout
`AuthShell`, same as login. Above the heading, the person's identity so they know the link is theirs: `VoicePartBadge` + `text-sm text-muted-foreground` name, e.g. `● Alto · Ayşe Yılmaz`.

### Content
- h1: `Aramıza hoş geldin, Ayşe`
- Helper: `Portala girmek için bir şifre belirle. E-postan: ayse@mail.com` (e-mail shown read-only so they learn their login)
- `Şifre` — `PasswordInput`, `autoComplete="new-password"`; hint under it, `text-xs text-muted-foreground`: `En az 8 karakter.`
- `Şifre (tekrar)` — `PasswordInput`, `autoComplete="new-password"`
- Submit: `Şifremi belirle ve gir` / pending `Kaydediliyor…`

### States
| State | UI |
|---|---|
| Valid token | Form as above. |
| Loading (submit) | Pending button. |
| Password too short | Field error: `Şifre en az 8 karakter olmalı.` |
| Mismatch | Field error on the second field: `Şifreler eşleşmiyor.` |
| Token invalid or expired | No form. `EmptyState`-like block inside `AuthShell`: icon `LinkIcon` tile, h1 `Bu link artık geçerli değil`, text `Linkin süresi dolmuş ya da hatalı kopyalanmış olabilir. Şefinden ya da yönetimden yeni bir link iste.` Secondary button `Giriş sayfasına git`. |
| Token already used | h1 `Bu link daha önce kullanılmış`, text `Şifreni zaten belirlediysen giriş yapabilirsin.`, primary `Giriş yap`. |
| Success | Create session, redirect to `/`, toast `Hoş geldin, Ayşe! Hesabın hazır.` |

Note for the developer: the token page must not log a logged-in manager out silently. If someone is already logged in as a different user, show a `FormAlert` (info variant, `bg-accent text-accent-foreground`): `Şu an Mert olarak giriş yapmışsın. Devam edersen bu hesaptan çıkılır.`

---

## 3. Password reset via link — `/sifre/[token]`

Same mechanism as the invite (the manager generates a link in the member sheet, §5). Same component as §2 with different copy:

- h1: `Yeni şifre belirle`
- Helper: `ayse@mail.com hesabı için yeni şifreni gir.`
- Fields: `Yeni şifre`, `Yeni şifre (tekrar)`
- Submit: `Şifremi güncelle` / pending `Güncelleniyor…`
- Success: all other sessions of the user are revoked; log in on this device; redirect `/`; toast `Şifren güncellendi.`
- Invalid/used: same blocks as §2.

If the dev prefers one route for both (`/davet/[token]` with a `purpose` on the invite row), fine; only the copy differs.

---

## 4. Members list — `/uyeler` (managers only)

### 375px layout
1. Page header row: h1 `Üyeler` (`text-4xl font-medium`) left; right `Button` `h-10 rounded-full px-4` with `UserPlus` icon + `Ekle`. Under the h1, `text-sm text-muted-foreground`: `48 aktif üye · 3 davet bekliyor`.
2. Sticky toolbar (`sticky top-[57px] z-20 -mx-4 bg-background/90 px-4 py-3 backdrop-blur-lg` so it docks under the mobile header; on `md` `top-0`):
   - Search `Input` with leading `Search` icon, `h-11 rounded-xl`, placeholder `İsim, e-posta ya da telefon ara`, `type="search"`, clear button when non-empty.
   - Filter chip row (horizontal scroll, `flex gap-2 overflow-x-auto`, no visible scrollbar): `Tümü 51`, `Soprano 16`, `Alto 14`, `Tenor 9`, `Bas 12`. Chip: `h-9 rounded-full border px-3.5 text-sm`; selected: `bg-primary text-primary-foreground border-transparent`; part chips carry their colour dot. Single-select.
   - `Tabs` (existing): `Aktif` / `Pasif` with counts. Default `Aktif`.
3. List grouped by voice part when the filter is `Tümü` (group header: eyebrow style `SOPRANO · 16`), alphabetical inside (Turkish collation: `Intl.Collator("tr")`). Members with no part go last under `PARTİSYON YOK`.
4. Row (`button`, full width, `min-h-16 px-4 py-3 flex items-center gap-3`, divided with `divide-y` inside a `rounded-2xl border bg-card`):
   - `Avatar size-10`, initials, fallback tint `bg-{part}/12 text-{part}-ink`.
   - Middle: name `text-sm font-medium` (truncate); second line `text-xs text-muted-foreground`: role if not Korist (`Koro şefi`, `Yönetim kurulu`) and/or phone.
   - Right: status chip only when not normal: `Davet bekliyor` (`bg-accent text-accent-foreground`), `Link süresi doldu` (`bg-destructive/10 text-destructive`). Then `ChevronRight` `text-muted-foreground`.
   - Tap → edit sheet (§5).

### md+ layout
Same header and toolbar (toolbar not sticky; search `max-w-xs` and chips on one row, tabs right-aligned). List becomes `Table` (existing) inside `rounded-2xl border bg-card`: columns `Ad soyad` (avatar + name), `Partisyon` (`VoicePartBadge`), `Rol`, `Telefon`, `Durum`, trailing `MoreHorizontal` menu (`Düzenle`, `Davet linki oluştur` / `Şifre sıfırlama linki`, `Pasifleştir`). Row click = `Düzenle`. No grouping in table view; sortable by name and part.

### Search behaviour
Client-side (≤ 60 rows). Normalise both sides with `toLocaleLowerCase("tr")` and fold diacritics (ç→c, ğ→g, ı→i, İ→i, ö→o, ş→s, ü→u) so `sukru` finds `Şükrü`. Match name, e-mail, phone digits.

### States
| State | UI |
|---|---|
| Loading | 6 skeleton rows: `size-10 rounded-full` + two bars `h-3 w-40` / `h-3 w-24`, `bg-muted animate-pulse`. |
| Empty (only the admin exists) | `EmptyState`: icon `Users`, title `Henüz kimse yok`, text `İlk koristi ekle, davet linkini WhatsApp'tan gönder.`, primary `Üye ekle`. |
| No results | Inside the list card: `“{q}” için sonuç yok.` + ghost `Filtreleri temizle`. |
| Pasif tab empty | `Pasif üye yok.` (`text-sm text-muted-foreground`, centred, `py-10`). |
| Error | `FormAlert`: `Üyeler yüklenemedi. Sayfayı yenile.` |
| Non-manager hits the URL | Server returns 404 or redirects to `/` (never render then hide). |

---

## 5. Add / edit member sheet

`Sheet side="bottom"` on mobile (`max-h-[92dvh] overflow-y-auto rounded-t-3xl px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]`, a 36×4 grab bar `mx-auto rounded-full bg-border`), `side="right"` from `md` with `sm:max-w-md`. Footer actions stick to the bottom of the sheet (`sticky bottom-0 bg-popover pt-3`).

### 5.1 Form (add and edit share it)
- Title: `Yeni üye` / edit: the member's name. Edit subtitle: `Ekleme: 3 Eylül 2026 · Son giriş: dün` (if tracked; otherwise just the date).
- `Ad soyad` (required) — `autoComplete="off"`, `autoCapitalize="words"`.
- `E-posta` (required, unique) — error: `Bu e-posta başka bir üyede kayıtlı.`
- `Telefon` (optional) — `type="tel" inputMode="tel"`, placeholder `05xx xxx xx xx`; store E.164 (`+905…`) so the WhatsApp deep link works. Error: `Telefon numarası geçersiz.`
- `Partisyon` — `VoicePartPicker`: 4 chips in a `grid grid-cols-4 gap-2`, each `h-11 rounded-xl border`, selected `border-{part} bg-{part}/12 text-{part}-ink font-medium`. Required when role is `Korist`; optional otherwise (the conductor may not sing a part). Error: `Partisyon seç.`
- `Rol` — `Select`: `Korist` (default), `Yönetim kurulu`, `Koro şefi`. Helper `text-xs text-muted-foreground`: `Şef ve yönetim kurulu üyeleri yoklama, üye ve repertuvarı yönetebilir.`
- Footer: primary `Kaydet ve davet linki oluştur` (add) / `Kaydet` (edit); ghost `Vazgeç`.

### 5.2 Edit-only sections (below the form, separated by `Separator`)
- **Giriş** section, eyebrow `GİRİŞ`:
  - Pending invite: text `Davet bekliyor · 14 Ekim'e kadar geçerli` + outline `Yeni davet linki oluştur`.
  - Expired invite: text `Davet linkinin süresi doldu.` + primary `Yeni davet linki oluştur`.
  - Has password: text `Hesap aktif.` + outline `Şifre sıfırlama linki oluştur`.
  - Generating a new link invalidates older unused links for that user (say so in the helper: `Eski link geçersiz olur.`).
- **Durum** section, eyebrow `DURUM`: `Button variant="destructive"` `Üyeyi pasifleştir` (active) / outline `Tekrar aktifleştir` (inactive). Pasifleştir opens `Dialog`: title `Ayşe Yılmaz pasifleştirilsin mi?`, text `Portala giremez ve yoklama listelerinde görünmez. Geçmiş devam kayıtları silinmez.`, actions `Pasifleştir` (destructive) / `Vazgeç`. Toast: `Ayşe pasifleştirildi.`
- Guards (server-enforced, UI disables with a helper line): you cannot deactivate yourself or change your own role (`Kendi rolünü değiştiremezsin.`); the last active conductor cannot be demoted or deactivated (`Koroda en az bir aktif şef olmalı.`). Who may assign `Koro şefi` — **PO decision** (suggest: only conductors).

### 5.3 Invite link step ("copy for WhatsApp")
After `Kaydet ve davet linki oluştur` succeeds (or `Yeni davet linki` / `Şifre sıfırlama linki` in edit), the sheet body swaps to `InviteLinkPanel` (same sheet, no new modal):

- Success icon tile `size-12 rounded-2xl bg-success/15 text-success` with `CircleCheck`.
- h2: `Davet linki hazır` / reset: `Sıfırlama linki hazır`
- Text: `Linki Ayşe'ye WhatsApp'tan gönder. 7 gün geçerli, tek kullanımlık.` (reset: `24 saat geçerli`) — expiry values are a **PO decision**.
- Message preview box, `rounded-xl bg-muted p-3.5 text-sm whitespace-pre-line`, exactly what will be copied:
  ```
  Merhaba Ayşe! Arkhe Mülkiye Çoksesli Korosu üye portalına davet edildin.
  Aşağıdaki linkten şifreni belirleyip giriş yapabilirsin (7 gün geçerli, tek kullanımlık):
  https://…/davet/AbC123…
  ```
  Reset message: `Merhaba Ayşe! Arkhe Portal şifreni yenilemek için bu linki kullan (24 saat geçerli, tek kullanımlık):` + link.
- Actions, stacked full width on mobile, `gap-2`:
  1. Primary `h-11 rounded-xl` `Copy` icon: `Mesajı kopyala` → after copy, label becomes `Kopyalandı` with `Check` icon for 2s, plus toast `Mesaj panoya kopyalandı.`
  2. Outline, only if a phone is stored: `MessageCircle` icon `WhatsApp'ta aç` → `https://wa.me/905XXXXXXXXX?text=<encoded message>` (free deep link, opens the chat directly). Without a phone: `https://wa.me/?text=…` (user picks the chat). Label stays the same.
  3. Ghost `Sadece linki kopyala`.
- Footer: `Bitti` (closes sheet; the list shows the member with `Davet bekliyor`).
- Clipboard fallback (old browsers / permission denied): show the link in a `readOnly` `Input` with text pre-selected and the hint `Linke basılı tut ve kopyala.`
- The raw token is shown only at this moment (only the hash is stored). Closing the panel loses it; the helper under the actions says: `Bu link bir daha gösterilmez; gerekirse yenisini oluşturursun.`

---

## 6. Profile — `/profil` (everyone)

Entry: `UserMenu` (header avatar on mobile, sidebar user block on md+) → `Profilim`. Not a bottom-nav tab.

### 375px layout
1. Identity header (no card): `Avatar size-16` (initials, part tint), name h1 `text-3xl`, then a row `VoicePartBadge` + role text `text-sm text-muted-foreground`. Role and part are read-only here with helper `text-xs`: `Partisyon ve rol değişikliği için yönetime yaz.`
2. Card `Bilgilerim` (eyebrow title): `Ad soyad`, `Telefon`, `E-posta` (disabled input, helper `E-postanı yönetim değiştirebilir.`). Button `Kaydet` (enabled only when dirty). Toast `Bilgilerin güncellendi.`
3. Card `Şifre değiştir`: `Mevcut şifre`, `Yeni şifre` (hint `En az 8 karakter.`), `Yeni şifre (tekrar)`. Button `Şifreyi değiştir`. Errors: `Mevcut şifre hatalı.`, `Şifreler eşleşmiyor.`, `Yeni şifre eskisiyle aynı olamaz.` On success: other sessions revoked, toast `Şifren değişti. Diğer cihazlardan çıkış yapıldı.`
4. `Çıkış yap`: full-width outline button `h-11 rounded-xl` with `LogOut` icon, at the bottom (`mt-10`). No confirmation.

### md+
Two columns `md:grid md:grid-cols-[280px_1fr] md:gap-10`: identity header left (sticky), cards right, `max-w-3xl`.

### States
- Loading: skeleton for the header + inputs.
- Saving: `SubmitButton` pending (`Kaydediliyor…`).
- Error: `FormAlert` at the top of the affected card: `Kaydedilemedi. Tekrar dene.`

---

## 7. Logout
From `UserMenu` or profile. Server action deletes the session, redirects to `/giris`, toast on the login page `Çıkış yaptın.`

## 8. Home in Phase 1
Real user name/part from the session; greeting by time of day. Attendance and repertoire cards still use mock data until Phases 2–3: keep the preview pill until then, and show the hero only in its `upcoming` state without `Geldim` (see review §1).

## Open questions for the PO
1. Invite link validity (suggest 7 days) and reset link validity (suggest 24 hours).
2. "Beni hatırla" checkbox vs. always-long sessions (suggest always 90 days; one less control for 60-year-olds).
3. Who may assign `Koro şefi` (suggest conductors only).
4. Do members see each other (a read-only choir directory)? Phase 1 assumes no; `/uyeler` is managers only.

---

## Frontend notes

From the frontend developer (see also `frontend-review.md` §2). Everything not listed here is feasible as specced.

**Counter-proposals**
1. **Add/edit member as pages, not a bottom sheet (§5).** `/uyeler/yeni` and `/uyeler/[id]`, same content and layout as the sheet body, `max-w-xl` on md+. Reasons: a 6-field form plus the invite panel in a `92dvh` bottom sheet fights the iOS keyboard (sticky sheet footer floats over it, inner scroll + body scroll lock), the Android back button leaves the page instead of closing the sheet, and an accidental swipe-down loses the one-time invite link. Pages also give deep links ("şu üyeye bak" on WhatsApp). The sticky footer becomes a page-level bar sitting above the bottom nav. A desktop right-side sheet can be added later with intercepting routes without changing the form.
2. **One route for invite and reset (§2/§3):** `/davet/[token]`. Copy switches on whether the user already has a password; expiry is stored per link, so 7 days vs 24 hours still works. No `/sifre/[token]`.
3. **Role picker as a 3-option segmented radio group** (`Korist` / `Yönetim kurulu` / `Koro şefi`), same pattern as `VoicePartPicker`, instead of `Select`. One tap instead of two, and no popover on mobile.
4. **E-mail on the profile (§6):** render as text + helper, not a `disabled` input (disabled inputs are skipped by keyboard/screen readers and fail contrast).
5. **Table on md+ (§4):** drop column sorting for Phase 1 (default alphabetical + part filter covers 60 rows). The whole row is a link via the name cell's stretched link, not `onClick` on `<tr>`. The row `MoreHorizontal` menu only offers `Düzenle` in Phase 1; link generation lives on the member page, where `InviteLinkPanel` has room.

**Feasibility comments**
- Toasts after a redirect (`Hoş geldin, Ayşe!`, `Şifren güncellendi.`, `Çıkış yaptın.`) need a flash mechanism: a 10-second cookie read by a small client component. Cheap; will do.
- "Keep e-mail, clear password, focus password" after a failed login: yes (`useActionState` returns the e-mail; focus via ref in an effect).
- "Inputs readOnly while pending": yes, from the `pending` flag.
- **Too many attempts** needs storage of failed attempts; in-memory counters don't work on serverless. Needs a small `login_attempts` table (email + time) — backend/schema addition, flagged.
- **`Son giriş: dün`** and **invite status chips** need data that isn't in the schema: `users.lastLoginAt` (new column, set on login) and the latest unused invite per user (derivable from `invites`). Fine, but the first is a schema change.
- Sticky toolbar `top-[57px]` (§4): will use a `--header-h` CSS variable plus `env(safe-area-inset-top)` instead of a magic number, because the installed iOS PWA adds the status bar height.
- Client-side search with Turkish diacritic folding: yes; the list is a client component receiving a DTO array (no e-mail/phone leaves the server for non-managers, since the page is managers only).
- `Kaydet` enabled only when dirty (§6): yes, a small client check against initial values.
- "Logged in as someone else" warning on the token page: yes, the server knows the current session.
- `Checkbox` for "Beni hatırla": not needed if the PO picks always-long sessions (I agree with that suggestion).
- Brand: the real logo in `brand/` is an uppercase striped sans ("ARKHE / MÜLKİYE ÇOKSESLİ KOROSU"), not the current lowercase Fraunces wordmark, and all files are 387–547px. `AuthShell`'s photo panel needs ≥1440px-wide photos and an SVG logo — asked in `frontend-review.md` §6.
