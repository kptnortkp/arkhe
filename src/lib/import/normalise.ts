import { searchKey } from "@/lib/format";

/** D6: Turkish lower-case, fold accents and ı, every run of other characters becomes "_". */
export function normaliseCode(value: string) {
  return searchKey(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
