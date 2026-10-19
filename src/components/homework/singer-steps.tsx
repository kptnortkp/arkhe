"use client";

import { Copy, Mail } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const stepNumber =
  "grid size-7 shrink-0 place-items-center rounded-full bg-muted font-heading text-sm font-medium";

/** The three steps: listen, send the mail, mark as submitted (the nudge links steps 2 and 3). */
export function SingerSteps({
  partButton,
  mailto,
  subject,
  email,
  toggle,
  submitted,
}: {
  partButton: React.ReactNode;
  mailto: string | null;
  subject: string;
  email: string | null;
  toggle: React.ReactNode;
  submitted: boolean;
}) {
  const [mailed, setMailed] = useState(false);
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
        onClick={() => setMailed(true)}
        className={cn(
          buttonVariants({ variant: submitted ? "outline" : "default" }),
          "h-12 w-full rounded-2xl text-base",
        )}
        data-testid="mailto"
      >
        <Mail />
        {submitted ? "Yeniden gönder" : "Kaydı e-postayla gönder"}
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

  // One tree for both states: the toggle keeps its place, so focus and its status survive.
  return (
    <ol className="space-y-5">
      {!submitted && (
        <li className="flex gap-3">
          <span className={stepNumber}>1</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-medium">Partisyonunu dinle</p>
            {partButton}
          </div>
        </li>
      )}
      {!submitted && (
        <li className="flex gap-3">
          <span className={stepNumber}>2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-medium">Kaydını gönder</p>
            {mailBlock}
          </div>
        </li>
      )}
      <li className="flex gap-3">
        {!submitted && <span className={stepNumber}>3</span>}
        <div
          className={cn(
            "min-w-0 flex-1 space-y-2 rounded-2xl",
            !submitted && mailed && "ring-2 ring-primary ring-offset-4 ring-offset-card",
          )}
        >
          {!submitted && <p className="font-medium">Gönderdiysen işaretle</p>}
          {!submitted && mailed && (
            <p className="text-sm">
              E-postayı gönderdin mi? Gönderdiysen &quot;Teslim ettim&quot;e dokun.
            </p>
          )}
          {toggle}
          {submitted && mailto && <div className="pt-2">{mailBlock}</div>}
        </div>
      </li>
    </ol>
  );
}
