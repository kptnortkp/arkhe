"use client";

import { Button } from "@/components/ui/button";

export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center">
      <h1 className="text-2xl font-medium">Bir şeyler ters gitti</h1>
      <p className="text-sm text-muted-foreground">
        Bağlantın kopmuş olabilir. Biraz sonra tekrar dene; sorun sürerse yönetime haber ver.
      </p>
      <Button onClick={reset} className="h-11 rounded-xl px-6">
        Tekrar dene
      </Button>
    </div>
  );
}
