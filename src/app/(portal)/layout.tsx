import Link from "next/link";
import { ArkheLockup, ArkheWordmark } from "@/components/arkhe-logo";
import { BottomNav, SidebarNav } from "@/components/shell/app-nav";
import { SidebarUserActions, UserAvatar } from "@/components/shell/user-menu";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { FlashToast } from "@/components/flash-toast";
import { PushSync } from "@/components/notifications/push-sync";
import { requireUser } from "@/lib/auth/dal";
import { boardBadgeCount } from "@/lib/board/queries";
import { readFlash } from "@/lib/flash";
import { reviewBadgeCount } from "@/lib/review/queries";
import { openHomeworkCount } from "@/lib/homework/queries";
import { ROLE_LABELS } from "@/lib/labels";
import { isManager } from "@/lib/permissions";

export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const canManage = isManager(user.role);
  const [homework, board, review, flash] = await Promise.all([
    openHomeworkCount(user.id),
    boardBadgeCount(),
    // The conductor only: assistant-noted takes waiting for the comment (D14).
    user.role === "conductor" ? reviewBadgeCount() : 0,
    readFlash(),
  ]);
  const badges = { homework, board, review };

  return (
    <div className="flex min-h-dvh">
      <a
        href="#icerik"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        İçeriğe geç
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-6 md:flex">
        <Link href="/" className="px-3" aria-label="Ana sayfa">
          {/* At 1× the subtitle is a 3.7 px smudge: wordmark there, full lockup from 2dppx. */}
          <ArkheWordmark
            density="small"
            className="h-auto w-44 [@media(min-resolution:2dppx)]:hidden"
          />
          <ArkheLockup className="hidden w-44 [@media(min-resolution:2dppx)]:block" />
        </Link>
        <div className="mt-8 flex-1">
          <SidebarNav canManage={canManage} badges={badges} />
        </div>
        <SidebarUserActions />
        <div className="mt-3 flex items-center gap-3 border-t px-2 pt-4">
          <UserAvatar name={user.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/85 px-4 py-3 backdrop-blur-lg md:hidden">
          <Link
            href="/"
            aria-label="Ana sayfa"
            className="-my-3 inline-flex min-h-11 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArkheWordmark className="h-5" density="small" />
          </Link>
          <Link href="/profil" className="flex items-center gap-2" aria-label="Profilim">
            {user.voicePart && <VoicePartBadge part={user.voicePart} />}
            <UserAvatar name={user.name} className="size-8" />
          </Link>
        </header>
        <main
          id="icerik"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 md:px-10 md:pt-10 md:pb-12"
        >
          {children}
        </main>
      </div>

      <BottomNav canManage={canManage} badges={badges} />
      {flash && <FlashToast key={flash} message={flash} />}
      <PushSync userId={user.id} />
    </div>
  );
}
