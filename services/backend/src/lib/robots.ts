export type RobotsRule = { allow: boolean; path: string };
export type RobotsPolicy = {
  allowed: boolean;
  crawlDelayMs: number;
  sitemaps: string[];
  reason: string;
};

type RobotsGroup = { agents: string[]; rules: RobotsRule[]; crawlDelayMs: number };
const USER_AGENT = "PokemonRestockFRBot";

export function parseRobots(text: string, pathnameAndSearch: string, userAgent = USER_AGENT): RobotsPolicy {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let group: RobotsGroup | null = null;
  let hasRule = false;

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "sitemap") {
      try {
        const url = new URL(value);
        if (url.protocol === "https:") sitemaps.push(url.toString());
      } catch {
        // Ignore malformed sitemap declarations.
      }
      continue;
    }
    if (name === "user-agent") {
      if (!group || hasRule) {
        group = { agents: [], rules: [], crawlDelayMs: 0 };
        groups.push(group);
        hasRule = false;
      }
      group.agents.push(value.toLowerCase());
      continue;
    }
    if (!group) continue;
    if (name === "allow" || name === "disallow") {
      if (value) group.rules.push({ allow: name === "allow", path: value });
      hasRule = true;
    } else if (name === "crawl-delay") {
      const delaySeconds = Number(value);
      if (Number.isFinite(delaySeconds) && delaySeconds >= 0) group.crawlDelayMs = Math.max(group.crawlDelayMs, delaySeconds * 1000);
      hasRule = true;
    }
  }

  const agent = userAgent.toLowerCase();
  const matchingGroups = groups.filter((entry) => entry.agents.some((name) => name === "*" || agent.includes(name)));
  const selectedSpecificity = Math.max(0, ...matchingGroups.flatMap((entry) => entry.agents.filter((name) => name !== "*").map((name) => name.length)));
  const selected = matchingGroups.filter((entry) => entry.agents.some((name) => name !== "*" && name.length === selectedSpecificity));
  const effectiveGroups = selected.length ? selected : matchingGroups.filter((entry) => entry.agents.includes("*"));
  const rules = effectiveGroups.flatMap((entry) => entry.rules);
  const matched = rules
    .filter((rule) => robotsMatch(rule.path, pathnameAndSearch))
    .sort((a, b) => ruleSpecificity(b.path) - ruleSpecificity(a.path));
  const decisive = matched[0];
  const tie = matched.filter((rule) => ruleSpecificity(rule.path) === ruleSpecificity(decisive?.path ?? ""));
  const allowed = !decisive || tie.some((rule) => rule.allow);
  const crawlDelayMs = effectiveGroups.reduce((value, entry) => Math.max(value, entry.crawlDelayMs), 0);
  return {
    allowed,
    crawlDelayMs,
    sitemaps: [...new Set(sitemaps)],
    reason: decisive ? `${decisive.allow ? "allowed" : "disallowed"}:${decisive.path}` : "no_matching_rule",
  };
}

function ruleSpecificity(path: string) {
  return path.replace(/[\*$]/g, "").length;
}

function robotsMatch(pattern: string, path: string) {
  const terminal = pattern.endsWith("$");
  const source = terminal ? pattern.slice(0, -1) : pattern;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const expression = new RegExp(`^${escaped}${terminal ? "$" : ".*"}`);
  return expression.test(path);
}

export function robotsPath(url: URL) {
  return `${url.pathname}${url.search}`;
}

export async function loadRobotsPolicy(url: URL, fetcher: typeof fetch = fetch): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const response = await fetcher(robotsUrl, { signal: AbortSignal.timeout(8_000), redirect: "error", headers: { "user-agent": USER_AGENT } });
    if (!response.ok) return { allowed: false, crawlDelayMs: 0, sitemaps: [], reason: `robots_http_${response.status}` };
    const text = await response.text();
    return parseRobots(text, robotsPath(url));
  } catch {
    return { allowed: false, crawlDelayMs: 0, sitemaps: [], reason: "robots_unavailable" };
  }
}
