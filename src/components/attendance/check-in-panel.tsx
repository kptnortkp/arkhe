"use client";

import { Check, CircleCheck, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  checkIn,
  checkInForm,
  submitExcuse,
  withdrawExcuse,
} from "@/app/(portal)/calismalar/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AttendanceStatus, CheckInMethod } from "@/db/schema";
import { STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { StatusChip } from "./status-chip";

export type CheckInPanelProps = {
  rehearsalId: string;
  phase: "cancelled" | "upcoming" | "openable" | "open" | "closed" | "untaken";
  started: boolean;
  expected: boolean;
  status: AttendanceStatus | null;
  method: CheckInMethod | null;
  note: string | null;
  recordedAt: string | null;
  onStage?: boolean;
};

const noop = () => () => {};

const timeFormat = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

/** What a member sees and can do for one rehearsal: check in, excuse, withdraw. */
export function CheckInPanel(props: CheckInPanelProps) {
  const { rehearsalId, phase, started, expected, status, method, note, recordedAt, onStage } =
    props;
  const [codeOpen, setCodeOpen] = useState(false);
  const [excuseOpen, setExcuseOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const muted = onStage ? "text-stage-foreground/70" : "text-muted-foreground";
  const attended = status === "present" || status === "late";

  if (phase === "cancelled") {
    return <p className={cn("text-sm", muted)}>Bu çalışma iptal edildi.</p>;
  }
  if (!expected && !attended) {
    return <p className={cn("text-sm", muted)}>Senin partisyonun değil.</p>;
  }

  if (attended) {
    return (
      <div className="flex items-start gap-3" data-testid="checkin-state">
        <CircleCheck className={cn("size-8 shrink-0", onStage ? "text-gold" : "text-present")} />
        <div>
          <p className="text-xs font-medium tracking-[0.2em] uppercase">Yoklamaya katıldın</p>
          <p className={cn("text-sm", muted)}>
            {STATUS_LABELS[status]}
            {recordedAt ? ` · saat ${timeFormat.format(new Date(recordedAt))}` : ""}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "open") {
    const managerMarked = status !== null && method !== "self";
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 text-xs font-medium tracking-[0.2em] uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-gold" />
          Yoklama açık
        </p>
        {managerMarked ? (
          <p className={cn("text-sm", muted)}>
            Yoklamayı alan kişi seni <StatusChip status={status} /> olarak işaretledi.
          </p>
        ) : (
          <>
            <p className={cn("text-sm", muted)}>
              Şefin ekranındaki 4 haneli kodu gir ya da QR&apos;ı telefon kamerasıyla okut.
            </p>
            {/* A link until hydrated: without JS (or on a too-old browser) it opens the code page. */}
            <Button
              nativeButton={false}
              render={<a href={`/yoklama/kod/${rehearsalId}`} />}
              onClick={(e) => {
                e.preventDefault();
                setCodeOpen(true);
              }}
              className="h-14 w-full rounded-2xl bg-gold text-base font-semibold text-gold-foreground hover:bg-gold/90 sm:w-auto sm:px-8"
            >
              <Check />
              Geldim
            </Button>
          </>
        )}
        <CodeDialog
          rehearsalId={rehearsalId}
          open={codeOpen}
          onOpenChange={setCodeOpen}
          onDone={() => router.refresh()}
        />
      </div>
    );
  }

  if (phase === "closed" || phase === "untaken" || started) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-[0.2em] uppercase">
          {phase === "closed" ? "Yoklama kapandı" : "Çalışma başladı"}
        </p>
        <div className={cn("text-sm", muted)}>
          {status ? (
            <StatusChip status={status} />
          ) : phase === "closed" ? (
            "Kaydın yok."
          ) : (
            "Yoklama henüz açılmadı."
          )}
        </div>
      </div>
    );
  }

  // Before the rehearsal: advance excuse.
  if (status === "excused" && method === "self") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <MessageSquareText
            className={cn("size-6 shrink-0", onStage ? "text-gold" : "text-excused")}
          />
          <div>
            <p className="text-xs font-medium tracking-[0.2em] uppercase">Mazeretin iletildi</p>
            {note && <p className={cn("line-clamp-1 text-sm", muted)}>“{note}”</p>}
          </div>
        </div>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await withdrawExcuse(rehearsalId);
              if (result.error) toast.error(result.error);
              else toast.success(result.success);
              router.refresh();
            })
          }
          className={cn(
            "h-11 rounded-full px-4",
            onStage && "text-stage-foreground hover:bg-white/10 hover:text-stage-foreground",
          )}
        >
          Mazereti geri al
        </Button>
      </div>
    );
  }
  if (status) {
    return (
      <p className={cn("text-sm", muted)}>
        Yoklamayı alan kişi seni <StatusChip status={status} /> olarak işaretledi.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className={cn("text-sm", muted)}>Yoklama çalışmadan önce açılacak.</p>
      <Button
        variant="ghost"
        onClick={() => setExcuseOpen(true)}
        className={cn(
          "h-11 rounded-full px-4",
          onStage && "text-stage-foreground hover:bg-white/10 hover:text-stage-foreground",
        )}
      >
        Gelemeyeceğim
      </Button>
      <ExcuseDialog
        rehearsalId={rehearsalId}
        open={excuseOpen}
        onOpenChange={setExcuseOpen}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

export function CodeDialog({
  rehearsalId,
  open,
  onOpenChange,
  onDone,
}: {
  rehearsalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Kodu gir</DialogTitle>
          <DialogDescription>
            Şefin ekranındaki 4 haneli kod. 30 saniyede bir yenilenir.
          </DialogDescription>
        </DialogHeader>
        <CodeEntry
          rehearsalId={rehearsalId}
          method="code"
          onSuccess={() => {
            onOpenChange(false);
            toast.success("Geldin olarak kaydedildi.");
            onDone();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Single numeric input that submits itself on the fourth digit. */
export function CodeEntry({
  rehearsalId,
  method,
  initialError,
  onSuccess,
}: {
  rehearsalId: string;
  method: "code" | "qr";
  initialError?: string;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  function submit(value: string) {
    startTransition(async () => {
      const result = await checkIn(rehearsalId, value, method).catch(() => ({
        ok: false as const,
        error: "Bağlantı yok. İnternet gelince tekrar dene ya da yoklamayı alan kişiye söyle.",
      }));
      if (result.ok) {
        onSuccess();
        return;
      }
      setError(result.error);
      setCode("");
      inputRef.current?.focus();
    });
  }

  return (
    // Without JS the form posts to checkInForm; once hydrated, onSubmit takes over.
    <form
      action={checkInForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 4) submit(code);
      }}
      className="space-y-3"
    >
      <input type="hidden" name="rehearsalId" value={rehearsalId} />
      <label htmlFor="checkin-code" className="sr-only">
        Yoklama kodu
      </label>
      <input
        ref={inputRef}
        id="checkin-code"
        name="code"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{4}"
        maxLength={4}
        value={code}
        // readOnly rather than disabled, so the phone keyboard stays open after a wrong code.
        readOnly={pending}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "checkin-error" : undefined}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
          setCode(digits);
          setError("");
          if (digits.length === 4) submit(digits);
        }}
        className="h-16 w-full rounded-2xl border border-input bg-card text-center font-heading text-4xl tracking-[0.5em] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && (
        <p id="checkin-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || (hydrated && code.length !== 4)}
        className="h-11 w-full rounded-xl"
      >
        {pending ? "Kontrol ediliyor…" : "Gönder"}
      </Button>
    </form>
  );
}

function ExcuseDialog({
  rehearsalId,
  open,
  onOpenChange,
  onDone,
}: {
  rehearsalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(submitExcuse.bind(null, rehearsalId), {});
  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      toast.success(state.success);
      onDone();
    }
  }, [state, onOpenChange, onDone]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gelemeyeceğim</DialogTitle>
          <DialogDescription>
            Sebep yazmak zorunlu değil. Sadece şef ve yönetim görür.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <label htmlFor="excuse-reason" className="sr-only">
            Sebep
          </label>
          <textarea
            id="excuse-reason"
            name="reason"
            rows={3}
            maxLength={200}
            placeholder="Örn. Sınavım var"
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl">
            {pending ? "Gönderiliyor…" : "Mazeret bildir"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
