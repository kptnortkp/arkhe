import "server-only";
import { sessionCode } from "./code";
import { getRehearsal } from "./rehearsals";
import { rosterOf } from "./roster";

export type LiveRow = {
  userId: string;
  name: string;
  voicePart: string | null;
  onRoster: boolean;
  status: string | null;
  method: string | null;
  note: string | null;
  recordedAt: number | null;
  recordedByName: string | null;
  corrected: boolean;
};

/** Everything the manager's live screen needs; managers only. */
export async function liveSnapshot(rehearsalId: string, withCodes: boolean) {
  const rehearsal = await getRehearsal(rehearsalId);
  if (!rehearsal) return null;
  const roster = await rosterOf(rehearsalId, { includeNotes: true });
  const rows: LiveRow[] = (roster?.rows ?? []).map((r) => ({
    userId: r.userId,
    name: r.name,
    voicePart: r.voicePart,
    onRoster: r.onRoster,
    status: r.status,
    method: r.method,
    note: r.note,
    recordedAt: r.recordedAt?.getTime() ?? null,
    recordedByName: r.recordedByName,
    corrected: Boolean(r.correctedAt),
  }));
  return {
    openedAt: rehearsal.openedAt?.getTime() ?? null,
    closedAt: rehearsal.closedAt?.getTime() ?? null,
    rows,
    code:
      withCodes && rehearsal.openedAt && !rehearsal.closedAt
        ? await sessionCode(rehearsalId)
        : null,
  };
}

export type LiveSnapshot = NonNullable<Awaited<ReturnType<typeof liveSnapshot>>>;
