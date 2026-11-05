import { duesExport } from "@/lib/exports/reports";
import { exportRoute } from "@/lib/exports/route";

export const GET = exportRoute("pdf", duesExport);
