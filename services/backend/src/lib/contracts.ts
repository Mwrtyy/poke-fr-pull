export type RetailerId = "fnac" | "king-jouet" | "carrefour" | "la-grande-recre";
export type StoreStatus = "in_stock" | "out_of_stock" | "unknown";
export type WebAvailability = "available" | "unavailable" | "unknown";
export type EvidenceMethod = "official_store_api" | "official_store_page" | "official_pickup_result" | "product_json_ld" | "product_html" | "catalog_feed";

export type RetailerProduct = {
  retailerId: RetailerId;
  retailerSku: string | null;
  ean: string | null;
  title: string;
  imageUrl: string | null;
  productUrl: string;
  priceCents: number | null;
  webAvailability: WebAvailability;
  discoveredAt: string;
  sourceUrl: string;
};

export type StoreObservation = {
  product: RetailerProduct;
  status: StoreStatus;
  store: {
    retailerStoreRef: string;
    name: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    region: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  checkedAt: string;
  confidence: number | null;
  evidence: {
    method: EvidenceMethod;
    url: string;
    excerpt: string;
  } | null;
};

export type ParsedCatalogPage = {
  products: RetailerProduct[];
  productLinks: string[];
  parser: "lgr_embedded_json" | "json_ld" | "html";
};

export type RetailerAdapter = {
  id: RetailerId;
  name: string;
  hosts: string[];
  startUrls: string[];
  parseListing(html: string, url: string): ParsedCatalogPage;
  parseProduct(html: string, url: string): RetailerProduct | null;
};
