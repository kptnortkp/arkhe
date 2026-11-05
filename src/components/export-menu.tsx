"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { downloadInApp } from "@/components/download-link";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { format: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet },
  { format: "pdf", label: "PDF", icon: FileText },
  { format: "csv", label: "CSV", icon: FileType },
] as const;

/** "İndir" with Excel, PDF and CSV; `base` is the report path, `query` its search string. */
export function ExportMenu({
  base,
  query = "",
  label = "İndir",
  className,
}: {
  base: string;
  query?: string;
  label?: string;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="export-menu"
        className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-full px-4", className)}
      >
        <Download />
        {label}
        <ChevronDown className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {OPTIONS.map(({ format, label, icon: Icon }) => (
          <Menu.LinkItem
            key={format}
            href={`${base}/${format}${query ? `?${query}` : ""}`}
            download
            onClick={downloadInApp}
            closeOnClick
            data-testid={`export-${format}`}
            className="flex h-10 items-center gap-2 rounded-md px-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <Icon />
            {label}
          </Menu.LinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
