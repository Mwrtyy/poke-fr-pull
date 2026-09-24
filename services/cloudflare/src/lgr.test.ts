import { describe, expect, it } from "vitest";
import { parseLgrCatalog } from "./lgr.js";

function product(title: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    common: {
      title,
      URL: { canonical: `https://www.lagranderecre.fr/cartes-a-collectionner/${slug}.html` },
      visuals: [{ listItem: { src: "https://cdn.lagranderecre-fr-storage.omn.proximis.com/pokemon.jpg" } }],
    },
    price: { valueWithTax: "19.99" },
    stock: { sku: slug, ean: "0196214139770", webStore: { available: true } },
    ...extra,
  };
}

function html(productsData: unknown[]) {
  return `<script>window.__change['24'] = ${JSON.stringify({ productsData })};</script>`;
}

describe("La Grande Récré catalog parser", () => {
  it("keeps Pokémon TCG products and separates web availability from store status", () => {
    const result = parseLgrCatalog(html([
      product("POKEMON MEGA EVOLUTION 05 : PACK PORTFOLIO+BOOSTER NUIT NOIRE", "pack-portfolio"),
      product("Kit d'Initiation Pokémon - Février", "kit-initiation"),
      product("Académie de Combat Pokémon - Nouvelle édition", "academie"),
      product("Pokébox Méga Clair de Lune Méga-Ectoplasma-ex", "pokebox-ectoplasma"),
      product("Pack 2 boosters + Piece Ronflex + Carte Zarude Pokemon", "pack-ronflex"),
      product("Pokébox Méga Clair de Lune Mélodelfe", "pokebox-melodelfe"),
      product("Peluche Pokémon Pikachu", "peluche-pikachu"),
      product("Figurine Pokémon Pikachu", "figurine-pikachu"),
    ]));

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({
      title: "POKEMON MEGA EVOLUTION 05 : PACK PORTFOLIO+BOOSTER NUIT NOIRE",
      ean: "0196214139770",
      priceCents: 1999,
      webAvailability: "available",
    });
    expect(result[0]).not.toHaveProperty("status");

    const unavailable = parseLgrCatalog(html([product("Kit d'Initiation Pokémon", "kit-initiation-unavailable", {
        price: { valueWithTax: "24,99" },
        stock: { sku: "kit-1", webStore: { available: false } },
      })]));
    expect(unavailable[0]).toMatchObject({ priceCents: 2499, webAvailability: "unavailable" });
  });

  it("rejects oversized embedded payload without parsing it", () => {
    const oversized = `<script>window.__change['24'] = {"productsData":[{"title":"${"x".repeat(300_001)}"}]};</script>`;
    expect(parseLgrCatalog(oversized)).toEqual([]);
  });

  it("rejects product links outside official La Grande Récré host", () => {
    const input = html([product("Pokémon Booster", "booster", {
      common: {
        title: "Pokémon Booster",
        URL: { canonical: "https://attacker.example/item" },
        visuals: [],
      },
    })]);
    expect(parseLgrCatalog(input)).toEqual([]);
  });
});
