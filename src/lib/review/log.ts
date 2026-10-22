/** A loggable tag for a DB error: never the message, which repeats the query and its params. */
export function errorTag(error: unknown) {
  let code: string | undefined;
  for (let e = error; e && !code; e = (e as { cause?: unknown }).cause) {
    code = (e as { code?: string }).code;
  }
  return { name: (error as Error)?.name, code };
}
