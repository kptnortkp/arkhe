# Phase 3: database design (DBA)

Author: arkhe-dba. Inputs: `po-spec.md` (§3, §6), `src/db/schema.ts`, `drizzle/0000_baseline.sql`, `drizzle/0001_phase2_review.sql`, `scripts/seed.ts`, `design/phase-2/review-db.md`. No `ux.md` / `ui.md` / `backend.md` existed when I wrote this; replies to them go in `review-db.md`.

@po: §6 accepted with three additions: archived pieces can't hold a programme position (CHECK), programme and link positions may have gaps (the UI shows ordinals), and links are unique per `(piece_id, position)` as well as per `(piece_id, url)`.

## 0. Rules carried over
- Timestamps: `integer(…, { mode: "timestamp" })`, UTC epoch seconds. App writes use the JS clock (Phase 2 P3-5), so `updated_at` is set by `$onUpdateFn(() => new Date())`. The DB default `unixepoch()` is only a fallback for inserts.
- Enums are enforced by `CHECK` in the DB with `inList(...)`. Column names inside `check()` are written literally.
- Fixed statement lists go in `db.batch([...])`. `db.transaction("write")` is used only where a read decides the write (Phase 2 P3-6).
- Phase 2 carry-forward P3-4 ("piece_files kind/voice CHECKs missing"): this is closed by replacing the table. `piece_links` gets every CHECK below.

## 1. Schema (`src/db/schema.ts`)

```ts
export const PIECE_STATUSES = ["learning", "concert", "archive"] as const;
export const LINK_KINDS = ["score", "part", "recording", "video", "other"] as const; // replaces FILE_KINDS
export type PieceStatus = (typeof PIECE_STATUSES)[number];
export type LinkKind = (typeof LINK_KINDS)[number];

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" }).notNull().default(now).$onUpdateFn(() => new Date());

export const pieces = sqliteTable(
  "pieces",
  {
    id: id(),
    title: text("title").notNull(),
    composer: text("composer"),
    arranger: text("arranger"),
    language: text("language"),
    voicing: text("voicing"),
    durationSec: integer("duration_sec"),
    status: text("status", { enum: PIECE_STATUSES }).notNull().default("learning"),
    notes: text("notes"),
    driveFolderUrl: text("drive_folder_url"),
    // Current concert programme order; null = not in the programme. Gaps allowed, UI shows 1..n.
    programPosition: integer("program_position"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("pieces_status_check", sql`status in (${inList(PIECE_STATUSES)})`),
    check("pieces_title_length", sql`length(trim(title)) between 1 and 120`),
    check("pieces_composer_length", sql`composer is null or length(composer) between 1 and 120`),
    check("pieces_arranger_length", sql`arranger is null or length(arranger) between 1 and 120`),
    check("pieces_language_length", sql`language is null or length(language) between 1 and 40`),
    check("pieces_voicing_length", sql`voicing is null or length(voicing) between 1 and 20`),
    check("pieces_duration_range", sql`duration_sec is null or duration_sec between 1 and 5999`),
    check("pieces_notes_length", sql`notes is null or length(notes) between 1 and 1000`),
    check(
      "pieces_folder_url_check",
      sql`drive_folder_url is null or (substr(drive_folder_url, 1, 8) = 'https://' and length(drive_folder_url) <= 2000)`,
    ),
    check("pieces_program_position_check", sql`program_position is null or program_position >= 1`),
    check("pieces_archive_not_in_program", sql`status <> 'archive' or program_position is null`),
    index("pieces_status_idx").on(t.status),
    // SQLite already allows many NULLs in a UNIQUE index; the partial WHERE keeps the index to programme rows only.
    uniqueIndex("pieces_program_position_unique")
      .on(t.programPosition)
      .where(sql`program_position is not null`),
  ],
);

export const pieceLinks = sqliteTable(
  "piece_links",
  {
    id: id(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LINK_KINDS }).notNull(),
    // Null means Tutti (whole choir). Divisi lives in the label.
    voicePart: text("voice_part", { enum: VOICE_PARTS }),
    // Null means the UI derives "<Kind> · <Part>".
    label: text("label"),
    // Normalised by src/lib/links.ts before insert.
    url: text("url").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("piece_links_kind_check", sql`kind in (${inList(LINK_KINDS)})`),
    check(
      "piece_links_voice_part_check",
      sql`voice_part is null or voice_part in (${inList(VOICE_PARTS)})`,
    ),
    check("piece_links_label_length", sql`label is null or length(trim(label)) between 1 and 120`),
    check(
      "piece_links_url_check",
      sql`substr(url, 1, 8) = 'https://' and length(url) <= 2000`,
    ),
    check("piece_links_position_check", sql`position >= 1`),
    uniqueIndex("piece_links_piece_url_unique").on(t.pieceId, t.url),
    uniqueIndex("piece_links_piece_position_unique").on(t.pieceId, t.position),
  ],
);
```

