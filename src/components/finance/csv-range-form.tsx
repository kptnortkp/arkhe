"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";

/** A plain GET form: the target is a download, so there's nothing to hydrate into. */
export function CsvRangeForm({ from, to }: { from: string; to: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action="/finans/rapor/csv"
      method="get"
      className="space-y-3"
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        if (String(fd.get("to")) < String(fd.get("from"))) {
          e.preventDefault();
          setError("Bitiş başlangıçtan önce olamaz.");
          requestAnimationFrame(() => document.getElementById("to")?.focus());
        } else setError(null);
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
      <Button type="submit" className="h-11 rounded-full px-5">
        <Download />
        CSV indir
      </Button>
      <p className="text-xs text-muted-foreground">
        İptal edilen kayıtlar dahil değil. Excel&apos;de Türkçe açılır.
      </p>
    </form>
  );
}
