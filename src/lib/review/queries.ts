import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  VOICE_PARTS,
  type RecordingDeleteReason,
  type Role,
  type SubmissionMethod,
  type VoicePart,
} from "@/db/schema";
import { isEligible } from "@/lib/homework/eligibility";
import { collator } from "@/lib/format";
import { COMMENTED_LIST_MAX, NO_TAKE_WINDOW_MS } from "@/lib/storage/limits";
import { now } from "@/lib/time";
import { reviewRole, type Scope, type Viewer } from "./access";

// Role-shaped reads (backend §6, db.md §5). The assistant's functions never select feedback text,
// another assistant's note, or a note count; the singer's paths never touch assistant_notes; no
// function here selects storage_key.

export const CONDUCTOR_CHIPS = ["bekleyen", "asistan-notlu", "yorumlanan"] as const;
export const ASSISTANT_CHIPS = ["dinlenecek", "notlarim"] as const;
export type ConductorChip = (typeof CONDUCTOR_CHIPS)[number];
export type AssistantChip = (typeof ASSISTANT_CHIPS)[number];

export function conductorChip(v: unknown): ConductorChip {
  return CONDUCTOR_CHIPS.includes(v as ConductorChip) ? (v as ConductorChip) : "bekleyen";
}
export function assistantChip(v: unknown): AssistantChip {
  return ASSISTANT_CHIPS.includes(v as AssistantChip) ? (v as AssistantChip) : "dinlenecek";
}

const toDate = (s: unknown) => (s === null || s === undefined ? null : new Date(Number(s) * 1000));
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const partsIn = (scope: Scope) => sql.raw(scope.map((p) => `'${p}'`).join(", ") || "''");

export type QueueRowBase = {
  assignmentId: string;
  userId: string;
  name: string;
  part: VoicePart | null;
  /** The current take, or null ("Portalda kayıt yok"). */
  recordingId: string | null;
  /** A current take whose audio is still there: the rows `Dinlemeye başla` walks first. */
  hasAudio: boolean;
  durationMs: number | null;
  uploadedAt: Date | null;
  submittedAt: Date | null;
  late: boolean;
  dueAt: Date;
  pieceTitle: string;
  barFrom: number | null;
  barTo: number | null;
};
export type ConductorQueueRow = QueueRowBase & {
  noRecording: boolean;
  audioDeleted: boolean;
  noteCount: number;
  commented: boolean;
};
export type AssistantQueueRow = QueueRowBase & {
  /** I noted an earlier take of this slot ("Yeni kayıt", D8). */
  retake: boolean;
  myNoteAt: Date | null;
};
export type QueueGroup<R> = {
  assignmentId: string;
  pieceTitle: string;
  barFrom: number | null;
  barTo: number | null;
  dueAt: Date;
  rows: R[];
};

type SortKey = {
  assignmentId: string;
  dueAt: Date;
  part: VoicePart | null;
  name: string;
  userId: string;
  /** Missing = true (a review page key built before this field existed). */
  hasAudio?: boolean;
};
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const partRank = (p: VoicePart | null) =>
  p === null ? VOICE_PARTS.length : VOICE_PARTS.indexOf(p);
const audioRank = (k: SortKey) => (k.hasAudio === false ? 1 : 0);
const sameRow = (a: SortKey, b: SortKey) =>
  a.assignmentId === b.assignmentId && a.userId === b.userId;

/**
 * Queue order: newest due first (one group per homework); inside a group rows with audio first and
 * "Portalda kayıt yok" / deleted-audio rows last; then S/A/T/B, name, id.
 */
export function compareQueue(a: SortKey, b: SortKey) {
  if (sameRow(a, b)) return 0;
  return (
    b.dueAt.getTime() - a.dueAt.getTime() ||
    cmp(a.assignmentId, b.assignmentId) ||
    audioRank(a) - audioRank(b) ||
    partRank(a.part) - partRank(b.part) ||
    collator.compare(a.name, b.name) ||
    cmp(a.userId, b.userId)
  );
}

