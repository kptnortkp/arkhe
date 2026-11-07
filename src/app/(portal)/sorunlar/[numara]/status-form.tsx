"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/field";
import { ChoiceGroup } from "@/components/forms/choice-group";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ISSUE_STATUSES, type IssueStatus } from "@/db/schema";
import { ISSUE_STATUS_LABELS, REPORT_REPLY_MAX } from "@/lib/reports/labels";
import { updateReport } from "../actions";

export function ReportStatusForm({
  number,
  status,
  reply,
}: {
  number: number;
  status: IssueStatus;
  reply: string | null;
}) {
  const [state, action, pending] = useActionState(updateReport, {});
  const replyError = state.fieldErrors?.reply;
  return (
    <form
      onSubmit={(e) => submitWithoutReset(e, action)}
      className="space-y-4 rounded-2xl border bg-card p-4"
      data-testid="report-status-form"
    >
      <h2 className="font-sans text-base font-medium">Durum ve yanıt</h2>
      <FormMessage error={state.error} success={state.success} />
      <input type="hidden" name="number" value={number} />
      <ChoiceGroup
        legend="Durum"
        name="status"
        defaultValue={status}
        options={ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_LABELS[s] }))}
      />
      <div className="space-y-2">
        <Label htmlFor="reply">Yanıt</Label>
        <Textarea
          id="reply"
          name="reply"
          rows={4}
          maxLength={REPORT_REPLY_MAX}
          defaultValue={reply ?? ""}
          placeholder="Bildirene görünür. İsteğe bağlı."
          aria-invalid={replyError?.length ? true : undefined}
          aria-describedby={replyError?.length ? "reply-error" : undefined}
          className="min-h-24 rounded-xl bg-background"
        />
        {replyError?.length ? (
          <p id="reply-error" className="text-sm text-destructive">
            {replyError[0]}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="h-11 rounded-xl px-6">
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </Button>
    </form>
  );
}
