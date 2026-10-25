/*
 * Badehusappen – enkel service worker.
 * «Nett først»: prøver alltid å hente nyeste versjon fra nettet, og
 * bruker lagret kopi bare når man er uten nett. Da blir oppdateringer
 * aldri hengende fast i hurtigbufferen.
 */
const CACHE = "badehusappen-2026-10-25b";   // endres ved oppdatering, så gamle kopier ryddes
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
