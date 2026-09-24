import type { FeedItem } from "./types";

export function euro(cents: number | null) {
  if (cents === null) return "Prix non indiqué";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function timeAgo(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function distanceKm(
  origin: { latitude: number; longitude: number } | null,
  item: FeedItem,
) {
  if (!origin || item.store?.latitude == null || item.store.longitude == null) return null;
  const toRadians = (degree: number) => (degree * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRadians(item.store.latitude - origin.latitude);
  const dLng = toRadians(item.store.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(item.store.latitude)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
