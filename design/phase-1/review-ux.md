# Phase 1 UX review (auth, members, profile)

Reviewed 2026-10-17 against http://127.0.0.1:3100, checked against `phase1-screens.md` (with the frontend counter-proposals, which I accept: pages instead of a sheet, one `/davet/[token]` route, role as a chip group, e-mail as text on the profile) and `review-phase0.md`.

I logged in as `sef@`, `yk@` and `korist@arkhe.local` and walked `/giris` (empty, wrong password), `/davet/<token>` (valid, field errors, invalid token), `/uyeler`, `/uyeler/yeni` (empty, errors, invite panel), `/uyeler/[id]` (pending invite), `/profil` and the shell. Each was captured at 390px (`isMobile`, DPR 2) and 1280px, in light and dark. Screenshots are in the session scratchpad (`team/ux/p1/*.png`), not the repo. The test member is `E2E Ayşe Yılmaz` with an `@e2e.test` address. Browser console: no errors, apart from Playwright's caret-color hydration noise. The red "1 Issue" dev badge seen in screenshots comes from that warning.

Overall the phase is in good shape. The flows work end to end. Copy is Turkish, short and friendly. Both themes hold up, the chip-based radio groups are easy to tap, and the invite → WhatsApp → set-password loop takes three taps for the manager. What remains is three gaps that will cause real-world trouble on the first invite wave, and a list of polish items.

---

## P1

### 1. A chorister can be created without a voice part, and "Yok" is the default
`src/app/(portal)/uyeler/member-form.tsx:86-95`, `src/lib/validation.ts:34`. The `Partisyon` group starts on `Yok` and the server accepts `""` for every role. A manager adding people quickly from a phone will leave most of them with no part. Phase 2 attendance-by-section and Phase 3 "your part's MIDI" both depend on this field, and a chorister with no part sees no part files at all.
Fix:
- No default for new members: `defaultValue={v?.voicePart ?? member?.voicePart ?? undefined}`, with no chip pre-checked.
- Show the `Yok` option only when the selected role is not `member` (client state on the role group), or keep it visible but disabled for `Korist`, with the helper `Koristler için partisyon zorunlu.`
- Server: in the member schema, add a `superRefine` that, when `role === "member"` and `voicePart` is null, returns the error `Partisyon seç.` on `voicePart`.

### 2. The invite page never tells the invitee which e-mail is their login
`src/app/davet/[token]/page.tsx:46-52`. The invite heading only says `Arkhe Portal'a girmek için kendine bir şifre belirle.` The WhatsApp message carries no e-mail either (`invite-link-panel.tsx:22-25`). After setting a password the person is logged in. When the session ends, or they open the portal on another device, they don't know which address to type. The manager may have entered a work address or one with a typo. For 30–60-year-old members this becomes a support call on day one.
Fix (spec §2):
- Helper text: `Portala girmek için bir şifre belirle. Giriş e-postan: {email}`, with the address in `font-medium text-foreground`.
- Put the identity line above the h1: `VoicePartBadge` + `text-sm text-muted-foreground` name, e.g. `● Alto · Ayşe Yılmaz`, so the person knows the link is theirs.
- Add the address to the WhatsApp message too: `… giriş yapabilirsin. Giriş e-postan: {email}\n{url}`.

### 3. Home still shows a dead `Geldim` button with a QR icon (carried over from review-phase0 P1 §1)
`src/app/(portal)/page.tsx:78-93`. Real members now log in, and the first thing they see is a gold `Geldim` button. It does nothing, and its `QrCode` icon suggests scanning. `Gelemeyeceğim` is also dead. The "örnek veri" pill doesn't excuse a primary button that looks live.
Fix: until Phase 2, render the hero only in its `upcoming` state with no actions. If you want to keep the visual weight, replace the buttons with a one-line footnote, `text-sm text-stage-foreground/60`: `Yoklama yakında buradan alınacak.` When Phase 2 lands, use the `RehearsalHero` states from review-phase0 §1, with a `Check` icon and no `QrCode`.

---

## P2

4. **"Davet bekliyor" is hidden on phones.** `uyeler/page.tsx:127` uses `hidden … sm:inline`. Managers mostly work from a phone, and "who hasn't joined yet" is the main thing they check this phase.
   - Show the chip on mobile, and move the email line's place to it: second line `Davet bekliyor · ayse@…` with `Davet bekliyor` in `text-accent-foreground font-medium`.
   - Or drop the voice badge to a coloured dot (`size-2 rounded-full bg-{part}`) on `<sm` to make room for the chip.
   - Add a count under the h1: `24 aktif üye · 5 davet bekliyor` (spec §4).

5. **Turkish sort order is wrong.** `uyeler/page.tsx:35` uses `orderBy(asc(users.name))`, which is binary SQLite order. `İrem Şahin` lands after `Zeynep`, and `Demo Yönetim` sorts before `Demo Şef`. Fix: sort in JS with `new Intl.Collator("tr").compare` after the query (60 rows).

6. **Search doesn't fold diacritics or Turkish I.** `?q=IREM` finds nothing, because `toLocaleLowerCase("tr")` gives `ırem`, and `sukru` wouldn't find `Şükrü`.
   - Fold both sides as spec §4 says: ç→c, ğ→g, ı/İ/I→i, ö→o, ş→s, ü→u.
   - Include phone digits in the match.
   - The placeholder can then say `İsim, e-posta ya da telefon ara`.
   - Search submits only on Enter. That's acceptable, but add `type="search"` and `enterKeyHint="search"` so the phone keyboard shows "Ara".

