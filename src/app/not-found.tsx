import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">404</p>
      <h1 className="text-3xl font-medium">Sayfa bulunamadı</h1>
      <p className="text-sm text-muted-foreground">Link eski ya da yanlış olabilir.</p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
