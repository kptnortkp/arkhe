import { Headphones, Play } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterChip } from "@/components/filter-chip";
import { Back } from "@/components/review/back";
import { QueueGroups, reviewHref } from "@/components/review/queue";
import { buttonVariants } from "@/components/ui/button";
import { VOICE_PARTS } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { canSeeQueue, effectiveScope, isConductor } from "@/lib/review/access";
import { assistantList } from "@/lib/review/assistants";
import {
  assistantChip,
  assistantQueue,
  conductorChip,
  conductorCounts,
  conductorQueue,
  firstToReview,
  groupQueue,
} from "@/lib/review/queries";
import { loadScope } from "@/lib/review/scope";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dinleme" };

const EMPTY = {
  bekleyen: ["Yorum bekleyen kayıt yok.", "Koristler kayıt gönderince burada görünür."],
  "asistan-notlu": ["Asistan notu bekleyen kayıt yok.", null],
  yorumlanan: ["Henüz yorum yazmadın.", null],
  dinlenecek: ["Dinlenecek kayıt yok.", "Yeni kayıt gelince burada görünür."],
  notlarim: ["Henüz not yazmadın.", null],
} as const;

function partsText(parts: readonly (typeof VOICE_PARTS)[number][]) {
  if (parts.length === VOICE_PARTS.length) return "Tüm partisyonların kayıtları";
  const names = parts.map((p) => VOICE_PART_LABELS[p]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names.at(-1)}` : names[0];
  return `${list} kayıtları`;
}

export default async function QueuePage({ searchParams }: PageProps<"/odevler/dinle">) {
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role };
  const scope = effectiveScope(viewer, await loadScope(user.id));
  if (!canSeeQueue(viewer, scope)) redirect("/odevler");
  const sp = await searchParams;
  const href = (chip: string) => `/odevler/dinle?filtre=${chip}`;

  let chips: React.ReactNode;
  let body: React.ReactNode;
  let first: string | null = null;
  let total = 0;
  // `Dinlemeye başla (n)` counts the takes it walks first, not the no-recording rows (UX P2-4).
  let startCount = 0;
  let sub: string;
  let notice: React.ReactNode = null;
  let chip: keyof typeof EMPTY;

  if (isConductor(user.role)) {
    const c = conductorChip(sp.filtre);
    chip = c;
    const [{ rows, truncated }, counts, assistants] = await Promise.all([
      conductorQueue(c),
      conductorCounts(),
      assistantList(),
    ]);
    sub = "Koristlere yorumunu buradan yaz.";
    chips = (
      <>
        <FilterChip href={href("bekleyen")} active={c === "bekleyen"} label="Yorum bekleyen" count={counts.total} />
        <FilterChip href={href("asistan-notlu")} active={c === "asistan-notlu"} label="Asistan notlu" count={counts.noted} />
        <FilterChip href={href("yorumlanan")} active={c === "yorumlanan"} label="Yorumlananlar" />
      </>
    );
    if (truncated) notice = <p className="text-xs text-muted-foreground">Son 100 kayıt gösteriliyor.</p>;
    if (assistants.length === 0) {
      notice = (
        <>
          {notice}
          <p className="text-xs text-muted-foreground">
            Henüz dinleme asistanı yok.{" "}
            <Link href="/odevler/asistanlar" className="font-medium text-primary hover:underline">
              Asistan ekle
            </Link>
          </p>
        </>
      );
    }
    total = rows.length;
    const start = firstToReview(rows);
    first = start ? reviewHref(start, c) : null;
    startCount =
      (c === "bekleyen" ? counts.waiting : rows.filter((r) => r.hasAudio).length) || rows.length;
    body = <QueueGroups groups={groupQueue(rows)} chip={c} />;
  } else {
    const c = assistantChip(sp.filtre);
    chip = c;
    const [todo, done] = await Promise.all([
      assistantQueue(viewer, scope, "dinlenecek"),
      assistantQueue(viewer, scope, "notlarim"),
    ]);
    const rows = c === "notlarim" ? done : todo;
    sub = `${partsText(scope)} · notlarını yalnızca şef görür.`;
    chips = (
      <>
        <FilterChip href={href("dinlenecek")} active={c === "dinlenecek"} label="Dinlenecek" count={todo.length} />
        <FilterChip href={href("notlarim")} active={c === "notlarim"} label="Not yazdıklarım" count={done.length} />
      </>
    );
    total = rows.length;
    const start = firstToReview(rows);
    first = start ? reviewHref(start, c) : null;
    startCount = rows.filter((r) => r.hasAudio).length || rows.length;
    body = <QueueGroups groups={groupQueue(rows)} chip={c} />;
  }

  const [emptyTitle, emptyBody] = EMPTY[chip];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-2">
        <Back href="/odevler" label="Ödevler" />
        <h1 className="text-4xl font-medium">Dinleme</h1>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
      <nav aria-label="Dinleme listesi" className="flex flex-wrap gap-2">
        {chips}
      </nav>
      {notice}
      {total === 0 ? (
        <div className="space-y-2 rounded-2xl border border-dashed bg-card px-6 py-10 text-center" data-testid="queue-empty">
          <Headphones className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{emptyTitle}</p>
          {emptyBody && <p className="text-sm text-muted-foreground">{emptyBody}</p>}
        </div>
      ) : (
        <>
          {body}
          {first && (
            <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 -mx-4 bg-background/95 px-4 py-2 md:static md:mx-0 md:bg-transparent md:p-0">
              <Link
                href={first}
                className={cn(buttonVariants(), "h-12 w-full rounded-2xl text-base md:w-auto md:px-6")}
                data-testid="queue-start"
              >
                <Play />
                Dinlemeye başla ({startCount})
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
