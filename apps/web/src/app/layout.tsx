import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Martian_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-martian", display: "swap" });

/** Every page reads the session or live ledger state; nothing is safe to prerender at build time. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Plimsoll", template: "%s · Plimsoll" },
  description: "Trade agreements that know when to pay. Documents reconciled, parties authorize milestones, stablecoin settlement on Stellar.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1F4" },
    { media: "(prefers-color-scheme: dark)", color: "#06111D" },
  ],
};

/** Applies the stored theme before first paint so there is no flash of the wrong theme. */
const THEME_BOOT = `try{var t=localStorage.getItem("plimsoll-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${martian.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
