"use client";

import { CircleCheck, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PartDot } from "@/components/part-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { VOICE_PARTS, type VoicePart } from "@/db/schema";
import type { DuesStatus } from "@/lib/finance/dues";
import { searchKey } from "@/lib/format";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { formatKurus } from "@/lib/money";
import type { FormState } from "@/lib/validation";
import { DuesChip } from "./dues-chip";
import { PaymentForm, type OpenPeriod } from "./payment-form";

export type DuesListRow = {
  id: string;
  name: string;
  voicePart: VoicePart | null;
  flags: string;
  status: DuesStatus;
  open: OpenPeriod[];
};

type Paying = { row: DuesListRow; done: FormState | null; key: number };

export function DuesList({
  rows,
  periodId,
  today,
  yesterday,
  emptyText,
}: {
  rows: DuesListRow[];
  periodId: string;
  today: string;
  yesterday: string;
  emptyText: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState<Paying | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const visible = useMemo(() => {
    const q = searchKey(query.trim());
    return q ? rows.filter((r) => searchKey(r.name).includes(q)) : rows;
  }, [rows, query]);
  const groups = [...VOICE_PARTS, null].map((part) => ({
    part,
    rows: visible.filter((r) => r.voicePart === part),
  }));
  const ordered = groups.flatMap((g) => g.rows);

  const onSuccess = useCallback(
    (state: FormState) => {
      if (state.success) toast.success(state.success);
      setPaying((p) => (p ? { ...p, done: state } : p));
      router.refresh();
      requestAnimationFrame(() => nextRef.current?.focus());
    },
    [router],
  );

  function nextDebtor(after: DuesListRow) {
    const i = ordered.findIndex((r) => r.id === after.id);
    return ordered.slice(i + 1).find((r) => r.status.remaining > 0 && r.open.length > 0) ?? null;
  }

  const next = paying?.done ? nextDebtor(paying.row) : null;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Üye ara"
          aria-label="Üye ara"
          className="h-11 rounded-xl pl-9"
        />
      </div>
      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          <CircleCheck className="size-5 text-present-ink" aria-hidden />
          {query ? "Bu aramaya uyan üye yok." : emptyText}
        </p>
      ) : (
        groups
          .filter((g) => g.rows.length)
          .map((g) => {
            const paid = g.rows.filter((r) => r.status.state === "paid").length;
            const owing = g.rows.filter((r) => r.status.state !== "exempt").length;
            return (
              <section
                key={g.part ?? "none"}
                className="space-y-2"
                aria-labelledby={`grup-${g.part ?? "none"}`}
              >
                <h3
                  id={`grup-${g.part ?? "none"}`}
                  className="flex items-center gap-2 text-sm font-medium"
                  data-testid="dues-group-title"
                >
                  {g.part && <PartDot part={g.part} />}
                  {g.part ? VOICE_PART_LABELS[g.part] : "Partisyonsuz"} · {paid}/{owing} ödedi
                </h3>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {g.rows.map((r) => (
                    <li
                      key={r.id}
                      id={`uye-${r.id}`}
                      data-testid="dues-row"
                      data-user={r.id}
                      data-name={r.name}
                      className="flex min-h-16 items-center gap-3 px-4 py-2"
                    >
                      <Link
                        href={`/finans/aidat?donem=${periodId}&uye=${r.id}`}
                        scroll={false}
                        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center hover:underline"
                      >
                        <span className="block truncate font-medium">{r.name}</span>
                        {r.flags && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.flags}
                          </span>
                        )}
                      </Link>
                      <DuesChip status={r.status} />
                      {r.status.remaining > 0 && r.open.length > 0 ? (
                        <Button
                          variant="outline"
                          className="size-11 shrink-0 rounded-full"
                          aria-label={`Ödeme al: ${r.name}`}
                          onClick={() => setPaying({ row: r, done: null, key: Date.now() })}
                        >
                          <Plus />
                        </Button>
                      ) : (
                        <span className="size-11 shrink-0" aria-hidden />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
      )}

      <Sheet
        open={paying !== null}
        onOpenChange={(o) => {
          if (o || !paying) return;
          const id = paying.row.id;
          setPaying(null);
          // The + trigger is gone once the member is paid; return focus to their name.
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`#uye-${CSS.escape(id)} a`)?.focus(),
          );
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:mx-auto sm:max-w-md"
        >
          {paying && (
            <>
              <SheetHeader>
                <SheetTitle className="text-xl">Ödeme al</SheetTitle>
                <SheetDescription>
                  {paying.done
                    ? paying.row.name
                    : `${paying.row.name} · kalan ${formatKurus(paying.row.open.reduce((s, p) => s + p.remaining, 0))}`}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                {paying.done ? (
                  <div className="space-y-4" data-testid="payment-done">
                    <p
                      role="status"
                      className="rounded-xl bg-success/12 px-3.5 py-2.5 text-sm text-success"
                    >
                      {paying.done.success}
                    </p>
                    {next ? (
                      <Button
                        ref={nextRef}
                        className="h-12 w-full rounded-xl text-base"
                        onClick={() => setPaying({ row: next, done: null, key: Date.now() })}
                      >
                        Sonraki borçlu: {next.name}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Bu dönem borçlu kimse kalmadı.
                      </p>
                    )}
                    <Button
                      variant="outline"
                      className="h-11 w-full rounded-xl"
                      onClick={() => setPaying(null)}
                    >
                      Kapat
                    </Button>
                  </div>
                ) : (
                  <PaymentForm
                    key={paying.key}
                    memberId={paying.row.id}
                    open={paying.row.open}
                    today={today}
                    yesterday={yesterday}
                    onSuccess={onSuccess}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
