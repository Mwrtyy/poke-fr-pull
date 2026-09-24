import type { RetailerAdapter, RetailerId, RetailerProduct, ParsedCatalogPage } from "../lib/contracts.js";
import { parseKingJouetListing, parseLgrListing, parseProductLinks, parseRetailerProduct } from "../lib/product-parser.js";

const LA_GRANDE_RECRE_CATEGORY = "https://www.lagranderecre.fr/cartes-a-collectionner-pokemon.html";
const KING_JOUET_CATEGORY = "https://www.king-jouet.com/jeux-jouets/toutes-les-cartes-pokemon-a-collectionner/page1.htm";
const CARREFOUR_PRODUCT = "https://www.carrefour.fr/p/pokemon-coffret-ex-juin-start-2-2026-pokemon-0196214139770";

function envUrls(name: string, fallback: string[] = []) {
  const configured = process.env[name]?.split(",").map((url) => url.trim()).filter(Boolean);
  return configured?.length ? configured : fallback;
}

function createAdapter(config: {
  id: RetailerId;
  name: string;
  hosts: string[];
  startUrls: string[];
  listingParser?: (html: string, url: string) => RetailerProduct[];
}): RetailerAdapter {
  return {
    id: config.id,
    name: config.name,
    hosts: config.hosts,
    startUrls: config.startUrls,
    parseListing(html, url): ParsedCatalogPage {
      if (config.listingParser) {
        const products = config.listingParser(html, url);
        const productLinks = products.map((product) => product.productUrl);
        return { products, productLinks, parser: config.id === "la-grande-recre" ? "lgr_embedded_json" : "html" };
      }
      const productLinks = parseProductLinks(html, url, config.hosts);
      return { products: [], productLinks, parser: "html" };
    },
    parseProduct(html, url) {
      return parseRetailerProduct({ retailerId: config.id, html, url });
    },
  };
}

export const adapters: RetailerAdapter[] = [
  createAdapter({
    id: "fnac",
    name: "Fnac",
    hosts: ["www.fnac.com", "fnac.com"],
    startUrls: envUrls("FNAC_START_URLS"),
  }),
  createAdapter({
    id: "king-jouet",
    name: "King Jouet",
    hosts: ["www.king-jouet.com", "king-jouet.com"],
    startUrls: envUrls("KING_JOUET_START_URLS", [KING_JOUET_CATEGORY]),
    listingParser: parseKingJouetListing,
  }),
  createAdapter({
    id: "carrefour",
    name: "Carrefour",
    hosts: ["www.carrefour.fr", "carrefour.fr"],
    startUrls: envUrls("CARREFOUR_START_URLS", [CARREFOUR_PRODUCT]),
  }),
  createAdapter({
    id: "la-grande-recre",
    name: "La Grande Récré",
    hosts: ["www.lagranderecre.fr", "lagranderecre.fr"],
    startUrls: envUrls("LA_GRANDE_RECRE_START_URLS", [LA_GRANDE_RECRE_CATEGORY]),
    listingParser: parseLgrListing,
  }),
];

export function adapterFor(id: string) {
  return adapters.find((adapter) => adapter.id === id);
}
