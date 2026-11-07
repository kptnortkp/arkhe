import {
  Bug,
  CalendarCheck,
  ChartColumn,
  House,
  Library,
  Megaphone,
  Mic,
  SquareKanban,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  managersOnly?: boolean;
  // Kept out of the mobile tab bar; reached from inside a section instead.
  sidebarOnly?: boolean;
  // The bottom bar's shorter label.
  shortLabel?: string;
  // Only for the issue-report handler (users.handles_reports), whatever the role.
  handlerOnly?: boolean;
  // Which count badge the entry carries: open homework, new board tickets or open reports.
  badge?: "homework" | "board" | "reports";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ana sayfa", icon: House },
  { href: "/calismalar", label: "Çalışmalar", icon: CalendarCheck },
  { href: "/repertuvar", label: "Repertuvar", icon: Library },
  { href: "/odevler", label: "Ödevler", icon: Mic, badge: "homework" },
  { href: "/duyurular", label: "Duyurular", icon: Megaphone, sidebarOnly: true },
  {
    href: "/raporlar",
    label: "Raporlar",
    icon: ChartColumn,
    managersOnly: true,
    sidebarOnly: true,
  },
  {
    href: "/finans",
    label: "Finans",
    icon: Wallet,
    managersOnly: true,
    sidebarOnly: true,
  },
  {
    href: "/yonetim",
    label: "Yönetim Kurulu",
    shortLabel: "Yönetim",
    icon: SquareKanban,
    managersOnly: true,
    badge: "board",
  },
  { href: "/uyeler", label: "Üyeler", icon: Users, managersOnly: true, sidebarOnly: true },
  {
    href: "/sorunlar",
    label: "Sorunlar",
    icon: Bug,
    handlerOnly: true,
    sidebarOnly: true,
    badge: "reports",
  },
];
