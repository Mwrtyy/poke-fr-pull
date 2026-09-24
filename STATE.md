# État du projet

## Objectif

Site mobile-first Pokémon TCG pour Paris/Île-de-France. Frontend Next.js statique sur GitHub Pages. Service Cloudflare Worker + D1 préparé séparément; aucun faux stock magasin.

## Fichiers importants

- `apps/web/` : site Next.js export statique et fallback catalogue.
- `services/cloudflare/src/index.ts` : API feed, garde de preuves, cron et rafraîchissement catalogue LGR.
- `services/cloudflare/src/lgr.ts` : parser léger limité, filtré Pokémon TCG.
- `services/cloudflare/migrations/0001_initial.sql`, `0002_catalog_presence.sql` : schéma D1 et activation atomique du catalogue courant.
- `services/cloudflare/wrangler.jsonc` : Worker `poke-fr-api`, binding `DB`, cron `* * * * *`, `observability.enabled=true`, `preview_urls=false`; aucune limite CPU Free non prise en charge.
- `services/cloudflare/dist/worker.js` : bundle autonome généré pour l'éditeur Dashboard; ignoré par Git.
- `README.md` : architecture, limites et étapes de déploiement.

## Découvertes

- La Grande Récré publie `productsData` et le stock web dans `window.__change['24']`; `context.data.storeId=0` ne prouve aucun stock magasin.
- Le GET PowerShell `Invoke-WebRequest` local renvoie HTTP 200 mais 0 octet, même en HTTP/1.1; `curl.exe` HTTP/1.1 avec le même User-Agent Worker reçoit 849 023 octets. Context Mode `fetch` reçoit 848 428 octets et trouve 8 produits, dont 6 TCG retenus par le filtre. Le corps vide est donc propre au chemin client PowerShell observé, pas à la page LGR.
- `robots.txt` LGR (HTTP 200) autorise la catégorie sans paramètres; il interdit plusieurs API internes et recherches, et publie un sitemap officiel. Le Worker reste sur la page catégorie publique autorisée.
- Fnac et Carrefour ont retourné 403 pendant la vérification. Le Worker Cloudflare ne surveille que le catalogue LGR et respecte `robots.txt`.
- La migration D1 locale a été appliquée. Elle contient quatre enseignes; seule LGR reçoit des produits du Worker.
- Les produits disparus de la catégorie LGR deviennent inactifs après un refresh réussi atomique; les erreurs gardent le précédent snapshot D1.

## Décisions

- Stock magasin reste `unknown` sans preuve officielle récente liée à une boutique exacte du même détaillant.
- Stock web reste un champ distinct. Le Worker n'importe aucune disponibilité magasin LGR.
- Feed live exige un refresh réussi datant de moins de six heures.
- `/api/v1/alerts` et `/api/v1/push/*` répondent 503 jusqu'à présence d'une protection anti-abus, de VAPID et d'une source de transitions magasin fiables. Les règles restent dans le navigateur.
- Les réponses robots interdites, 403, erreurs de parsing et corps trop grands ne remplacent pas les données courantes.
- Un corps vide/non-catalogue donne zéro résultat; le Worker l'enregistre en échec avant tout batch D1, conserve le snapshot précédent et réessaie avec délai exponentiel.

## Validations

- `pnpm typecheck` : réussi pour web, backend et Worker.
- `pnpm test` : réussi; 7 tests backend et 13 tests Worker, dont le test corps vide/non-catalogue.
- `pnpm --filter @poke-fr/cloudflare db:migrate:local` : migrations `0001` et `0002` appliquées.
- Wrangler 4.128.0 D1 locale : 4 retailers et colonne `products.catalog_active` confirmés.
- `pnpm --filter @poke-fr/cloudflare bundle:dashboard` : Wrangler dry-run réussi; bundle `25.55 KiB`, binding `DB` reconnu.

## À faire

- Worker `poke-fr-api` version `888589a9` déployé selon le Dashboard; cron `* * * * *` et binding D1 `DB` visibles. `source_state` distant n'avait pas encore de ligne au dernier contrôle; attendre jusqu'à 15 minutes puis vérifier le premier résultat/erreur.
- Les réglages observability/preview du fichier Wrangler ont été poussés après ce déploiement; ils prendront effet au prochain déploiement Worker. Ne pas redéployer sans demande.
- Ajouter des moniteurs magasin uniquement quand sources officielles propres à chaque boutique sont disponibles.
