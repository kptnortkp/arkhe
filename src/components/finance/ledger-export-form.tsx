"use client";

import { FileSpreadsheet, FileText, FileType } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { needsShareSheet, saveInApp } from "@/components/download-link";
import { Field } from "@/components/forms/field";

const FORMATS = [
  { format: "xlsx", label: "Excel", icon: FileSpreadsheet, variant: "default" },
  { format: "pdf", label: "PDF", icon: FileText, variant: "outline" },
  { format: "csv", label: "CSV", icon: FileType, variant: "outline" },
] as const;

/** A plain GET form: each button submits to its format's download route. */
export function LedgerExportForm({ from, to }: { from: string; to: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action="/finans/rapor/xlsx"
      method="get"
      className="space-y-3"
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        if (String(fd.get("to")) < String(fd.get("from"))) {
          e.preventDefault();
          setError("Bitiş başlangıçtan önce olamaz.");
          requestAnimationFrame(() => document.getElementById("to")?.focus());
          return;
        }
        setError(null);
        if (needsShareSheet()) {
          e.preventDefault();
          const submitter = e.nativeEvent.submitter as HTMLButtonElement | null;
          const url = new URL(submitter?.formAction || e.currentTarget.action);
          url.search = new URLSearchParams({
            from: String(fd.get("from")),
            to: String(fd.get("to")),
          }).toString();
          void saveInApp(url.href);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç" name="from" type="date" defaultValue={from} />
        <Field
          label="Bitiş"
          name="to"
          type="date"
          defaultValue={to}
          errors={error ? [error] : undefined}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label, icon: Icon, variant }) => (
          <Button
            key={format}
            type="submit"
            variant={variant}
            formAction={`/finans/rapor/${format}`}
            className="h-11 rounded-full px-5"
          >
            <Icon />
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        İptal edilen kayıtlar dahil değil. PDF&apos;te belge bağlantısı, kaydeden ve kayıt no
        yer almaz.
      </p>
    </form>
  );
}
