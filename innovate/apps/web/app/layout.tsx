import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Innovate", template: "%s · Innovate" },
  description: "Collect, cut and present visual references.",
};

export const viewport: Viewport = { themeColor: "#0a0a0b", colorScheme: "dark light" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("innovate-theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
