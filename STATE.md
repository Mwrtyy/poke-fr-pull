# État du projet

## Objectif

Site mobile-first Pokémon TCG pour Paris/Île-de-France. Frontend Next.js statique sur GitHub Pages. Service Cloudflare Worker + D1 préparé séparément; aucun faux stock magasin.

## Fichiers importants

- `apps/web/` : site Next.js export statique et fallback catalogue.
- `services/cloudflare/src/index.ts` : API feed, garde de preuves, cron et rafraîchissement catalogue LGR.
- `services/cloudflare/src/lgr.ts` : parser léger limité, filtré Pokémon TCG.
- `services/cloudflare/migrations/0001_initial.sql`, `0002_catalog_presence.sql` : schéma D1 et activation atomique du catalogue courant.
- `services/cloudflare/wrangler.jsonc` : Worker `poke-fr-api`, binding `DB`, cron `* * * * *`, limite CPU `10 ms`.
- `services/cloudflare/dist/worker.js` : bundle autonome généré pour l'éditeur Dashboard; ignoré par Git.
- `README.md` : architecture, limites et étapes de déploiement.

## Découvertes

- La Grande Récré publie `productsData` et le stock web dans `window.__change['24']`; `context.data.storeId=0` ne prouve aucun stock magasin.
- Fnac et Carrefour ont retourné 403 pendant la vérification. Le Worker Cloudflare ne surveille que le catalogue LGR et respecte `robots.txt`.
- La migration D1 locale a été appliquée. Elle contient quatre enseignes; seule LGR reçoit des produits du Worker.
- Les produits disparus de la catégorie LGR deviennent inactifs après un refresh réussi atomique; les erreurs gardent le précédent snapshot D1.

## Décisions

- Stock magasin reste `unknown` sans preuve officielle récente liée à une boutique exacte du même détaillant.
- Stock web reste un champ distinct. Le Worker n'importe aucune disponibilité magasin LGR.
- Feed live exige un refresh réussi datant de moins de six heures.
- `/api/v1/alerts` et `/api/v1/push/*` répondent 503 jusqu'à présence d'une protection anti-abus, de VAPID et d'une source de transitions magasin fiables. Les règles restent dans le navigateur.
- Les réponses robots interdites, 403, erreurs de parsing et corps trop grands ne remplacent pas les données courantes.

## Validations

- `pnpm typecheck` : réussi pour web, backend et Worker.
- `pnpm test` : réussi, 7 tests backend et 12 tests Worker.
- `pnpm --filter @poke-fr/cloudflare db:migrate:local` : migrations `0001` et `0002` appliquées.
- Wrangler 4.128.0 D1 locale : 4 retailers et colonne `products.catalog_active` confirmés.
- `pnpm --filter @poke-fr/cloudflare bundle:dashboard` : Wrangler dry-run réussi; bundle `25.55 KiB`, binding `DB` reconnu.

## À faire

- Après revue, appliquer D1 distante puis déployer Worker via Wrangler ou Dashboard.
- Configurer le cron `* * * * *`, `ALLOWED_ORIGINS=https://mwrtyy.github.io,http://localhost:3000` et vérifier le binding `DB`.
- Après déploiement vérifié, définir la variable GitHub Actions `NEXT_PUBLIC_API_BASE_URL` et reconstruire Pages.
- Ajouter des moniteurs magasin uniquement quand sources officielles propres à chaque boutique sont disponibles.
