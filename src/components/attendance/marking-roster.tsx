"use client";

import { CheckCheck, Eraser, RotateCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { markRemainingPresent, undoBulkPresent } from "@/app/(portal)/calismalar/actions";
import { Button } from "@/components/ui/button";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type VoicePart } from "@/db/schema";
import {
  METHOD_LABELS,
  STATUS_SHORT,
  STATUS_STYLES,
  VOICE_PART_LABELS,
  VOICE_PART_SHORT,
  VOICE_PART_STYLES,
} from "@/lib/labels";
import type { LiveRow, LiveSnapshot } from "@/lib/attendance/live";
import { cn } from "@/lib/utils";
import { STATUS_ICONS } from "./status-chip";

type Pending = { status: AttendanceStatus | null; markedAt: number; failed?: boolean };

const GROUPS: (VoicePart | "none")[] = ["soprano", "alto", "tenor", "bass", "none"];
const collator = new Intl.Collator("tr", { sensitivity: "base" });
const timeFormat = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

function fold(text: string) {
  return text.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
}

export function useLiveSnapshot(rehearsalId: string, initial: LiveSnapshot, poll: boolean) {
  const [snapshot, setSnapshot] = useState(initial);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(
    async (withCodes = false) => {
      try {
        const res = await fetch(
          `/api/calismalar/${rehearsalId}/durum${withCodes ? "?kodlar=1" : ""}`,
          {
            cache: "no-store",
          },
        );
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as LiveSnapshot;
        setSnapshot((prev) => ({ ...next, schedule: next.schedule ?? prev.schedule }));
        setOnline(true);
        return next;
      } catch {
        setOnline(false);
        return null;
      }
    },
    [rehearsalId],
  );
  useEffect(() => {
    if (!poll) return;
    let delay = 5000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const ok = await refresh();
        delay = ok ? 5000 : Math.min(delay * 2, 30_000);
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [poll, refresh]);
  // Mark responses carry no code schedule; never let them wipe the one the live screen is using.
  const mergeSnapshot = useCallback(
    (next: LiveSnapshot) =>
      setSnapshot((prev) => ({ ...next, schedule: next.schedule ?? prev.schedule })),
    [],
  );
  return { snapshot, setSnapshot: mergeSnapshot, refresh, online, setOnline };
}

export function MarkingRoster({
  rehearsalId,
  snapshot,
  onSnapshot,
  online,
  onOnline,
  canClear,
  imported = false,
}: {
  rehearsalId: string;
  snapshot: LiveSnapshot;
  onSnapshot: (s: LiveSnapshot) => void;
  online: boolean;
  onOnline: (v: boolean) => void;
  canClear: boolean;
  /** The rehearsal came from a file: its untouched marks have no real time or actor. */
  imported?: boolean;
}) {
  const [pending, setPendingState] = useState<Record<string, Pending>>({});
  const [query, setQuery] = useState("");
  // The ref is the source of truth for sending; state mirrors it for rendering.
  const pendingRef = useRef<Record<string, Pending>>({});
  const sending = useRef(false);
  const flushAgain = useRef<() => void>(() => {});

  const setPending = useCallback(
    (update: (cur: Record<string, Pending>) => Record<string, Pending>) => {
      pendingRef.current = update(pendingRef.current);
      setPendingState(pendingRef.current);
    },
    [],
  );

  const flush = useCallback(async () => {
    if (sending.current) return;
    const batch = Object.entries(pendingRef.current);
    if (batch.length === 0) return;
    sending.current = true;
    let sent = false;
    try {
      const res = await fetch(`/api/calismalar/${rehearsalId}/isaret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marks: batch.map(([userId, p]) => ({
            userId,
            status: p.status,
            // Age instead of a timestamp, so a device with a wrong clock still orders marks correctly.
            ageMs: Math.max(0, Date.now() - p.markedAt),
          })),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onSnapshot((await res.json()) as LiveSnapshot);
      const wasOffline = batch.some(([, p]) => p.failed);
      setPending((cur) => {
        const next = { ...cur };
        for (const [userId, p] of batch)
          if (next[userId]?.markedAt === p.markedAt) delete next[userId];
        return next;
      });
      onOnline(true);
      sent = true;
      if (wasOffline) toast.success(`Bekleyen ${batch.length} işaret kaydedildi.`);
    } catch {
      setPending((cur) =>
        Object.fromEntries(Object.entries(cur).map(([k, p]) => [k, { ...p, failed: true }])),
      );
      onOnline(false);
    } finally {
      sending.current = false;
    }
    // Marks made while the request was in flight go out right after it.
    if (sent && Object.values(pendingRef.current).some((p) => !p.failed)) flushAgain.current();
  }, [rehearsalId, onSnapshot, onOnline, setPending]);

  useEffect(() => {
    flushAgain.current = () => void flush();
  }, [flush]);

  useEffect(() => {
    const retry = () => void flush();
    window.addEventListener("online", retry);
    const timer = setInterval(retry, 10_000);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(timer);
    };
  }, [flush]);

  useEffect(() => {
    if (Object.keys(pending).length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  function mark(userId: string, status: AttendanceStatus | null) {
    setPending((cur) => ({ ...cur, [userId]: { status, markedAt: Date.now() } }));
    void flush();
  }

  // Pending marks win over whatever the last poll said.
  const rows: (LiveRow & { pending?: Pending })[] = useMemo(
    () =>
      snapshot.rows.map((r) =>
        pending[r.userId]
          ? { ...r, status: pending[r.userId].status, pending: pending[r.userId] }
          : r,
      ),
    [snapshot.rows, pending],
  );
  const roster = rows.filter((r) => r.onRoster);
  const extras = rows.filter((r) => !r.onRoster);
  const came = roster.filter((r) => r.status === "present" || r.status === "late").length;
  const count = (s: AttendanceStatus | null) => roster.filter((r) => r.status === s).length;
  const unsaved = Object.keys(pending).length > 0;
  const visible = (r: LiveRow) => !query || fold(r.name).includes(fold(query));

  async function bulk(part: string) {
    const result = await markRemainingPresent(rehearsalId, part);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const ids = result.userIds ?? [];
    const label = part === "none" ? "Partisyonsuz" : VOICE_PART_LABELS[part as VoicePart];
    toast.success(`${label}: ${ids.length} kişi geldi olarak işaretlendi.`, {
      duration: 5000,
      action: ids.length
        ? {
            label: "Geri al",
            onClick: async () => {
              await undoBulkPresent(rehearsalId, ids);
              await refreshAfterBulk();
            },
          }
        : undefined,
    });
    await refreshAfterBulk();
  }

  async function refreshAfterBulk() {
    const res = await fetch(`/api/calismalar/${rehearsalId}/durum`, { cache: "no-store" });
    if (res.ok) onSnapshot((await res.json()) as LiveSnapshot);
  }

  return (
    <div className="space-y-4">
      {!online && (
        <p
          role="status"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm text-accent-foreground"
        >
          Bağlantı yok — işaretlemeler bağlantı gelince kaydedilecek. Bu sekmeyi kapatma.
        </p>
      )}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-heading text-3xl font-medium tabular-nums" data-testid="came-count">
            Geldi {came} / {roster.length}
            {unsaved && "*"}
          </p>
          <p className="text-sm text-muted-foreground">
            {count("late")} geç · {count("excused")} mazeretli · {count("absent")} gelmedi ·{" "}
            {count(null)} işaretlenmedi
          </p>
        </div>
        {unsaved && (
          <p className="text-xs text-muted-foreground">* kaydedilmemiş işaretler dahil</p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="İsim ara"
            aria-label="İsim ara"
            className="h-11 w-full rounded-xl border border-input bg-card pr-4 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
        </div>
      </div>

      {GROUPS.map((group) => {
        const members = roster
          .filter((r) => (r.voicePart ?? "none") === group && visible(r))
          .sort((a, b) => collator.compare(a.name, b.name));
        const all = roster.filter((r) => (r.voicePart ?? "none") === group);
        if (all.length === 0) return null;
        const groupCame = all.filter((r) => r.status === "present" || r.status === "late").length;
        const unmarked = all.filter((r) => r.status === null).length;
        return (
          <section
            key={group}
            aria-label={group === "none" ? "Partisyonsuz" : VOICE_PART_LABELS[group]}
          >
            <div className="flex items-center justify-between gap-3 py-2">
              <h3 className="inline-flex items-center gap-2 font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
                {group !== "none" && (
                  <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[group].dot)} />
                )}
                {group === "none" ? "Partisyon yok" : VOICE_PART_LABELS[group]} · {groupCame}/
                {all.length}
              </h3>
              {canClear && (
                <Button
                  variant="ghost"
                  disabled={unmarked === 0 || !online}
                  onClick={() => void bulk(group)}
                  className="h-9 rounded-full px-3 text-xs"
                >
                  <CheckCheck />
                  Kalanları geldi işaretle
                </Button>
              )}
            </div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {members.map((r) => (
                <RosterRow
                  key={r.userId}
                  row={r}
                  onMark={mark}
                  canClear={canClear}
                  imported={imported}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {extras.length > 0 && (
        <section aria-label="Listede olmayanlar">
          <h3 className="py-2 font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Listede olmayanlar
          </h3>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {extras.filter(visible).map((r) => (
              <RosterRow
                key={r.userId}
                row={r}
                onMark={mark}
                canClear={canClear}
                imported={imported}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RosterRow({
  row,
  onMark,
  canClear,
  imported,
}: {
  row: LiveRow & { pending?: Pending };
  onMark: (userId: string, status: AttendanceStatus | null) => void;
  canClear: boolean;
  imported: boolean;
}) {
  const sub = row.pending?.failed
    ? null
    : row.status === "excused" && row.note
      ? `“${row.note}”`
      : imported && row.status && !row.corrected && !row.pending
        ? "İçe aktarıldı"
        : row.method && row.recordedAt
          ? `${METHOD_LABELS[row.method as keyof typeof METHOD_LABELS]} · ${timeFormat.format(new Date(row.recordedAt))}${
              row.method === "manual" && row.recordedByName
                ? ` · ${row.recordedByName.split(" ")[0]}`
                : ""
            }`
          : null;
  return (
    <li
      className="flex flex-col gap-2 px-4 py-3 sm:min-h-16 sm:flex-row sm:items-center sm:gap-3 sm:py-2"
      data-testid="roster-row"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full text-xs font-medium",
          row.voicePart ? VOICE_PART_STYLES[row.voicePart as VoicePart].soft : "bg-muted",
          row.voicePart
            ? VOICE_PART_STYLES[row.voicePart as VoicePart].text
            : "text-muted-foreground",
        )}
        aria-hidden
      >
        {row.voicePart ? VOICE_PART_SHORT[row.voicePart as VoicePart] : "–"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.name}</p>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {row.pending?.failed ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              Kaydedilmedi <RotateCw className="size-3" aria-hidden />
            </span>
          ) : (
            <>
              {sub}
              {row.corrected && row.recordedByName && (
                <span className="ml-1">· Düzeltildi · {row.recordedByName.split(" ")[0]}</span>
              )}
            </>
          )}
        </p>
      </div>
      <div className="flex w-full items-center gap-1 sm:w-auto">
        <StatusSegment
          name={row.name}
          value={row.status as AttendanceStatus | null}
          onChange={(s) => onMark(row.userId, s)}
        />
        {canClear && row.status && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMark(row.userId, null)}
            aria-label={`${row.name}: işareti kaldır`}
            className="size-11 rounded-xl text-muted-foreground"
          >
            <Eraser />
          </Button>
        )}
      </div>
    </li>
  );
}

export function StatusSegment({
  name,
  value,
  onChange,
}: {
  name: string;
  value: AttendanceStatus | null;
  onChange: (status: AttendanceStatus) => void;
}) {
  const focusIndex = value ? ATTENDANCE_STATUSES.indexOf(value) : 0;
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (Math.max(current, 0) + delta + buttons.length) % buttons.length;
    buttons[next]?.focus();
    onChange(ATTENDANCE_STATUSES[next]);
  }
  return (
    <div
      role="radiogroup"
      aria-label={`${name} yoklama durumu`}
      onKeyDown={onKeyDown}
      className="grid flex-1 grid-cols-4 gap-0.5 rounded-xl border bg-card p-0.5 sm:inline-flex sm:flex-none"
    >
      {ATTENDANCE_STATUSES.map((s, i) => {
        const Icon = STATUS_ICONS[s];
        const selected = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={STATUS_SHORT[s]}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(s)}
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-colors sm:px-2.5 sm:text-sm",
              selected ? STATUS_STYLES[s].solid : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className={cn(selected ? "inline" : "inline sm:hidden xl:inline")}>
              {STATUS_SHORT[s]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
