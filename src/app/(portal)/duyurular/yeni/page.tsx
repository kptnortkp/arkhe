import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { SHOW_DAYS_DEFAULT, SHOW_DAYS_MAX } from "@/lib/announcements/labels";
import { audienceCounts } from "@/lib/announcements/queries";
import { requireManager } from "@/lib/auth/dal";
import { addDays, istanbulDateOf, now } from "@/lib/time";

export const metadata = { title: "Yeni duyuru" };

export default async function NewAnnouncementPage() {
  await requireManager();
  const counts = await audienceCounts();
  const today = istanbulDateOf(now());
  return (
    <div className="max-w-xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/duyurular"
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Duyurular
        </Link>
        <h1 className="text-3xl font-medium">Yeni duyuru</h1>
        <p className="text-sm text-muted-foreground">
          Duyuru seçtiğin kişilere bildirim olarak gider ve ana sayfalarında görünür.
        </p>
      </header>
      <AnnouncementForm
        mode="create"
        counts={counts}
        minDay={today}
        maxDay={addDays(today, SHOW_DAYS_MAX)}
        initial={{
          title: "",
          body: "",
          important: false,
          showUntil: addDays(today, SHOW_DAYS_DEFAULT),
        }}
      />
    </div>
  );
}
