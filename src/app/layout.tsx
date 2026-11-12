import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Preflight: Simulate Before You Act",
  description:
    "An agent that runs every write as a real dry run on Postgres, shows exactly what will change, and rolls back if reality outgrows the preview.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
