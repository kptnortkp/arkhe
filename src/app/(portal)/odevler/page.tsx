import { CircleCheck, Grid3x3, Mic, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { FilterChip } from "@/components/filter-chip";
import { ManagerRow, SingerRow } from "@/components/homework/homework-rows";
import { RecordingEmailDialog } from "@/components/homework/recording-email-dialog";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/dal";
import {
  countHomework,
  getRecordingEmail,
  HOMEWORK_VIEWS,
  listForManager,
  listForSinger,
  loadViewer,
  type HomeworkView,
} from "@/lib/homework/queries";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { isManager } from "@/lib/permissions";
import { now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Ödevler" };

const eyebrow = "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";

export default async function HomeworkPage({ searchParams }: PageProps<"/odevler">) {
  const user = await requireUser();
  const viewer = (await loadViewer(user.id))!;
  const manager = isManager(user.role);
  const params = await searchParams;
  const view = HOMEWORK_VIEWS.includes(params.liste as HomeworkView)
    ? (params.liste as HomeworkView)
    : "guncel";
  const at = now();
  const href = (v: HomeworkView) => (v === "guncel" ? "/odevler" : `/odevler?liste=${v}`);

  if (manager) {
    const [rows, mine, email, counts] = await Promise.all([
      listForManager(view, at),
      listForSinger(viewer, view, at),
      getRecordingEmail(),
      Promise.all(HOMEWORK_VIEWS.map((v) => countHomework(v, at))),
    ]);
    const ownPending = new Set(mine.filter((r) => r.expected && !r.submittedAt).map((r) => r.id));
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-4xl font-medium">Ödevler</h1>
          <Link href="/odevler/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-4")}>
            <Plus />
            Ödev ver
          </Link>
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/odevler/matris"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4")}
            >
              <Grid3x3 />
              Teslim matrisi
            </Link>
            <RecordingEmailDialog current={email} />
          </div>
          {email && (
            <p className="text-xs text-muted-foreground">Kayıtlar şu adrese gidiyor: {email}</p>
          )}
        </div>
        {!email && (
          <div
            className="flex gap-3 rounded-2xl border border-late/40 bg-late/10 p-4"
            data-testid="email-missing"
          >
            <TriangleAlert className="size-5 shrink-0 text-late-ink" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm">
                Kayıt e-postası ayarlanmadı. Koristler kaydını nereye göndereceğini göremiyor.
              </p>
              <RecordingEmailDialog current={null} label="Ayarla" variant="outline" />
            </div>
          </div>
        )}
        <nav aria-label="Ödev listesi" className="flex gap-2">
          <FilterChip
            href={href("guncel")}
            active={view === "guncel"}
            label="Güncel"
            count={counts[0]}
          />
          <FilterChip
            href={href("gecmis")}
            active={view === "gecmis"}
            label="Geçmiş"
            count={counts[1]}
          />
        </nav>
        {rows.length === 0 ? (
          <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
            <Mic className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {view === "guncel" ? "Şu an ödev yok." : "Geçmiş ödev yok."}
            </p>
            {view === "guncel" && (
              <Link href="/odevler/yeni" className={cn(buttonVariants(), "h-11 rounded-full px-5")}>
                Ödev ver
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {rows.map((r) => (
              <ManagerRow key={r.id} row={r} at={at} ownPending={ownPending.has(r.id)} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const [rows, other] = await Promise.all([
    listForSinger(viewer, view, at),
    listForSinger(viewer, view === "guncel" ? "gecmis" : "guncel", at),
  ]);
  const todo = rows.filter((r) => !r.submittedAt);
  const done = rows
    .filter((r) => r.submittedAt)
    .sort((a, b) => b.submittedAt!.getTime() - a.submittedAt!.getTime());
  const pending = (view === "guncel" ? todo : []).filter((r) => r.expected).length;
  const optional = (view === "guncel" ? todo : []).filter((r) => !r.expected).length;
  const counts = view === "guncel" ? [rows.length, other.length] : [other.length, rows.length];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl font-medium">Ödevler</h1>
        {viewer.voicePart && view === "guncel" && (
          <p className="text-sm text-muted-foreground">
            {VOICE_PART_LABELS[viewer.voicePart]} ·{" "}
            {pending
              ? `${pending} bekleyen`
              : optional
                ? `${optional} isteğe bağlı`
                : "hepsi tamam"}
          </p>
        )}
      </div>
      <nav aria-label="Ödev listesi" className="flex gap-2">
        <FilterChip
          href={href("guncel")}
          active={view === "guncel"}
          label="Güncel"
          count={counts[0]}
        />
        <FilterChip
          href={href("gecmis")}
          active={view === "gecmis"}
          label="Geçmiş"
          count={counts[1]}
        />
      </nav>
      {rows.length === 0 ? (
        <div className="staff-lines space-y-2 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <Mic className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">
            {view === "guncel" ? "Şu an ödev yok." : "Geçmiş ödev yok."}
          </p>
          {view === "guncel" && (
            <p className="text-sm text-muted-foreground">Şef ödev verince burada görünür.</p>
          )}
        </div>
      ) : (
        <>
          {view === "guncel" && todo.length === 0 && (
            <p className="flex items-center gap-2 rounded-2xl bg-present/10 p-4 text-sm text-present-ink">
              <CircleCheck className="size-5" aria-hidden />
              Bütün ödevlerini teslim ettin.
            </p>
          )}
          {todo.length > 0 && (
            <section aria-labelledby="todo" className="space-y-2">
              <h2 id="todo" className={eyebrow}>
                Yapılacak
              </h2>
              <ul
                className="divide-y overflow-hidden rounded-2xl border bg-card"
                data-testid="todo-list"
              >
                {todo.map((r) => (
                  <SingerRow key={r.id} row={r} at={at} calm={view === "gecmis"} />
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="done" className="space-y-2">
              <h2 id="done" className={eyebrow}>
                Teslim ettiklerim
              </h2>
              <ul
                className="divide-y overflow-hidden rounded-2xl border bg-card"
                data-testid="done-list"
              >
                {done.map((r) => (
                  <SingerRow key={r.id} row={r} at={at} calm />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
