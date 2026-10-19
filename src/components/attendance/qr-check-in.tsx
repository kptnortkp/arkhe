"use client";

import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { checkIn, type CheckInResult } from "@/app/(portal)/calismalar/actions";
import { STATUS_LABELS } from "@/lib/labels";
import { CodeEntry } from "./check-in-panel";

export function QrCheckIn({ rehearsalId, code }: { rehearsalId: string; code: string | null }) {
  const router = useRouter();
  const started = useRef(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [manualDone, setManualDone] = useState(false);

  useEffect(() => {
    // Exactly one attempt per page load, even under React's dev double-effects.
    if (started.current || !code) return;
    started.current = true;
    void checkIn(rehearsalId, code, "qr")
      .catch((): CheckInResult => ({
        ok: false,
        error: "Bağlantı yok. İnternet gelince kodu buradan gir.",
      }))
      .then((r) => {
        setResult(r);
        router.replace(`/yoklama/kod/${rehearsalId}`);
      });
  }, [rehearsalId, code, router]);

  if (result?.ok || manualDone) {
    return (
      <div className="flex items-center gap-3" data-testid="qr-state">
        <CircleCheck className="size-8 text-present" />
        <p className="font-medium">
          Yoklamaya katıldın{result?.ok ? ` · ${STATUS_LABELS[result.status]}` : ""}
        </p>
      </div>
    );
  }
  if (code && !result) {
    return <p className="text-sm text-muted-foreground">Kaydediliyor…</p>;
  }
  if (result && !result.ok && result.managerMarked) {
    return (
      <p className="font-medium" data-testid="qr-state">
        {result.error}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {result && !result.ok
          ? result.error.startsWith("Bağlantı yok")
            ? result.error
            : "QR'daki kod yenilenmiş olabilir. Ekrandaki kodu gir."
          : "Şefin ekranındaki 4 haneli kodu gir."}
      </p>
      <CodeEntry rehearsalId={rehearsalId} method="code" onSuccess={() => setManualDone(true)} />
    </div>
  );
}