7. **WhatsApp button ignores the stored phone.** `invite-link-panel.tsx:52` always opens `https://wa.me/?text=…`, so the manager has to search for the contact.
   - Pass the phone to the panel and, when it exists, link to `https://wa.me/90XXXXXXXXXX?text=…`.
   - Phones are stored as typed (`0532 123 45 67`, seen on the edit page). Normalise to E.164 on save (`+905321234567`), and display with `formatPhone` in the UI.

8. **No warning that the link is shown only once.** In the invite panel, after the buttons, add a `text-xs text-muted-foreground` line: `Bu link bir daha gösterilmez; gerekirse yenisini oluşturursun.` (spec §5.3). Also, `Mesajı kopyala` swaps its icon to `Check` but keeps its label. Change the label to `Kopyalandı` for 2 s too: icon-only feedback is easy to miss outdoors.

9. **Deactivation uses native `confirm()`.** `uyeler/[id]/member-access.tsx:33`. The native dialog reads "127.0.0.1:3100 diyor ki…", has OK/Cancel in the system language, and looks alarming. Use the existing `Dialog`:
   - Title: `{name} pasifleştirilsin mi?`
   - Text: `Portala giremez, açık oturumları kapanır. Geçmiş devam kayıtları silinmez.`
   - Actions: `Pasifleştir` (destructive) / `Vazgeç`.

10. **Selected chip state is too faint in light mode.** `components/forms/choice-group.tsx:32` uses `has-checked:bg-primary/8 has-checked:border-primary`. In the screenshots the selected `Alto`/`Korist` is barely distinguishable from the rest.
    - Use `has-checked:bg-primary has-checked:text-primary-foreground has-checked:border-transparent`, the same as the list filter chips, so one "selected" language is used everywhere.
    - Part chips may keep their dot. Alternatively use the per-part tint from spec §5.1 (`bg-{part}/12 text-{part}-ink border-{part}`).
    - Add a `Check` icon (`size-4`) to the checked chip so selection isn't carried by colour alone.

11. **Disabled `Koro şefi` has no explanation for board members.** Under the role group, when it is disabled, add `text-xs text-muted-foreground`: `Koro şefi rolünü sadece şef verebilir.` Also add `aria-disabled` context, so the label alone doesn't look broken.

12. **No show/hide toggle on any password field** (login, invite, profile). Spec §0 `PasswordInput`. This matters for this audience typing 8+ characters on a phone keyboard. Add a trailing 44×44 ghost icon button, `Eye`/`EyeOff`, with `aria-label` `Şifreyi göster` / `Şifreyi gizle`. One component, used in three forms.

13. **Mobile auth layout is vertically centred, with ~200px of empty space above the logo.** `components/auth-layout.tsx:15`. Spec §1 and review-phase0 §8 asked for a top stage band, `h-36 rounded-b-3xl bg-stage on-stage staff-lines`, with the logo at bottom-left and a top-aligned form (`pt-8`). On a real phone, the centred form gets pushed under the keyboard. Minimum fix: `justify-start pt-16 md:justify-center` on `<main>`.

14. **Login error alert has no icon.** The `FormAlert` spec includes `CircleAlert`. Red text alone relies on colour. Add the icon at `size-4 shrink-0`.

15. **Members list isn't grouped by part under `Tümü`.** Spec §4 asks for group headers (`SOPRANO · 6`) on mobile. With a filter chip one tap away, this is optional. If skipped, at least sort by part, then by name, so the list mirrors the choir's seating. I'd accept either.

## P3

16. **Profile `Kaydet` is always enabled.** Spec: enable it only when the form is dirty. Low risk.
17. **Profile `Çıkış yap` is a ghost link-sized button.** `profil/page.tsx:49`. Spec: full-width outline `h-11 rounded-xl`. It is the only logout on mobile, because the header avatar goes straight to `/profil` and has no menu. I'm fine with avatar → profile instead of a dropdown, but make the button obvious.
18. **Avatars use neutral grey (light) and gold (dark) initials.** Spec: part tint `bg-{part}/12 text-{part}-ink`. That gives a quick visual scan by section in the list.
19. **Invalid-link page's `Giriş sayfasına dön` is a text link with about a 20px tap height.** Make it `Button variant="outline" h-11 rounded-xl w-full`.
20. **Invite greeting uses the first word of the name.** `Hoş geldin, E2E` is fine for real names. Nothing to do unless people get entered as `Dr. …`.
21. **Desktop light auth panel: the staff stave is invisible.** It is visible in dark. This is the `--staff-line` / `.on-stage` fix from review-phase0 §5, which is not yet applied to `AuthLayout`.
22. **Pasif is a chip next to the voice parts**, where the spec had separate tabs. That's acceptable. Give it a visual gap, e.g. `ml-2` or a `border-l` separator, so it doesn't read as a fifth voice part.

## Not verified
- "Logged in as someone else" warning on `/davet/<token>` (spec §2 note).
- Rate-limit copy.
- Expired-link (as opposed to invalid-link) state.

The e2e suite covers the rate limit functionally.

## Keep
- One `/davet/[token]` route for invite and reset, with purpose-specific copy.
- The add form flowing into the invite panel on the same page (no modal): `Bir üye daha ekle` / `Üye listesine dön` is a good loop for adding many people.
- Field errors under fields with `aria-invalid` rings, and values kept after server errors.
- `Kaydediliyor…` pending labels.
- The member nav hides `Üyeler`, and `/uyeler` redirects for non-managers.
- Dark mode: gold primary on indigo-black reads well, and chips and badges hold contrast.
