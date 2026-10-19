"use client";

import { Check, ClipboardPaste, Trash2, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveBulkLinks } from "@/app/(portal)/repertuvar/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LINK_KINDS, VOICE_PARTS, type VoicePart } from "@/db/schema";
import { LINK_KIND_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { deriveLabel, parseBulk, type BulkKind, type BulkRow } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useFocusAfter } from "./use-focus-after";

type Row = BulkRow & { key: number };

const select =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const input = select;

function KindSelect({
  row,
  label,
  onChange,
}: {
  row: Row;
  label: string;
  onChange: (k: BulkKind) => void;
}) {
  return (
    <select
      aria-label={label}
      className={select}
      value={row.kind}
      onChange={(e) => onChange(e.target.value as BulkKind)}
    >
      {LINK_KINDS.map((k) => (
        <option key={k} value={k}>
          {LINK_KIND_LABELS[k]}
        </option>
      ))}
      {row.kind === "folder" && <option value="folder">Drive klasörü</option>}
    </select>
  );
}

function PartSelect({
  row,
  label,
  onChange,
}: {
  row: Row;
  label: string;
  onChange: (p: VoicePart | null) => void;
}) {
  return (
    <select
      aria-label={label}
      className={select}
      value={row.voicePart ?? ""}
      disabled={row.kind === "folder"}
      onChange={(e) => onChange((e.target.value || null) as VoicePart | null)}
    >
      <option value="">Tutti</option>
      {VOICE_PARTS.map((p) => (
        <option key={p} value={p}>
          {VOICE_PART_LABELS[p]}
        </option>
      ))}
    </select>
  );
}

function RowStatus({ error }: { error: string | null }) {
  return error ? (
    <span className="flex items-center gap-1 text-absent-ink">
      <X className="size-3.5" aria-hidden />
      {error}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-present-ink">
      <Check className="size-3.5" aria-hidden />
      Geçerli
    </span>
  );
}

