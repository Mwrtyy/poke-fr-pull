self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Un stock confirmé a été détecté." };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Stock magasin confirmé", {
      body: payload.body || "Une disponibilité Pokémon TCG a été vérifiée.",
      icon: new URL("icons/pokeball.svg", self.registration.scope).toString(),
      badge: new URL("icons/pokeball.svg", self.registration.scope).toString(),
      data: { url: payload.url || self.registration.scope },
      tag: payload.tag || "pokemon-restock",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope).toString();
  event.waitUntil(self.clients.openWindow(target));
});
