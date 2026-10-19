# Phase 3 — UI engineering plan (repertoire + Drive links)

Author: arkhe-ui-engineer. Inputs: `po-spec.md`, Phase 2 `ui.md`, current code (`/uyeler` list pattern, `Field`/`ChoiceGroup`/`useFocusError`, `next.config.ts`). `ux.md` and `db.md` arrived while I was writing. §1–12 already follow them where we agree, and §13 replies to them. `backend.md` doesn't exist yet. Checked against the bundled Next 16.4.2 docs (`02-guides/videos.md`, `forms.md`, `server-actions.md`, `preserving-ui-state.md`, `content-security-policy.md`).

## 0. Principles

- Server Components by default. The client islands are: the `Partisyonum` chooser (only when a piece has more than one candidate file), the preview toggle, the piece form, the links editor and the bulk paste table. Lists, detail and the programme are server-rendered HTML.
- **No new runtime dependencies.** No MIDI player, no Drive SDK, no YouTube iframe API script.
- `cacheComponents` is off, so the Activity-based state preservation in `preserving-ui-state.md` doesn't apply. Leaving the page unmounts an open preview, which also stops a playing video. No cleanup code is needed.
- One isomorphic module, `src/lib/links.ts` (owned by @backend, with no `server-only` import), is used by the forms, the bulk preview, the actions and the renderer. The UI never parses URLs on its own.

## 1. Routes and component map

```
src/app/(portal)/repertuvar/
  page.tsx                server: search + list chips (?q=, ?liste=), rows, programme view
  loading.tsx             skeleton rows (list + detail share it)
  actions.ts              @backend: all writes, assertManager() first
  yeni/page.tsx           requireManager(); <PieceForm> → redirect to [id]/duzenle#baglantilar
  [id]/page.tsx           server: header, notes, part filter (?partisyon=), grouped links, manager menu
  [id]/duzenle/page.tsx   requireManager(); <PieceForm> + <LinksEditor> + <BulkPaste>
src/components/repertoire/
  piece-row.tsx           server; title link (flex-1) + sibling <PartButton>
  back-link.tsx           client; returns to the last list URL (sessionStorage), else /repertuvar
  piece-meta.tsx          server; composer line + language/voicing/duration chips
  part-button.tsx         server; 0 → disabled, 1 → <a>, n → <PartChooser>
  part-chooser.tsx        client; one base-ui Dialog, bottom sheet < md / centred dialog ≥ md (CSS only)
  link-groups.tsx         server; sections per kind, rows
  link-preview.tsx        client; Önizle toggle + lazy iframe panel
  preview-group.tsx       client; context so only one preview is open at a time
  piece-form.tsx          client; useActionState, Field, ChoiceGroup, datalist, textarea
  links-editor.tsx        client; add one link, rows with edit/up/down/delete
  bulk-paste.tsx          client; textarea → local parse → editable table → one save action
  program-list.tsx        server <ol>; manager rows get <MoveButtons>
  move-buttons.tsx        client; up/down form buttons + focus restore + live announcement
  confirm-dialog.tsx      client; AlertDialog wrapper around a form action (delete, clear programme)
src/lib/labels.ts         + PIECE_STATUS_LABELS, LINK_KIND_LABELS (singular + group plural)
src/lib/format.ts         + formatDuration(sec) "3:40", parseDuration("3:40" | "3.40" | "3,40" | "340")
```

**`yeni` vs `duzenle`:** links need a piece id, so the `yeni` page is only the piece form. On success it redirects to `/repertuvar/<id>/duzenle#baglantilar` with the links editor focused (the `Bağlantılar` heading gets `tabIndex=-1` and focus on mount when the hash matches). This avoids holding unsaved links in client state across a create (same flow as ux.md §0).

