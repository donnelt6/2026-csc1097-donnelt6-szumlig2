import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/Providers";
import { AppShell } from "../components/AppShell";

export const metadata: Metadata = {
  title: "Caddie",
  description: "Onboarding knowledge companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
