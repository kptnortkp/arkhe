import { FilterChip } from "@/components/filter-chip";
import { ActiveChipIntoView } from "@/components/finance/active-chip-into-view";

const SECTIONS = [
  ["ozet", "Özet", "/finans"],
  ["hareketler", "Hareketler", "/finans/hareketler"],
  ["aidat", "Aidat", "/finans/aidat"],
  ["etkinlikler", "Etkinlikler", "/finans/etkinlikler"],
  ["sponsorlar", "Sponsorlar", "/finans/sponsorlar"],
  ["rapor", "Rapor", "/finans/rapor"],
  ["butce", "Bütçe", "/finans/butce"],
  ["ayarlar", "Ayarlar", "/finans/ayarlar"],
] as const;

export type FinanceSection = (typeof SECTIONS)[number][0];

export function FinanceNav({ active }: { active: FinanceSection }) {
  return (
    <>
      <ActiveChipIntoView label="Finans bölümleri" />
      <nav
        aria-label="Finans bölümleri"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
      >
        {SECTIONS.map(([key, label, href]) => (
          <FilterChip key={key} href={href} active={key === active} label={label} />
        ))}
      </nav>
    </>
  );
}

export const eyebrow =
  "font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase";
