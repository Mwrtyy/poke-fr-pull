"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapPanel from "./MapPanel";
import InstallPrompt from "./InstallPrompt";
import { apiBaseUrl, initialFeedResponse, loadFeed, loadRules, saveRule } from "@/lib/api";
import { distanceKm, euro, timeAgo } from "@/lib/format";
import { type AlertRule, type FeedItem, type FeedResponse, RETAILERS, type StoreStatus } from "@/lib/types";

type View = "feed" | "map" | "alerts";
type Origin = { latitude: number; longitude: number };
type TabProps = { active: boolean; children: React.ReactNode; onClick: () => void; icon: React.ReactNode };

function Tab({ active, children, onClick, icon }: TabProps) {
  return <button className={`view-tab${active ? " active" : ""}`} onClick={onClick}>{icon}{children}</button>;
}

function Icon({ name }: { name: "pin" | "map" | "bell" | "search" | "filter" | "clock" | "store" | "arrow" | "box" | "wifi" | "refresh" | "tag" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<typeof name, React.ReactNode> = {
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    filter: <><path d="M4 6h16M7 12h10m-7 6h4" /><circle cx="8" cy="6" r="1.5" fill="currentColor" /><circle cx="15" cy="12" r="1.5" fill="currentColor" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    store: <><path d="M3 10h18l-2-6H5z" /><path d="M5 10v10h14V10M9 20v-6h6v6" /><path d="M3 10a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5z" /><path d="M3 8v9l9 5 9-5V8M12 13v9" /></>,
    wifi: <><path d="M5 12.5a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0m-5 3h2" /><path d="M2 9a16 16 0 0 1 20 0" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.8 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.2-3" /></>,
    tag: <><path d="M20 13 11 22l-9-9V2h11z" /><circle cx="7" cy="7" r="1" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function PokeballMark() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M3.5 12h17" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="3" fill="#19251e" stroke="currentColor" strokeWidth="2"/></svg>;
}

function getInstallationId() {
  const key = "poke-fr-installation-id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = window.crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sourceStatusLabel(status: StoreStatus) {
  if (status === "in_stock") return "Disponible magasin";
  if (status === "out_of_stock") return "Indisponible magasin";
  return "Magasin à vérifier";
}

function productMatches(item: FeedItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase("fr-FR");
  if (!normalized) return true;
  return `${item.product.title} ${item.product.ean ?? ""} ${item.retailer.name}`.toLocaleLowerCase("fr-FR").includes(normalized);
}

export default function Dashboard() {
  const [view, setView] = useState<View>("feed");
  const [response, setResponse] = useState<FeedResponse>(initialFeedResponse);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locationState, setLocationState] = useState<"unset" | "loading" | "ready" | "denied">("unset");
  const [query, setQuery] = useState("");
  const [retailer, setRetailer] = useState("all");
  const [status, setStatus] = useState<"all" | StoreStatus>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [maxDistance, setMaxDistance] = useState(30);
  const [maxPrice, setMaxPrice] = useState(300);
  const [distanceEnabled, setDistanceEnabled] = useState(false);
  const [priceEnabled, setPriceEnabled] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [alertQuery, setAlertQuery] = useState("");
  const [alertPrice, setAlertPrice] = useState(300);
  const [alertDistance, setAlertDistance] = useState(10);
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>(RETAILERS.map((entry) => entry.id));
  const [alertMessage, setAlertMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [savingAlert, setSavingAlert] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadFeed();
    setResponse(data);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadFeed(controller.signal).then(setResponse);
    const interval = window.setInterval(refresh, 90_000);
    try {
      const saved = window.localStorage.getItem("poke-fr-origin");
      if (saved) setOrigin(JSON.parse(saved) as Origin);
      setInstallationId(getInstallationId());
      const localRules = window.localStorage.getItem("poke-fr-alert-rules");
      if (localRules) setRules(JSON.parse(localRules) as AlertRule[]);
    } catch {
      window.localStorage.removeItem("poke-fr-origin");
    }
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!installationId) return;
    loadRules(installationId).then((remoteRules) => {
      if (remoteRules.length) setRules(remoteRules);
    });
  }, [installationId]);

  const visibleItems = useMemo(() => response.items.filter((item) => {
    if (!productMatches(item, query)) return false;
    if (retailer !== "all" && item.retailer.id !== retailer) return false;
    if (status !== "all" && item.status !== status) return false;
    const distance = distanceKm(origin, item);
    if (distanceEnabled && distance !== null && distance > maxDistance) return false;
    if (priceEnabled && item.priceCents !== null && item.priceCents > maxPrice * 100) return false;
    return true;
  }), [response.items, query, retailer, status, origin, distanceEnabled, maxDistance, priceEnabled, maxPrice]);

  const confirmedCount = response.items.filter((item) => item.status === "in_stock" && item.store).length;
  const center: [number, number] = origin ? [origin.latitude, origin.longitude] : [48.8566, 2.3522];

  function locate() {
    if (!navigator.geolocation) {
      setLocationState("denied");
      return;
    }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setOrigin(next);
      setLocationState("ready");
      window.localStorage.setItem("poke-fr-origin", JSON.stringify(next));
    }, () => setLocationState("denied"), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 });
  }

  async function addAlert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = alertQuery.trim();
    if (!text || selectedRetailers.length === 0) {
      setAlertMessage("Saisissez un produit et choisissez au moins une enseigne.");
      return;
    }
    if (!origin) {
      setAlertMessage("Autorisez votre position pour appliquer le rayon choisi.");
      locate();
      return;
    }
    const rule = {
      query: text,
      maxPriceCents: alertPrice > 0 ? alertPrice * 100 : null,
      maxDistanceKm: alertDistance,
      retailers: selectedRetailers,
      latitude: origin.latitude,
      longitude: origin.longitude,
    };
    setSavingAlert(true);
    const savedRemotely = installationId ? await saveRule(installationId, rule) : false;
    const localEntry: AlertRule = { id: window.crypto.randomUUID(), ...rule };
    const next = [localEntry, ...rules].slice(0, 20);
    setRules(next);
    window.localStorage.setItem("poke-fr-alert-rules", JSON.stringify(next));
    setAlertQuery("");
    setSavingAlert(false);
    setAlertMessage(savedRemotely
      ? "Alerte enregistrée. Une notification partira uniquement après confirmation magasin."
      : "Alerte enregistrée sur cet appareil. Les notifications live exigent un backend et un abonnement push.");
  }

  async function enableNotifications() {
    if (!apiBaseUrl()) {
      setNotificationMessage("Notifications indisponibles : le backend live n’est pas configuré.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setNotificationMessage("Ce navigateur ne prend pas en charge les notifications push.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotificationMessage("Autorisation de notification refusée.");
        return;
      }
      const keyResponse = await fetch(`${apiBaseUrl()}/api/v1/push/config`, { cache: "no-store" });
      if (!keyResponse.ok) throw new Error("Configuration push absente");
      const { publicKey } = (await keyResponse.json()) as { publicKey?: string };
      if (!publicKey) throw new Error("Configuration push absente");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBase64UrlBytes(publicKey) });
      const saved = await fetch(`${apiBaseUrl()}/api/v1/push/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId, subscription: subscription.toJSON() }),
      });
      if (!saved.ok) throw new Error("Inscription push refusée");
      setNotificationMessage("Notifications activées pour les disponibilités magasin confirmées.");
    } catch {
      setNotificationMessage("Impossible d’activer les notifications. Vérifiez la configuration HTTPS et VAPID du backend.");
    }
  }

  function toggleRetailer(id: string) {
    setSelectedRetailers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const retailerName = (id: string) => RETAILERS.find((entry) => entry.id === id)?.name ?? id;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Accueil Restocks France">
          <span className="brand-mark"><PokeballMark /></span>
          <span className="brand-copy"><strong>Restocks France</strong><span>Pokémon TCG · indépendant</span></span>
        </a>
        <div className="top-actions">
          <button className="location-pill" onClick={locate} title="Partager la position de cet appareil">
            <Icon name="pin" />{locationState === "ready" ? "Autour de vous" : "Paris · IDF"}
          </button>
          <InstallPrompt />
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow"><span className="pulse-dot" /> Veille Pokémon TCG · Île-de-France</span>
          <h1>Les restocks proches,<br />sans fausse alerte.</h1>
          <p>Références, prix et disponibilité magasin réunis. Chaque stock local doit avoir une source et une boutique vérifiables.</p>
        </div>
        <div className="hero-count" aria-live="polite">
          <strong>{confirmedCount}</strong><span>stock{confirmedCount === 1 ? "" : "s"} magasin confirmé{confirmedCount === 1 ? "" : "s"}</span>
        </div>
      </section>

      {!response.configured && response.source === "snapshot" ? (
        <div className="source-status good" role="status"><Icon name="box" /><span><strong>Catalogue public · relevé {response.snapshotAt ? timeAgo(response.snapshotAt) : "sans date"}.</strong> Fiches, images et prix viennent de La Grande Récré. Stock magasin reste inconnu ; ce relevé ne donne aucune alerte live.</span></div>
      ) : !response.configured ? (
        <div className="source-status" role="status"><Icon name="wifi" /><span><strong>Mode site statique.</strong> Le backend live n’est pas configuré. Aucun stock n’est simulé ; connectez une API externe pour afficher les vérifications réelles.</span></div>
      ) : response.connected ? (
        <div className="source-status good" role="status"><Icon name="refresh" /><span><strong>API connectée.</strong> Les résultats affichent l’heure, la source et le niveau de preuve disponibles.</span></div>
      ) : (
        <div className="source-status" role="status"><Icon name="wifi" /><span><strong>API live inaccessible.</strong> {response.source === "snapshot" ? `Catalogue public du ${response.snapshotAt ? new Date(response.snapshotAt).toLocaleDateString("fr-FR") : "dernier relevé"} affiché ; stock magasin toujours inconnu.` : "Les données magasin restent inconnues jusqu’au prochain échange réussi."}</span></div>
      )}

      <section className="retailer-status" aria-label="Enseignes suivies">
        {RETAILERS.map((entry) => <div className="retailer-status-card" key={entry.id}><strong>{entry.name}</strong><span>{response.connected ? "Source externe" : "À connecter"}</span></div>)}
      </section>

      <div className="toolbar">
        <nav className="view-tabs" aria-label="Vues">
          <Tab active={view === "feed"} onClick={() => setView("feed")} icon={<Icon name="search" />}>Flux</Tab>
          <Tab active={view === "map"} onClick={() => setView("map")} icon={<Icon name="map" />}>Carte</Tab>
          <Tab active={view === "alerts"} onClick={() => setView("alerts")} icon={<Icon name="bell" />}>Alertes</Tab>
        </nav>
        {view === "feed" && <button className="filter-button" onClick={() => setShowFilters((visible) => !visible)} aria-expanded={showFilters}><Icon name="filter" />Filtres</button>}
      </div>

      {view === "feed" && <>
        <div className="filters">
          <label className="filter-select"><Icon name="search" /><span className="sr-only">Rechercher un produit</span><input className="filter-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produit, extension, EAN…" /></label>
          <button className={`filter-chip${status === "all" ? " active" : ""}`} onClick={() => setStatus("all")}>Tout</button>
          <button className={`filter-chip stock${status === "in_stock" ? " active" : ""}`} onClick={() => setStatus(status === "in_stock" ? "all" : "in_stock")}>Confirmé</button>
          <button className={`filter-chip${status === "unknown" ? " active" : ""}`} onClick={() => setStatus(status === "unknown" ? "all" : "unknown")}>À vérifier</button>
          <label className="filter-select"><span>Enseigne</span><select value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="all">Toutes</option>{RETAILERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        </div>
        {showFilters && <div className="filters advanced-filters">
          <label className="filter-chip"><input type="checkbox" checked={distanceEnabled} onChange={(event) => setDistanceEnabled(event.target.checked)} /> Distance ≤ <select value={maxDistance} onChange={(event) => setMaxDistance(Number(event.target.value))}><option value="5">5 km</option><option value="10">10 km</option><option value="20">20 km</option><option value="30">30 km</option><option value="50">50 km</option></select></label>
          <label className="filter-chip"><input type="checkbox" checked={priceEnabled} onChange={(event) => setPriceEnabled(event.target.checked)} /> Prix ≤ <select value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))}><option value="50">50 €</option><option value="100">100 €</option><option value="200">200 €</option><option value="300">300 €</option><option value="500">500 €</option></select></label>
          {distanceEnabled && !origin && <button className="filter-chip" onClick={locate}>Activer ma position</button>}
        </div>}
        <div className="feed-heading"><h2>{response.source === "snapshot" ? "Catalogue public" : "Dernières vérifications"}</h2><span>{visibleItems.length} résultat{visibleItems.length === 1 ? "" : "s"}</span></div>
        {visibleItems.length ? <div className="feed-list">{visibleItems.map((item) => <FeedCard key={item.id} item={item} origin={origin} />)}</div> : <EmptyFeed configured={response.configured} connected={response.connected} hasFilters={Boolean(query || retailer !== "all" || status !== "all")} onRefresh={refresh} />}
      </>}

      {view === "map" && <>
        <div className="feed-heading"><h2>Stocks proches</h2><span>{origin ? "Position de cet appareil" : "Centre par défaut : Paris"}</span></div>
        {!origin && <div className="source-status" style={{ marginBottom: 12 }}><Icon name="pin" /><span>Partagez votre position pour calculer les distances. La position reste sur cet appareil.</span><button className="text-action" onClick={locate}>Me localiser</button></div>}
        <MapPanel items={response.items} center={center} />
      </>}

      {view === "alerts" && <section className="alert-layout">
        <div className="panel">
          <h2>Créer une alerte</h2>
          <p>Choisissez un produit, une distance et un prix. Les alertes push partent seulement après une transition vérifiée vers le stock magasin.</p>
          <form onSubmit={addAlert}>
            <div className="form-grid">
              <div className="field full"><label htmlFor="alert-query">Produit, extension ou EAN</label><input id="alert-query" value={alertQuery} onChange={(event) => setAlertQuery(event.target.value)} placeholder="Ex. Coffret Pokémon, 019621…" required /></div>
              <div className="field"><label htmlFor="alert-distance">Distance maximale</label><select id="alert-distance" value={alertDistance} onChange={(event) => setAlertDistance(Number(event.target.value))}><option value="5">5 km</option><option value="10">10 km</option><option value="20">20 km</option><option value="30">30 km</option><option value="50">50 km</option></select></div>
              <div className="field"><label htmlFor="alert-price">Prix maximum (€)</label><input id="alert-price" type="number" min="1" max="5000" value={alertPrice} onChange={(event) => setAlertPrice(Number(event.target.value))} /></div>
              <div className="field full"><label>Enseignes</label><div className="retailer-options">{RETAILERS.map((entry) => <label className="retailer-option" key={entry.id}><input type="checkbox" checked={selectedRetailers.includes(entry.id)} onChange={() => toggleRetailer(entry.id)} />{entry.name}</label>)}</div></div>
              <div className="field full"><button className="solid-button" disabled={savingAlert}>{savingAlert ? "Enregistrement…" : "Enregistrer l’alerte"}</button></div>
            </div>
          </form>
          {alertMessage && <p className="form-message" role="status">{alertMessage}</p>}
        </div>
        <aside className="panel">
          <h2>Notifications push</h2>
          <p>Activez-les sur un appareil HTTPS. iPhone et iPad demandent d’abord l’ajout du site à l’écran d’accueil.</p>
          <div className="empty-actions" style={{ justifyContent: "flex-start" }}><button className="outline-button" onClick={enableNotifications}><Icon name="bell" />Activer les notifications</button></div>
          {notificationMessage && <p className="form-message" role="status">{notificationMessage}</p>}
          <p className="install-note">Sans backend externe avec VAPID, les règles restent enregistrées dans ce navigateur et aucun push n’est envoyé.</p>
          <div className="saved-alerts">
            {rules.length ? rules.map((rule) => <div className="saved-alert" key={rule.id}><div><strong>{rule.query}</strong><br /><span>{rule.maxDistanceKm} km · {rule.maxPriceCents ? euro(rule.maxPriceCents) : "prix libre"} · {rule.retailers.map(retailerName).join(", ")}</span></div><span>Active</span></div>) : <p>Aucune alerte enregistrée.</p>}
          </div>
        </aside>
      </section>}

      <footer className="footer"><span>Projet indépendant, sans affiliation avec Pokémon ou les enseignes.</span><span>Source magasin exigée · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></span></footer>
    </main>
  );
}

function toBase64UrlBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) output[index] = raw.charCodeAt(index);
  return output;
}

function FeedCard({ item, origin }: { item: FeedItem; origin: Origin | null }) {
  const distance = distanceKm(origin, item);
  const storeLabel = item.store?.name ?? "Magasin inconnu";
  const directions = item.store?.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.store.address)}` : null;
  const statusClass = item.status === "in_stock" ? "stock-state in-stock" : "stock-state";
  return (
    <article className="feed-card">
      <div className="product-image">{item.product.imageUrl ? <img src={item.product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="product-placeholder"><Icon name="box" /></div>}</div>
      <div className="product-content">
        <div className="product-meta"><span className="retailer-tag">{item.retailer.name}</span>{item.product.ean && <span className="retailer-tag">EAN {item.product.ean}</span>}</div>
        <h3 className="product-title">{item.product.title}</h3>
        <div className="product-extra">
          <span><Icon name="store" />{storeLabel}</span>
          <span><Icon name="pin" />{distance === null ? "Distance inconnue" : `${distance.toFixed(1)} km`}</span>
          <span><Icon name="clock" />{item.snapshot ? "Catalogue relevé" : item.status === "in_stock" ? "Stock confirmé" : "Vérifié"} {timeAgo(item.checkedAt)}</span>
          <span>Web : {item.webAvailability === "available" ? "disponible" : item.webAvailability === "unavailable" ? "indisponible" : "inconnu"}</span>
        </div>
      </div>
      <div className="card-side">
        <span className="price">{euro(item.priceCents)}</span>
        <span className={statusClass}>{sourceStatusLabel(item.status)}</span>
        <span className="confidence" title="Le score dépend de la preuve, de la source et de sa fraîcheur.">Confiance {item.confidence === null ? "—" : `${Math.round(item.confidence * 100)} %`}</span>
        <div className="card-actions">
          <a className="small-action primary" href={item.product.productUrl} target="_blank" rel="noreferrer"><Icon name="arrow" />Acheter / réserver</a>
          <a className={`small-action${directions ? "" : " disabled"}`} href={directions ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!directions}><Icon name="pin" />Itinéraire</a>
        </div>
      </div>
    </article>
  );
}

function EmptyFeed({ configured, connected, hasFilters, onRefresh }: { configured: boolean; connected: boolean; hasFilters: boolean; onRefresh: () => void }) {
  const title = hasFilters ? "Aucun résultat avec ces filtres" : !configured ? "Flux live non connecté" : connected ? "Aucun stock magasin confirmé" : "Service live indisponible";
  const copy = hasFilters
    ? "Modifiez le produit, l’enseigne ou les seuils. Les données inconnues ne deviennent pas des ruptures."
    : !configured
      ? "Le site statique fonctionne déjà. Branchez l’API externe pour recevoir les produits détectés ; aucun exemple fictif n’est affiché."
      : connected
        ? "Les fiches web ne suffisent pas. Un produit apparaît ici dès qu’une vérification réelle apporte sa source et son magasin."
        : "L’API ne répond pas. Les données magasin restent inconnues jusqu’au prochain échange réussi.";
  return <div className="empty-state">
    <div className="empty-art"><Icon name="search" /></div>
    <h3>{title}</h3>
    <p>{copy}</p>
    <div className="empty-actions">
      {!configured ? <a className="solid-button" href="https://github.com/Mwrtyy/poke-fr-pull" target="_blank" rel="noreferrer"><Icon name="arrow" />Voir le projet</a> : <button className="solid-button" onClick={onRefresh}><Icon name="refresh" />Actualiser</button>}
      <span className="outline-button" aria-label="Le stock magasin inconnu n'est jamais présenté comme disponible"><Icon name="tag" />Preuve magasin requise</span>
    </div>
  </div>;
}
