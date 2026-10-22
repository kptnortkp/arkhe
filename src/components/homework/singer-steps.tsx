"use client";

import { Copy, Mail } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { copyText } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The Phase 4 mail block, now inside `Başka yolla gönderdim` (D5). */
export function MailBlock({
  mailto,
  subject,
  email,
}: {
  mailto: string | null;
  subject: string;
  email: string | null;
}) {
  const subjectRef = useRef<HTMLParagraphElement>(null);

  async function copy() {
    if (await copyText(subject)) {
      toast.success("Konu kopyalandı.");
    } else {
      toast.error("Kopyalanamadı, konuyu elle seç.");
      const range = document.createRange();
      if (subjectRef.current) {
        range.selectNodeContents(subjectRef.current);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
    }
  }

  const mailBlock = mailto ? (
    <div className="space-y-3">
      <a
        href={mailto}
        className={cn(buttonVariants({ variant: "outline" }), "h-12 w-full rounded-2xl text-base")}
        data-testid="mailto"
      >
        <Mail />
        Kaydı e-postayla gönder
        <span className="sr-only"> (e-posta uygulaman açılır)</span>
      </a>
      <p className="text-xs text-muted-foreground">
        Kaydını e-postaya eklemeyi unutma. Dosya büyükse Drive&apos;a koyup bağlantısını yapıştır.
      </p>
      <div className="space-y-2 rounded-xl bg-muted p-3">
        <p className="text-xs text-muted-foreground">Konu</p>
        <p
          ref={subjectRef}
          className="font-mono text-sm break-words select-all"
          data-testid="subject"
        >
          {subject}
        </p>
        <Button variant="outline" className="h-11 rounded-xl px-4" onClick={copy}>
          <Copy />
          Konuyu kopyala
        </Button>
        <p className="text-xs text-muted-foreground">
          Adres: <span className="select-all">{email}</span>
        </p>
      </div>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground" data-testid="email-missing">
      Kayıt e-postası henüz ayarlanmadı. Kaydını şefe nasıl ileteceğini sor.
    </p>
  );

  return mailBlock;
}