Import `uniqueIndex` from `drizzle-orm/sqlite-core`. Remove `FILE_KINDS` and `pieceFiles`; nothing in `src/` uses them today (checked with grep).

Notes:
- **Partial unique index:** drizzle 0.45's `uniqueIndex(...).on(...).where(sql)` emits `CREATE UNIQUE INDEX … WHERE program_position is not null`. SQLite and libSQL/Turso support partial indexes, and `rehearsals_open_idx` already uses the same form.
- The app's validation (`Eser adı gerekli.`, `Geçerli bir https bağlantısı gir.`) runs first. The CHECKs are the backstop. Empty strings become `null` in the app; the `between 1 and …` checks reject `''`.
- `substr(...,1,8) = 'https://'` is case-sensitive on purpose (`LIKE` is ASCII case-insensitive). `links.ts` always emits lower-case `https://`.
- `duration_sec` upper bound 5999 = `99:59`, the most the `m:ss` input can express.
- The `(piece_id, url)` unique index also serves every "links of piece X" lookup (leftmost column). The `(piece_id, position)` unique index serves `where piece_id = ? order by position`. Neither needs a separate plain index; the PO's "index (piece_id, position)" is this unique one.
- `pieces_status_idx`: the list filters by status. The table stays small (hundreds of rows), so this is cheap insurance, not a hot path.

## 2. FK on delete
| FK | On delete | Why |
|---|---|---|
| `piece_links.piece_id → pieces` | cascade | The spec allows deleting a piece together with its links (AC17). |
| `pieces.created_by → users` | set null | Actor column. Same rule as `rehearsals.created_by`. |
| (Phase 4) `assignments.piece_id → pieces` | restrict | Once homework refers to a piece, a hard delete fails. The action maps the FK error to "Arşivle instead". |

Delete vs archive: piece delete is a **hard delete** (one `DELETE`, cascade does the links). Archive is the soft path: `status = 'archive'`, and the `pieces_archive_not_in_program` CHECK forces `program_position = null` in the same `UPDATE`. Link delete is hard. We don't use a `deleted_at`, because nothing references a piece yet and the PO wants Phase 4 to rely on `restrict`.

## 3. Queries the screens need (no N+1)
- **`/repertuvar` list:** 1) `select id, title, composer, arranger, language, voicing, duration_sec, status, program_position from pieces` (filtered by status, or none for `Tümü`, or `program_position is not null order by program_position` for `Program`). Don't select `notes`. 2) **One** query for the `Partisyonum` buttons: `select piece_id, voice_part, label, url, position from piece_links where kind = 'part' and piece_id in (...ids) order by piece_id, position`, grouped in JS. That's two queries regardless of row count. The home card works the same way with `status = 'learning'`, limit 5 after sorting.
- **Search:** reuse `searchKey()` from `src/lib/format.ts` exactly as `/uyeler` does. Load the filtered rows, then keep those where `searchKey(`${title} ${composer ?? ""} ${arranger ?? ""}`).includes(searchKey(q))`. Sort with the shared `collator`. Why not SQL: SQLite's `lower()`/`LIKE` fold ASCII only (`İ`, `ı`, `ş`, `ğ` would miss), and a stored folded column or FTS5 isn't worth it below ~1,000 pieces. Revisit only if the repertoire grows beyond that.
- **`/repertuvar/[id]`:** two queries (the piece by PK, its links by `piece_id order by position`) or one `db.batch`. Filtering by part happens in JS.
- **Role exposure:** every column of `pieces`/`piece_links` is readable by any logged-in user (notes are public by spec). `created_by` is never sent to members. A list query needs nothing more than the columns above.

