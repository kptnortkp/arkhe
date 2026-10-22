import type { ImportDef } from "../def";
import type { Slug } from "../limits";
import { aidatDonemleri } from "./aidat-donemleri";
import { aidatOdemeleri } from "./aidat-odemeleri";
import { donemler } from "./donemler";
import { hareketler } from "./hareketler";
import { uyeler } from "./uyeler";
import { yoklama } from "./yoklama";

/** In D1 order. */
export const DEFS: readonly ImportDef[] = [
  uyeler,
  donemler,
  yoklama,
  hareketler,
  aidatDonemleri,
  aidatOdemeleri,
];

export function defOf(slug: Slug) {
  return DEFS.find((d) => d.slug === slug)!;
}

export function defOfKind(kind: ImportDef["kind"]) {
  return DEFS.find((d) => d.kind === kind)!;
}
