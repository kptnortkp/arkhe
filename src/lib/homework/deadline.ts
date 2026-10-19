import { formatShortDate } from "@/lib/time";

export type DeadlineTone = "green" | "amber" | "red" | "done" | "muted";
export type DeadlineBadge = { tone: DeadlineTone; label: string; late: boolean; overdue: boolean };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The singer-facing deadline state; `now` is injected so a page renders one instant. */
export function deadlineBadge({
  dueAt,
  now,
  submittedAt,
  expected,
}: {
  dueAt: Date;
  now: Date;
  submittedAt: Date | null;
  expected: boolean;
}): DeadlineBadge {
  if (submittedAt) {
    const late = submittedAt > dueAt;
    const day = formatShortDate.format(submittedAt);
    return {
      tone: "done",
      label: `${late ? "Geç teslim" : "Teslim edildi"} · ${day}`,
      late,
      overdue: false,
    };
  }
  const r = dueAt.getTime() - now.getTime();
  if (!expected) {
    return {
      tone: "muted",
      label: r > 0 ? "İsteğe bağlı" : "Son tarih geçti",
      late: false,
      overdue: false,
    };
  }
  if (r > 3 * DAY) {
    return { tone: "green", label: `${Math.ceil(r / DAY)} gün kaldı`, late: false, overdue: false };
  }
  if (r > DAY) {
    return { tone: "amber", label: `${Math.ceil(r / DAY)} gün kaldı`, late: false, overdue: false };
  }
  if (r > 0) {
    const label = r < HOUR ? "1 saatten az kaldı" : `${Math.ceil(r / HOUR)} saat kaldı`;
    return { tone: "red", label, late: false, overdue: false };
  }
  const days = Math.floor(-r / DAY);
  return {
    tone: "red",
    label: days === 0 ? "Gecikti" : `Gecikti · ${days} gün`,
    late: false,
    overdue: true,
  };
}

/** A manager's view of a homework: the deadline itself, not a person's state. */
export function managerBadge(dueAt: Date, now: Date): DeadlineBadge {
  if (dueAt <= now) return { tone: "muted", label: "Süre doldu", late: false, overdue: false };
  return deadlineBadge({ dueAt, now, submittedAt: null, expected: true });
}
