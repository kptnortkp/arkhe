import { eq } from "drizzle-orm";
import Link from "next/link";
import { AuthLayout } from "@/components/auth-layout";
import { db } from "@/db";
import { users } from "@/db/schema";
import { findValidLink } from "@/lib/auth/set-password-links";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Şifre belirle", referrer: "no-referrer" };

export default async function InvitePage({ params }: PageProps<"/davet/[token]">) {
  const { token } = await params;
  const link = await findValidLink(token);
  const [user] = link
    ? await db
        .select({
          name: users.name,
          email: users.email,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, link.userId))
        .limit(1)
    : [];

  if (!link || !user?.isActive) {
    return (
      <AuthLayout>
        <div className="space-y-3">
          <h1 className="text-3xl font-medium">Link geçersiz</h1>
          <p className="text-sm text-muted-foreground">
            Bu link kullanılmış ya da süresi dolmuş. Şefinden ya da yönetimden yeni bir link iste.
          </p>
        </div>
        <Link href="/giris" className="text-sm font-medium text-primary hover:underline">
          Giriş sayfasına dön
        </Link>
      </AuthLayout>
    );
  }

  const firstName = user.name.split(" ")[0];
  return (
    <AuthLayout>
      <div className="space-y-2">
        <h1 className="text-3xl font-medium">
          {link.purpose === "invite" ? `Hoş geldin, ${firstName}` : "Yeni şifre belirle"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {link.purpose === "invite"
            ? "Arkhe Portal'a girmek için kendine bir şifre belirle."
            : "Hesabın için yeni şifreni belirle."}
        </p>
        <p className="rounded-xl bg-muted px-3.5 py-2.5 text-sm">
          Giriş e-postan: <span className="font-medium">{user.email}</span>
        </p>
      </div>
      <SetPasswordForm token={token} email={user.email} />
    </AuthLayout>
  );
}
