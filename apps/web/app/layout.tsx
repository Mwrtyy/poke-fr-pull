import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

export const metadata: Metadata = {
  title: "Cartes Pokémon — Restocks France",
  description: "Suivi des références Pokémon TCG et des disponibilités magasins vérifiées en France.",
  applicationName: "Restocks France",
  appleWebApp: { capable: true, title: "Restocks FR", statusBarStyle: "default" },
  icons: {
    apple: [{ url: `${basePath}/icons/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
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
