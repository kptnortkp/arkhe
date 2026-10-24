import type { Metadata, Viewport } from "next";
import { Geist, Jost } from "next/font/google";
import { headers } from "next/headers";
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

// ES5 on purpose: it must run where the bundle can't (Next targets Safari 16.4+). The 15.4 built-ins
// catch older engines; regex lookbehind is the one 16.4 syntax feature that Chrome/Firefox had long before.
// "js" tells the CSS that scripts run at all (see globals.css).
const LEGACY_PROBE = `(function(){var d=document.documentElement,old=!Array.prototype.at||!Object.hasOwn||typeof structuredClone!=="function";if(!old){try{new RegExp("(?<=a)b")}catch(e){old=true}}d.className+=old?" js legacy-browser":" js"})();`;

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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // The probe below may add a class before hydration.
    <html
      lang="tr"
      className={`${sans.variable} ${display.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LEGACY_PROBE }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
        <PwaBoot />
      </body>
    </html>
  );
}
