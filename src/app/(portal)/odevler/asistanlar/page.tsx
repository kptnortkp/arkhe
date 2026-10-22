import { Headphones } from "lucide-react";
import { redirect } from "next/navigation";
import { PartDot } from "@/components/part-dot";
import { AddAssistant, AssistantMenu } from "@/components/review/assistant-sheet";
import { Back } from "@/components/review/back";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { canManageAssistants } from "@/lib/review/access";
import { assistantCandidates, assistantList } from "@/lib/review/assistants";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dinleme asistanları" };

export default async function AssistantsPage() {
  const user = await requireUser();
  if (!canManageAssistants(user.role)) redirect("/odevler");
  const [rows, candidates] = await Promise.all([assistantList(), assistantCandidates()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Back href="/odevler" label="Ödevler" />
        <h1 className="text-4xl font-medium">Dinleme asistanları</h1>
        <p className="text-sm text-muted-foreground">
          Kayıtları senden önce dinleyip sana not bırakırlar. Notlarını yalnızca sen görürsün;
          koriste senin yorumun gider.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
          <Headphones className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Henüz asistan yok.</p>
          <p className="text-sm text-muted-foreground">
            Henüz dinleme asistanı yok. Asistanlar senin seçtiğin partisyonlardaki kayıtları
            dinleyip sana not yazar.
          </p>
          <AddAssistant candidates={candidates} />
        </div>
      ) : (
        <>
          <AddAssistant candidates={candidates} />
          <ul className="divide-y rounded-2xl border bg-card" data-testid="assistant-list">
            {rows.map((r) => (
              <li
                key={r.userId}
                className={cn("flex min-h-16 items-center gap-3 px-4 py-2.5", !r.effective && "opacity-60")}
                data-testid="assistant-row"
                data-user={r.userId}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.effective
                      ? `${r.part ? VOICE_PART_LABELS[r.part] : "Partisyonsuz"} · ${ROLE_LABELS[r.role]}`
                      : r.role === "conductor"
                        ? "Şef oldu · etkin değil"
                        : "Ayrıldı · etkin değil"}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm" data-testid="assistant-scope">
                    {r.allParts
                      ? "Tüm partisyonlar"
                      : r.scope.map((p, i) => (
                          <span key={p} className="inline-flex items-center gap-1.5">
                            {i > 0 && <span className="sr-only">, </span>}
                            <PartDot part={p} />
                            {VOICE_PART_LABELS[p]}
                          </span>
                        ))}
                  </p>
                </div>
                <AssistantMenu
                  row={{ userId: r.userId, name: r.name, scope: r.scope, allParts: r.allParts }}
                  effective={r.effective}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
