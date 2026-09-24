import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${basePath}/`,
    name: "Cartes Pokémon — Restocks France",
    short_name: "Restocks FR",
    description: "Références et disponibilités Pokémon TCG vérifiées en France.",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#f4f6f1",
    theme_color: "#19251e",
    icons: [
      { src: `${basePath}/icons/pokeball-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${basePath}/icons/pokeball-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${basePath}/icons/pokeball.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
