import { sql } from "drizzle-orm";
import { ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { FilterChip } from "@/components/filter-chip";
import { UserAvatar } from "@/components/shell/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { db } from "@/db";
import { users, VOICE_PARTS, type VoicePart } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { ROLE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { collator, searchKey } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Üyeler" };

const FILTERS = [...VOICE_PARTS, "pasif"] as const;
type Filter = (typeof FILTERS)[number];

export default async function MembersPage({ searchParams }: PageProps<"/uyeler">) {
  await requireManager();
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const q = searchKey(rawQ);
  const filter = FILTERS.includes(params.p as Filter) ? (params.p as Filter) : undefined;

  const all = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      voicePart: users.voicePart,
      isActive: users.isActive,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`.mapWith(Boolean),
    })
    .from(users);

  all.sort((a, b) => collator.compare(a.name, b.name));
  const active = all.filter((m) => m.isActive);
  const counts = Object.fromEntries(
    VOICE_PARTS.map((part) => [part, active.filter((m) => m.voicePart === part).length]),
  ) as Record<VoicePart, number>;

  const shown = all.filter((m) => {
    if (filter === "pasif" ? m.isActive : !m.isActive) return false;
    if (filter && filter !== "pasif" && m.voicePart !== filter) return false;
    if (q && !searchKey(`${m.name} ${m.email}`).includes(q)) return false;
    return true;
  });

  const href = (p?: Filter) => {
    const sp = new URLSearchParams();
    if (rawQ) sp.set("q", rawQ);
    if (p) sp.set("p", p);
    const s = sp.toString();
    return s ? `/uyeler?${s}` : "/uyeler";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-4xl font-medium">Üyeler</h1>
          <p className="text-sm text-muted-foreground">{active.length} aktif üye</p>
        </div>
        <Link href="/uyeler/yeni" className={cn(buttonVariants(), "h-10 rounded-full px-4")}>
          <Plus />
          Üye ekle
        </Link>
      </div>

      <form className="relative" role="search">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        {filter && <input type="hidden" name="p" value={filter} />}
        <input
          name="q"
          defaultValue={rawQ}
          placeholder="İsim ya da e-posta ara"
          aria-label="Üye ara"
          className="h-11 w-full rounded-xl border border-input bg-card pr-4 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </form>

      <nav
        aria-label="Partisyon filtresi"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        <FilterChip href={href()} active={!filter} label="Tümü" count={active.length} />
        {VOICE_PARTS.map((part) => (
          <FilterChip
            key={part}
            href={href(part)}
            active={filter === part}
            label={VOICE_PART_LABELS[part]}
            count={counts[part]}
          />
        ))}
        <FilterChip
          href={href("pasif")}
          active={filter === "pasif"}
          label="Pasif"
          count={all.length - active.length}
        />
      </nav>

      {shown.length === 0 ? (
        <div className="staff-lines rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          {all.length <= 1
            ? "Henüz üye yok. İlk koristi ekleyerek başla."
            : "Bu filtreye uyan üye yok."}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {shown.map((m) => (
            <li key={m.id}>
              <Link
                href={`/uyeler/${m.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
              >
                <UserAvatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {!m.hasPassword && m.isActive && (
                      <span className="font-medium text-accent-foreground sm:hidden">
                        Davet bekliyor ·{" "}
                      </span>
                    )}
                    {m.role !== "member" ? `${ROLE_LABELS[m.role]} · ` : ""}
                    {m.email}
                  </p>
                </div>
                {!m.hasPassword && m.isActive && (
                  <span className="hidden rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground sm:inline">
                    Davet bekliyor
                  </span>
                )}
                {m.voicePart && <VoicePartBadge part={m.voicePart} />}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
