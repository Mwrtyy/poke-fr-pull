import { describe, expect, it } from "vitest";
import { parseRobots } from "../src/lib/robots.js";

describe("robots policy", () => {
  const rules = `User-agent: *\nDisallow: /get-store\nAllow: /get-store/public\nDisallow: /SearchResult/ResultList.aspx*SFilt=*\nDisallow: /api/\nCrawl-delay: 4\nSitemap: https://www.fnac.com/sitemap.xml`;

  it("blocks retailer store endpoints and search filter patterns", () => {
    expect(parseRobots(rules, "/get-store?sku=1").allowed).toBe(false);
    expect(parseRobots(rules, "/SearchResult/ResultList.aspx?SFilt=Pok%C3%A9mon").allowed).toBe(false);
    expect(parseRobots(rules, "/api/store-stock").allowed).toBe(false);
  });

  it("honors a more specific allow and exposes crawl delay and sitemaps", () => {
    const policy = parseRobots(rules, "/get-store/public/branch/1");
    expect(policy.allowed).toBe(true);
    expect(policy.crawlDelayMs).toBe(4000);
    expect(policy.sitemaps).toEqual(["https://www.fnac.com/sitemap.xml"]);
  });

  it("uses an allow rule when allow and disallow have equal specificity", () => {
    expect(parseRobots("User-agent: *\nDisallow: /item\nAllow: /item", "/item").allowed).toBe(true);
  });
});