### shadcn components to add
- `npx shadcn@latest add textarea alert-dialog`. The textarea is for notes and bulk paste. `alert-dialog` gives `role="alertdialog"` for delete / `Programı temizle` / delete link. The existing `Dialog` is the wrong role for destructive confirms, and `window.confirm()` is not used (it can't be styled and blocks e2e).
- **Not** added: `select`/`combobox` for kind/part inside the bulk table. Native `<select>` (styled with the `Input` classes, `h-11`) is 0 KB, gives the native iOS/Android picker, and stays cheap with 50 rows × 2 selects. The existing base-ui `Select` stays for single fields if @ux wants it. Language/voicing suggestions use a native `<datalist>`: the field stays free text, as the spec requires.
- Already present and reused: `dropdown-menu` (manager overflow menus), `dialog`/`sheet` primitives (chooser), `badge`, `button`, `card`, `input`, `label`, `separator`, `sonner` (toast after save/reorder).

## 2. List `/repertuvar`

- **URL state** (GET form + links, same as `/uyeler` and `/raporlar`, so back/forward and shared links work with zero JS):
  - `?q=` search, trimmed, ≤ 80 chars.
  - `?liste=program|hazir|arsiv|tumu` (ux.md naming). Absent or unknown = `Çalışılıyor`. With `q` set, the search spans **all statuses** (ux.md §0), so chips link without `q`, none is `aria-current`, and each row shows its status chip.
- **Search:** reuse `searchKey()` from `src/lib/format.ts` (tr lower-case, NFD, strip marks, `ı→i`). Filtering happens in memory on the server over `searchKey(\`${title} ${composer} ${arranger}\`)`. A choir has at most a few hundred pieces, so no SQL `LIKE` or FTS. `gulum` finds `Gülüm` and `IREM` finds `İrem`, the same behaviour as `/uyeler`. Submitting on Enter is enough (`type="search"`, consistent with `/uyeler`, no client JS). Empty state `Eşleşen eser yok.` + `Aramayı temizle`.
- **Queries:** one for the pieces, plus one `inArray(pieceId, shownIds)` for `kind = 'part'` links (only the columns the button needs). No N+1. Sort by `collator.compare(title)`. The programme view sorts by `programPosition`.
- **Row** (`<li>`, ux.md §2.2): the left block is a `Link` (`flex-1 min-w-0`), and `PartButton` is a sibling, so no interactive elements are nested and the button keeps its own 44 px target. The meta line and chips come from `piece-meta.tsx`. Duration is `tabular-nums`. Chips wrap, and the title `line-clamp-2` (no truncation for long Latin titles at 375 px).
- **Programme view:** an `<ol>` (screen readers get the order from it) with `aria-hidden` visual ordinals (row index + 1, since db.md allows gaps). In `Sırayı düzenle` mode, managers get `MoveButtons` + `Programdan çıkar` per row and `Programı temizle` (AlertDialog).
- **`BackLink`:** our `Referrer-Policy: no-referrer` leaves `document.referrer` empty, so a referrer check can't drive `history.back()`. Instead, a tiny client component on the list writes `location.pathname + search` to `sessionStorage` (`arkhe:repertoire-list`). `BackLink` renders `href="/repertuvar"` on the server and swaps in the stored URL after mount. No `?geri=` on detail URLs, so Phase 4 links stay clean.
- Managers see `Eser ekle` (same button style as `Üye ekle`). Members never get these controls rendered; the actions still check on the server.

## 3. `Partisyonum`

Resolution is a pure helper in `links.ts`: `partFilesFor(links, voicePart)` → part links with `voicePart === mine`, else those with `voicePart === null` (Tutti), ordered by `position`. `PartButton` (server) renders:

| Candidates | Render |
|---|---|
| user has no voice part | nothing (see @po Q2 below) |
| 0 | `<Button disabled variant="outline">Partisyon kaydı yok</Button>` (a real disabled `<button>`, so AC 5 can assert `toBeDisabled()`) |
| 1 | `<a href={url} target="_blank" rel="noopener noreferrer">`, styled with `buttonVariants`. Text: `Partisyonum`, an `ArrowUpRight` icon, and `<span class="sr-only">: {title}, yeni sekmede açılır</span>` |
| ≥ 2 | `<PartChooser>`: trigger `button` (`aria-haspopup="dialog"`, `ChevronDown`) → base-ui Dialog: title = piece title, description `Soprano partisyon kayıtları`, `<a target=_blank rel=…>` rows `min-h-14` that also close it on click, footer `Eserin tüm bağlantıları` + `Kapat` (ux.md §3.3) |

- **Accessible name:** the visible `Partisyonum` + sr-only title meets WCAG 2.5.3 (label in name) and makes the 20 `Partisyonum` buttons in a list distinguishable. I don't use `aria-label`, because it would hide the visible text from voice control.
- **Sheet vs dialog without JS media queries:** `Sheet` and `Dialog` are both base-ui `Dialog`. I render **one** `Dialog.Popup` whose classes switch at `md` (`fixed inset-x-0 bottom-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)]` → `md:inset-auto md:top-1/2 md:left-1/2 md:-translate-1/2 md:max-w-sm md:rounded-2xl`). There's no `useMediaQuery`, so no hydration flash, and both are already in the bundle. Focus goes to the first link on open and back to the trigger on close.
- `href` is always the normalised `…/view` or `watch?v=` URL (AC 4). The Drive app intercepts it on Android/iOS. Inside a home-screen PWA, `_blank` opens the system browser/app, which is what we want.

## 4. Detail `/repertuvar/[id]`

- `?partisyon=` holds the filter: absent = my part (if I have one, else all), `tumu` = all, `soprano|alto|tenor|bass` = that part. The explicit part values are for Phase 4 homework links (`?partisyon=alto`) and let a soprano check the bass line. Chips are links with `aria-current`, matching `FilterChip` in `/uyeler`. Label: `Benim partisyonum (Alto)` · `Tümü`. A non-own part only shows as a third chip when it's in the URL.
- The filter applies to `part` **and** any other kind with a non-null `voicePart` (e.g. an alto-only score). Tutti always shows. Kinds that end up with no visible rows are omitted, and if everything is filtered out: `Bu partisyon için bağlantı yok. Tümünü göster` (link).
- Groups: `<section aria-labelledby>` with an `h2` per kind, in the order Nota, Partisyon kayıtları, Referans kayıt, Video, Diğer, then the `Drive klasörü` row (folder). Row: label (derived `<Kind> · <Part>` when empty), `VoicePartBadge` or a `Tutti` badge, `Aç` (external `<a>`, `min-h-11`, sr-only `: {label}, yeni sekmede açılır`) and `Önizle` when `embedUrl(link)` is non-null.
- Header per ux.md §4.1: `BackLink`, status + `Programda {n}. sıra` chips, `h1`, the composer/arranger lines, meta chips, the full-width `Partisyonumu aç (Alto)` (same `PartButton` with a `size="lg"` variant) and notes as `whitespace-pre-line` text (no markdown, no HTML). Managers get the edit icon button + the overflow menu (`Programa ekle`/`Programdan çıkar`, `Arşivle`/`Arşivden çıkar`). `Sil` lives only in the edit page's danger zone.
- `generateMetadata` → `title: piece.title`. Unknown id → `notFound()`.

## 5. Lazy preview (`link-preview.tsx`)

```
<LinkPreview id label embedUrl kind openUrl />
  button  aria-expanded aria-controls={panelId}  "Önizle" + ChevronDown (rotates)
  {open && <div id={panelId} role="region" aria-label="{label} önizlemesi">
     <div class="relative {ratio} w-full overflow-hidden rounded-xl bg-muted">
       <iframe …/>   (skeleton behind it until onLoad)
     </div>
     <p class="text-xs text-muted-foreground">Önizleme açılmıyorsa … <a>Drive'da aç</a></p>
  </div>}
```

- **No iframe in the DOM until it's toggled** (conditional render, not `hidden`/`display:none`), which satisfies AC 7's "no iframe before". Closing unmounts it, which stops audio/video. `PreviewGroup` context keeps **one preview open at a time**: two Drive players on a phone are heavy and can play over each other. Opening another one closes the first.
- Focus stays on the toggle. The iframe gets `title="{label} önizlemesi"`.
- Attributes:

| | Drive file | Drive folder | YouTube |
|---|---|---|---|
| `src` | `…/file/d/<ID>/preview` | `…/embeddedfolderview?id=<ID>#list` | `https://www.youtube-nocookie.com/embed/<ID>` |
| `sandbox` | `allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox` | same | same + `allow-presentation` |
| `allow` | `autoplay; fullscreen` | none | `autoplay; encrypted-media; picture-in-picture; fullscreen` |
| `referrerPolicy` | `strict-origin-when-cross-origin` (ux.md; one policy for all three, sends the origin only) | same | same (**required**, see below) |
| `loading` | `lazy` | `lazy` | `lazy` |
| box | score/other: `aspect-[3/4] max-h-[75dvh]`; part/recording: `aspect-video` | `h-96` | `aspect-video` |

- **Sandbox.** `allow-scripts` + `allow-same-origin` is safe here because the frame is cross-origin. Both viewers need their own cookies/scripts. `allow-popups(-to-escape-sandbox)` lets Drive's "open in new window" and folder links work normally. No `allow-top-navigation` and no `allow-forms`.
- **YouTube referrer.** Since 2025 YouTube refuses embeds that send no `Referer` (player error 153). Our global `Referrer-Policy: no-referrer` (kept for invite tokens) would break the video, so the iframes override it to send the origin. Repertoire URLs carry no secrets. @tech lead: e2e can't check this (no Google), so it needs one manual check on a real device.
- **Ratios.** @po: the spec says 4:3 for files, but a portrait A4 score in a 4:3 box at 375 px is a thumbnail. Same as ux.md: 3:4 capped at 75dvh, frame `max-w-2xl mx-auto` from `md`. Audio files (part/recording) use 16:9, because Drive's audio player is a short bar and a tall box would be wasted.
- `loading="lazy"` is kept as the spec asks, but it's effectively a no-op: the iframe appears in the viewport on tap. The real lazy part is that the iframe doesn't exist until tapped. A centred `Loader2 motion-safe:animate-spin` on `bg-muted` sits behind the iframe and is removed on `onLoad`.
- `Önizle` appears on every Drive file, Drive folder and YouTube link, including part files: MP3 renders play in Drive's preview, and a MIDI shows Drive's "can't preview" page plus our fallback. `Aç` stays the primary action. The toggle is `Eye` `Önizle` / `EyeOff` `Kapat` + `aria-expanded` (ux.md §4.3).

## 6. Bulk paste (`bulk-paste.tsx`)

**Decision: parse on the client and save once through a Server Action. No server round trip for `Önizle`.** @po §3.6 says "the server parses". The parser (`parseBulk(lines, { existingUrls, folderEmpty })`) is the isomorphic `links.ts` code, so the result is identical, appears instantly, works on a flaky phone connection and costs no request. The server re-runs the same parser and validation on save and is authoritative.

- State: `useReducer` over `rows: { key, line, label, kind, voicePart, url, error | null }[]`, at most 50 (line 51+ → a form-level message `En fazla 50 satır yapıştırabilirsin.`). The textarea is uncontrolled. `Önizle` replaces `rows`. Editing the table never re-parses the textarea, so edits aren't lost.
- Row edits: label `Input`, and kind and part as native `<select>`. Invalid rows show the raw line + error and have no inputs (ux.md: fix the text, `Metne dön`, `Önizle` again). They're excluded from the count. `Kaydet ({n} bağlantı)` is derived (AC 13). A per-row `Kaldır` button (44 px, `aria-label="{n}. satırı kaldır"`).
- Duplicates are checked against `existingUrls` (passed in by the server page) and within the batch, which shows `Bu bağlantı bu eserde zaten var.` already in the preview.
- The folder rule: a folder URL with no kind word is shown as kind `Drive klasörü` (an extra option, only offered for folder URLs, and only while the piece's `driveFolderUrl` is empty). On save it sets `driveFolderUrl`.
- Save: a `<form action={formAction}>` with `useActionState`. A hidden `<input name="rows" value={JSON.stringify(validRows)}>` holds `{label,kind,voicePart,url}[]`. The server: `assertManager()`, Zod (≤ 50, url ≤ 2000), re-normalise, dedupe against the DB, then **one transaction**. If any row fails on the server (race: someone else added the URL), it saves nothing and returns `{ rowErrors: Record<index, string> }`. The table marks those rows and keeps the rest, so the user removes them and saves again. On success: a toast `5 bağlantı eklendi`, `revalidatePath`, a reset (`rows = []`, textarea cleared) and focus on the links list heading.
- Layout: a real `<table>` from `md` (`th scope="col"`). Under `md`, each row is a stacked card as in ux.md §6.3. Both are rendered from the same `rows` with a CSS switch (`md:hidden` / `hidden md:table`); the hidden copy's inputs are not `name`d, so only the JSON field is submitted. That meets AC 20 (no horizontal scroll at 375 px). The sticky save bar has no `backdrop-blur` on old phones: use `bg-background` (opaque) instead of `/90`.
- a11y: status per row is text (`Geçerli` / error), not colour only. The `Önizle` result is announced in a `role="status"` line: `6 satırdan 5'i geçerli, 1 hatalı.` Each select has a visually-hidden label that includes the row number (`3. satır türü`).

## 7. Links editor, reorder, programme

- Add one link: `Field` URL (`type="url" inputMode="url" autoComplete="off"`), kind/part chips via `ChoiceGroup` (kind is guessed from the URL on blur and stays editable), optional label. `useActionState` + `useFocusError`, field error `Geçerli bir https bağlantısı gir.` The Drive sharing hint sits under the URL field as the `hint`: `Drive dosyası "Bağlantıya sahip olan herkes" ile paylaşılmış olmalı.` Under the part kind, the MP3 nudge: `MIDI'ler telefonda çalmaz; mümkünse MP3'e çevirip yükle.`
- Rows: inline edit (label/kind/part) in a disclosure per row, `Yukarı`/`Aşağı`/`Sil`. `MoveButtons` are tiny `<form action>`s (they work before hydration), each with `aria-label="{label}: yukarı taşı"`. The first row's up and the last row's down are `disabled`.
- **Focus after a move:** React moving a keyed DOM node can drop focus in Safari. After the action resolves, `MoveButtons` focuses `[data-row="{id}"] [data-move="{dir}"]`, or the other direction if it's now at the edge. A shared `aria-live="polite"` line announces `"{label}" 2. sıraya taşındı.` The same component is used for programme order (`{title} programda 2. sırada.`).
- Delete link / delete piece / clear programme go through `ConfirmDialog` (AlertDialog). The cancel button is focused by default, and focus returns to the trigger on cancel. After a piece delete → `redirect("/repertuvar")` + toast.
- Optimistic reorder (ux.md): `useOptimistic` over the ordered id list inside `startTransition(() => moveAction(id, dir))`. The swap shows immediately, and if the action fails the list reverts on its own, with a toast `Sıra kaydedilemedi.` Moves are serialised (Server Actions are queued), so fast double-taps stay consistent.

## 8. Piece form (`piece-form.tsx`)

- `Field`s: Eser adı (required, `maxLength=120`), Besteci, Düzenleyen, Dil (`list="languages"` datalist), Ses dağılımı (`list="voicings"`, `maxLength=20`, `autoCapitalize="characters"`), Süre, Drive klasörü (`type="url"`), Notlar (`Textarea`, `maxLength=1000`, a live `n/1000` counter tied to the field through `aria-describedby`, `aria-live` only past 900). Status uses `ChoiceGroup` with `Çalışılıyor` / `Hazır` / `Arşiv` with ux.md's one-line descriptions as option hints.
- **Duration:** iOS numeric keypads have no colon, so it's `inputMode="decimal"` (it gives a `.`/`,` key), `placeholder="3:40"`, `pattern` left off. `parseDuration` accepts `3:40`, `3.40`, `3,40` and `340` and returns seconds or the error `Süreyi dakika:saniye olarak gir (ör. 3:40).` The form re-displays the normalised value. Max 59:59.
- Errors from `fieldErrorsOf` (existing `FormState`). `Eser adı gerekli.` is the message for an empty title.

## 9. Home card

- Replace `previewPieces`: a server query (`learning`, title order, limit 5) + the same `partFilesFor` helper. Each row: title link to `/repertuvar/<id>`, composer line, `PartButton` (compact size, still 44 px). Remove the `Örnek veri` pill and the `previewPieces` export from `src/lib/preview-data.ts`. Empty state: `Şu an çalışılan eser yok.` + (manager) `Eser ekle`.

## 10. CSP (`next.config.ts`)

`"frame-src https://drive.google.com https://www.youtube-nocookie.com"`, and nothing else. Nested frames inside the YouTube player are governed by YouTube's own policy, not ours. Note: when a Drive file isn't shared, Drive redirects the frame to `accounts.google.com`, which our CSP blocks. The user then sees the browser's blocked-frame page, which is exactly the case our fallback line covers. Don't widen `frame-src` to fix that. `Permissions-Policy` doesn't restrict `fullscreen`/`autoplay` (their default allowlist is `self`, and the `allow` attribute delegates), so it needs no change.

## 11. Accessibility checklist (my review gate)

- Targets ≥ 44 px: `Partisyonum`, `Aç`, `Önizle`, chips (`min-h-11` on the new chips; `/uyeler` chips are `min-h-9`. @ux: align them up, not down), menu items, move/delete icon buttons, bulk table controls.
- Inputs use a 16 px font on phones (`text-base md:text-sm`), so iOS doesn't zoom.
- External links say they open a new tab (sr-only), and the icon is `aria-hidden`.
- Status and part are never colour-only: the part badge has text, the status pill has text, and bulk row status is text.
- Headings: `h1` page, `h2` per link group / section, so a screen reader can jump to `Partisyon kayıtları`.
- Focus is visible everywhere (the `ring-3 ring-ring/50` pattern), including the row link (`focus-visible:ring-inset`, so the ring isn't clipped by `overflow-hidden`).
- Both themes: only existing tokens (ux.md §1). The iframe frame uses `ring-1 ring-border` (Drive/YouTube are light/black inside; no theming possible). In my review I check contrast for `bg-accent text-accent-foreground` (`Çalışılıyor`) and `bg-gold/20 text-foreground` (programme chip) in dark mode.
- `prefers-reduced-motion`: no skeleton pulse and no chevron rotation transition.

## 12. Performance

- List, detail, programme and home ship **no new client JS** apart from `PartChooser` (base-ui Dialog is already in the shared bundle) and `LinkPreview` (~1 KB). The editor islands only load on `duzenle`, which route-level splitting handles. No `next/dynamic` needed.
- Third-party cost is zero until a tap: no Drive/YouTube requests on page load (no thumbnails, no `preconnect`). A `preconnect` hint on the first `Önizle` hover/focus is a possible micro-optimisation; not now.
- Default `Link` prefetch. No `prefetch={true}` on 60 rows.
- Add `repertuvar/loading.tsx` (skeleton rows) so the tab switch and the detail navigation paint immediately. Phase 2 asked for `(portal)/loading.tsx` and it still doesn't exist; @tech lead: worth adding now.

## 13. Replies

**@po**
- **Q5 (Drive sharing failures):** @po: the iframe error **cannot** be detected. A cross-origin frame fires `load` for Drive's "You need access" page as well as for the real preview. There's no `error` event for HTTP or framing failures, and we can't read its document. Timeouts guess wrong on slow phones. On top of that, Safari (and Chrome's third-party-cookie phase-out) don't send Google cookies into the iframe, so "shared with my account" files fail there even when they work in a tab. Conclusion: only "Bağlantıya sahip olan herkes" sharing previews reliably. Agree with help text + the fallback line, shown **always** under an open preview (not on error), with the `Drive'da aç` link right there. I'd also put the sharing hint in the add form and the bulk paste intro (§7).
- **Q6 (Docs/Sheets preview):** @po: agree, **not now**. Docs/Sheets/Slides are text documents that read better in the Docs app/tab (`Aç`). Embedding needs `/preview` URLs, `frame-src https://docs.google.com` and has the same sharing/cookie failure as Q5, for little gain on a phone. It's a one-line CSP + `embedUrl` change later if lyrics docs turn out to be used a lot.
- Q2 (no voice part): agree with @ux: **hide** `Partisyonum` for users without a part, and default their detail filter to `Tümü`. The disabled `Partisyon kaydı yok` stays for singers whose part has no file (AC 5).
- §3.6: preview parsing runs on the client with the shared parser, and the server is authoritative on save (§6). The behaviour and ACs are unchanged.
- §4 aspect ratio: 3:4 for scores on phones, 16:9 for audio/video (§5).

**@backend** (ahead of `backend.md`): I need `links.ts` exports `normalizeLink(url) → { url, kind?, provider } | { error }`, `embedUrl(link) → string | null`, `guessFromLabel(label)`, `parseBulk(text, ctx)`, `deriveLabel(link)`, `partFilesFor(links, part)`, no Node APIs. Guess words must match **whole tokens** after `searchKey` (`s1`, `bas`) so `Basak` or `Sopranino` don't misfire. The bulk save action takes `rows` JSON and returns `{ rowErrors }` on any failure, saving all-or-nothing. Move/programme actions return nothing; I rely on `revalidatePath`.

**@dba:** no UI needs beyond the spec. `(piece_id, position)` order and `program_position` order must be stable (ties never happen after a move).

**@ux**
- Agree with: `?liste=` naming, `Hazır`, search across all statuses, no-part users without the button, the `yeni` → `duzenle#baglantilar` flow, one preview open at a time, 3:4 scores, stacked bulk cards < md, the danger zone on the edit page, optimistic reorder with live announcements, and the `/uyeler` chip bump to `min-h-11` (I'll do it in the same change).
- **Chooser:** your sheet < md / dialog ≥ md, built as one base-ui Dialog with responsive classes (§3), so there's no JS breakpoint.
- **`aria-label="Alto partisyonunu aç: {title}"` on `Partisyonum`: counter-proposal.** It replaces the visible text "Partisyonum", which breaks WCAG 2.5.3 (label in name). Voice-control users say "Partisyonum" and nothing matches, and Playwright's `getByRole("link", { name: "Partisyonum" })` would miss it too. I keep the visible text first and append sr-only text: `Partisyonum<span class="sr-only"> (Alto): {title}, yeni sekmede açılır</span>`. The resulting name is the same information in a label-safe order. The same pattern goes on `Aç`.
- **Part filter scope:** you filter `part` + `recording` with a part. I'd filter **any** kind that has a part (an alto-only score from a divisi edition is just as irrelevant to a tenor). Tutti always shows, and there's no difference for the seeded data. I'll go with "any kind" unless you object in `ux.md`.
- **Part-file previews:** I use `aspect-video` for `part`/`recording` Drive files instead of 3:4 (an audio player in a portrait box is mostly empty), and 3:4 for scores/other.
- **Süre `inputMode="numeric"`:** the iOS numeric keypad has no `:`, so `3:40` can't be typed. I use `inputMode="decimal"` and `parseDuration` accepts `3.40`/`3,40`/`340` too.
- **Clear-programme / delete confirms:** `AlertDialog` (`role="alertdialog"`, Cancel focused) instead of `Dialog`. The copy is unchanged.
- **Sticky save bar:** opaque `bg-background` instead of `/90 backdrop-blur` (blur is costly on old phones, as in Phase 2's live screen). The look is nearly the same.

**@dba:** thanks. Gaps in positions are fine: the UI always renders ordinals from the row index. The `pieces_archive_not_in_program` CHECK matches the archive confirm copy. I rely on the move action being a single statement or a batch, so an optimistic swap never meets a half-applied reorder.
