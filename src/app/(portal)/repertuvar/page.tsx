import { Library, Plus, Search } from "lucide-react";
import Link from "next/link";
import { FilterChip } from "@/components/filter-chip";
import { ListMemory } from "@/components/repertoire/back-link";
import { PieceRow } from "@/components/repertoire/piece-row";
import { ProgramEditor } from "@/components/repertoire/program-editor";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import { formatDuration } from "@/lib/format";
import { isManager } from "@/lib/permissions";
import { LIST_VIEWS, listPieces, withMyPart, type ListView } from "@/lib/repertoire";
import { cn } from "@/lib/utils";

export const metadata = { title: "Repertuvar" };

const CHIPS: { view: ListView; label: string }[] = [
  { view: "calisiliyor", label: "Çalışılıyor" },
  { view: "program", label: "Program" },
  { view: "hazir", label: "Hazır" },
  { view: "arsiv", label: "Arşiv" },
  { view: "tumu", label: "Tümü" },
];

const EMPTY: Record<ListView, string> = {
  calisiliyor: "Şu an çalışılan eser yok.",
  program: "Program henüz belirlenmedi.",
  hazir: "Konsere hazır eser yok.",
  arsiv: "Arşivde eser yok.",
  tumu: "Repertuvar henüz boş.",
};

export default async function RepertoirePage({ searchParams }: PageProps<"/repertuvar">) {
  const user = await requireUser();
  const manager = isManager(user.role);
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const view = LIST_VIEWS.includes(params.liste as ListView)
    ? (params.liste as ListView)
    : "calisiliyor";
  const { shown, counts, total } = await listPieces(view, q);
  const rows = await withMyPart(shown, user.voicePart);
  const isProgram = view === "program" && !q;
  const chips = CHIPS.filter((c) => c.view !== "program" || manager || counts.program > 0);

  const href = (v: ListView) => (v === "calisiliyor" ? "/repertuvar" : `/repertuvar?liste=${v}`);
  const totalSec =
    isProgram && rows.every((r) => r.durationSec)
      ? rows.reduce((sum, r) => sum + (r.durationSec ?? 0), 0)
      : 0;

  return (
    <div className="space-y-6">
      <ListMemory />
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-4xl font-medium">Repertuvar</h1>
          <p className="text-sm text-muted-foreground">{total} eser</p>
        </div>
        {manager && (
          <Link href="/repertuvar/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-4")}>
            <Plus />
            Eser ekle
          </Link>
        )}
      </div>

      <form className="relative" role="search" action="/repertuvar">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Eser veya besteci ara"
          aria-label="Repertuvarda ara"
          maxLength={100}
          className="h-11 w-full rounded-xl border border-input bg-card pr-4 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </form>

      <nav
        aria-label="Repertuvar listesi"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {chips.map((c) => (
          <FilterChip
            key={c.view}
            href={href(c.view)}
            active={!q && view === c.view}
            label={c.label}
            count={counts[c.view]}
          />
        ))}
      </nav>

      {q && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span data-testid="search-summary">
            &quot;{q}&quot; için {rows.length} sonuç · tüm durumlar
          </span>
          <Link
            href={href(view)}
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            Aramayı temizle
          </Link>
        </p>
      )}

      {isProgram && rows.length > 0 && (
        <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Konser programı · {rows.length} eser
          {totalSec > 0 && ` · toplam ${formatDuration(totalSec)}`}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          {total === 0 ? (
            <>
              <Library className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">Repertuvar henüz boş.</p>
              <p className="text-sm text-muted-foreground">
                {manager ? "" : "Şef eser ekledikçe burada görünecek."}
              </p>
              {manager && (
                <Link
                  href="/repertuvar/yeni"
                  className={cn(buttonVariants(), "h-11 rounded-full px-5")}
                >
                  İlk eseri ekle
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {q ? "Eşleşen eser yok." : EMPTY[view]}
              </p>
              {isProgram && manager && (
                <p className="text-sm text-muted-foreground">
                  Eser sayfasındaki &quot;Programa ekle&quot; ile başla.
                </p>
              )}
              {view === "calisiliyor" && !q && (
                <Link
                  href={href("tumu")}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                >
                  Tüm eserleri gör
                </Link>
              )}
            </>
          )}
        </div>
      ) : isProgram && manager ? (
        <ProgramEditor pieces={rows.map((r) => ({ id: r.id, title: r.title }))}>
          {rows.map((r, i) => (
            <PieceRow
              key={r.id}
              piece={r}
              myPart={r.myPart}
              voicePart={user.voicePart}
              number={i + 1}
              showStatus
            />
          ))}
        </ProgramEditor>
      ) : isProgram ? (
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((r, i) => (
            <PieceRow
              key={r.id}
              piece={r}
              myPart={r.myPart}
              voicePart={user.voicePart}
              number={i + 1}
              showStatus
            />
          ))}
        </ol>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map((r) => (
            <PieceRow
              key={r.id}
              piece={r}
              myPart={r.myPart}
              voicePart={user.voicePart}
              showStatus={Boolean(q) || view === "tumu"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
