"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveBackupRecipients } from "@/app/(portal)/yedek/actions";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

export const RECIPIENTS_FORM_ID = "backup-recipients";
const MAX_ROWS = 5;
const LIST_ERROR_ID = "alicilar-error";
const NONE = "En az bir adres gir.";

type Row = { key: number; value: string };

let nextKey = 0;
const toRows = (list: string[]) =>
  (list.length ? list : [""]).map((value) => ({ key: nextKey++, value }));

export function RecipientsForm({ saved, audit }: { saved: string[]; audit: string | null }) {
  const [state, action, pending] = useActionState(saveBackupRecipients, {});
  const [rows, setRows] = useState<Row[]>(() => toRows(saved));
  const [seen, setSeen] = useState<FormState>(state);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const focusKey = useRef<number | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const formRef = useFocusError(state);
  const toasted = useRef<FormState | null>(null);

  // A new server result: map field errors onto the rows that were submitted, and show the stored list.
  if (state !== seen) {
    setSeen(state);
    const next = new Map<number, string>();
    rows.forEach((row, i) => {
      const message = state.fieldErrors?.[`recipients.${i}`]?.[0];
      if (message) next.set(row.key, message);
    });
    if (state.error === NONE && rows[0]) next.set(rows[0].key, "");
    setErrors(next);
    if (state.success && state.values?.recipients) {
      setRows(toRows(state.values.recipients.split(",")));
    }
  }

  useEffect(() => {
    if (toasted.current === state || !state.success) return;
    toasted.current = state;
    toast.success(state.success);
    if (state.warning) toast.warning(state.warning);
  }, [state]);

  useEffect(() => {
    if (focusKey.current === null) return;
    inputs.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  }, [rows]);

  function update(key: number, value: string) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, value } : r)));
  }

  function remove(index: number) {
    const target = rows[index - 1] ?? rows[index + 1];
    setRows(rows.filter((_, i) => i !== index));
    focusKey.current = target?.key ?? null;
  }

  function add() {
    const row = { key: nextKey++, value: "" };
    setRows([...rows, row]);
    focusKey.current = row.key;
  }

  return (
    <form
      ref={formRef}
      id={RECIPIENTS_FORM_ID}
      onSubmit={(e) => submitWithoutReset(e, action)}
      noValidate
      className="space-y-4"
      data-testid="backup-recipients-form"
    >
      <FormMessage id={LIST_ERROR_ID} error={state.error} />
      <ol className="space-y-2">
        {rows.map((row, i) => {
          const error = errors.get(row.key);
          const errorId = `recipient-${row.key}-error`;
          const describedBy = [
            error && errorId,
            i === 0 && state.error && LIST_ERROR_ID,
            "alicilar-hint",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={row.key} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  ref={(el) => {
                    if (el) inputs.current.set(row.key, el);
                    else inputs.current.delete(row.key);
                  }}
                  name="recipients"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="ornek@gmail.com"
                  aria-label={`Alıcı ${i + 1}`}
                  aria-invalid={error !== undefined ? true : undefined}
                  aria-describedby={describedBy}
                  value={row.value}
                  onChange={(e) => update(row.key, e.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-xl"
                />
                {/* Kept in layout with one row so the input width doesn't jump. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-11 shrink-0", rows.length === 1 && "invisible")}
                  aria-label={`${i + 1}. alıcıyı kaldır`}
                  aria-hidden={rows.length === 1 || undefined}
                  tabIndex={rows.length === 1 ? -1 : undefined}
                  onClick={() => remove(i)}
                >
                  <X aria-hidden />
                </Button>
              </div>
              {error && (
                <p id={errorId} className="text-sm break-all text-destructive">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length < MAX_ROWS ? (
        <Button type="button" variant="outline" className="h-11 rounded-full px-4" onClick={add}>
          <Plus aria-hidden />
          Adres ekle
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">En fazla beş adres.</p>
      )}
      <div className="space-y-2">
        <Button type="submit" className="h-11 rounded-full px-5" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        {audit && (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p data-testid="backup-audit">{audit}</p>
            <p>Listeyi değiştirdiğinde eski ve yeni adreslere bilgi e-postası gider.</p>
          </div>
        )}
      </div>
    </form>
  );
}
