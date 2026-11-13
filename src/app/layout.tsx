import type { Metadata } from "next";
import { Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import "./globals.css";

// One loud, characterful grotesque for everything people read, and one wide mono for
// everything the database says. Two voices: the humans and the machine.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "wdth"] });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian" });

export const metadata: Metadata = {
  title: "Preflight: Simulate Before You Act",
  description:
    "Every action your agent wants to take gets a ghost run first, for real, on Postgres. See exactly who it hits, then decide. If reality outgrows the ghost run, it rolls itself back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <div id="root-shell">{children}</div>
      </body>
    </html>
  );
}
