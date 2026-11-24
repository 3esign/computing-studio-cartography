/* Urbani žurnal · Service Worker: Cache-First za MapLibre, Network-First za ljusku aplikacije */
'use strict';

const KES_NAZIV = 'uz-ljuska-v5';
const VENDOR_KES = 'uz-vendor-v1';

const APP_FAJLOVI = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './icon.svg',
  './manifest.webmanifest'
];

const VENDOR_FAJLOVI = [
  './maplibre-gl.css',
  './maplibre-gl.js'
];

function jeVendorPutanja(pathname) {
  return /\/maplibre-gl\.(js|css)$/i.test(String(pathname || ''));
}

function kanonskiKljucKesa(url) {
  return url.origin + url.pathname;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const appKes = await caches.open(KES_NAZIV);
      await Promise.allSettled(
        APP_FAJLOVI.map(async u => {
          const odg = await fetch(new Request(u, { cache: 'reload' }));
          if (odg && odg.ok) await appKes.put(u, odg);
        })
      );
    } catch {}
    try {
      const vendorKes = await caches.open(VENDOR_KES);
      await Promise.allSettled(
        VENDOR_FAJLOVI.map(async u => {
          const vecIma = await vendorKes.match(u, { ignoreSearch: true });
          if (vecIma) return;
          const odg = await fetch(new Request(u));
          if (odg && odg.ok) await vendorKes.put(u, odg);
        })
      );
    } catch {}
  })());
});

self.addEventListener('activate', event => {
  const aktivni = new Set([KES_NAZIV, VENDOR_KES]);
  event.waitUntil(
    caches.keys()
      .then(kljucevi => Promise.all(kljucevi.filter(k => !aktivni.has(k)).map(k => caches.delete(k))))
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

  const kljuc = kanonskiKljucKesa(url);

  // Cache-First za nepromenljive vendor biblioteke (MapLibre GL JS/CSS, ~868 KB)
  if (jeVendorPutanja(url.pathname)) {
    event.respondWith((async () => {
      const vendorKes = await caches.open(VENDOR_KES);
      const izKesa = await vendorKes.match(kljuc) || await vendorKes.match(req, { ignoreSearch: true });
      if (izKesa) return izKesa;
      const mrezniOdg = await fetch(req);
      if (mrezniOdg && mrezniOdg.ok) {
        vendorKes.put(kljuc, mrezniOdg.clone()).catch(() => {});
      }
      return mrezniOdg;
    })());
    return;
  }

  // Network-First za ljusku aplikacije (index.html, app.js, app.css):
  // kad god telefon ima signal, uzmi najsvežiji fajl sa mreže i osveži keš pod kanonskim ključem (bez dupliranja ?v=);
  // tek ako je student bez signala, posluži poslednju keširanu ljusku aplikacije.
  event.respondWith((async () => {
    try {
      const mrezniOdg = await fetch(req, { cache: req.cache === 'reload' ? 'reload' : 'no-cache' });
      if (mrezniOdg && mrezniOdg.ok) {
        const kopija = mrezniOdg.clone();
        caches.open(KES_NAZIV).then(c => c.put(kljuc, kopija)).catch(() => {});
      }
      return mrezniOdg;
    } catch {
      const izKesa = await caches.match(kljuc) || await caches.match(req, { ignoreSearch: true });
      if (izKesa) return izKesa;
      if (req.mode === 'navigate') {
        const pocetna = await caches.match('./index.html');
        if (pocetna) return pocetna;
      }
      throw new Error('Offline');
    }
  })());
});
