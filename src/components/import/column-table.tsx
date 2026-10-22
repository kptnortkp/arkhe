import { cn } from "@/lib/utils";

export type ColumnDoc = {
  name: string;
  required: string;
  format: string;
  allowed: string;
  example: string;
  help: string;
};

const CODE = "rounded bg-muted px-1 font-mono text-[13px] [overflow-wrap:anywhere]";

/** Renders the definitions' Markdown subset: `code` and **bold**. */
export function InlineText({ text }: { text: string }) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className={CODE}>
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** "`a`, `b`" lists become wrapping chips; anything else stays text. */
function Allowed({ text }: { text: string }) {
  if (text === "—") return <span className="text-muted-foreground">—</span>;
  const codes = /^(`[^`]+`(, )?)+$/.test(text) ? text.match(/`[^`]+`/g) : null;
  if (!codes) return <InlineText text={text} />;
  return (
    <span className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <code key={c} className={CODE}>
          {c.slice(1, -1)}
        </code>
      ))}
    </span>
  );
}

function RequiredChip({ value }: { value: string }) {
  if (value === "Hayır") return null;
  const required = value === "Evet";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        required ? "bg-primary/10 text-primary" : "bg-late/18 text-late-ink",
      )}
    >
      {required ? "Zorunlu" : "Koşullu"}
    </span>
  );
}

/** A table from md, one card per column below it (two DOMs; the hidden one leaves the a11y tree). */
export function ColumnTable({ columns, title }: { columns: ColumnDoc[]; title: string }) {
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {columns.map((c) => (
          <li key={c.name} className="space-y-2 rounded-xl border p-3" data-testid="column-card">
            <p className="flex flex-wrap items-center gap-2">
              <code className="font-mono font-medium [overflow-wrap:anywhere]">{c.name}</code>
              <RequiredChip value={c.required} />
            </p>
            <dl className="space-y-1.5 text-sm">
              {c.required !== "Evet" && c.required !== "Hayır" && (
                <div>
                  <dt className="text-xs text-muted-foreground">Zorunlu</dt>
                  <dd>{c.required}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Biçim</dt>
                <dd className="[overflow-wrap:anywhere]">
                  <InlineText text={c.format} />
                </dd>
              </div>
              {c.allowed !== "—" && (
                <div>
                  <dt className="text-xs text-muted-foreground">İzin verilen değerler</dt>
                  <dd>
                    <Allowed text={c.allowed} />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Örnek</dt>
                <dd>
                  <code className={CODE}>{c.example}</code>
                </dd>
              </div>
              {c.help && (
                <div>
                  <dt className="text-xs text-muted-foreground">Açıklama</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    <InlineText text={c.help} />
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
      <table className="hidden w-full table-fixed border-collapse text-sm md:table">
        <caption className="sr-only">{title}: sütunlar</caption>
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[10%]" />
          <col className="w-[14%]" />
          <col className="w-[22%]" />
          <col className="w-[14%]" />
          <col className="w-[24%]" />
        </colgroup>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {["Sütun", "Zorunlu", "Biçim", "İzin verilen değerler", "Örnek", "Açıklama"].map((h) => (
              <th key={h} scope="col" className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} className="border-b align-top last:border-0" data-testid="column-row">
              <th scope="row" className="px-2 py-2.5 text-left font-normal">
                <code className="font-mono font-medium [overflow-wrap:anywhere]">{c.name}</code>
              </th>
              <td className="px-2 py-2.5 [overflow-wrap:anywhere]">{c.required}</td>
              <td className="px-2 py-2.5 [overflow-wrap:anywhere]">
                <InlineText text={c.format} />
              </td>
              <td className="px-2 py-2.5">
                <Allowed text={c.allowed} />
              </td>
              <td className="px-2 py-2.5">
                <code className={cn(CODE, c.example.length <= 10 && "whitespace-nowrap")}>
                  {c.example}
                </code>
              </td>
              <td className="px-2 py-2.5 [overflow-wrap:anywhere]">
                <InlineText text={c.help} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
