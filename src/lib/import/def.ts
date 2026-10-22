// The shape of one import type's definition: parser, page table, sample, docs and prompt all read it.
import type { ImportKind } from "@/db/schema";
import type { Slug } from "./limits";
import type { ResultLink } from "./types";

/** The part of a code table the parser and the docs read. */
export type CodeLookup = { canonical: readonly string[]; lookup: ReadonlyMap<string, string> };

export type Format =
  | { kind: "text"; max: number }
  /** nameSchema: 2–80 characters. */
  | { kind: "name" }
  | { kind: "email" }
  /** `future`: end-type dates (bitis, son_odeme) may lie ahead. */
  | { kind: "date"; future?: boolean }
  | { kind: "time" }
  | { kind: "amount" }
  | { kind: "code"; table: CodeLookup; codes?: readonly string[] }
  /** Codes joined by "+": partiler. */
  | { kind: "codes"; table: CodeLookup }
  | { kind: "recordNo" }
  | { kind: "url" };

export type ColumnDef = {
  /** Canonical header, already normalised: "katilim_tarihi". */
  name: string;
  /** true, false, or the condition shown in "Zorunlu" ("Eski üyede"). */
  required: boolean | string;
  format: Format;
  /** "Biçim" cell. */
  formatText: string;
  /** "İzin verilen değerler" cell when it isn't just the code list. */
  allowedText?: string;
  example: string;
  help: string;
  /** The SÜTUNLAR line of the AI prompt. */
  prompt: string;
};

export type WorkedExample = {
  /** Heading of a second or later example ("İkinci örnek: …"). */
  title?: string;
  /** One sentence before the source block. */
  intro: string;
  source: string;
  /** The expected CSV: it must pass Kontrol et against the docs' fictional cast. */
  csv: string;
  /** The AI's closing report, one paragraph each. */
  report: string[];
  teaches: string;
};

export type ImportDef = {
  slug: Slug;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  kind: ImportKind;
  title: string;
  /** Index card line (≤ 48 characters). */
  summary: string;
  /** Type page explanation. */
  explanation: string;
  columns: readonly ColumnDef[];
  /** Sample rows in column order; "" is a blank cell. */
  sample: readonly (readonly string[])[];
  /** BU DOSYAYA ÖZEL KURALLAR. */
  rules: readonly string[];
  /** Adds the KİŞİLER block (types 3 and 6). */
  people: boolean;
  /** Adds the "two Selins" rule (types with people). */
  ambiguity: boolean;
  /** The unit an output split must never cut. */
  unit: string;
  example: WorkedExample;
  /** Further worked examples, after the first one. */
  moreExamples?: readonly WorkedExample[];
  /** Portal data the copied prompt lists (D-P1-2); the repo copy shows an explained placeholder. */
  live?: readonly LiveBlock[];
  links: readonly ResultLink[];
  /** Extra paragraphs for the .md, after the table. */
  notes?: readonly string[];
};

export type LiveBlock = "periods" | "events" | "firstHandEntry";

/** What the server fills into a copied prompt; null in the static docs. */
export type LiveData = {
  periods: {
    name: string;
    startsOn: string;
    endsOn: string;
    dueOn: string;
    amountKurus: number;
    reducedAmountKurus: number | null;
  }[];
  events: string[];
  /** The earliest live hand-made ledger entry (not opening, not dues, not imported). */
  firstHandEntry: string | null;
};

export function headerLine(def: ImportDef) {
  return def.columns.map((c) => c.name).join(";");
}

export function fileBase(def: ImportDef) {
  return `${def.step}-${def.slug}`;
}
