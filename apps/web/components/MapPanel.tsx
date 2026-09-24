"use client";

import dynamic from "next/dynamic";
import type { FeedItem } from "@/lib/types";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="map-loading">Chargement de la carte…</div>,
});

export default function MapPanel({ items, center }: { items: FeedItem[]; center: [number, number] }) {
  const confirmedCount = items.filter((item) => item.status === "in_stock" && item.store).length;
  return (
    <section className="map-panel" aria-label="Carte des stocks confirmés">
      <div className="map-caption">
        <span className="map-caption-dot" />
        {confirmedCount === 0 ? "Aucun stock magasin confirmé autour de vous" : `${confirmedCount} stock${confirmedCount > 1 ? "s" : ""} confirmé${confirmedCount > 1 ? "s" : ""}`}
      </div>
      <MapCanvas items={items} center={center} />
      <p className="map-attribution-note">Carte OpenStreetMap · seuls les magasins confirmés apparaissent.</p>
    </section>
  );
}