export function BulkPaste({
  pieceId,
  existing,
  folderFree,
}: {
  pieceId: string;
  existing: string[];
  folderFree: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [message, setMessage] = useState<string>();
  const focusAfter = useFocusAfter();
  const [state, formAction, pending] = useActionState(saveBulkLinks.bind(null, pieceId), {});

  const valid = rows?.filter((r) => !r.error) ?? [];
  const invalid = (rows?.length ?? 0) - valid.length;

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset after a confirmed save
      setRows(null);
      setText("");
      setOpen(false);
      document.getElementById("links-heading")?.focus();
    } else if (state.rowErrors) {
      const errors = state.rowErrors;
      setRows((current) => {
        if (!current) return current;
        const validKeys = current.filter((r) => !r.error).map((r) => r.key);
        return current.map((r) => {
          const i = validKeys.indexOf(r.key);
          return i >= 0 && errors[i] ? { ...r, error: errors[i] } : r;
        });
      });
    }
  }, [state]);

  function preview() {
    const result = parseBulk(text, { existing, folderFree });
    setMessage(result.error);
    if (!result.error) focusAfter("[data-testid=bulk-summary]");
    setRows(result.error ? null : result.rows.map((r, key) => ({ ...r, key })));
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  }

  if (!open) {
    return (
      <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => setOpen(true)}>
        <ClipboardPaste />
        Toplu bağlantı ekle
      </Button>
    );
  }

  const payload = JSON.stringify(
    valid.map(({ label, kind, voicePart, url }) => ({ label, kind, voicePart, url })),
  );

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4" data-testid="bulk-paste">
      <h3 className="font-sans text-base font-medium">Toplu bağlantı ekle</h3>
      {rows === null ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="bulk-text">Bağlantıları yapıştır (her satıra bir tane)</Label>
            <Textarea
              id="bulk-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              aria-describedby="bulk-help"
              className="min-h-40 rounded-xl font-mono text-sm"
              placeholder={
                "Soprano 1 MIDI https://drive.google.com/…\nAlto mp3 | https://drive.google.com/…\nhttps://youtu.be/…"
              }
            />
            <p id="bulk-help" className="text-xs text-muted-foreground">
              Etiketteki &quot;soprano&quot;, &quot;alto&quot;, &quot;midi&quot;, &quot;nota&quot;
              gibi kelimelerden tür ve partisyon tahmin edilir; önizlemede düzeltebilirsin. En fazla
              50 satır. Drive dosyaları &quot;Bağlantıya sahip olan herkes&quot; ile paylaşılmış
              olmalı.
            </p>
          </div>
          <FormMessage error={message} />
          <div className="flex gap-2">
            <Button className="h-11 rounded-xl px-5" onClick={preview}>
              Önizle
            </Button>
            <Button variant="ghost" className="h-11 px-4" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          </div>
        </>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="rows" value={payload} />
          <p
            role="status"
            tabIndex={-1}
            className="text-sm text-muted-foreground outline-none"
            data-testid="bulk-summary"
          >
            {valid.length} geçerli, {invalid} hatalı satır. Hatalı satırlar kaydedilmez.
          </p>
          <FormMessage error={state.error} />

          <ol className="space-y-2 md:hidden">
            {rows.map((r, i) => (
              <li
                key={r.key}
                data-testid="bulk-row"
                data-valid={!r.error}
                className={cn(
                  "space-y-3 rounded-xl border p-3",
                  r.error && "border-absent/30 bg-absent/8",
                )}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Satır {i + 1}</span>
                  <RowStatus error={r.error} />
                </div>
                {r.error ? (
                  <p className="font-mono text-xs break-all">{r.line}</p>
                ) : (
                  <>
                    <input
                      aria-label={`${i + 1}. satır etiketi`}
                      className={input}
                      value={r.label ?? ""}
                      placeholder={
                        r.kind === "folder" ? "Drive klasörü" : deriveLabel(r.kind, r.voicePart)
                      }
                      maxLength={120}
                      onChange={(e) => update(r.key, { label: e.target.value || null })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <KindSelect
                        row={r}
                        label={`${i + 1}. satır türü`}
                        onChange={(kind) => update(r.key, { kind })}
                      />
                      <PartSelect
                        row={r}
                        label={`${i + 1}. satır partisyonu`}
                        onChange={(voicePart) => update(r.key, { voicePart })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">
                        {r.url}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-11"
                        aria-label={`${i + 1}. satırı çıkar`}
                        onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>

          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="w-8 py-2">
                  #
                </th>
                <th scope="col" className="py-2">
                  Etiket
                </th>
                <th scope="col" className="w-40 py-2">
                  Tür
                </th>
                <th scope="col" className="w-32 py-2">
                  Partisyon
                </th>
                <th scope="col" className="py-2">
                  Bağlantı
                </th>
                <th scope="col" className="py-2">
                  Durum
                </th>
                <th scope="col" className="w-12 py-2">
                  <span className="sr-only">Çıkar</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr key={r.key} className={cn("align-middle", r.error && "bg-absent/8")}>
                  <td className="py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                  {r.error ? (
                    <td colSpan={4} className="py-2 font-mono text-xs break-all">
                      {r.line}
                    </td>
                  ) : (
                    <>
                      <td className="py-2 pr-2">
                        <input
                          aria-label={`${i + 1}. satır etiketi`}
                          className={input}
                          value={r.label ?? ""}
                          placeholder={
                            r.kind === "folder" ? "Drive klasörü" : deriveLabel(r.kind, r.voicePart)
                          }
                          maxLength={120}
                          onChange={(e) => update(r.key, { label: e.target.value || null })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <KindSelect
                          row={r}
                          label={`${i + 1}. satır türü`}
                          onChange={(kind) => update(r.key, { kind })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <PartSelect
                          row={r}
                          label={`${i + 1}. satır partisyonu`}
                          onChange={(voicePart) => update(r.key, { voicePart })}
                        />
                      </td>
                      <td
                        className="max-w-48 truncate py-2 pr-2 font-mono text-xs text-muted-foreground"
                        title={r.url}
                      >
                        {r.url}
                      </td>
                    </>
                  )}
                  <td className="py-2 pr-2 text-xs">
                    <RowStatus error={r.error} />
                  </td>
                  <td className="py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-11"
                      aria-label={`${i + 1}. satırı çıkar`}
                      onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex gap-2 rounded-2xl border bg-background p-2 md:bottom-4">
            <Button
              type="submit"
              disabled={pending || valid.length === 0}
              className="h-12 flex-1 rounded-xl"
            >
              Kaydet ({valid.length} bağlantı)
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-12 px-4"
              onClick={() => setRows(null)}
            >
              Metne dön
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
