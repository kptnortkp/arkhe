"use client";

import { CircleAlert, CircleCheck, Copy, Download, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton, useCopy } from "@/components/copy-button";
import { MoneyAmount } from "@/components/finance/money-amount";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/format";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ERRORS, PASTE_FILE_NAME, TOO_BIG } from "@/lib/import/limits";
import type { CheckResult, CommitResult, RowError, Warning } from "@/lib/import/types";
import { cn } from "@/lib/utils";

type Result = CheckResult | CommitResult;

const GENERIC = "Bir şeyler ters gitti, tekrar dene.";
const SHOWN_ERRORS = 100;
const CARD = "space-y-3 rounded-2xl border bg-card p-4 md:p-6";
const FAILED = "space-y-2 rounded-2xl border border-absent/40 bg-absent/8 p-4 md:p-6";
const WIDE = "h-11 w-full rounded-xl px-4 md:w-auto";

const PREFACE =
  "Portal bu CSV dosyasında aşağıdaki hataları buldu. Satır numaraları dosyanın satırlarıdır; 1. satır başlık satırıdır. Yalnızca bu hataları düzelt, öteki satırları ve kuralları değiştirme, dosyanın tamamını aynı başlıkla tek kod bloğunda yeniden ver. Düzeltemediğin satırı çıkar ve Atladıklarım listesine yaz.";
const CAPPED = "İlk 1000 hata listelendi; dosyayı düzeltip yeniden kontrol et.";

function errorLine(e: RowError) {
  if (e.line === null) return e.message;
  return e.column ? `Satır ${e.line} · ${e.column}: ${e.message}` : `Satır ${e.line}: ${e.message}`;
}

/** What Hataları kopyala puts on the clipboard (D22, D23). */
function errorText(errors: RowError[], capped: boolean) {
  return [PREFACE, "", ...errors.map(errorLine), ...(capped ? [CAPPED] : [])].join("\n");
}

const fileError = (message: string): Result => ({
  kind: "fileError",
  file: null,
  message,
  messages: [message],
});

const HEADER_PROBLEM = /Bilinmeyen sütun|Zorunlu sütun eksik|sütunu iki kez var|Başlığı boş|Başlıkta çok fazla sütun/;

const WARNING_ORDER: Warning["kind"][] = [
  "deactivate",
  "autoAbsent",
  "newSponsor",
  "sameFile",
  "other",
  "nameMismatch",
];

