import { ArrowLeft, Check, Clock, X } from "lucide-react";
import Link from "next/link";
import { PartDot } from "@/components/part-dot";
import { buttonVariants } from "@/components/ui/button";
import { VOICE_PARTS } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { barsLabel } from "@/lib/homework/mail";
import { homeworkMatrix, type MatrixCell } from "@/lib/homework/queries";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { formatShortDate, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Teslim matrisi" };

const CELL: Record<MatrixCell, { label: string; className: string; icon?: typeof Check }> = {
  done: { label: "Zamanında", className: "bg-present/14 text-present-ink", icon: Check },
  late: { label: "Geç", className: "bg-late/18 text-late-ink", icon: Clock },
  missing: { label: "Gecikti", className: "bg-absent/12 text-absent-ink", icon: X },
  pending: { label: "Bekleniyor", className: "text-muted-foreground" },
  none: { label: "Bu partisyon için değil", className: "bg-muted/40" },
};

function CellMark({ cell }: { cell: MatrixCell }) {
  const { icon: Icon } = CELL[cell];
  if (Icon) return <Icon className="size-4" aria-hidden />;
  return cell === "pending" ? <span aria-hidden>·</span> : null;
}

export default async function MatrixPage() {
  await requireManager();
  const at = now();
  const { columns, rows } = await homeworkMatrix(at);

  return (
    <div className="space-y-6">
      <Link
        href="/odevler"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Ödevler
      </Link>
      <div className="space-y-1">
        <h1 id="matris-baslik" className="text-4xl font-medium">
          Teslim matrisi
        </h1>
        <p className="text-sm text-muted-foreground">Son 8 ödev · yeni olan solda</p>
      </div>

      {columns.length === 0 ? (
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">Henüz ödev verilmedi.</p>
          <Link href="/odevler/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
            Ödev ver
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Açıklama">
            {(Object.keys(CELL) as MatrixCell[]).map((cell) => (
              <li key={cell} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-md border",
                    CELL[cell].className,
                  )}
                >
                  <CellMark cell={cell} />
                </span>
                {CELL[cell].label}
              </li>
            ))}
          </ul>
          <div
            role="region"
            aria-labelledby="matris-baslik"
            tabIndex={0}
            className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border bg-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            data-testid="matrix"
          >
            <table className="w-max border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Son 8 ödevin teslim durumu</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 w-[6.5rem] border-b bg-card px-3 text-left text-xs font-medium text-muted-foreground"
                  >
                    Korist
                  </th>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" className="h-16 w-14 border-b px-1 align-bottom">
                      <Link
                        href={`/odevler/${c.id}`}
                        title={`${c.pieceTitle} · ${barsLabel(c.barFrom, c.barTo)}`}
                        className="flex min-h-11 flex-col items-center justify-end gap-0.5 pb-2 text-[11px] leading-tight font-medium hover:underline"
                        data-testid="matrix-column"
                        data-id={c.id}
                      >
                        <span className="line-clamp-2 w-14 text-center break-words">
                          {c.pieceTitle.split(" ").slice(0, 2).join(" ")}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {formatShortDate.format(c.dueAt)}
                        </span>
                      </Link>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="sticky right-0 z-10 border-b bg-card px-3 text-xs font-medium text-muted-foreground shadow-[-1px_0_0_var(--border)]"
                  >
                    Toplam
                  </th>
                </tr>
              </thead>
              {VOICE_PARTS.map((part) => {
                const inPart = rows.filter((r) => r.part === part);
                if (inPart.length === 0) return null;
                return (
                  <tbody key={part}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={columns.length + 2}
                        className="bg-muted px-3 py-1.5 text-left text-xs font-medium"
                      >
                        <span className="sticky left-3 inline-flex items-center gap-1.5">
                          <PartDot part={part} />
                          {VOICE_PART_LABELS[part]} · {inPart.length} kişi
                        </span>
                      </th>
                    </tr>
                    {inPart.map((r) => (
                      <tr key={r.id} data-testid="matrix-row" data-name={r.name}>
                        <th
                          scope="row"
                          className="sticky left-0 z-10 max-w-[6.5rem] truncate border-b bg-card px-3 text-left font-medium shadow-[1px_0_0_var(--border)]"
                          title={r.name}
                        >
                          {r.name}
                          {r.left && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              Ayrıldı
                            </span>
                          )}
                        </th>
                        {r.cells.map((cell, i) => {
                          const col = columns[i];
                          const label = `${r.name}, ${col.pieceTitle} ${formatShortDate.format(col.dueAt)}: ${CELL[cell].label}`;
                          return (
                            <td key={col.id} className="border-b p-0.5" data-cell={cell}>
                              {cell === "none" ? (
                                <span
                                  className={cn("block size-11 rounded-md", CELL.none.className)}
                                  aria-label={label}
                                  role="img"
                                />
                              ) : (
                                <Link
                                  href={`/odevler/${col.id}`}
                                  aria-label={label}
                                  className={cn(
                                    "grid size-11 place-items-center rounded-md",
                                    CELL[cell].className,
                                  )}
                                >
                                  <CellMark cell={cell} />
                                </Link>
                              )}
                            </td>
                          );
                        })}
                        <td
                          className={cn(
                            "sticky right-0 border-b bg-card px-3 text-center font-medium tabular-nums shadow-[-1px_0_0_var(--border)]",
                            r.total && r.done / r.total < 0.5 && "text-absent-ink",
                          )}
                        >
                          {r.done}/{r.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
