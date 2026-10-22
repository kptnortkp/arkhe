// Isomorphic result shapes of checkImport / commitImport / undoImport, shared with the client flow.
import type { Slug } from "./limits";

export type FileMeta = { name: string; size: number; sha256: string };

/** `line` is the physical line in the file (header = 1); null for whole-file problems. */
export type RowError = { line: number | null; column: string | null; message: string };

export type WarningKind =
  | "deactivate"
  | "autoAbsent"
  | "newSponsor"
  | "nameMismatch"
  | "sameFile"
  | "other";

/** `items` holds the list under the sentence (names); nameMismatch is collapsed by the UI, deactivate never. */
export type Warning = { kind: WarningKind; text: string; items?: string[] };

export type Counts = { added: number; updated: number; unchanged: number };

/** Before → after per account, for hareketler and aidat-odemeleri. */
export type BalancePreview = {
  cash: { before: number; after: number };
  bank: { before: number; after: number };
  hint: string;
};

export type ResultLink = { label: string; href: string };

export type CheckResult =
  | { kind: "denied"; message: string }
  /** Encoding, size, header, empty, tokenizer problems: nothing was checked row by row. */
  | { kind: "fileError"; file: FileMeta | null; message: string; messages: string[] }
  | {
      kind: "errors";
      file: FileMeta;
      rowCount: number;
      errorCount: number;
      /** True when `errors` was cut at IMPORT_MAX_ERRORS. */
      capped: boolean;
      errors: RowError[];
      /** "<n> satır okundu · <e> hata. Hiçbir şey yazılmadı. Dosyayı düzeltip yeniden yükle." */
      summary: string;
      /** Set on a commit that found new errors: the DB changed after the check. */
      afterCheck?: true;
    }
  | {
      kind: "clean";
      file: FileMeta;
      rowCount: number;
      counts: Counts;
      warnings: Warning[];
      balances?: BalancePreview;
      /** Extra summary lines, e.g. "12 çalışma · 9 tutti, 2 partisyon, 1 konser". */
      notes: string[];
      effects: string[];
      effectsMore: number;
      /** "<n> satır okundu · <a> eklenecek · <u> güncellenecek · <s> değişmeyecek" */
      summary: string;
      /** Deactivations, for the confirm dialog's extra line. */
      deactivations: number;
    }
  | {
      kind: "unchanged";
      file: FileMeta;
      rowCount: number;
      counts: Counts;
      warnings: Warning[];
      /** "Değişecek bir şey yok; bu dosyadaki her şey zaten portalda." */
      message: string;
    };

export type CommitResult =
  | Exclude<CheckResult, { kind: "clean" }>
  | {
      kind: "done";
      batchId: number;
      counts: Counts;
      /** "İçe aktarıldı: <a> eklendi, <u> güncellendi, <s> değişmedi." */
      message: string;
      links: ResultLink[];
      /** uyeler only: "Sıradaki adımlardan önce üye listesini yeniden indir; …" */
      hint?: string;
    };

export type { Slug };
