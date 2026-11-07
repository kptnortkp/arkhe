import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { SHOW_DAYS_MAX } from "@/lib/announcements/labels";
import { audienceIds, visibleAnnouncement } from "@/lib/announcements/queries";
import { requireManager } from "@/lib/auth/dal";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export const metadata = { title: "Duyuruyu düzenle" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditAnnouncementPage({
  params,
}: PageProps<"/duyurular/[id]/duzenle">) {
  const user = await requireManager();
  const { id } = await params;
  const a = UUID.test(id) ? await visibleAnnouncement(user, id) : null;
  if (!a) notFound();
  const resendCount = (await audienceIds(a.audience, a.parts)).filter((u) => u !== user.id).length;
  const today = istanbulDateOf(now());
  return (
    <div className="max-w-xl space-y-8">
      <header className="space-y-2">
        <Link
          href={`/duyurular#${a.id}`}
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Duyurular
        </Link>
        <h1 className="text-3xl font-medium">Duyuruyu düzenle</h1>
        <p className="text-sm text-muted-foreground">
          Kaydetmek bildirimi tekrar göndermez; istersen aşağıdan tekrar bildirebilirsin.
        </p>
      </header>
      <AnnouncementForm
        mode="edit"
        id={a.id}
        audience={a.audience}
        parts={a.parts}
        resendCount={resendCount}
        minDay={a.showUntil < today ? a.showUntil : today}
        maxDay={addDays(today, SHOW_DAYS_MAX)}
        initial={{
          title: a.title,
          body: a.body,
          important: a.important,
          showUntil: a.showUntil,
        }}
      />
    </div>
  );
}
