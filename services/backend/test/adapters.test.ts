import { describe, expect, it } from "vitest";
import { parseKingJouetListing, parseLgrListing } from "../src/lib/product-parser.js";
import { makeUnknownObservation, normalizeWebAvailability } from "../src/lib/evidence.js";

describe("retailer catalog adapters", () => {
  it("parses LGR product data while keeping web status out of store status", () => {
    const html = `<script>window.__change['24'] = {
      productsData: [{
        common: { title: 'Fixture test booster', URL: { canonical: 'https://www.lagranderecre.fr/fixture-test.html' }, visuals: [{ listItem: 'https://images.example.test/fixture.jpg' }] },
        price: { valueWithTax: '59,99' }, stock: { sku: 'fixture-1', webStore: { available: true } }, context: { data: { storeId: 0 } }
      }]
    };</script>`;
    const [product] = parseLgrListing(html, "https://www.lagranderecre.fr/cartes-a-collectionner-pokemon.html", new Date("2026-09-24T10:00:00.000Z"));
    expect(product).toMatchObject({ title: "Fixture test booster", priceCents: 5999, retailerSku: "fixture-1", webAvailability: "available" });
    expect(makeUnknownObservation(product!).status).toBe("unknown");
    expect(normalizeWebAvailability("available")).toBe("available");
  });

  it("does not promote King Jouet web stock or a store lookup prompt to store stock", () => {
    const html = `<article class="product-item">
      <a href="/jeu-jouet/cartes/ref-fixture-2.htm" title="Fixture card product">
        <span>WEB En stock</span><span>MAGASIN Vérifier le stock</span>
        <span class="product-price">20,99 €</span>
        <img src="https://images.example.test/fixture-card.jpg" />
      </a>
    </article>`;
    const [product] = parseKingJouetListing(html, "https://www.king-jouet.com/jeux-jouets/toutes-les-cartes-pokemon-a-collectionner/page1.htm", new Date("2026-09-24T10:00:00.000Z"));
    expect(product?.webAvailability).toBe("available");
    expect(makeUnknownObservation(product!).status).toBe("unknown");
  });
});
