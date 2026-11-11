import { ne } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ReadinessBar, readinessText } from "@/components/repertoire/readiness-summary";
import { db } from "@/db";
import { pieces } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { collator } from "@/lib/format";
import { READINESS_STYLES, VOICE_PART_LABELS } from "@/lib/labels";
import { readinessByPart } from "@/lib/repertoire-readiness";
import { cn } from "@/lib/utils";

export const metadata = { title: "Eser hazırlığı" };

/** Every piece still sung, each part's own "how ready am I" answers side by side. */
export default async function ReadinessReportPage() {
  await requireManager();
  const list = (
    await db
      .select({ id: pieces.id, title: pieces.title, programPosition: pieces.programPosition })
      .from(pieces)
      .where(ne(pieces.status, "archive"))
  ).sort(
    (a, b) =>
      (a.programPosition ?? Infinity) - (b.programPosition ?? Infinity) ||
      collator.compare(a.title, b.title),
  );
  const byPiece = await readinessByPart(list.map((p) => p.id));
  const answered = [...byPiece.values()]
    .flat()
    .reduce((s, r) => s + r.counts.ready + r.counts.partial + r.counts.not_ready, 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-3">
        <Link
          href="/raporlar"
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Raporlar
        </Link>
        <h1 className="text-4xl font-medium">Eser hazırlığı</h1>
        <p className="text-sm text-muted-foreground">
          Koristlerin her eserde kendi işaretlediği durum. Koristler eser sayfasından “Hazır değilim
          · Kısmen · Hazırım” seçer.
        </p>
        <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Renkler">
          <li className={cn("rounded-full px-2.5 py-0.5", READINESS_STYLES.ready.chip)}>Hazırım</li>
          <li className={cn("rounded-full px-2.5 py-0.5", READINESS_STYLES.partial.chip)}>
            Kısmen
          </li>
          <li className={cn("rounded-full px-2.5 py-0.5", READINESS_STYLES.not_ready.chip)}>
            Hazır değilim
          </li>
          <li className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">Cevap yok</li>
        </ul>
      </div>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Çalışılan eser yok.
        </p>
      ) : (
        <>
          {answered === 0 && (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm">
              Henüz kimse işaretlemedi. Koristlere eser sayfasındaki “Bu eserde ne durumdasın?”
              sorusunu hatırlatabilirsin.
            </p>
          )}
          <ul className="space-y-3">
            {list.map((piece) => (
              <li
                key={piece.id}
                className="rounded-2xl border bg-card p-4"
                data-testid="readiness-piece"
                data-piece={piece.id}
              >
                <Link href={`/repertuvar/${piece.id}`} className="font-medium hover:underline">
                  {piece.title}
                </Link>
                <dl className="mt-3 space-y-2.5">
                  {(byPiece.get(piece.id) ?? []).map((row) => (
                    <div
                      key={row.part}
                      className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3"
                    >
                      <dt className="text-sm">{VOICE_PART_LABELS[row.part]}</dt>
                      <dd className="space-y-1" data-part={row.part}>
                        <ReadinessBar row={row} />
                        <p className="text-xs text-muted-foreground" data-testid="readiness-text">
                          {readinessText(row)}
                        </p>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
