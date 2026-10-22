import { z } from "zod";
import { cleanLine } from "@/lib/text";
import { optionalText } from "@/lib/validation";
import { text } from "./schemas";

export const sponsorSchema = z.object({
  name: z
    .string()
    .overwrite(cleanLine)
    .trim()
    .min(1, "Ad gir.")
    .max(120, "En fazla 120 karakter.")
    .transform((v) => v.replace(/\s+/g, " ")),
  contactName: text(80),
  contact: text(120),
  note: optionalText(500),
});

export const SPONSOR_TAKEN = "Bu adla bir sponsor zaten var.";
