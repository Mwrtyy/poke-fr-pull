export type StoreStatus = "in_stock" | "out_of_stock" | "unknown";
export type WebAvailability = "available" | "unavailable" | "unknown";

export type FeedItem = {
  id: string;
  retailer: { id: string; name: string };
  product: {
    title: string;
    ean: string | null;
    imageUrl: string | null;
    productUrl: string;
  };
  priceCents: number | null;
  webAvailability: WebAvailability;
  status: StoreStatus;
  store: {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  checkedAt: string;
  confidence: number | null;
  evidence: { method: string; url: string; summary: string } | null;
  snapshot?: boolean;
};

export type FeedResponse = {
  configured: boolean;
  connected: boolean;
  source: "live" | "snapshot" | "empty";
  items: FeedItem[];
  checkedAt: string | null;
  snapshotAt: string | null;
};

export type AlertRule = {
  id: string;
  query: string;
  maxPriceCents: number | null;
  maxDistanceKm: number;
  retailers: string[];
  latitude?: number | null;
  longitude?: number | null;
};

export const RETAILERS = [
  { id: "fnac", name: "Fnac" },
  { id: "king-jouet", name: "King Jouet" },
  { id: "carrefour", name: "Carrefour" },
  { id: "la-grande-recre", name: "La Grande Récré" },
] as const;
