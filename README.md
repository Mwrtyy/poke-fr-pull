# Pokémon Restock France

Site mobile-first de découverte de références Pokémon TCG et de suivi de stock local. Le frontend Next.js s'exporte en HTML/CSS/JavaScript statique pour GitHub Pages. L'API, PostgreSQL, Redis, les workers et Web Push sont des services séparés et facultatifs.

## État des données

Le dépôt contient un snapshot build-time du catalogue public La Grande Récré : références, prix, images et liens produit. Chaque snapshot porte son heure et sa source. Le stock magasin reste `unknown` sans preuve pour une boutique exacte ; le stock web ne compte jamais comme disponibilité magasin. Un refus HTTP 403 ou une erreur de parsing garde le dernier snapshot, sans prétendre l'avoir actualisé.

Les sources initiales sont Fnac, King Jouet, Carrefour et La Grande Récré en priorité Île-de-France. Les adaptateurs n'utilisent que les URL publiques autorisées par `robots.txt`. Le moniteur ne contourne ni refus d'accès ni CAPTCHA. Les endpoints de sélection de magasin privés et les chemins interdits ne sont pas appelés.

## Prérequis

- Node.js `>=20.18.1`.
- `pnpm` version `11.19.0`.
- PostgreSQL, Redis et une adresse HTTPS publique uniquement si vous déployez le backend.

## Développement local

```powershell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

Le frontend est disponible sur `http://localhost:3000`. Laissez `NEXT_PUBLIC_API_BASE_URL` vide pour vérifier le mode sans données live. Pour connecter le backend, renseignez sa base URL puis relancez le build Next.js.

## Vérifications

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` construit le site pour `https://mwrtyy.github.io/poke-fr-pull/`. La source GitHub Pages doit être **GitHub Actions**. À chaque publication et toutes les six heures, il tente de rafraîchir le catalogue avant de produire les fichiers statiques dans `apps/web/out`.

GitHub Pages ne fournit pas de serveur Node.js. Laissez le frontend sans API pour le site statique autonome, ou définissez `NEXT_PUBLIC_API_BASE_URL` comme variable Actions après avoir déployé le backend HTTPS. Cette valeur est publique et ne doit jamais contenir de secret.

## Backend externe

Le service backend fournit l'API et des processus workers séparés. Il peut être déployé sur un hébergeur de conteneurs externe. Configurez `DATABASE_URL`, `REDIS_URL`, `API_CORS_ORIGINS` et, si Web Push est voulu, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT`. Appliquez `db/migrations/001_initial.sql` à PostgreSQL/Supabase avant le démarrage.

Avec Docker Compose local :

```powershell
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm api
```

Dans un second terminal, lancez `pnpm worker`. Le worker découvre les catalogues publics toutes les six heures et garde l'état magasin inconnu sans preuve liée à une boutique exacte. Le worker n'est pas nécessaire au site statique. N'exposez pas Redis publiquement.

## Sources et limites par enseigne

- **Fnac** : les pages publiques et sitemaps peuvent aider à découvrir des références. Le flux d'affiliation éventuel fournit un catalogue, pas un stock magasin garanti. Les recherches paginées et `/api/*` exclus par `robots.txt` ne sont pas interrogés.
- **King Jouet** : le catalogue distingue le stock web de « Vérifier le stock » magasin. Le premier ne devient jamais une disponibilité locale.
- **Carrefour** : le stock dépend parfois du magasin choisi. Aucun endpoint de sélection de magasin n'est appelé. Une page inaccessible reste inconnue.
- **La Grande Récré** : `productsData`, le prix et `stock.webStore.available` servent à découvrir le produit et son stock web. `storeId=0` ne prouve aucun stock magasin.

Les règles robots sont récupérées avant les requêtes et revérifiées régulièrement. Gardez une cadence faible, respectez tout `Crawl-delay`, et vérifiez les conditions d'utilisation de chaque source avant mise en production.

## Architecture

```text
GitHub Pages (Next.js export statique)
        │ HTTPS API facultative
        ▼
API Fastify ─ PostgreSQL/Supabase
        ▲
        │ observations via queue
Workers BullMQ ─ Redis
```

Chaque adaptateur convertit les sources au contrat commun `RetailerProduct` et `StoreObservation`. Le schéma empêche une disponibilité magasin sans référence de boutique ni preuve. Les alertes se déclenchent uniquement sur une transition vérifiée vers `in_stock`, avec déduplication et une fenêtre de fraîcheur.

## Propriété intellectuelle

Projet indépendant non affilié aux enseignes, à The Pokémon Company, Nintendo ou Creatures Inc. Les marques et visuels appartiennent à leurs propriétaires. Les images restent servies par la source marchande.
