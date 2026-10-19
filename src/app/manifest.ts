import type { MetadataRoute } from "next";
import { brandColors } from "@/lib/brand/colors";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arkhe · Mülkiye Çoksesli Korosu",
    short_name: "Arkhe",
    description: "Arkhe korist portalı: çalışmalar, yoklama, repertuvar, ödevler ve aidat.",
    lang: "tr",
    dir: "ltr",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: brandColors.backgroundDark,
    theme_color: brandColors.stage,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Yoklama",
        url: "/yoklama",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Ödevlerim",
        url: "/odevler",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
