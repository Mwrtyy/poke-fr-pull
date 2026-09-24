"use client";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { FeedItem } from "@/lib/types";

const stockIcon = L.divIcon({
  className: "stock-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function MapCanvas({ items, center }: { items: FeedItem[]; center: [number, number] }) {
  const locations = items.filter((item) => item.status === "in_stock" && item.store?.latitude != null && item.store.longitude != null);
  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="map-canvas">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {locations.map((item) => (
        <Marker key={item.id} position={[item.store!.latitude!, item.store!.longitude!]} icon={stockIcon}>
          <Popup>
            <strong>{item.product.title}</strong>
            <br />
            {item.store!.name} · {item.retailer.name}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