## 4. Writes, positions and unique-collision strategy
SQLite checks UNIQUE **row by row** inside one `UPDATE`. I verified this on 3.51: `update … set pos = case id when 'a' then 2 when 'b' then 1 end` fails, and so does `pos = pos + 1`. So:

1. **Gaps are allowed** in both `program_position` and `piece_links.position`. Removing a programme piece or deleting a link never renumbers the others. The UI shows ordinals (row index + 1), so AC8/AC16 still see 1..n.
2. **Append (programme):** one statement, atomic under SQLite's single writer:
   `update pieces set program_position = (select coalesce(max(program_position), 0) + 1 from pieces), updated_at = ? where id = ? and program_position is null and status <> 'archive'`. 0 rows changed means it was already in the programme or archived.
3. **Append (links, single or bulk):** a `db.batch` of inserts, each with `position = (select coalesce(max(position), 0) + 1 from piece_links where piece_id = ?)` as a `sql` value. The batch runs in order, so the saved order matches the paste order (AC13). If a duplicate URL is in the batch, the whole batch rolls back. The backend should dedupe the paste and check it against existing URLs in the preview, and map a `UNIQUE … piece_links.piece_id, piece_links.url` error to `Bu bağlantı bu eserde zaten var.`
4. **Up/down (swap A with its neighbour B):** `db.transaction("write")`, because the neighbour is read first:
   - read `pA`; read B = `where … position < pA order by position desc limit 1` (up) or `> pA … asc` (down); return if there's no B;
   - programme: `A := null`, `B := pA`, `A := pB` (the column is nullable, so null is the free temporary slot; the archive CHECK is unaffected).
   - links: `A := (select max(position) + 1 … where piece_id = ?)`, `B := pA`, `A := pB` (`position` is NOT NULL and `>= 1`, so the temporary slot is max + 1, not a negative).
   - On Turso this holds a write lock for 4–5 round trips. That's fine for a rare manager action.
5. **Clear programme:** `update pieces set program_position = null, updated_at = ? where program_position is not null`.
6. **Archive:** `update pieces set status = 'archive', program_position = null, updated_at = ? where id = ?` (one statement, so it satisfies the CHECK).
7. **Create piece with links in one form** (if UX wants that): `db.batch([insert piece (id from crypto.randomUUID()), ...link inserts with explicit positions 1..n])`.
8. **Bulk paste folder line → `drive_folder_url`:** `update pieces set drive_folder_url = ? where id = ? and drive_folder_url is null`, in the same batch as the link inserts.

## 5. Migration `drizzle/0002_phase3_repertoire.sql`
Current data: `pieces` = 0 rows and `piece_files` = 0 rows in `data/arkhe.db` (checked read-only). Nothing in `src/` or the seed writes them, and production (Turso) doesn't exist yet. The SQL still migrates data correctly, so the file is safe to run on any copy.

