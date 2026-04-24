// layout.tsx: Root Next.js layout with font loading, metadata, and provider wrappers.

import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./layout.css";
import "./shared-ui.css";
import "./sidebar.css";
import "./navbar.css";
import "./dashboard.css";
import "./hubs.css";
import "./sources.css";
import "./hub-analytics.css";
import "./chat.css";
import "./filters.css";
import "./responsive.css";
import "./members.css";
import "./hub-dashboard.css";
import "./admin-dashboard.css";
import { Providers } from "../components/Providers";
import { AppShell } from "../components/AppShell";
import { ShellErrorBoundary } from "../components/ShellErrorBoundary";

export const metadata: Metadata = {
  title: "Caddie",
  description: "Onboarding knowledge companion",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <ShellErrorBoundary>
            <AppShell>{children}</AppShell>
          </ShellErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
