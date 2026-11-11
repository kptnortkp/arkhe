import {
  Bug,
  ChartColumn,
  ChevronRight,
  DatabaseBackup,
  FileUp,
  LogOut,
  Megaphone,
  MessageSquareWarning,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { LogoutForm } from "@/components/shell/logout-form";
import { UserAvatar } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { ItBadge } from "@/components/it-badge";
import { SectionPicker } from "@/components/section-picker";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { requireUser } from "@/lib/auth/dal";
import { feedTokenOf, feedUrl } from "@/lib/calendar-feed/tokens";
import { CalendarFeedSection } from "@/components/calendar-feed-section";
import { MyDuesSection } from "@/components/finance/my-dues";
import { InstallCard } from "@/components/install-card";
import { NotificationsSection } from "@/components/notifications/notifications-section";
import { ROLE_LABELS } from "@/lib/labels";
import { isManager } from "@/lib/permissions";
import { reportNavCount } from "@/lib/reports/queries";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata = { title: "Profilim" };

export default async function ProfilePage() {
  const user = await requireUser();
  const [openReports, feedToken] = await Promise.all([
    reportNavCount(user.id),
    feedTokenOf(user.id),
  ]);
  return (
    <div className="max-w-xl space-y-10">
      <div className="flex items-center gap-4">
        <UserAvatar name={user.name} className="size-16 [&_[data-slot=avatar-fallback]]:text-xl" />
        <div className="space-y-1.5">
          <h1 className="text-3xl font-medium">{user.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {ROLE_LABELS[user.role]}
            {openReports !== null && <ItBadge />}
            {user.voicePart && <VoicePartBadge part={user.voicePart} section={user.voiceSection} />}
          </div>
        </div>
      </div>

      <InstallCard />

      <NotificationsSection userId={user.id} />

      <MyDuesSection />

      <CalendarFeedSection url={feedToken ? feedUrl(feedToken) : null} />

      <nav aria-label="Duyurular" data-testid="profile-announcements">
        <ProfileRow
          href="/duyurular"
          label="Duyurular"
          hint="Şef ve yönetimden gelen duyurular"
          icon={Megaphone}
        />
      </nav>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-medium">Bilgilerin</h2>
          <p className="text-sm text-muted-foreground">
            E-posta: {user.email}. E-posta, rol ve partisyonu yönetim değiştirebilir.
          </p>
        </div>
        {user.voicePart && <SectionPicker part={user.voicePart} section={user.voiceSection} />}
        <ProfileForm name={user.name} phone={user.phone} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-medium">Şifre</h2>
        <PasswordForm email={user.email} />
      </section>

      {isManager(user.role) && (
        <nav aria-label="Yönetim" className="space-y-2" data-testid="profile-manager-links">
          {(
            [
              ["/finans", "Finans", "Kasa, aidat, raporlar", Wallet],
              ["/raporlar", "Raporlar", "Devam ve uyarılar", ChartColumn],
              ["/yedek", "Yedekleme", "Aylık rapor ve yedek e-postası", DatabaseBackup],
              ["/ice-aktar", "Veri içe aktar", "Eski kayıtları toplu aktar", FileUp],
            ] as const
          ).map(([href, label, hint, Icon]) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 transition-colors hover:bg-muted/50"
            >
              <Icon className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-muted-foreground">{hint}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </nav>
      )}

      <nav aria-label="Destek" className="space-y-2" data-testid="profile-support-links">
        {openReports !== null && (
          <ProfileRow
            href="/sorunlar"
            label="Sorunlar"
            hint={openReports > 0 ? `${openReports} açık bildirim` : "Açık bildirim yok"}
            icon={Bug}
          />
        )}
        <ProfileRow
          href="/sorun-bildir"
          label="Sorun bildir"
          hint="Portalda bir şey ters gittiyse yaz"
          icon={MessageSquareWarning}
        />
      </nav>

      <LogoutForm className="border-t pt-6">
        <Button
          type="submit"
          variant="ghost"
          className="h-11 rounded-xl px-4 text-muted-foreground"
        >
          <LogOut />
          Çıkış yap
        </Button>
      </LogoutForm>
    </div>
  );
}

function ProfileRow({
  href,
  label,
  hint,
  icon: Icon,
}: {
  href: string;
  label: string;
  hint: string;
  icon: typeof Bug;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 transition-colors hover:bg-muted/50"
    >
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}
