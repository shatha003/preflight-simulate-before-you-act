import type { Metadata } from "next";
import { Alfa_Slab_One, Caveat, Courier_Prime, Newsreader } from "next/font/google";
import "./globals.css";

// Text and headings: a newspaper serif. Ledger and SQL: a typewriter face, because a ledger is typed.
// Verdicts: a slab, because rubber stamps are slab. Margin notes: handwriting, in the red pen.
const news = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-news" });
const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-courier" });
const slab = Alfa_Slab_One({ subsets: ["latin"], weight: "400", variable: "--font-slab" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-caveat" });

export const metadata: Metadata = {
  title: "Preflight: Simulate Before You Act",
  description:
    "Pull a proof before the press runs. Every action an agent proposes is run for real on Postgres, marked up in red pen, and only then signed off. If reality outgrows the proof, the run rolls itself back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${news.variable} ${courier.variable} ${slab.variable} ${hand.variable}`}>
      <body className="min-h-screen">
        {/* Ink that does not quite cover: used by the rubber stamp */}
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" result="d" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 0 0 0 3.5" result="m" />
            <feComposite in="d" in2="m" operator="in" />
          </filter>
        </svg>
        <div id="root-shell">{children}</div>
      </body>
    </html>
  );
}