/** `Dinlemeye başla` / `Sonraki` order: every row with audio (in queue order), then the rest. */
export function compareWalk(a: SortKey, b: SortKey) {
  if (sameRow(a, b)) return 0;
  return audioRank(a) - audioRank(b) || compareQueue(a, b);
}

/** Where `Dinlemeye başla` starts: the first row with audio, else the first row. */
export function firstToReview<R extends QueueRowBase>(rows: R[]): R | null {
  return rows.find((r) => r.hasAudio) ?? rows[0] ?? null;
}

/** The review key of a review page's own row (with its audio state), for nextAfter. */
export function reviewKey(review: ConductorReview | AssistantReview): SortKey {
  const rec = review.recording;
  return {
    assignmentId: review.assignment.id,
    dueAt: review.assignment.dueAt,
    part: review.singer.part,
    name: review.singer.name,
    userId: review.singer.id,
    // An assistant's page drops the recording once commented; the queue row had audio.
    hasAudio: rec ? !rec.audioDeletedAt : review.kind === "assistant",
  };
}

export function groupQueue<R extends QueueRowBase>(rows: R[]): QueueGroup<R>[] {
  const groups: QueueGroup<R>[] = [];
  for (const r of rows) {
    let g = groups.at(-1);
    if (!g || g.assignmentId !== r.assignmentId) {
      g = {
        assignmentId: r.assignmentId,
        pieceTitle: r.pieceTitle,
        barFrom: r.barFrom,
        barTo: r.barTo,
        dueAt: r.dueAt,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(r);
  }
  return groups;
}

/**
 * The next row after `current` in walk order (audio rows first), even when `current` has just left
 * the list. `rows` may be in queue order.
 */
export function nextAfter<R extends QueueRowBase>(rows: R[], current: SortKey): R | null {
  const walk = [...rows].sort(compareWalk);
  const here = walk.findIndex((r) => sameRow(r, current));
  if (here >= 0) return walk[here + 1] ?? null;
  return walk.find((r) => compareWalk(r, current) > 0) ?? null;
}

type RawRow = {
  a: string;
  u: string;
  rid: string | null;
  dur: number | null;
  up: number | null;
  sat: number | null;
  gone: number;
  due: number;
  title: string;
  bf: number | null;
  bt: number | null;
  name: string;
  part: VoicePart | null;
};

function baseOf(r: RawRow): QueueRowBase {
  const submittedAt = toDate(r.sat);
  const dueAt = toDate(r.due)!;
  return {
    assignmentId: r.a,
    userId: r.u,
    name: r.name,
    part: r.part,
    recordingId: r.rid,
    hasAudio: r.rid !== null && !r.gone,
    durationMs: r.dur === null ? null : Number(r.dur),
    uploadedAt: toDate(r.up),
    submittedAt,
    late: submittedAt !== null && submittedAt > dueAt,
    dueAt,
    pieceTitle: r.title,
    barFrom: r.bf === null ? null : Number(r.bf),
    barTo: r.bt === null ? null : Number(r.bt),
  };
}

const DETAILS = sql.raw(`
  asg.due_at as due, p.title as title, asg.bar_from as bf, asg.bar_to as bt, s.name as name,
  s.voice_part as part`);

/**
 * Conductor's waiting list (D13, D50): every submission without a comment that has live audio
 * (any age), plus submissions without live audio on homework due in the last 30 days.
 */
async function conductorWaiting(): Promise<ConductorQueueRow[]> {
  const since = secs(new Date(now().getTime() - NO_TAKE_WINDOW_MS));
  const rows = await db.all<RawRow & { notes: number }>(sql`
    select q.*, ${DETAILS},
      (select count(*) from assistant_notes n where n.assignment_id = q.a and n.singer_id = q.u) as notes
    from (
      select r.assignment_id as a, r.user_id as u, r.id as rid, r.duration_ms as dur,
        r.uploaded_at as up, sub.submitted_at as sat, 0 as gone
      from recordings r
      join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
      where r.replaced_at is null and r.audio_deleted_at is null
        and sub.submitted_at is not null and sub.feedback is null
      union all
      select sub.assignment_id, sub.user_id, r.id, r.duration_ms, r.uploaded_at, sub.submitted_at,
        r.id is not null
      from assignments a2
      join submissions sub on sub.assignment_id = a2.id
      left join recordings r on r.assignment_id = sub.assignment_id and r.user_id = sub.user_id
        and r.replaced_at is null
      where a2.due_at >= ${since} and sub.submitted_at is not null and sub.feedback is null
        and (r.id is null or r.audio_deleted_at is not null)
    ) q
    join assignments asg on asg.id = q.a
    join pieces p on p.id = asg.piece_id
    join users s on s.id = q.u`);
  return rows.map((r) => ({
    ...baseOf(r),
    noRecording: r.rid === null,
    audioDeleted: Boolean(r.gone),
    noteCount: Number(r.notes),
    commented: false,
  }));
}

/** D51: the newest 100 commented submissions (by comment time). */
async function conductorCommented(): Promise<{ rows: ConductorQueueRow[]; truncated: boolean }> {
  const rows = await db.all<RawRow & { notes: number }>(sql`
    select sub.assignment_id as a, sub.user_id as u, r.id as rid, r.duration_ms as dur,
      r.uploaded_at as up, sub.submitted_at as sat, r.audio_deleted_at is not null as gone, ${DETAILS},
      (select count(*) from assistant_notes n where n.assignment_id = sub.assignment_id
         and n.singer_id = sub.user_id) as notes
    from submissions sub
    join assignments asg on asg.id = sub.assignment_id
    join pieces p on p.id = asg.piece_id
    join users s on s.id = sub.user_id
    left join recordings r on r.assignment_id = sub.assignment_id and r.user_id = sub.user_id
      and r.replaced_at is null
    where sub.feedback is not null and sub.submitted_at is not null
    order by sub.feedback_at desc
    limit ${COMMENTED_LIST_MAX + 1}`);
  return {
    truncated: rows.length > COMMENTED_LIST_MAX,
    rows: rows.slice(0, COMMENTED_LIST_MAX).map((r) => ({
      ...baseOf(r),
      noRecording: r.rid === null,
      audioDeleted: Boolean(r.gone),
      noteCount: Number(r.notes),
      commented: true,
    })),
  };
}

export async function conductorQueue(chip: ConductorChip) {
  if (chip === "yorumlanan") {
    const { rows, truncated } = await conductorCommented();
    return { rows: rows.sort(compareQueue), truncated };
  }
  const waiting = await conductorWaiting();
  const rows = chip === "asistan-notlu" ? waiting.filter((r) => r.noteCount > 0) : waiting;
  return { rows: rows.sort(compareQueue), truncated: false };
}

/**
 * `data-review-badge` and the `Asistan notlu` chip: waiting rows with at least one assistant note
 * (D14). The same predicate as conductorWaiting, as one aggregate for the layout.
 */
export const reviewBadgeCount = cache(async () => {
  const since = secs(new Date(now().getTime() - NO_TAKE_WINDOW_MS));
  const [row] = await db.all<{ n: number }>(sql`
    select
      (select count(*) from recordings r
         join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
        where r.replaced_at is null and r.audio_deleted_at is null
          and sub.submitted_at is not null and sub.feedback is null
          and exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id
                      and n.singer_id = r.user_id))
    + (select count(*) from assignments asg
         join submissions sub on sub.assignment_id = asg.id
        where asg.due_at >= ${since} and sub.submitted_at is not null and sub.feedback is null
          and not exists (select 1 from recordings r where r.assignment_id = sub.assignment_id
                          and r.user_id = sub.user_id and r.replaced_at is null
                          and r.audio_deleted_at is null)
          and exists (select 1 from assistant_notes n where n.assignment_id = sub.assignment_id
                      and n.singer_id = sub.user_id)) as n`);
  return Number(row?.n ?? 0);
});

/**
 * The conductor's counts (UX P2-4): `waiting` = waiting rows with live audio (the home card's
 * `<n> kayıt dinlenmeyi bekliyor`, the `Dinleme` pill, `Dinlemeye başla (<n>)`), `noAudio` = waiting
 * submissions without audio in the portal, `total` = every waiting row (the `Yorum bekleyen` list),
 * `noted` = waiting rows with an assistant note (the `Asistan notlu` chip, D14).
 */
export async function conductorCounts() {
  const rows = await conductorWaiting();
  const waiting = rows.filter((r) => r.hasAudio).length;
  return {
    waiting,
    noAudio: rows.length - waiting,
    total: rows.length,
    noted: rows.filter((r) => r.noteCount > 0).length,
  };
}

/** Assistant `Dinlenecek` (db.md §5.4): live takes in scope, not mine, uncommented, not yet noted. */
async function assistantTodo(viewer: Viewer, scope: Scope): Promise<AssistantQueueRow[]> {
  if (scope.length === 0) return [];
  const rows = await db.all<RawRow & { mine: number | null }>(sql`
    select r.assignment_id as a, r.user_id as u, r.id as rid, r.duration_ms as dur,
      r.uploaded_at as up, sub.submitted_at as sat, 0 as gone, ${DETAILS},
      (select n.updated_at from assistant_notes n where n.assignment_id = r.assignment_id
         and n.singer_id = r.user_id and n.assistant_id = ${viewer.id}) as mine
    from recordings r
    join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
    join assignments asg on asg.id = r.assignment_id
    join pieces p on p.id = asg.piece_id
    join users s on s.id = r.user_id
    where r.replaced_at is null and r.audio_deleted_at is null
      and sub.submitted_at is not null and sub.feedback is null
      and r.user_id <> ${viewer.id}
      and s.voice_part in (${partsIn(scope)})
      and not exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id
                      and n.singer_id = r.user_id and n.assistant_id = ${viewer.id}
                      and n.recording_id = r.id)`);
  return rows
    .map((r) => ({ ...baseOf(r), retake: r.mine !== null, myNoteAt: toDate(r.mine) }))
    .sort(compareQueue);
}

/** Assistant `Not yazdıklarım` (db.md §5.5): my notes on uncommented slots still in scope. */
async function assistantDone(viewer: Viewer, scope: Scope): Promise<AssistantQueueRow[]> {
  if (scope.length === 0) return [];
  const rows = await db.all<RawRow & { mine: number; oncur: number }>(sql`
    select n.assignment_id as a, n.singer_id as u, r.id as rid, r.duration_ms as dur,
      r.uploaded_at as up, sub.submitted_at as sat, r.audio_deleted_at is not null as gone, ${DETAILS},
      n.updated_at as mine, (r.id is not null and n.recording_id = r.id) as oncur
    from assistant_notes n
    join submissions sub on sub.assignment_id = n.assignment_id and sub.user_id = n.singer_id
    join assignments asg on asg.id = n.assignment_id
    join pieces p on p.id = asg.piece_id
    join users s on s.id = n.singer_id
    left join recordings r on r.assignment_id = n.assignment_id and r.user_id = n.singer_id
      and r.replaced_at is null
    where n.assistant_id = ${viewer.id} and sub.submitted_at is not null and sub.feedback is null
      and s.voice_part in (${partsIn(scope)})`);
  return rows
    .map((r) => ({ ...baseOf(r), retake: !r.oncur, myNoteAt: toDate(r.mine) }))
    .sort(compareQueue);
}

export async function assistantQueue(viewer: Viewer, scope: Scope, chip: AssistantChip) {
  return chip === "notlarim" ? assistantDone(viewer, scope) : assistantTodo(viewer, scope);
}

/** Home card `Dinleme kuyruğun: <n> kayıt` and the `/odevler` header pill. */
export async function assistantQueueCount(viewer: Viewer, scope: Scope) {
  return (await assistantTodo(viewer, scope)).length;
}

// ------------------------------------------------------------------------------- review page

type Head = {
  assignment: {
    id: string;
    pieceTitle: string;
    barFrom: number | null;
    barTo: number | null;
    dueAt: Date;
  };
  singer: { id: string; name: string; part: VoicePart | null };
  submittedAt: Date | null;
  method: SubmissionMethod | null;
  late: boolean;
};

export type ReviewRecording = {
  id: string;
  durationMs: number | null;
  uploadedAt: Date;
  /** "Değiştirildi · <uploadedAt>": this take replaced an earlier one. */
  replacedEarlier: boolean;
  audioDeletedAt: Date | null;
  deletedReason: RecordingDeleteReason | null;
  /** Istanbul day the audio goes. */
  deleteOn: string;
};

export type ConductorReview = Head & {
  kind: "conductor";
  recording: ReviewRecording | null;
  notes: {
    assistantId: string;
    author: string;
    text: string;
    at: Date;
    previousTake: boolean;
  }[];
  comment: { text: string; at: Date | null; byName: string | null; byRole: Role | null } | null;
};

/** No field for the comment text or other assistants' notes, by construction (AC 24). */
export type AssistantReview = Head & {
  kind: "assistant";
  /** null once the conductor has commented: no player (D43). */
  recording: ReviewRecording | null;
  commented: boolean;
  myNote: { text: string; at: Date; previousTake: boolean } | null;
};

async function head(assignmentId: string, singerId: string) {
  const [r] = await db.all<{
    title: string;
    bf: number | null;
    bt: number | null;
    due: number;
    parts: string | null;
    name: string;
    role: Role;
    part: VoicePart | null;
    joined: number;
    left_at: number | null;
    sat: number | null;
    method: SubmissionMethod | null;
    has_sub: number;
  }>(sql`
    select p.title, asg.bar_from as bf, asg.bar_to as bt, asg.due_at as due,
      (select group_concat(voice_part) from assignment_parts where assignment_id = asg.id) as parts,
      s.name, s.role, s.voice_part as part, s.joined_at as joined, s.left_at,
      sub.submitted_at as sat, sub.method, sub.user_id is not null as has_sub
    from assignments asg
    join pieces p on p.id = asg.piece_id
    join users s on s.id = ${singerId}
    left join submissions sub on sub.assignment_id = asg.id and sub.user_id = s.id
    where asg.id = ${assignmentId}`);
  if (!r) return null;
  const dueAt = toDate(r.due)!;
  const submittedAt = toDate(r.sat);
  const parts = (r.parts ?? "").split(",").filter(Boolean) as VoicePart[];
  const eligible = isEligible(
    { role: r.role, voicePart: r.part, joinedAt: toDate(r.joined)!, leftAt: toDate(r.left_at) },
    parts,
  );
  const value: Head = {
    assignment: { id: assignmentId, pieceTitle: r.title, barFrom: r.bf, barTo: r.bt, dueAt },
    singer: { id: singerId, name: r.name, part: r.part },
    submittedAt,
    method: r.method,
    late: submittedAt !== null && submittedAt > dueAt,
  };
  return { value, eligible, hasSubmission: Boolean(r.has_sub) };
}

async function currentTake(
  assignmentId: string,
  singerId: string,
): Promise<ReviewRecording | null> {
  const [r] = await db.all<{
    id: string;
    dur: number | null;
    up: number;
    rep: string | null;
    gone: number | null;
    reason: RecordingDeleteReason | null;
    del: string;
  }>(sql`
    select id, duration_ms as dur, uploaded_at as up, replaces_id as rep, audio_deleted_at as gone,
      deleted_reason as reason, delete_on as del
    from recordings where assignment_id = ${assignmentId} and user_id = ${singerId}
      and replaced_at is null`);
  if (!r) return null;
  return {
    id: r.id,
    durationMs: r.dur === null ? null : Number(r.dur),
    uploadedAt: toDate(r.up)!,
    replacedEarlier: r.rep !== null,
    audioDeletedAt: toDate(r.gone),
    deletedReason: r.reason,
    deleteOn: r.del,
  };
}

/**
 * The review page's data for the viewer, or null for 404 (D29). The conductor may open any
 * singer who is responsible for the homework or holds a row on it; an assistant only a live slot
 * in scope that isn't their own (and never a "Portalda kayıt yok" row).
 */
export async function reviewFor(
  viewer: Viewer,
  scope: Scope,
  assignmentId: string,
  singerId: string,
): Promise<ConductorReview | AssistantReview | null> {
  const h = await head(assignmentId, singerId);
  if (!h) return null;
  const role = reviewRole(viewer, scope, { id: singerId, voicePart: h.value.singer.part });
  if (!role) return null;
  const recording = await currentTake(assignmentId, singerId);

  if (role === "conductor") {
    if (!h.eligible && !h.hasSubmission) return null;
    const [notes, [comment]] = await Promise.all([
      db.all<{ aid: string; author: string; body: string; at: number; rid: string }>(sql`
        select n.assistant_id as aid, u.name as author, n.body, n.updated_at as at, n.recording_id as rid
        from assistant_notes n join users u on u.id = n.assistant_id
        where n.assignment_id = ${assignmentId} and n.singer_id = ${singerId}
        order by n.created_at, u.name`),
      db.all<{ text: string | null; at: number | null; by: string | null; brole: Role | null }>(sql`
        select sub.feedback as text, sub.feedback_at as at, u.name as by, u.role as brole
        from submissions sub left join users u on u.id = sub.feedback_by
        where sub.assignment_id = ${assignmentId} and sub.user_id = ${singerId}`),
    ]);
    return {
      kind: "conductor",
      ...h.value,
      recording,
      notes: notes.map((n) => ({
        assistantId: n.aid,
        author: n.author,
        text: n.body,
        at: toDate(n.at)!,
        previousTake: n.rid !== recording?.id,
      })),
      comment: comment?.text
        ? { text: comment.text, at: toDate(comment.at), byName: comment.by, byRole: comment.brole }
        : null,
    };
  }

  if (!recording || h.value.submittedAt === null) return null;
  const [[state], [mine]] = await Promise.all([
    db.all<{ commented: number }>(sql`
      select feedback is not null as commented from submissions
      where assignment_id = ${assignmentId} and user_id = ${singerId}`),
    db.all<{ body: string; at: number; rid: string }>(sql`
      select body, updated_at as at, recording_id as rid from assistant_notes
      where assignment_id = ${assignmentId} and singer_id = ${singerId}
        and assistant_id = ${viewer.id}`),
  ]);
  const commented = Boolean(state?.commented);
  return {
    kind: "assistant",
    ...h.value,
    recording: commented ? null : recording,
    commented,
    myNote: mine
      ? { text: mine.body, at: toDate(mine.at)!, previousTake: mine.rid !== recording.id }
      : null,
  };
}

/** `Sonraki` for the review page: the next item of the same queue and chip, or null. */
export async function nextReviewHref(
  viewer: Viewer,
  scope: Scope,
  review: ConductorReview | AssistantReview,
  chip: string | undefined,
) {
  const current = reviewKey(review);
  let next: QueueRowBase | null;
  let filter: string;
  if (review.kind === "conductor") {
    const c = conductorChip(chip);
    next = nextAfter((await conductorQueue(c)).rows, current);
    filter = c;
  } else {
    const c = assistantChip(chip);
    next = nextAfter(await assistantQueue(viewer, scope, c), current);
    filter = c;
  }
  return next ? `/odevler/${next.assignmentId}/dinle/${next.userId}?filtre=${filter}` : null;
}
