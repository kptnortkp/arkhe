"use client";

import type { LiveSnapshot } from "@/lib/attendance/live";
import { MarkingRoster, useLiveSnapshot } from "./marking-roster";

/** Roster on the detail page: marking without the code panel, no polling. */
export function DetailRoster({
  rehearsalId,
  initial,
}: {
  rehearsalId: string;
  initial: LiveSnapshot;
}) {
  const { snapshot, setSnapshot, online, setOnline } = useLiveSnapshot(rehearsalId, initial, false);
  return (
    <MarkingRoster
      rehearsalId={rehearsalId}
      snapshot={snapshot}
      onSnapshot={setSnapshot}
      online={online}
      onOnline={setOnline}
      canClear={snapshot.closedAt === null && snapshot.openedAt !== null}
    />
  );
}
