import {
  CalendarCheck,
  ChartColumn,
  House,
  Library,
  Mic,
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
  // Shows the count of the user's open homework.
  homeworkBadge?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Ana sayfa", icon: House },
  { href: "/calismalar", label: "Çalışmalar", icon: CalendarCheck },
  { href: "/repertuvar", label: "Repertuvar", icon: Library },
  { href: "/odevler", label: "Ödevler", icon: Mic, homeworkBadge: true },
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
  { href: "/uyeler", label: "Üyeler", icon: Users, managersOnly: true },
];
