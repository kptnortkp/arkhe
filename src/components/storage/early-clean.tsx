"use client";

import { useState } from "react";
import { earlyClean } from "@/app/(portal)/odevler/depolama/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/use-run-action";

export function EarlyClean({ count, size }: { count: number; size: string }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <section id="yer-ac" aria-labelledby="yer-ac-baslik" className="scroll-mt-20 space-y-3 rounded-2xl border bg-card p-4">
      <h2 id="yer-ac-baslik" className="text-xl font-medium">
        Yer aç
      </h2>
      <p className="text-sm" data-testid="early-clean-text">
        {count > 0
          ? `Yorumu 30 günden eski olan kayıtların ses dosyalarını şimdi sil: ${count} kayıt, ${size}. Yorumlar ve notlar kalır.`
          : "Yorumu 30 günden eski kayıt yok."}
      </p>
      <Button
        variant="outline"
        className="h-12 w-full text-absent-ink md:w-auto md:px-6"
        disabled={count === 0 || pending}
        aria-label={`Yorumlanmış kayıtlardan 30 günden eskileri şimdi sil (${count} kayıt, ${size})`}
        onClick={() => setOpen(true)}
      >
        Şimdi sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${count} kaydın ses dosyası silinsin mi?`}
        description="Koristler bu kayıtları artık dinleyemez. Yorumlar ve notlar kalır. Bu işlem geri alınamaz."
        pending={pending}
        actions={[{ label: "Sil", run: () => run(() => earlyClean(), () => setOpen(false)) }]}
      />
    </section>
  );
}
