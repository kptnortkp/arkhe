"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { dateTimeFormat, firstName } from "@/lib/format";
import { cn } from "@/lib/utils";

/** wa.me wants digits in international format; Turkish numbers are usually typed as 05xx. */
function whatsappNumber(phone: string | null) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length === 11 && digits.startsWith("0")) return `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  return digits.length >= 11 ? digits : "";
}

export function InviteLinkPanel({
  url,
  expiresAt,
  name,
  email,
  phone,
  purpose,
}: {
  url: string;
  expiresAt: Date;
  name: string;
  email: string;
  phone: string | null;
  purpose: "invite" | "reset";
}) {
  const [copied, setCopied] = useState(false);
  const message =
    purpose === "invite"
      ? `Merhaba ${firstName(name)}! Arkhe Portal'a davetlisin. Bu linkten şifreni belirleyip giriş yapabilirsin: ${url}\n\nGiriş e-postan: ${email}`
      : `Merhaba ${firstName(name)}! Arkhe Portal şifreni yenilemek için bu linki kullanabilirsin: ${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("Mesaj kopyalandı");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopyalanamadı, linki elle seç.");
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-gold/40 bg-accent/60 p-5">
      <div className="space-y-1">
        <p className="font-medium">
          {purpose === "invite" ? "Davet linki hazır" : "Şifre yenileme linki hazır"}
        </p>
        <p className="text-sm text-muted-foreground">
          Tek kullanımlık. {dateTimeFormat.format(new Date(expiresAt))} tarihine kadar geçerli.
          Sadece {firstName(name)} ile paylaş.
        </p>
      </div>
      <p className="rounded-xl bg-card px-3 py-2.5 font-mono text-xs break-all select-all">{url}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), "h-10 rounded-full px-4")}
        >
          <MessageCircle />
          WhatsApp ile gönder
        </a>
        <Button type="button" variant="outline" onClick={copy} className="h-10 rounded-full px-4">
          {copied ? <Check /> : <Copy />}
          Mesajı kopyala
        </Button>
      </div>
    </div>
  );
}
