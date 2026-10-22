"use client";

import { Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addComment,
  deleteComment,
  deleteTicket,
  markTicketSeen,
} from "@/app/(portal)/yonetim/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { copyText } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/use-run-action";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";
import { boardError } from "./move-menu";

/** Clears "Yeni" once the page is really on screen (never on a prefetch). */
export function TicketSeen({
  number,
  eventId,
  revision,
}: {
  number: number;
  eventId: number;
  revision: number;
}) {
  const router = useRouter();
  useEffect(() => {
    void markTicketSeen(number, eventId, revision).then((r) => {
      // The layout badge was rendered before the marker moved.
      if (r.changed) router.refresh();
    });
  }, [number, eventId, revision, router]);
  return null;
}

export function CopyLinkButton({ path }: { path: string }) {
  return (
    <Button
      variant="ghost"
      className="h-11 rounded-full px-3 text-sm text-muted-foreground"
      onClick={async () => {
        if (await copyText(new URL(path, location.origin).href)) toast.success("Kopyalandı.");
        else toast.error("Kopyalanamadı, adresi elle seç.");
      }}
    >
      <Link2 />
      Bağlantıyı kopyala
    </Button>
  );
}

/** `aside`: the desktop button beside Düzenle; `end`: the quiet phone button at the end of the page. */
export function TicketDelete({
  number,
  variant = "aside",
  className,
}: {
  number: number;
  variant?: "aside" | "end";
  className?: string;
}) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant === "aside" ? "outline" : "ghost"}
        className={cn(
          "h-11 text-destructive hover:text-destructive",
          variant === "aside" ? "rounded-full px-4" : "px-3 text-sm",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        {variant === "aside" ? "Sil" : "İşi sil"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`#${number} silinsin mi?`}
        description="İş ve tüm yorumları kalıcı olarak silinir."
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteTicket(number),
                (r) => r.error && setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}

/** Own comment, while the 15 minutes last; the server re-checks on the DB clock. */
export function CommentDelete({
  id,
  expiresAt,
  label,
}: {
  id: number;
  expiresAt: number;
  // Unique accessible name, e.g. "Demo Yönetim yorumunu sil, 21 Eki 14:05: Salonu aradım…".
  label: string;
}) {
  const [pending, run] = useRunAction();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGone(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  if (gone && !open) return null;
  return (
    <>
      <Button
        variant="ghost"
        aria-label={label}
        className="-my-2 h-11 px-3 text-sm text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        Sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Yorum silinsin mi?"
        description="Bu yorum kalıcı olarak silinir."
        pending={pending}
        finalFocus={() => document.getElementById("yorum")}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteComment(id),
                () => setOpen(false),
              ),
          },
        ]}
      />
    </>
  );
}

export function CommentForm({ number, initialKey }: { number: number; initialKey: string }) {
  const router = useRouter();
  const [clientKey, setClientKey] = useState(initialKey);
  const [body, setBody] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const error = state.fieldErrors?.body?.[0];

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      let result: FormState;
      try {
        result = await addComment(number, {}, fd);
      } catch {
        result = { error: "Bir şeyler ters gitti, tekrar dene." };
      }
      busy.current = false;
      setState(result);
      if (result.error) {
        boardError(result.error, () => router.refresh());
      } else if (result.success) {
        setBody("");
        // A new key per comment: a replay of this one is a no-op, the next one is new.
        setClientKey(crypto.randomUUID());
        router.refresh();
        ref.current?.focus();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <input type="hidden" name="clientKey" value={clientKey} />
      <Label htmlFor="yorum">Yorum ekle</Label>
      <Textarea
        ref={ref}
        id="yorum"
        name="body"
        rows={3}
        placeholder="Yorum yaz…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "yorum-error" : "yorum-hint"}
        className="min-h-24 rounded-xl"
      />
      <div className="flex items-start justify-between gap-3">
        {error ? (
          <p id="yorum-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p id="yorum-hint" className="text-xs text-muted-foreground">
            {body.length >= 1800 ? `${body.length}/2000` : ""}
          </p>
        )}
        <Button type="submit" disabled={pending} className="h-11 shrink-0 rounded-full px-6">
          {pending ? "Gönderiliyor…" : "Gönder"}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {state.success ?? ""}
      </p>
    </form>
  );
}
