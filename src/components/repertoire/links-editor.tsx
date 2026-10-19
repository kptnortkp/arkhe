"use client";

import { ChevronDown, ChevronUp, MoreVertical } from "lucide-react";
import { useActionState, useEffect, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";
import { addLink, deleteLink, reorderLinks, updateLink } from "@/app/(portal)/repertuvar/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINK_KINDS, VOICE_PARTS, type LinkKind, type VoicePart } from "@/db/schema";
import { LINK_KIND_LABELS, VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { deriveLabel, hostLabel, parseLink } from "@/lib/links";
import type { FormState } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { BulkPaste } from "./bulk-paste";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { moveTargets, useFocusAfter } from "./use-focus-after";
import { PartDot } from "@/components/part-dot";
import { useRunAction } from "@/components/use-run-action";

export type EditorLink = {
  id: string;
  kind: LinkKind;
  voicePart: VoicePart | null;
  label: string | null;
  url: string;
};

const chip =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

function LinkForm({
  action,
  initial,
  submitLabel,
  onDone,
  onCancel,
  autoFocus,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: EditorLink;
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const errors = state.fieldErrors ?? {};
  const v = state.values;
  const [url, setUrl] = useState(v?.url ?? initial?.url ?? "");
  const [kind, setKind] = useState<string>(v?.kind ?? initial?.kind ?? "score");
  const [part, setPart] = useState<string>(v?.voicePart ?? initial?.voicePart ?? "");
  const [label, setLabel] = useState(v?.label ?? initial?.label ?? "");
  const parsed = parseLink(url);
  const prefix = initial ? `edit-${initial.id}-` : "add-";

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per action result
  }, [state]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => submitWithoutReset(e, formAction)}
      className="space-y-4"
      noValidate
    >
      <FormMessage error={state.error} />
      <div className="space-y-1">
        <Field
          label="Bağlantı"
          name="url"
          id={`${prefix}url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoFocus={autoFocus}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            if (parsed?.provider === "youtube") setKind("video");
            else if (parsed?.provider === "drive-folder") setKind("other");
          }}
          errors={errors.url}
          placeholder="https://drive.google.com/file/d/…"
          hint={`Drive dosyası "Bağlantıya sahip olan herkes" ile paylaşılmış olmalı.`}
        />
        {parsed && parsed.url !== url.trim() && (
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            data-testid="normalised-url"
          >
            {parsed.url}
          </p>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Tür</legend>
        <div className="flex flex-wrap gap-2">
          {LINK_KINDS.map((k) => (
            <label key={k} className={chip}>
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {LINK_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {kind === "part" && (
          <p className="text-xs text-muted-foreground">
            Telefonlar MIDI çalamaz. Partisyonun MP3&apos;ünü de Drive&apos;a koyarsan tarayıcıda
            dinlenir.
          </p>
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Partisyon</legend>
        <div className="flex flex-wrap gap-2">
          {(["", ...VOICE_PARTS] as const).map((p) => (
            <label key={p || "tutti"} className={chip}>
              <input
                type="radio"
                name="voicePart"
                value={p}
                checked={part === p}
                onChange={() => setPart(p)}
                className="sr-only"
              />
              {p ? (
                <span className={cn("size-2 rounded-full", VOICE_PART_STYLES[p].dot)} />
              ) : (
                <span className="size-2 rounded-full ring-1 ring-foreground/40" />
              )}
              {p ? VOICE_PART_LABELS[p] : "Tutti"}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Etiket"
        name="label"
        id={`${prefix}label`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={120}
        errors={errors.label}
        placeholder={deriveLabel(kind as LinkKind, (part || null) as VoicePart | null)}
        hint="Divisi için yaz: Soprano 1, Soprano 2"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="h-11 rounded-xl px-5">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="h-11 px-4" onClick={onCancel}>
            Vazgeç
          </Button>
        )}
      </div>
    </form>
  );
}

export function LinksEditor({
  pieceId,
  links,
  folderFree,
}: {
  pieceId: string;
  links: EditorLink[];
  folderFree: boolean;
}) {
  const [pending, run] = useRunAction();
  const [items, setItems] = useOptimistic(links);
  const focusAfter = useFocusAfter();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EditorLink | null>(null);
  const [announce, setAnnounce] = useState("");
  // Remounting the add form after a save resets it and puts focus back on the URL field.
  const [addKey, setAddKey] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (location.hash === "#baglantilar") headingRef.current?.focus();
  }, []);

  function move(index: number, delta: number) {
    const next = [...items];
    const [item] = next.splice(index, 1);
    const to = index + delta;
    next.splice(to, 0, item);
    const label = item.label ?? deriveLabel(item.kind, item.voicePart);
    setAnnounce(`"${label}" ${to + 1}. sıraya taşındı.`);
    run(async () => {
      setItems(next);
      return reorderLinks(
        pieceId,
        next.map((l) => l.id),
      );
    });
    focusAfter(...moveTargets(item.id, delta));
  }

  return (
    <section
      id="baglantilar"
      className="scroll-mt-20 space-y-4 md:scroll-mt-6"
      aria-labelledby="links-heading"
    >
      <h2
        id="links-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-medium outline-none"
      >
        Bağlantılar{" "}
        <span className="text-base text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz bağlantı yok. Aşağıdan tek tek ya da toplu ekleyebilirsin.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card" data-testid="editor-links">
          {items.map((l, i) => {
            const parsed = parseLink(l.url);
            const label = l.label ?? deriveLabel(l.kind, l.voicePart);
            return (
              <li key={l.id} data-row={l.id} data-testid="editor-link">
                <div className="flex min-h-16 items-center gap-1 pr-1 pl-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" data-testid="editor-link-label">
                      {label}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {LINK_KIND_LABELS[l.kind]} · <PartDot part={l.voicePart} />
                      {l.voicePart ? VOICE_PART_LABELS[l.voicePart] : "Tutti"}
                      {parsed && <> · {hostLabel(parsed)}</>}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="size-11"
                    data-move="up"
                    disabled={i === 0}
                    aria-label={`Yukarı taşı: ${label}`}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    className="size-11"
                    data-move="down"
                    disabled={i === items.length - 1}
                    aria-label={`Aşağı taşı: ${label}`}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          data-menu
                          variant="ghost"
                          className="size-11"
                          aria-label={`İşlemler: ${label}`}
                        />
                      }
                    >
                      <MoreVertical />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuItem className="min-h-11" onClick={() => setEditing(l.id)}>
                        Düzenle
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-11"
                        render={<a href={l.url} target="_blank" rel="noopener noreferrer" />}
                      >
                        Bağlantıyı aç
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="min-h-11"
                        variant="destructive"
                        onClick={() => setDeleting(l)}
                      >
                        Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {editing === l.id && (
                  <div className="border-t bg-muted/30 p-4">
                    <LinkForm
                      action={updateLink.bind(null, l.id, pieceId)}
                      initial={l}
                      submitLabel="Kaydet"
                      onDone={() => {
                        focusAfter(`[data-row="${l.id}"] [data-menu]`);
                        setEditing(null);
                      }}
                      onCancel={() => {
                        focusAfter(`[data-row="${l.id}"] [data-menu]`);
                        setEditing(null);
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-4 rounded-2xl border bg-card p-4">
        <h3 className="font-sans text-base font-medium">Bağlantı ekle</h3>
        <LinkForm
          key={addKey}
          action={addLink.bind(null, pieceId)}
          submitLabel="Ekle"
          autoFocus={addKey > 0}
          onDone={() => setAddKey((k) => k + 1)}
        />
      </div>

      <BulkPaste pieceId={pieceId} existing={links.map((l) => l.url)} folderFree={folderFree} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Bağlantı silinsin mi?"
        description={
          deleting ? (deleting.label ?? deriveLabel(deleting.kind, deleting.voicePart)) : ""
        }
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () => {
              const target = deleting!;
              setDeleting(null);
              run(() => deleteLink(target.id, pieceId));
            },
          },
        ]}
      />
    </section>
  );
}
