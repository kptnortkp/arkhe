import { Megaphone, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { DeleteAnnouncementButton } from "@/components/announcements/delete-button";
import { ImportantChip } from "@/components/announcements/important-chip";
import { LinkifiedText } from "@/components/announcements/linkified-text";
import { buttonVariants } from "@/components/ui/button";
import { AUDIENCE_LABELS } from "@/lib/announcements/labels";
import { listAnnouncements, type ManagedAnnouncement } from "@/lib/announcements/queries";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { isManager } from "@/lib/permissions";
import { dayInstant, formatAuditDateTime, formatShortDate, istanbulDateOf, now } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Duyurular" };

function audienceText(a: ManagedAnnouncement) {
  return a.audience === "parts"
    ? a.parts.map((p) => VOICE_PART_LABELS[p]).join(", ")
    : AUDIENCE_LABELS[a.audience];
}

export default async function AnnouncementsPage() {
  const user = await requireUser();
  const manager = isManager(user.role);
  const list = await listAnnouncements(user);
  const today = istanbulDateOf(now());
  return (
    <div className="max-w-2xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-medium">Duyurular</h1>
          <p className="text-sm text-muted-foreground">Koro şefi ve yönetimden gelen duyurular.</p>
        </div>
        {manager && (
          <Link
            href="/duyurular/yeni"
            className={cn(buttonVariants(), "h-11 rounded-full px-4")}
            data-testid="announcement-new"
          >
            <Plus aria-hidden />
            Yeni duyuru
          </Link>
        )}
      </header>

      {list.length === 0 ? (
        <div
          className="space-y-2 rounded-2xl border border-dashed bg-card px-6 py-10 text-center"
          data-testid="announcements-empty"
        >
          <Megaphone aria-hidden className="mx-auto size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Henüz duyuru yok.</p>
        </div>
      ) : (
        <ul className="space-y-4" data-testid="announcement-list">
          {list.map((a) => (
            <li
              key={a.id}
              id={a.id}
              data-id={a.id}
              data-testid="announcement"
              className={cn(
                "scroll-mt-20 space-y-3 rounded-2xl border p-4 md:p-5",
                a.important ? "border-absent/45 bg-absent/8" : "bg-card",
              )}
            >
              <div className="flex items-start gap-2">
                <h2
                  className={cn(
                    "min-w-0 flex-1 text-xl font-medium [overflow-wrap:anywhere]",
                    a.important && "text-absent-ink",
                  )}
                >
                  {a.title}
                </h2>
                {a.important && <ImportantChip />}
              </div>
              <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="announcement-body">
                <LinkifiedText text={a.body} />
              </p>
              <p className="text-xs text-muted-foreground">
                {a.senderName} · {ROLE_LABELS[a.senderRole]} ·{" "}
                <time dateTime={a.createdAt.toISOString()}>{formatAuditDateTime(a.createdAt)}</time>
                {a.updatedAt.getTime() - a.createdAt.getTime() > 60_000 && " · düzenlendi"}
              </p>
              {manager && (
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground"
                  data-testid="announcement-manage"
                >
                  <span>Kime: {audienceText(a)}</span>
                  <span data-testid="announcement-reads" className="tabular-nums">
                    Okuyan: {a.readCount}/{a.audienceCount}
                  </span>
                  <span>
                    {a.showUntil >= today
                      ? `Ana sayfada ${formatShortDate.format(dayInstant(a.showUntil))} tarihine kadar`
                      : "Ana sayfadan kalktı"}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <Link
                      href={`/duyurular/${a.id}/duzenle`}
                      className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-3")}
                      data-testid="announcement-edit"
                    >
                      <Pencil aria-hidden />
                      Düzenle
                    </Link>
                    <DeleteAnnouncementButton id={a.id} title={a.title} />
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
