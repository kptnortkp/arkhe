"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { ChoiceChips } from "@/components/finance/choice-chips";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  URGENCY_LABELS,
  type TicketStatus,
  type TicketUrgency,
} from "@/lib/board/labels";
import { NOT_ON_BOARD, TICKET_STALE, UNASSIGNED } from "@/lib/board/rules";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export type TicketDefaults = {
  title: string;
  description: string;
  assigneeId: string;
  urgency: TicketUrgency;
  dueOn: string;
  status: TicketStatus;
};

const selectClass =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";
const URGENCY_ORDER: TicketUrgency[] = ["low", "medium", "high", "urgent"];

function Hint({ id, error, children }: { id: string; error?: string; children?: React.ReactNode }) {
  if (error) {
    return (
      <p id={id} className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  return children ? (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  ) : null;
}

export function TicketForm({
  mode,
  action,
  defaults,
  assignees,
  former,
  me,
  clientId,
  revision,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: TicketDefaults;
  assignees: { id: string; name: string }[];
  // The current assignee when they left the board: offered only as the current value (AC 11).
  former?: { id: string; name: string } | null;
  me: string;
  clientId?: string;
  revision?: number;
  cancelHref: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const v = state.values;
  const errors = state.fieldErrors ?? {};
  const [title, setTitle] = useState(v?.title ?? defaults.title);
  const [description, setDescription] = useState(v?.description ?? defaults.description);
  const [assigneeId, setAssigneeId] = useState(defaults.assigneeId);
  const [urgency, setUrgency] = useState<TicketUrgency>(defaults.urgency);
  const [status, setStatus] = useState<TicketStatus>(defaults.status);
  const [dueOn, setDueOn] = useState(defaults.dueOn);
  const stale = state.error === TICKET_STALE && mode === "edit";
  const canSelfAssign = assignees.some((a) => a.id === me) && assigneeId !== me;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-6"
      noValidate
    >
      {clientId && <input type="hidden" name="id" value={clientId} />}
      {revision !== undefined && <input type="hidden" name="revision" value={revision} />}
      {!stale && (
        <FormMessage
          error={
            state.error ?? (state.fieldErrors ? "Bazı alanları düzeltmen gerekiyor." : undefined)
          }
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Başlık</Label>
        <Input
          id="title"
          name="title"
          autoFocus={mode === "create"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title?.length ? true : undefined}
          aria-describedby="title-hint"
          className="h-11 rounded-xl text-base"
        />
        <Hint id="title-hint" error={errors.title?.[0]}>
          {title.length >= 100
            ? `${title.length}/120`
            : "Kısa ve net: “Bahar konseri için salon rezervasyonu”."}
        </Hint>
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <Label htmlFor="assigneeId">Sorumlu</Label>
          {canSelfAssign && (
            <button
              type="button"
              onClick={() => setAssigneeId(me)}
              className="-my-2 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Bana ata
            </button>
          )}
        </div>
        <select
          id="assigneeId"
          name="assigneeId"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className={selectClass}
          aria-invalid={errors.assigneeId?.length ? true : undefined}
          aria-describedby={errors.assigneeId?.length ? "assigneeId-error" : undefined}
        >
          <option value="">{UNASSIGNED}</option>
          {former && (
            <option value={former.id}>
              {former.name} ({NOT_ON_BOARD})
            </option>
          )}
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Hint id="assigneeId-error" error={errors.assigneeId?.[0]} />
      </div>

      <ChoiceChips
        legend="Aciliyet"
        name="urgency"
        value={urgency}
        onChange={setUrgency}
        errors={errors.urgency}
        options={URGENCY_ORDER.map((u) => ({ value: u, label: URGENCY_LABELS[u] }))}
      />

      <div className="space-y-2">
        <Label htmlFor="dueOn">
          Son tarih <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="dueOn"
            name="dueOn"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            aria-invalid={errors.dueOn?.length ? true : undefined}
            aria-describedby={errors.dueOn?.length ? "dueOn-error" : undefined}
            className="h-11 w-auto min-w-44 rounded-xl"
          />
          {dueOn && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3 text-sm"
              onClick={() => setDueOn("")}
            >
              Tarihi kaldır
            </Button>
          )}
        </div>
        <Hint id="dueOn-error" error={errors.dueOn?.[0]} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          Açıklama <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description?.length ? true : undefined}
          aria-describedby="description-hint"
          className="max-h-[50dvh] min-h-32 rounded-xl"
        />
        <Hint id="description-hint" error={errors.description?.[0]}>
          {description.length >= 3800
            ? `${description.length}/4000`
            : "Bağlantıyı olduğu gibi yapıştırabilirsin; tıklanmaz ama kopyalanabilir."}
        </Hint>
      </div>

      {mode === "create" && (
        <ChoiceChips
          legend="Durum"
          name="status"
          value={status}
          onChange={setStatus}
          errors={errors.status}
          options={TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] }))}
        />
      )}

      {stale && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-late/40 bg-late/10 p-4 text-sm"
        >
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-late-ink" />
            {TICKET_STALE}
          </p>
          <p className="text-muted-foreground">
            Yazdıkların yenileyince silinir; önce kopyalayabilirsin.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full px-4"
            onClick={() => router.refresh()}
          >
            Yenile
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending} className="h-11 rounded-full px-6">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <Link
          href={cancelHref}
          className={cn(buttonVariants({ variant: "ghost" }), "h-11 rounded-full px-5")}
        >
          Vazgeç
        </Link>
      </div>
    </form>
  );
}
