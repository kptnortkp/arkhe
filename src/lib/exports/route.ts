import "server-only";
import { managerOrError } from "@/lib/api";
import { csvDocument, downloadHeaders } from "@/lib/csv";
import { bookPdf } from "./pdf";
import { asBook, type ExportBook, type ExportFormat, type ExportTable } from "./table";
import { bookXlsx } from "./xlsx";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

type Build<C> = (request: Request, ctx: C) => Promise<ExportTable | ExportBook | Response>;

/** A manager-only GET that renders a report (one table or a book of them) as CSV, Excel or PDF. */
export function exportRoute<C>(format: ExportFormat, build: Build<C>) {
  return async (request: Request, ctx: C) => {
    const auth = await managerOrError();
    if (auth.error) return auth.error;
    const built = await build(request, ctx);
    if (built instanceof Response) return built;
    const book = "sheets" in built ? built : asBook(built);
    let body: BodyInit;
    if (format === "csv") {
      if ("sheets" in built) throw new Error("A multi-table report has no CSV form.");
      body = csvDocument(built.header, built.rows);
    } else {
      body = new Uint8Array(format === "xlsx" ? await bookXlsx(book) : await bookPdf(book));
    }
    const ext = `.${format}`;
    return new Response(body, {
      headers: downloadHeaders(
        CONTENT_TYPES[format],
        book.filename + ext,
        (book.utf8Name ?? book.filename) + ext,
      ),
    });
  };
}
