import { ledgerExport } from "@/lib/exports/reports";
import { exportRoute } from "@/lib/exports/route";

export const GET = exportRoute("csv", ledgerExport);
