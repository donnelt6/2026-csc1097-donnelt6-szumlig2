import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/Providers";
import { ProfileMenu } from "../components/navigation/ProfileMenu";
import { NotificationsMenu } from "../components/navigation/NotificationsMenu";

export const metadata: Metadata = {
  title: "Caddie",
  description: "Onboarding knowledge companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="site-nav">
            <div className="nav-content">
              <a className="brand" href="/">
                <span className="brand-mark" aria-hidden="true" />
                Caddie
              </a>
              <div className="nav-actions">
                <NotificationsMenu />
                <ProfileMenu />
              </div>
            </div>
          </header>
          <div className="app-content">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
