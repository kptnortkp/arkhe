import { fullReportExport } from "@/lib/exports/full-report";
import { exportRoute } from "@/lib/exports/route";

export const GET = exportRoute("pdf", fullReportExport);
