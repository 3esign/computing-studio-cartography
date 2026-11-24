/* Urbani žurnal · Network-First Service Worker za offline otvaranje ljuske aplikacije na terenu */
'use strict';

const KES_NAZIV = 'uz-ljuska-v4';
const STATICKI_FAJLOVI = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './maplibre-gl.css',
  './maplibre-gl.js',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(KES_NAZIV).then(async cache => {
      await Promise.allSettled(
        STATICKI_FAJLOVI.map(async u => {
          const odg = await fetch(new Request(u, { cache: 'reload' }));
          if (odg && odg.ok) await cache.put(u, odg);
        })
      );
    }).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(kljucevi => Promise.all(kljucevi.filter(k => k !== KES_NAZIV).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Nikada ne keširaj živi API, medije, lokalnu upravu niti endpoint.json (uvek idu pravo na mrežu!)
  if (
    url.pathname.includes('/api/') ||
    url.pathname.includes('/mediji/') ||
    url.pathname.includes('/admin') ||
    url.pathname.endsWith('/endpoint.json') ||
    url.pathname.endsWith('endpoint.json')
  ) {
    return;
  }

  // Network-First: kad god telefon ima signal, uzmi najsvežiji fajl sa mreže i osveži keš;
  // tek ako je student u podzemnom prolazu/bloku bez signala, posluži poslednju keširanu ljusku aplikacije.
  event.respondWith((async () => {
    try {
      const mrezniOdg = await fetch(req, { cache: req.cache === 'reload' ? 'reload' : 'no-cache' });
      if (mrezniOdg && mrezniOdg.ok) {
        const kopija = mrezniOdg.clone();
        caches.open(KES_NAZIV).then(c => c.put(req, kopija)).catch(() => {});
      }
      return mrezniOdg;
    } catch {
      const izKesa = await caches.match(req, { ignoreSearch: true });
      if (izKesa) return izKesa;
      if (req.mode === 'navigate') {
        const pocetna = await caches.match('./index.html');
        if (pocetna) return pocetna;
      }
      throw new Error('Offline');
    }
  })());
});