function Warnings({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) return null;
  const sorted = [...warnings].sort(
    (a, b) => WARNING_ORDER.indexOf(a.kind) - WARNING_ORDER.indexOf(b.kind),
  );
  return (
    <section
      aria-labelledby="dikkat"
      className="space-y-2 rounded-2xl border border-late/45 bg-late/10 p-4 md:p-6"
      data-testid="import-warnings"
    >
      <h2 id="dikkat" className="text-lg font-medium">
        Dikkat
      </h2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        {sorted.map((w, i) => (
          <li
            key={i}
            data-kind={w.kind}
            className={cn("[overflow-wrap:anywhere]", w.kind === "deactivate" && "font-semibold")}
          >
            {w.text}
            {(w.kind === "nameMismatch" || w.kind === "other") && w.items?.length ? (
              <details className="mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline-offset-4 hover:underline">
                  Listeyi göster
                </summary>
                <ul className="space-y-1 pb-1">
                  {w.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ErrorList({ result }: { result: Extract<Result, { kind: "errors" }> }) {
  const [copy, dialog] = useCopy("Hatalar");
  const shown = result.errors.slice(0, SHOWN_ERRORS);
  const more = result.errorCount - shown.length;
  return (
    <section aria-labelledby="hatalar" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hatalar" className="text-xl font-medium">
          Hatalar
        </h2>
        <Button
          variant="outline"
          className="h-11 rounded-xl px-4"
          onClick={() => copy(errorText(result.errors, result.capped), "Hatalar kopyalandı.")}
        >
          <Copy />
          Hataları kopyala
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Kopyala ve aynı yapay zekâ sohbetine yapıştır; düzeltilmiş dosyanın tamamını ister.
      </p>
      <ol aria-label="Hatalar" className="text-sm" data-testid="import-errors">
        {shown.map((e, i) => (
          <li key={i} className="space-y-0.5 border-t py-2.5" data-testid="import-error" data-text={errorLine(e)}>
            <p className="flex flex-wrap items-center gap-x-1.5">
              {e.line !== null && (
                <span className="font-semibold tabular-nums">Satır {e.line}</span>
              )}
              {e.line !== null && e.column && <span aria-hidden>·</span>}
              {e.column && (
                <code className="rounded bg-muted px-1 font-mono text-[13px]">{e.column}</code>
              )}
            </p>
            <p className="[overflow-wrap:anywhere]">{e.message}</p>
          </li>
        ))}
        {more > 0 && (
          <li className="border-t py-2.5 text-muted-foreground" data-testid="import-errors-more">
            ve {more} hata daha (ilk {IMPORT_MAX_ERRORS}&apos;i kopyalanır)
          </li>
        )}
      </ol>
      {dialog}
    </section>
  );
}

export type NextStep = { href: string; label: string };

const noop = () => () => {};

export function ImportFlow({
  check,
  commit,
  typeTitle,
  header,
  next,
}: {
  check: (formData: FormData) => Promise<CheckResult>;
  commit: (formData: FormData) => Promise<CommitResult>;
  typeTitle: string;
  header: string;
  next: NextStep;
}) {
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [picked, setPicked] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  // The exact bytes that were checked; the commit resends them (D12, D18).
  const [checked, setChecked] = useState<File | null>(null);
  const [action, setAction] = useState<"check" | "commit" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const resultArea = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<HTMLElement | null>(null);

  // False during SSR and hydration: lets tests wait until the inputs are live.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const source = tab === "file" ? picked : text.trim() ? "paste" : null;

  function reset() {
    setResult(null);
    setChecked(null);
  }

  function clearSource() {
    setPicked(null);
    setText("");
    if (input.current) input.current.value = "";
  }

  async function pick(file: File | undefined) {
    reset();
    if (!file) return setPicked(null);
    if (file.size > IMPORT_MAX_BYTES) {
      setPicked(null);
      if (input.current) input.current.value = "";
      return setResult(fileError(TOO_BIG));
    }
    // A snapshot, not the live handle: a file edited on disk after the check can't slip in.
    const bytes = await file.arrayBuffer();
    setPicked(new File([bytes], file.name, { type: "text/csv" }));
  }

  function run(kind: "check" | "commit") {
    if (busy.current) return;
    const file =
      kind === "commit"
        ? checked
        : tab === "file"
          ? picked
          : new File([text], PASTE_FILE_NAME, { type: "text/csv" });
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) return setResult(fileError(TOO_BIG));
    const sha = result && "file" in result && result.file ? result.file.sha256 : null;
    busy.current = true;
    setAction(kind);
    setConfirm(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      if (kind === "commit" && sha) fd.set("sha256", sha);
      let next: Result;
      try {
        next = kind === "check" ? await check(fd) : await commit(fd);
      } catch {
        // Bodies over the server's limit throw before the action runs.
        next = fileError(file.size > IMPORT_MAX_BYTES ? TOO_BIG : GENERIC);
      }
      busy.current = false;
      setAction(null);
      setResult(next);
      setChecked(kind === "check" && next.kind === "clean" ? file : null);
      if (next.kind === "done") clearSource();
      requestAnimationFrame(() => {
        resultArea.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        // After a commit the button is gone; focus the outcome instead of <body>.
        if (kind === "commit") focusTarget.current?.focus({ preventScroll: true });
      });
    });
  }

  const checking = pending && action === "check";
  const committing = pending && action === "commit";
  const changes = result?.kind === "clean" ? result.counts.added + result.counts.updated : 0;
  const fileName = result && "file" in result && result.file ? result.file.name : "";
  const live =
    result?.kind === "errors" || result?.kind === "clean"
      ? `${result.kind === "errors" && result.afterCheck ? "Kontrolden sonra portalda bir şey değişti. " : ""}${result.summary}`
      : result?.kind === "fileError" || result?.kind === "denied" || result?.kind === "unchanged"
        ? result.message
        : result?.kind === "done"
          ? result.message
          : "";

  return (
    <>
      <section aria-labelledby="yukle" className={CARD}>
        <h2 id="yukle" className="text-xl font-medium">
          2 · Yükle ve kontrol et
        </h2>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "file" | "paste");
            reset();
          }}
        >
          <TabsList className="h-auto! w-full md:w-auto">
            <TabsTrigger value="file" className="h-11 px-4" disabled={pending}>
              Dosya seç
            </TabsTrigger>
            <TabsTrigger value="paste" className="h-11 px-4" disabled={pending}>
              Metni yapıştır
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="space-y-2 pt-1">
            <Label id="import-file-label" htmlFor="import-file">
              Dosya seç (.csv)
            </Label>
            <label
              htmlFor="import-file"
              className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-input p-3 focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!pending) pick(e.dataTransfer.files[0]);
              }}
            >
              <input
                ref={input}
                id="import-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                aria-labelledby="import-file-label"
                aria-describedby="import-file-hint"
                disabled={pending}
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <span
                aria-hidden
                className={cn(buttonVariants({ variant: "outline" }), "h-11 shrink-0 rounded-xl px-4")}
              >
                Dosya seç
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {picked ? (
                  <>
                    <span className="block truncate font-medium" data-testid="picked-name">
                      {picked.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatBytes(picked.size)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Henüz dosya seçilmedi.</span>
                )}
              </span>
            </label>
            <p id="import-file-hint" className="text-xs text-muted-foreground">
              En fazla 1 MB ve 5000 satır. UTF-8 CSV.
            </p>
          </TabsContent>
          <TabsContent value="paste" className="space-y-2 pt-1">
            <Label htmlFor="import-text">CSV metni</Label>
            <textarea
              id="import-text"
              rows={8}
              value={text}
              disabled={pending}
              spellCheck={false}
              aria-describedby="import-text-hint"
              onChange={(e) => {
                setText(e.target.value);
                reset();
              }}
              className="w-full rounded-xl border border-input bg-transparent p-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30"
            />
            <p id="import-text-hint" className="text-xs text-muted-foreground">
              Yapay zekânın verdiği kod bloğunu, başlık satırıyla birlikte yapıştır.
            </p>
          </TabsContent>
        </Tabs>
        <Button
          className={WIDE}
          disabled={!source || pending}
          aria-busy={checking || undefined}
          onClick={() => run("check")}
        >
          {checking && <LoaderCircle className="animate-spin" aria-hidden />}
          {checking ? "Kontrol ediliyor…" : "Kontrol et"}
        </Button>
        <p className="text-xs text-muted-foreground">Kontrol hiçbir şey yazmaz.</p>
      </section>

      <div role="status" aria-live="polite" className="sr-only" data-testid="import-summary">
        {live}
      </div>

      <div ref={resultArea} id="sonuc" className="scroll-mt-20 space-y-4" data-testid="import-result" data-kind={result?.kind ?? "idle"} data-ready={hydrated || undefined}>
        {(result?.kind === "fileError" || result?.kind === "denied") && (
          <section className={FAILED}>
            <p
              ref={(el) => {
                focusTarget.current = el;
              }}
              tabIndex={-1}
              className="flex gap-2 font-semibold outline-none"
            >
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-absent-ink" aria-hidden />
              <span className="space-y-1 [overflow-wrap:anywhere]">
                {(result.kind === "fileError" ? result.messages : [result.message]).map((m, i) => (
                  <span key={i} className="block">
                    {m}
                  </span>
                ))}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">Hiçbir şey yazılmadı.</p>
            {result.kind === "fileError" && HEADER_PROBLEM.test(result.message) && (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-medium">Geçerli sütunlar:</p>
                <p className="rounded-xl bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
                  {header}
                </p>
                <CopyButton text={header} label="Başlığı kopyala" toastText="Başlık kopyalandı." />
              </div>
            )}
          </section>
        )}

        {result?.kind === "errors" && (
          <>
            <section className={FAILED}>
              <p
                ref={(el) => {
                  focusTarget.current = el;
                }}
                tabIndex={-1}
                className="flex gap-2 font-semibold outline-none"
              >
                <CircleAlert className="mt-0.5 size-5 shrink-0 text-absent-ink" aria-hidden />
                <span>
                  {result.afterCheck && "Kontrolden sonra portalda bir şey değişti. "}
                  {result.summary}
                </span>
              </p>
              {fileName && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{fileName}</p>}
            </section>
            <ErrorList result={result} />
          </>
        )}

        {result?.kind === "unchanged" && (
          <section className={CARD}>
            <p
              ref={(el) => {
                focusTarget.current = el;
              }}
              tabIndex={-1}
              className="flex gap-2 font-medium outline-none"
            >
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-present-ink" aria-hidden />
              {result.message}
            </p>
            {result.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w.text}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {result?.kind === "clean" && (
          <>
            <section className={CARD} aria-label="Kontrol sonucu">
              <p aria-hidden className="font-medium">
                {result.rowCount} satır okundu
              </p>
              <p className="sr-only">{result.summary}</p>
              <div aria-hidden className="grid grid-cols-3 gap-2">
                {(
                  [
                    [result.counts.added, "eklenecek"],
                    [result.counts.updated, "güncellenecek"],
                    [result.counts.unchanged, "değişmeyecek"],
                  ] as const
                ).map(([n, label]) => (
                  <div key={label} className="rounded-xl bg-muted py-2 text-center">
                    <p className="text-[22px] font-semibold tabular-nums">{n}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              {result.notes.map((n, i) => (
                <p key={i} className="text-sm text-muted-foreground">
                  {n}
                </p>
              ))}
              {result.balances && (
                <div className="space-y-1.5 border-t pt-3 text-sm" data-testid="import-balances">
                  <p className="text-muted-foreground">İçe aktarımdan sonra</p>
                  {(
                    [
                      ["Kasa", result.balances.cash],
                      ["Banka", result.balances.bank],
                    ] as const
                  ).map(([label, b]) => (
                    <p key={label} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span>{label}</span>
                      <span className="font-medium">
                        <MoneyAmount kurus={b.before} kind="balance" className="text-muted-foreground" />
                        <span aria-hidden> → </span>
                        <span className="sr-only"> sonra </span>
                        <MoneyAmount kurus={b.after} kind="balance" />
                      </span>
                    </p>
                  ))}
                  <p className="text-xs text-muted-foreground">{result.balances.hint}</p>
                </div>
              )}
              {fileName && (
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {fileName} · {formatBytes(result.file.size)} ·{" "}
                  <span className="font-mono" title={result.file.sha256}>
                    <span className="sr-only">SHA-256 özeti </span>
                    {result.file.sha256.slice(0, 12)}
                  </span>
                </p>
              )}
            </section>

            <Warnings warnings={result.warnings} />

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Button
                className={WIDE}
                disabled={pending}
                aria-busy={committing || undefined}
                onClick={() => setConfirm(true)}
              >
                {committing && <LoaderCircle className="animate-spin" aria-hidden />}
                {committing ? "Aktarılıyor…" : `İçe aktar (${changes} değişiklik)`}
              </Button>
              <Button
                variant="ghost"
                className={WIDE}
                disabled={pending}
                onClick={() => {
                  reset();
                  clearSource();
                }}
              >
                Vazgeç
              </Button>
            </div>
            {committing && (
              <p className="text-sm text-muted-foreground">
                Büyük dosyalarda yarım dakika sürebilir. Sayfayı kapatma.
              </p>
            )}

            <section aria-labelledby="neler" className={CARD}>
              <div>
                <h2 id="neler" className="text-lg font-medium">
                  Neler değişecek
                </h2>
                <p className="text-sm text-muted-foreground">
                  {result.effectsMore > 0 ? `İlk ${result.effects.length} satır.` : "Tümü."}
                </p>
              </div>
              <ul className="text-sm" data-testid="import-effects">
                {result.effects.map((e, i) => (
                  <li key={i} className="border-t py-2 [overflow-wrap:anywhere]">
                    {e}
                  </li>
                ))}
                {result.effectsMore > 0 && (
                  <li className="border-t py-2 text-muted-foreground">
                    ve {result.effectsMore} değişiklik daha
                  </li>
                )}
              </ul>
            </section>

            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title={`${changes} değişiklik aktarılsın mı?`}
              description={`${typeTitle} · ${result.file.name}. Hepsi birden yazılır; sonra İçe aktarma geçmişi'nden geri alabilirsin.`}
              pending={committing}
              actions={[{ label: "İçe aktar", variant: "default", run: () => run("commit") }]}
            >
              {result.deactivations > 0 && (
                <p className="text-sm font-medium text-absent-ink">
                  {result.deactivations} kişi pasifleşecek ve oturumları kapanacak.
                </p>
              )}
            </ConfirmDialog>
          </>
        )}

        {result?.kind === "done" && (
          <section
            className="space-y-3 rounded-2xl border border-present/40 bg-present/8 p-4 md:p-6"
            data-testid="import-done"
          >
            <p
              ref={(el) => {
                focusTarget.current = el;
              }}
              tabIndex={-1}
              className="flex gap-2 font-semibold outline-none"
            >
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-present-ink" aria-hidden />
              {result.message}
            </p>
            <p className="text-sm text-muted-foreground">
              Yanlış görürsen{" "}
              <Link href="/ice-aktar/gecmis" className="font-medium text-foreground underline underline-offset-4">
                İçe aktarma geçmişi
              </Link>
              &apos;nden geri alabilirsin.
            </p>
            {result.hint && (
              <div className="space-y-2 rounded-xl bg-card p-3">
                <p className="text-sm">{result.hint}</p>
                <a
                  href="/ice-aktar/uye-listesi"
                  download
                  className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}
                >
                  <Download aria-hidden />
                  Üye listesini indir
                </a>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {result.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-xl px-4")}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <Link href={next.href} className={cn(buttonVariants(), WIDE)}>
              {next.label}
            </Link>
          </section>
        )}
      </div>
    </>
  );
}