Steps for the tech lead:
1. Edit `schema.ts` as in §1, then run `npm run db:generate`. drizzle-kit will ask whether `piece_links` is **created or renamed** from `piece_files`. Answer **create** (the columns differ too much for a rename to help). Because new CHECKs are added and `is_active` is dropped, it will **rebuild `pieces`** (`__new_pieces` + `INSERT … SELECT` + `DROP` + `RENAME`, wrapped in `PRAGMA foreign_keys=OFF/ON`). A rebuild is required: SQLite can't add CHECKs with `ALTER`.
2. Hand-edit the generated file:
   - In the `INSERT INTO __new_pieces … SELECT`, select from the old `pieces` and map the status: `case when is_active = 1 then 'learning' else 'archive' end` → `status`. Also set `program_position` to null and `updated_at` to `created_at`. Drop `is_active` from the column list.
   - Order: rebuild `pieces` → `CREATE TABLE piece_links` + indexes → copy → `DROP TABLE piece_files`. The copy:
     ```sql
     INSERT INTO piece_links (id, piece_id, kind, voice_part, label, url, position, created_at)
     SELECT id, piece_id,
            CASE kind WHEN 'midi' THEN 'part' WHEN 'score' THEN 'score' WHEN 'recording' THEN 'recording' ELSE 'other' END,
            CASE WHEN voice_part IN ('soprano','alto','tenor','bass') THEN voice_part END,
            NULLIF(trim(substr(label, 1, 120)), ''),
            url,
            row_number() OVER (PARTITION BY piece_id ORDER BY created_at, id),
            created_at
     FROM piece_files
     WHERE substr(url, 1, 8) = 'https://' AND length(url) <= 2000
       AND rowid IN (SELECT min(rowid) FROM piece_files GROUP BY piece_id, url);
     ```
     The CASE/filter lines absorb the unchecked legacy data (P3-4), so the copy can't fail the new CHECKs. URLs aren't re-normalised in SQL; with 0 rows that's moot.
3. Don't run it myself. The tech lead runs `npm run db:migrate` (backup + `db:check` FK/orphan check), or `npm run db:reset` with the dev server stopped. `PRAGMA foreign_keys=OFF` may be a no-op if drizzle runs the migration inside a transaction. Dropping `pieces` doesn't cascade to `piece_files` here, because `piece_files` is copied and dropped afterwards. `db:check` is the safety net.

## 6. Seed (`scripts/seed.ts`, per §6)
Six pieces. Drive IDs and YouTube IDs are fake. `created_by` is the conductor. Links are listed in position order. `D(x)` = `https://drive.google.com/file/d/<x>/view`, `F(x)` = `https://drive.google.com/drive/folders/<x>`, `Y(x)` = `https://www.youtube.com/watch?v=<x>`.

| # | title | composer / arranger | lang | voicing | dur | status | prog | links |
|---|---|---|---|---|---|---|---|---|
| 1 | Sicut Cervus | G. P. da Palestrina / – | Latince | SATB | 170 (2:50) | concert | 1 | score Tutti `D(seedSicutNota)`; part soprano/alto/tenor/bass `D(seedSicutSop/Alto/Ten/Bas)` labels null; video `Y(arkheSicut1)` |
| 2 | Bogoroditse Devo | S. Rachmaninoff / – | Rusça | SSAATTBB | 190 (3:10) | concert | 2 | score; part soprano `Soprano 1` `D(seedBogoS1)`, part soprano `Soprano 2` `D(seedBogoS2)`, part alto, tenor, bass; recording Tutti |
| 3 | Aman Gülüm | Halk türküsü / Koro Arkhe | Türkçe | SATB | 160 (2:40) | learning | 3 | **only Tutti** part `Tutti MP3` `D(seedGulumTutti)`; score Tutti; `drive_folder_url` = `F(seedGulumKlasor)` |
| 4 | Ave Verum Corpus | W. A. Mozart / – | Latince | SATB | 220 (3:40) | learning | – | score; part alto `D(seedAveAlto)` + soprano/tenor/bass; video `Y(arkheAveV01)`; other `Sözler ve çeviri` docs URL |
| 5 | Hallelujah | L. Cohen / K. Lavender | İngilizce | SSA | 270 (4:30) | learning | – | **no part links**: score + video `Y(arkheHall01)` |
| 6 | Abendlied | J. Rheinberger / – | Almanca | SSATTB | 200 (3:20) | archive | – | score + recording; `drive_folder_url` = `F(seedAbendKlasor)` |

This covers the ACs: learning = {3,4,5}, concert = {1,2}, archive = {6}, programme = 1,2,3 (one of them `learning`). `gulum` → #3. `Mozart` → #4. Alto `Partisyonum`: #4 → `D(seedAveAlto)`, #3 → the Tutti file, #5 disabled. A soprano member sees the S1/S2 chooser on #2 (the seed already has soprano members). Duration `3:40` → #4. Use 11-character YouTube IDs, and Drive IDs from `[A-Za-z0-9_-]` so `links.ts` accepts them. Insert all pieces and links in one `db.batch` after the users.
