import type { Metadata, Viewport } from "next";
import { Geist, Jost } from "next/font/google";
import { connection } from "next/server";
import { PwaBoot } from "@/components/pwa-boot";
import { Toaster } from "@/components/ui/sonner";
import { brandColors } from "@/lib/brand/colors";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

const display = Jost({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "Arkhe Portal", template: "%s · Arkhe" },
  description: "Koro Arkhe üye portalı",
  applicationName: "Arkhe Portal",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brandColors.background },
    { media: "(prefers-color-scheme: dark)", color: brandColors.backgroundDark },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so the CSP nonce from the proxy reaches its scripts.
  await connection();
  return (
    <html lang="tr" className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
        <PwaBoot />
      </body>
    </html>
  );
}
