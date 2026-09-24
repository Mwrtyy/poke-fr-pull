import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cartes Pokémon — Restocks France",
  description: "Suivi des références Pokémon TCG et des disponibilités magasins vérifiées en France.",
  applicationName: "Restocks France",
  appleWebApp: { capable: true, title: "Restocks FR", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#19251e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
