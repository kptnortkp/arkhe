// Shared by schema.ts (CHECK constraints), server code and client forms; no Node APIs.
export const ENTRY_KINDS = ["income", "expense", "transfer", "opening"] as const;
export const ACCOUNTS = ["cash", "bank"] as const;
export const INCOME_CATEGORIES = [
  "dues",
  "sponsorship",
  "tickets",
  "donation",
  "grant",
  "other_income",
] as const;
export const EXPENSE_CATEGORIES = [
  "costume",
  "venue",
  "musician_fee",
  "scores_royalties",
  "travel",
  "festival_fee",
  "organisation",
  "catering",
  "refund",
  "bank_fee",
  "other_expense",
] as const;
export const CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES] as const;
export const DUES_RATES = ["standard", "reduced", "exempt"] as const;
export const OVERRIDE_KINDS = ["waiver", "freeze"] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];
export type Account = (typeof ACCOUNTS)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type Category = (typeof CATEGORIES)[number];
export type DuesRate = (typeof DUES_RATES)[number];
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

export function kindOfCategory(category: Category): "income" | "expense" {
  return (INCOME_CATEGORIES as readonly string[]).includes(category) ? "income" : "expense";
}
