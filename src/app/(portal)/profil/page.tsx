import { ChartColumn, ChevronRight, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { UserAvatar } from "@/components/shell/user-menu";
import { Button } from "@/components/ui/button";
import { VoicePartBadge } from "@/components/voice-part-badge";
import { requireUser } from "@/lib/auth/dal";
import { MyDuesSection } from "@/components/finance/my-dues";
import { InstallCard } from "@/components/install-card";
import { ROLE_LABELS } from "@/lib/labels";
import { isManager } from "@/lib/permissions";
import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata = { title: "Profilim" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <div className="max-w-xl space-y-10">
      <div className="flex items-center gap-4">
        <UserAvatar name={user.name} className="size-16 [&_[data-slot=avatar-fallback]]:text-xl" />
        <div className="space-y-1.5">
          <h1 className="text-3xl font-medium">{user.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {ROLE_LABELS[user.role]}
            {user.voicePart && <VoicePartBadge part={user.voicePart} />}
          </div>
        </div>
      </div>

      <InstallCard />

      <MyDuesSection />

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-medium">Bilgilerin</h2>
          <p className="text-sm text-muted-foreground">
            E-posta: {user.email}. E-posta, rol ve partisyonu yönetim değiştirebilir.
          </p>
        </div>
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

      <form action={logout} className="border-t pt-6">
        <Button
          type="submit"
          variant="ghost"
          className="h-11 rounded-xl px-4 text-muted-foreground"
        >
          <LogOut />
          Çıkış yap
        </Button>
      </form>
    </div>
  );
}
