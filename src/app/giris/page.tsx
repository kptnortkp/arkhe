import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: PageProps<"/giris">) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;

  return (
    <AuthLayout>
      <div className="space-y-2">
        <h1 className="text-3xl font-medium">Tekrar hoş geldin</h1>
        <p className="text-sm text-muted-foreground">
          Hesabın yoksa şefinden ya da yönetimden davet linki iste.
        </p>
      </div>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthLayout>
  );
}
