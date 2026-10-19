import { CHECK_FAILED, constraintKind, NOT_FOUND } from "@/lib/finance/schemas";
import { formValues, type FormState } from "@/lib/validation";

/** Thrown inside a write to attach a message to one form field (and roll the transaction back). */
export class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/** Runs a write and maps field throws and constraint failures to form state. */
export async function guarded(
  formData: FormData,
  fn: () => Promise<FormState>,
): Promise<FormState> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof FieldError) {
      return { values: formValues(formData), fieldErrors: { [error.field]: [error.message] } };
    }
    const kind = constraintKind(error);
    if (kind === "fk") return { error: NOT_FOUND, values: formValues(formData) };
    if (kind) {
      console.error("finance constraint", error);
      return { error: CHECK_FAILED, values: formValues(formData) };
    }
    throw error;
  }
}
