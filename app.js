/* Urbani žurnal · Computing Studio — klijentska aplikacija (mobilni i desktop) */
(function () {
  'use strict';

  // Oznaka izdanja aplikacije: ide uz svako slanje zapisa (?v=), da se u tragu servera vidi koji kod telefon vrti.
  const VERZIJA_APP = '2026-11-22.1';
  const BEOGRAD_CENTAR = [20.4612, 44.8154];
  const LS_SESIJA = 'uz_sesija_v1';
  const KOLACIC_SESIJA = 'uz_sesija_c1';
  const LS_NACRT = 'uz_nacrt_v1';
  const LS_JEZIK = 'uz_jezik_v1';
  const LS_API = 'uz_poslednji_api_v1';
  const LS_PRVI_PUT = 'uz_upoznat_v1';
  const SS_PENDING_QR = 'uz_pending_qr_v1';
  const RAW_ENDPOINT_FALLBACK = 'https://raw.githubusercontent.com/3esign/computing-studio-cartography/main/endpoint.json';
  const GPS_SVEZ_MS = 3 * 60 * 1000;      // 3 min posle buđenja ekrana
  const GPS_MAKS_STAROST_MS = 5 * 60 * 1000; // 5 min apsolutni plafon pre čuvanja zapisa

  const STANJE = {
    jezik: localStorage.getItem(LS_JEZIK) === 'en' ? 'en' : 'sr',
    apiBaza: '',
    serverDostupan: false,
    sesija: ucitajSesiju(), // { tim, oznaka, nadimak, tajna, zauzeto, limit }
    pendingQr: null,        // { tim, kod }
    gps: null,              // { lat, lon, tacnost_m, vreme }
    gpsGreska: '',
    pogled: 'mapa',         // 'mapa' | 'lista'
    filter: 'svi',          // 'svi' | 'tim'
    aktivnaNedelja: 1,
    serverZapisi: [],
    serverStatistika: { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} },
    poslednjiEtag: '',
    ucitavanjeStanjaUToku: false,
    dnevnikPrikazano: 30,
    dnevnikPrljav: false,
    lokalniRed: [],         // zapisi u IndexedDB koji čekaju slanje
    sinhronizacijaUToku: false,
    kompozitorPrilozi: [],  // [{ id, vrsta, ime, mime, blob, previewUrl, sirina, visina, trajanje }]
    kompozitorTagovi: new Set(),
    snimacZvuka: null,
    snimanjeSekundi: 0,
    snimanjeTajmer: null,
    mapa: null,
    mapaSpremna: false,
    mapa3D: true,
    korisnikMarker: null
  };

  function procitajKolacicSesije() {
    try {
      const parovi = String(document.cookie || '').split(';');
      for (const p of parovi) {
        const idx = p.indexOf('=');
        if (idx < 0) continue;
        const k = p.slice(0, idx).trim();
        if (k !== KOLACIC_SESIJA) continue;
        const v = decodeURIComponent(p.slice(idx + 1).trim());
        const s = JSON.parse(v);
        if (s && s.tim && s.tajna) return s;
      }
    } catch {}
    return null;
  }

  function zapisiKolacicSesije(s) {
    try {
      const sec = location.protocol === 'https:' ? '; Secure' : '';
      if (s && s.tim && s.tajna) {
        const val = encodeURIComponent(JSON.stringify(s));
        document.cookie = `${KOLACIC_SESIJA}=${val}; Max-Age=15552000; Path=/; SameSite=Lax${sec}`;
      } else {
        document.cookie = `${KOLACIC_SESIJA}=; Max-Age=0; Path=/; SameSite=Lax${sec}`;
      }
    } catch {}
  }

  function ucitajSesiju() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SESIJA) || 'null');
      if (s && s.tim && s.tajna) return s;
    } catch {}
    const izKol = procitajKolacicSesije();
    if (izKol) {
      try { localStorage.setItem(LS_SESIJA, JSON.stringify(izKol)); } catch {}
      return izKol;
    }
    return null;
  }

  function sacuvajSesiju(s) {
    STANJE.sesija = s;
    try {
      if (s) localStorage.setItem(LS_SESIJA, JSON.stringify(s));
      else localStorage.removeItem(LS_SESIJA);
    } catch {}
    zapisiKolacicSesije(s);
    idbSacuvajKes('sesija_rezerva', s || null);
    osveziZaglavljeSesije();
  }

  // --- Prevod SR / EN ---
  const TXT = {
    sr: {
      uzivo: 'Uživo',
      offline: 'U telefonu',
      cekaSlanje: n => `Čeka slanje (${n})`,
      prijava: 'Prijava',
      nasTim: t => (t ? `Tim ${t}` : 'Naš tim'),
      gpsTrazi: 'Tražim GPS lokaciju…',
      gpsOk: m => `GPS ±${Math.round(m)} m`,
      gpsGrub: m => `GPS grub (±${Math.round(m)} m)`,
      gpsNema: 'Uključi lokaciju (GPS)',
      gpsOdbijeno: 'Lokacija isključena · uputstvo',
      gpsGreskaTxt: 'GPS nije očitan · probaj opet',
      josZapisa: n => `Prikaži još zapažanja (još ${n})`,
      nemaZapisa: 'Još nema zapažanja u ovom prikazu. Dodirni „+ Novi zapis“ i zabeleži prvi trag u gradu.',
      uTelefonuOznaka: 'Sačuvano u telefonu · čeka slanje',
      otkaziRed: 'Otkaži slanje',
      probajOpet: 'Probaj opet',
      sacuvajKopiju: 'Sačuvaj kopiju',
      urediMoj: 'Uredi',
      obrisiMoj: 'Obriši',
      videoObrada: '🎬 Video se optimizuje za sve uređaje…',
      prikaziNaMapi: 'Prikaži na mapi →',
      qrPrepoznat: (tim, sl, lim) => `QR kod prepoznat: Tim ${tim} (${sl}/${lim} zauzetih mesta). Upiši ime ili nadimak i uđi u žurnal.`,
      qrSkeniranOffline: tim => `QR kod prepoznat za tim ${tim}. Proveravam vezu sa serverom…`,
      potrebnaPrijava: 'Prvo se prijavi skeniranjem QR koda svog tima.',
      potrebanGps: 'Sačekaj trenutak da telefon očita GPS lokaciju ili dozvoli pristup lokaciji u pregledaču.',
      potrebanPrilog: 'Dodaj bar zapažanje u tekstu, fotografiju, zvuk ili video.',
      sacuvanoUzivo: 'Zapis je upisan u Urbani žurnal i vidljiv na mapi!',
      sacuvanoOffline: 'Sačuvano u telefonu! Poslaće se automatski čim server bude dostupan.',
      saljeSeVeliki: 'Sačuvano u telefonu. Veliki prilog se šalje u pozadini; ostavi aplikaciju otvorenu dok ne stigne.',
      kopirano: 'Link je kopiran! Otvori Safari ili Chrome i nalepi ga u adresnu traku.',
      snimam: s => `Zaustavi (${s}s)`,
      snimiZvuk: 'Snimi zvuk'
    },
    en: {
      uzivo: 'Live',
      offline: 'On phone',
      cekaSlanje: n => `Pending (${n})`,
      prijava: 'Sign in',
      nasTim: t => (t ? `Team ${t}` : 'Our team'),
      gpsTrazi: 'Acquiring GPS…',
      gpsOk: m => `GPS ±${Math.round(m)} m`,
      gpsGrub: m => `Coarse GPS (±${Math.round(m)} m)`,
      gpsNema: 'Enable location (GPS)',
      gpsOdbijeno: 'Location blocked · guide',
      gpsGreskaTxt: 'GPS unavailable · retry',
      josZapisa: n => `Show more entries (${n} left)`,
      nemaZapisa: 'No observations in this view yet. Tap "+ New entry" to record your first city trace.',
      uTelefonuOznaka: 'Saved on phone · waiting to sync',
      otkaziRed: 'Cancel queued',
      probajOpet: 'Retry',
      sacuvajKopiju: 'Save a copy',
      urediMoj: 'Edit',
      obrisiMoj: 'Delete',
      videoObrada: '🎬 Optimizing video for all devices…',
      prikaziNaMapi: 'Show on map →',
      qrPrepoznat: (tim, sl, lim) => `QR verified: Team ${tim} (${sl}/${lim} seats used). Enter your name or nickname to start.`,
      qrSkeniranOffline: tim => `QR recognized for team ${tim}. Checking server connection…`,
      potrebnaPrijava: 'Please sign in first by scanning your team QR code.',
      potrebanGps: 'Please wait for phone GPS fix or allow location permission in your browser.',
      potrebanPrilog: 'Add at least a text note, photo, sound, or video.',
      sacuvanoUzivo: 'Entry saved to Urban Journal and live on the map!',
      sacuvanoOffline: 'Saved on your phone! Will sync automatically once connected.',
      saljeSeVeliki: 'Saved on your phone. The large attachment is uploading in the background; keep the app open until it arrives.',
      kopirano: 'Link copied! Open Safari or Chrome and paste it into the address bar.',
      snimam: s => `Stop (${s}s)`,
      snimiZvuk: 'Record sound'
    }
  };

  function t(kljuc, ...args) {
    const v = TXT[STANJE.jezik][kljuc];
    return typeof v === 'function' ? v(...args) : v;
  }

  function primeniJezik() {
    document.documentElement.lang = STANJE.jezik === 'en' ? 'en' : 'sr-Latn';
    document.getElementById('btn-lang').textContent = STANJE.jezik === 'en' ? 'SR' : 'EN';
    document.querySelectorAll('[data-sr]').forEach(el => {
      const tekst = el.getAttribute(STANJE.jezik === 'en' ? 'data-en' : 'data-sr');
      if (tekst !== null) el.textContent = tekst;
    });
    const ta = document.getElementById('comp-text');
    if (ta) {
      ta.placeholder = STANJE.jezik === 'en'
        ? 'How do you experience this place, surroundings, or movement through your chosen neighborhood?'
        : 'Šta primećuješ u prostoru? Kako beležiš doživljaj okruženja, zvuk, sećanje ili kretanje kroz kraj?';
    }
    osveziZaglavljeSesije();
    osveziStatusTraku();
    osveziGpsPrikaz();
    crtajPodatke();
  }

  function toast(poruka) {
    const el = document.getElementById('toast');
    el.textContent = poruka;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3600);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- IndexedDB (offline red slanja + lokalni keš stanja) ---
  let idbPromis = null;
  function otvoriBazu() {
    if (idbPromis) return idbPromis;
    idbPromis = new Promise((resolve, reject) => {
      const z = indexedDB.open('urbani_zurnal_idb', 1);
      z.onupgradeneeded = () => {
        const db = z.result;
        if (!db.objectStoreNames.contains('red_slanja')) {
          db.createObjectStore('red_slanja', { keyPath: 'uuid_klijenta' });
        }
        if (!db.objectStoreNames.contains('kes')) {
          db.createObjectStore('kes', { keyPath: 'kljuc' });
        }
      };
      z.onsuccess = () => resolve(z.result);
      z.onerror = () => reject(z.error);
    });
    return idbPromis;
  }

  async function idbSviIzReda() {
    try {
      const db = await otvoriBazu();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('red_slanja', 'readonly');
        const req = tx.objectStore('red_slanja').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  async function idbUpisiURed(stavka) {
    const db = await otvoriBazu();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('red_slanja', 'readwrite');
      tx.objectStore('red_slanja').put(stavka);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbObrisiIzReda(uuid) {
    const db = await otvoriBazu();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('red_slanja', 'readwrite');
      tx.objectStore('red_slanja').delete(uuid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbSacuvajKes(kljuc, vrednost) {
    try {
      const db = await otvoriBazu();
      const tx = db.transaction('kes', 'readwrite');
      tx.objectStore('kes').put({ kljuc, vrednost });
    } catch {}
  }

  async function idbProcitajKes(kljuc) {
    try {
      const db = await otvoriBazu();
      return await new Promise(resolve => {
        const tx = db.transaction('kes', 'readonly');
        const req = tx.objectStore('kes').get(kljuc);
        req.onsuccess = () => resolve(req.result ? req.result.vrednost : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  // --- Otkrivanje adrese PC servera (endpoint.json + raw.githubusercontent.com rezerva bez čekanja CDN-a) ---
  async function procitajJsonSaRoka(url, rokMs = 4500) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tajmer = ctrl ? setTimeout(() => ctrl.abort(), rokMs) : null;
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      if (tajmer) clearTimeout(tajmer);
    }
  }

  async function razresiApiBazu(prisilnoOsvezi = false) {
    const q = new URLSearchParams(location.search);
    if (q.get('api')) {
      STANJE.apiBaza = q.get('api').replace(/\/+$/, '');
      return STANJE.apiBaza;
    }
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      STANJE.apiBaza = location.origin;
      return STANJE.apiBaza;
    }
    if (!prisilnoOsvezi && STANJE.apiBaza) return STANJE.apiBaza;

    const kandidati = [procitajJsonSaRoka('./endpoint.json?t=' + Date.now(), 4500)];
    if (prisilnoOsvezi) {
      kandidati.push(procitajJsonSaRoka(RAW_ENDPOINT_FALLBACK + '?t=' + Date.now(), 4500));
    }
    const odgovori = await Promise.all(kandidati);
    let najbolji = null;
    for (const j of odgovori) {
      if (!j || typeof j.api !== 'string' || !j.api.trim()) continue;
      const vreme = Date.parse(j.updatedAt || '') || 0;
      if (!najbolji || vreme > najbolji.vreme) {
        najbolji = { api: j.api.trim().replace(/\/+$/, ''), vreme };
      }
    }
    if (najbolji) {
      STANJE.apiBaza = najbolji.api;
      try { localStorage.setItem(LS_API, STANJE.apiBaza); } catch {}
      return STANJE.apiBaza;
    }
    let izLs = '';
    try { izLs = localStorage.getItem(LS_API) || ''; } catch {}
    STANJE.apiBaza = izLs.replace(/\/+$/, '');
    return STANJE.apiBaza;
  }

  async function apiPoziv(putanja, opcije = {}, probajReEndpoint = true) {
    const baza = await razresiApiBazu(false);
    if (!baza) throw new Error('PC server trenutno nije povezan.');
    const zaglavlja = Object.assign({}, opcije.headers || {});
    if (STANJE.sesija && STANJE.sesija.tajna && !zaglavlja.Authorization) {
      zaglavlja.Authorization = 'Bearer ' + STANJE.sesija.tajna;
    }
    const jeVelikoSlanje = (typeof FormData !== 'undefined' && opcije.body instanceof FormData)
      || (typeof Blob !== 'undefined' && opcije.body instanceof Blob)
      || (typeof ArrayBuffer !== 'undefined' && (opcije.body instanceof ArrayBuffer || ArrayBuffer.isView(opcije.body)));
    const rokMs = opcije.rokMs || (jeVelikoSlanje ? 90000 : 15000);
    const ctrl = !opcije.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tajmer = ctrl ? setTimeout(() => ctrl.abort(), rokMs) : null;
    try {
      const r = await fetch(
        baza + putanja,
        Object.assign({}, opcije, {
          headers: zaglavlja,
          signal: opcije.signal || (ctrl ? ctrl.signal : undefined)
        })
      );
      // Ako Cloudflare ivica vrati 502/503/504/530 (ugašen ili zamenjen quick-tunnel), osveži endpoint.json!
      if (r.status === 502 || r.status === 503 || r.status === 504 || r.status === 530) {
        throw Object.assign(new Error('Tunel se obnavlja (' + r.status + ')'), { tunelPao: true, status: r.status });
      }
      STANJE.serverDostupan = true;
      osveziStatusTraku();
      return r;
    } catch (err) {
      if (probajReEndpoint && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        const novaBaza = await razresiApiBazu(true);
        if (novaBaza && novaBaza !== baza) {
          return apiPoziv(putanja, opcije, false);
        }
      }
      STANJE.serverDostupan = false;
      osveziStatusTraku();
      throw err;
    } finally {
      if (tajmer) clearTimeout(tajmer);
    }
  }

  // --- Čitanje QR koda ili prenosa prijave iz #hash (odmah čisti URL traku!) ---
  function izvuciQrIzTeksta(sirovo) {
    const s = String(sirovo || '').trim();
    if (!s) return null;
    const m = /(?:^|#)(T\d{2})-([A-Za-z0-9]{4,28})\b/i.exec(s);
    if (m) return { tim: m[1].toUpperCase(), kod: m[2].toUpperCase() };
    const hp = s.indexOf('#');
    if (hp >= 0) {
      const p = new URLSearchParams(s.slice(hp + 1));
      const pt = p.get('t') || p.get('tim');
      const pk = p.get('k') || p.get('kod');
      if (pt && pk) return { tim: pt.trim().toUpperCase(), kod: pk.trim().toUpperCase() };
    }
    return null;
  }

  function procitajPrenosIzUrl() {
    const siroviHash = String(location.hash || '').trim();
    const m = /^#prenos=([A-Za-z0-9_-]{16,800})$/.exec(siroviHash);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const dekodirano = decodeURIComponent(escape(atob(b64)));
      const p = JSON.parse(dekodirano);
      if (p && typeof p.tim === 'string' && typeof p.tajna === 'string' && p.tajna.length >= 20) {
        sacuvajSesiju({
          tim: p.tim.trim().toUpperCase(),
          uredjaj_id: Number(p.uredjaj_id || 0),
          oznaka: String(p.oznaka || ''),
          nadimak: String(p.nadimak || ''),
          tajna: p.tajna.trim(),
          zauzeto: 0,
          limit: 0
        });
        localStorage.setItem(LS_PRVI_PUT, '1');
        return true;
      }
    } catch {}
    return false;
  }

  function napraviLinkPrenosa() {
    if (!STANJE.sesija || !STANJE.sesija.tajna) return '';
    const json = JSON.stringify({
      tim: STANJE.sesija.tim,
      tajna: STANJE.sesija.tajna,
      nadimak: STANJE.sesija.nadimak || '',
      oznaka: STANJE.sesija.oznaka || '',
      uredjaj_id: STANJE.sesija.uredjaj_id || 0
    });
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `${location.origin}${location.pathname}#prenos=${b64}`;
  }

  function procitajQrIzUrl() {
    const siroviHash = String(location.hash || '').trim();
    const nadjeno = siroviHash.length > 2 ? izvuciQrIzTeksta(siroviHash) : null;
    if (nadjeno) {
      sessionStorage.setItem(SS_PENDING_QR, JSON.stringify(nadjeno));
      history.replaceState(null, '', location.pathname + location.search);
      return nadjeno;
    }
    try {
      const izSes = JSON.parse(sessionStorage.getItem(SS_PENDING_QR) || 'null');
      if (izSes && izSes.tim && izSes.kod) return izSes;
    } catch {}
    return null;
  }

  function jePrivremeniPregledac() {
    const ua = navigator.userAgent || '';
    return /Comet|Viber|Instagram|FBAN|FBAV|WhatsApp|Line\/|TikTok|BytedanceWebview|; wv\)/i.test(ua);
  }

  // --- Skeniranje ili učitavanje slike QR koda direktno u panelu prijave ---
  let qrKameraStream = null;
  let qrKameraTajmer = null;

  function zaustaviQrKameru() {
    if (qrKameraTajmer) {
      clearInterval(qrKameraTajmer);
      qrKameraTajmer = null;
    }
    if (qrKameraStream) {
      qrKameraStream.getTracks().forEach(tr => tr.stop());
      qrKameraStream = null;
    }
    const vid = document.getElementById('qr-cam-video');
    if (vid) vid.srcObject = null;
    const box = document.getElementById('qr-cam-box');
    if (box) box.hidden = true;
  }

  async function primeniPrepoznatQr(par) {
    zaustaviQrKameru();
    STANJE.pendingQr = par;
    sessionStorage.setItem(SS_PENDING_QR, JSON.stringify(par));
    await pripremiPrijavuPanel();
    const inpNad = document.getElementById('inp-nadimak');
    if (inpNad && !inpNad.value) inpNad.focus();
  }

  async function pripremiSlikuZaQrServer(fajl) {
    const url = URL.createObjectURL(fajl);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Neuspešno čitanje slike.'));
        i.src = url;
      });
      const maks = 1200;
      let w = img.naturalWidth || img.width || 800;
      let h = img.naturalHeight || img.height || 800;
      if (w > maks || h > maks) {
        if (w >= h) { h = Math.round((h * maks) / w); w = maks; }
        else { w = Math.round((w * maks) / h); h = maks; }
      }
      const pl = document.createElement('canvas');
      pl.width = w;
      pl.height = h;
      pl.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => pl.toBlob(r, 'image/png'));
      return blob || fajl;
    } catch {
      return fajl;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function dekodirajQrIzFajla(fajl) {
    if (!fajl) return;
    const errBox = document.getElementById('login-error-box');
    errBox.hidden = true;

    // 1. Pokušaj ugrađenim BarcodeDetector-om u samom pregledaču (trenutno na Android Chrome-u)
    if (typeof window.BarcodeDetector === 'function') {
      try {
        const bmp = await createImageBitmap(fajl);
        try {
          const det = new window.BarcodeDetector({ formats: ['qr_code'] });
          const kodovi = await det.detect(bmp);
          for (const k of kodovi) {
            const par = izvuciQrIzTeksta(k.rawValue);
            if (par) {
              await primeniPrepoznatQr(par);
              return;
            }
          }
        } finally {
          if (bmp && bmp.close) bmp.close();
        }
      } catch {}
    }

    // 2. Rezerva preko PC servera (/api/procitaj-qr u memoriji) za iOS Safari / desktop pregledače
    try {
      const manjiBlob = await pripremiSlikuZaQrServer(fajl);
      const r = await apiPoziv('/api/procitaj-qr', {
        method: 'POST',
        headers: { 'Content-Type': manjiBlob.type || 'image/png' },
        body: manjiBlob
      });
      const j = await r.json();
      if (r.ok && j.ok && j.tim && j.kod) {
        await primeniPrepoznatQr({ tim: j.tim, kod: j.kod });
        return;
      }
      errBox.textContent = (j && j.poruka) || 'QR kod tima nije prepoznat na slici.';
      errBox.hidden = false;
    } catch {
      errBox.textContent = 'QR kod nije prepoznat u pregledaču, a PC server nije dostupan.';
      errBox.hidden = false;
    }
  }

  async function pokreniQrKameru() {
    if (qrKameraStream) {
      zaustaviQrKameru();
      return;
    }
    let podrzavaUzivo = false;
    if (typeof window.BarcodeDetector === 'function' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
          const fmt = await window.BarcodeDetector.getSupportedFormats();
          podrzavaUzivo = Array.isArray(fmt) && fmt.includes('qr_code');
        } else {
          podrzavaUzivo = true;
        }
      } catch {}
    }
    if (!podrzavaUzivo) {
      document.getElementById('inp-qr-snap').click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      qrKameraStream = stream;
      const vid = document.getElementById('qr-cam-video');
      const box = document.getElementById('qr-cam-box');
      vid.srcObject = stream;
      box.hidden = false;
      await vid.play();

      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      let uToku = false;
      qrKameraTajmer = setInterval(async () => {
        if (uToku || !qrKameraStream || vid.readyState < 2) return;
        uToku = true;
        try {
          const kodovi = await det.detect(vid);
          for (const k of kodovi) {
            const par = izvuciQrIzTeksta(k.rawValue);
            if (par) {
              await primeniPrepoznatQr(par);
              break;
            }
          }
        } catch {} finally {
          uToku = false;
        }
      }, 220);
    } catch {
      zaustaviQrKameru();
      document.getElementById('inp-qr-snap').click();
    }
  }

  // --- Jedinstveni upravljač panelima (uvek najviše jedan otvoren!) ---
  const SVI_PANELI = ['modal-login', 'modal-info', 'modal-composer', 'modal-detail', 'modal-profile', 'modal-gps-help'];

  function otvoriPanel(id) {
    if (id !== 'modal-login') zaustaviQrKameru();
    const tst = document.getElementById('toast');
    if (tst) tst.hidden = true;
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el) el.hidden = pid !== id;
    }
  }

  function zatvoriSvePanele() {
    zaustaviSnimanjeZvuka(true);
    zaustaviQrKameru();
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el) el.hidden = true;
    }
  }

  // --- Zaglavlje i status ---
  function osveziZaglavljeSesije() {
    const lbl = document.getElementById('profil-label');
    const fltLbl = document.getElementById('filter-team-label');
    if (STANJE.sesija && STANJE.sesija.tim) {
      const potpis = STANJE.sesija.nadimak || STANJE.sesija.oznaka || '';
      lbl.textContent = potpis ? `${STANJE.sesija.tim} · ${potpis}` : STANJE.sesija.tim;
      fltLbl.textContent = t('nasTim', STANJE.sesija.tim);
    } else {
      lbl.textContent = t('prijava');
      fltLbl.textContent = t('nasTim', '');
    }
  }

  function osveziStatusTraku() {
    const btn = document.getElementById('btn-status');
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    const brRed = STANJE.lokalniRed.length;

    if (brRed > 0) {
      btn.classList.add('queue-active');
      dot.className = 'dot warn';
      txt.textContent = t('cekaSlanje', brRed);
    } else if (STANJE.serverDostupan) {
      btn.classList.remove('queue-active');
      dot.className = 'dot ok';
      txt.textContent = t('uzivo');
    } else {
      btn.classList.remove('queue-active');
      dot.className = 'dot warn';
      txt.textContent = t('offline');
    }
  }

  // --- GPS lokacija (automatski, bez ručnog nišanjenja + zaštita od zastarele lokacije posle prevoza) ---
  let gpsWatchId = null;
  function osveziGpsPrikaz() {
    const dot = document.getElementById('gps-dot');
    const lbl = document.getElementById('gps-label');
    if (STANJE.gps) {
      if (STANJE.gps.tacnost_m > 120) {
        dot.className = 'dot warn';
        lbl.textContent = t('gpsGrub', STANJE.gps.tacnost_m);
      } else {
        dot.className = 'dot ok';
        lbl.textContent = t('gpsOk', STANJE.gps.tacnost_m);
      }
    } else if (STANJE.gpsGreska) {
      dot.className = 'dot err';
      lbl.textContent = STANJE.gpsGreskaKod === 1 ? t('gpsOdbijeno') : t('gpsGreskaTxt');
    } else {
      dot.className = 'dot warn';
      lbl.textContent = t('gpsTrazi');
    }
    azurirajKompozitorMeta();
  }

  function pokreniGps(centrirajAkoDobije = false) {
    if (!navigator.geolocation) {
      STANJE.gpsGreska = 'Geolokacija nije podržana.';
      osveziGpsPrikaz();
      return;
    }
    const naPoziciju = pos => {
      STANJE.gps = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        tacnost_m: Math.max(3, Math.round(pos.coords.accuracy || 12)),
        vreme: new Date().toISOString(),
        ts: Date.now()
      };
      STANJE.gpsGreska = '';
      STANJE.gpsGreskaKod = 0;
      const gpsModal = document.getElementById('modal-gps-help');
      if (gpsModal && !gpsModal.hidden) zatvoriSvePanele();
      osveziGpsPrikaz();
      azurirajPlavuTackuNaMapi();
      if (centrirajAkoDobije && STANJE.mapa && STANJE.mapaSpremna) {
        centrirajAkoDobije = false;
        STANJE.mapa.flyTo({ center: [STANJE.gps.lon, STANJE.gps.lat], zoom: 17.2, duration: 900 });
      }
    };
    const naGresku = err => {
      if (!STANJE.gps) {
        STANJE.gpsGreska = err && err.message ? err.message : 'GPS nedostupan';
        STANJE.gpsGreskaKod = err && err.code;
        if (err && err.code === 1 && STANJE.gpsRucno) {
          STANJE.gpsRucno = false;
          otvoriPanel('modal-gps-help');
        }
      }
      osveziGpsPrikaz();
    };
    navigator.geolocation.getCurrentPosition(naPoziciju, naGresku, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 15000
    });
    if (gpsWatchId === null) {
      gpsWatchId = navigator.geolocation.watchPosition(naPoziciju, naGresku, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 8000
      });
    }
  }

  // --- Prijava tima preko QR koda ili ručno ---
  async function pripremiPrijavuPanel() {
    const errBox = document.getElementById('login-error-box');
    const qrBox = document.getElementById('qr-detected-box');
    const manPolja = document.getElementById('manual-code-fields');
    const inappBox = document.getElementById('inapp-warning');
    const inpTim = document.getElementById('inp-tim');
    const inpKod = document.getElementById('inp-kod');
    const inpNad = document.getElementById('inp-nadimak');

    errBox.hidden = true;
    qrBox.hidden = true;
    inappBox.hidden = !jePrivremeniPregledac();

    if (STANJE.sesija && STANJE.sesija.nadimak && !inpNad.value) {
      inpNad.value = STANJE.sesija.nadimak;
    }

    if (STANJE.pendingQr) {
      inpTim.value = STANJE.pendingQr.tim;
      inpKod.value = STANJE.pendingQr.kod;
      manPolja.hidden = true;
      qrBox.hidden = false;
      qrBox.textContent = t('qrSkeniranOffline', STANJE.pendingQr.tim);
      otvoriPanel('modal-login');

      try {
        const r = await apiPoziv('/api/provera-koda', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tim: STANJE.pendingQr.tim, kod: STANJE.pendingQr.kod })
        });
        const j = await r.json();
        if (r.ok && j.ok) {
          qrBox.textContent = t('qrPrepoznat', j.tim, j.zauzeto, j.limit);
        } else {
          qrBox.hidden = true;
          errBox.hidden = false;
          errBox.textContent = j.poruka || 'QR kod nije prihvaćen.';
          if (j.kod_greske === 'NEVAZECI_KOD') {
            manPolja.hidden = false;
          }
        }
      } catch {
        qrBox.hidden = true;
        errBox.hidden = false;
        errBox.textContent = 'PC server trenutno ne odgovara. Proveri internet vezu i pokušaj ponovo.';
      }
    } else {
      manPolja.hidden = false;
      otvoriPanel('modal-login');
    }
  }

  async function izvrsiPrijavu() {
    const btn = document.getElementById('btn-submit-login');
    const errBox = document.getElementById('login-error-box');
    const tim = document.getElementById('inp-tim').value.trim().toUpperCase();
    const kod = document.getElementById('inp-kod').value.trim().toUpperCase();
    const nadimak = document.getElementById('inp-nadimak').value.trim();

    errBox.hidden = true;
    if (!tim || !kod) {
      errBox.textContent = 'Skeniraj QR kod svog tima ili upiši oznaku tima (npr. T07) i kod.';
      errBox.hidden = false;
      document.getElementById('manual-code-fields').hidden = false;
      return;
    }

    btn.disabled = true;
    try {
      const r = await apiPoziv('/api/prijava', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tim,
          kod,
          nadimak,
          postojeca_tajna: STANJE.sesija && STANJE.sesija.tim === tim ? STANJE.sesija.tajna : ''
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        errBox.textContent = j.poruka || 'Prijava nije uspela.';
        errBox.hidden = false;
        if (j.kod_greske === 'NEVAZECI_KOD') {
          document.getElementById('manual-code-fields').hidden = false;
        }
        return;
      }

      sessionStorage.removeItem(SS_PENDING_QR);
      STANJE.pendingQr = null;
      sacuvajSesiju({
        tim: j.tim,
        uredjaj_id: j.uredjaj_id,
        oznaka: j.oznaka,
        nadimak: j.nadimak || '',
        tajna: j.tajna,
        zauzeto: j.zauzeto,
        limit: j.limit
      });
      try { localStorage.setItem(LS_PRVI_PUT, '1'); } catch {}
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(() => {});
      }
      zatvoriSvePanele();
      pokreniGps(true);
      toast(`${j.tim} · ${j.nadimak || j.oznaka}`);
      ucitajStanjeSaServera();
      sinhronizujRed();
    } catch {
      errBox.textContent = 'Prva prijava traži aktivnu vezu sa PC serverom. Proveri internet ili javi profesoru.';
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // --- Optimizacija slike na telefonu (WebP / JPEG <= 1600 px, ciljno ~180–450 KB, 0 EXIF) ---
  async function optimizujSliku(fajl) {
    const url = URL.createObjectURL(fajl);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Neuspešno čitanje slike.'));
        i.src = url;
      });
      const izvSir = img.naturalWidth || img.width || 1200;
      const izvVis = img.naturalHeight || img.height || 900;

      const kodirajNaMax = async (maksStrana, kvWebp, kvJpeg) => {
        let sirina = izvSir;
        let visina = izvVis;
        if (sirina > maksStrana || visina > maksStrana) {
          if (sirina >= visina) {
            visina = Math.round((visina * maksStrana) / sirina);
            sirina = maksStrana;
          } else {
            sirina = Math.round((sirina * maksStrana) / visina);
            visina = maksStrana;
          }
        }
        const platno = document.createElement('canvas');
        platno.width = sirina;
        platno.height = visina;
        const ctx = platno.getContext('2d');
        ctx.drawImage(img, 0, 0, sirina, visina);

        let blob = await new Promise(res => platno.toBlob(res, 'image/webp', kvWebp));
        let mime = 'image/webp';
        let ext = '.webp';
        if (!blob || blob.type !== 'image/webp') {
          blob = await new Promise(res => platno.toBlob(res, 'image/jpeg', kvJpeg));
          mime = 'image/jpeg';
          ext = '.jpg';
        }
        return { blob, mime, ext, sirina, visina };
      };

      let rez = await kodirajNaMax(1600, 0.80, 0.78);
      // Ako na iOS Safari JPEG fallback-u gusta fotografija i dalje pređe 650 KB, spusti kvalitet u još jednom koraku radi brzog slanja bez zagušenja
      if (rez.blob && rez.blob.size > 650 * 1024) {
        rez = await kodirajNaMax(1400, 0.72, 0.68);
      }

      return {
        vrsta: 'foto',
        ime: 'foto' + rez.ext,
        mime: rez.mime,
        blob: rez.blob,
        sirina: rez.sirina,
        visina: rez.visina,
        trajanje: 0
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // --- Snimanje zvuka u pregledaču ---
  function zaustaviSnimanjeZvuka(otkazi = false) {
    clearInterval(STANJE.snimanjeTajmer);
    STANJE.snimanjeTajmer = null;
    const btn = document.getElementById('btn-record-audio');
    const lbl = document.getElementById('rec-label');
    if (btn) btn.classList.remove('recording');
    if (lbl) lbl.textContent = t('snimiZvuk');

    if (STANJE.snimacZvuka) {
      const rec = STANJE.snimacZvuka;
      STANJE.snimacZvuka = null;
      rec._otkazano = otkazi;
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {}
      if (rec.stream) {
        rec.stream.getTracks().forEach(tr => tr.stop());
      }
    }
  }

  async function prekidacSnimanjaZvuka() {
    if (STANJE.snimacZvuka) {
      zaustaviSnimanjeZvuka(false);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Snimanje zvuka nije podržano u ovom pregledaču — izaberi audio fajl.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const kandidati = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      let izabraniMime = '';
      for (const m of kandidati) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
          izabraniMime = m;
          break;
        }
      }
      const rec = izabraniMime ? new MediaRecorder(stream, { mimeType: izabraniMime }) : new MediaRecorder(stream);
      const delovi = [];
      const pocetak = Date.now();
      STANJE.snimacZvuka = rec;
      STANJE.snimanjeSekundi = 0;

      rec.ondataavailable = e => { if (e.data && e.data.size > 0) delovi.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        if (rec._otkazano || delovi.length === 0) return;
        const stvarniMime = (rec.mimeType || izabraniMime || 'audio/webm').split(';')[0];
        const ext = stvarniMime.includes('mp4') ? '.m4a' : (stvarniMime.includes('ogg') ? '.ogg' : '.webm');
        const blob = new Blob(delovi, { type: stvarniMime });
        const trajanje = Math.max(1, Math.round((Date.now() - pocetak) / 1000));
        dodajPrilogUKompozitor({
          vrsta: 'zvuk',
          ime: 'zvuk-grada' + ext,
          mime: stvarniMime,
          blob,
          sirina: 0,
          visina: 0,
          trajanje
        });
      };

      rec.start();
      const btn = document.getElementById('btn-record-audio');
      const lbl = document.getElementById('rec-label');
      btn.classList.add('recording');
      lbl.textContent = t('snimam', 0);

      STANJE.snimanjeTajmer = setInterval(() => {
        STANJE.snimanjeSekundi++;
        lbl.textContent = t('snimam', STANJE.snimanjeSekundi);
        if (STANJE.snimanjeSekundi >= 180) {
          zaustaviSnimanjeZvuka(false);
        }
      }, 1000);
    } catch {
      toast('Dozvoli pristup mikrofonu u pregledaču za snimanje zvuka.');
    }
  }

  // --- Kompozitor novog zapisa ---
  function azurirajKompozitorMeta() {
    const el = document.getElementById('comp-meta-strip');
    if (!el || document.getElementById('modal-composer').hidden) return;
    const timTxt = STANJE.sesija ? `${STANJE.sesija.tim} · ${STANJE.sesija.nadimak || STANJE.sesija.oznaka}` : 'Nije prijavljen';
    const gpsTxt = STANJE.gps
      ? `${STANJE.gps.lat.toFixed(5)}, ${STANJE.gps.lon.toFixed(5)} (±${STANJE.gps.tacnost_m} m)`
      : t('gpsTrazi');
    const sadTxt = new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    const vezbaTxt = STANJE.jezik === 'en' ? `Exercise ${STANJE.aktivnaNedelja}` : `Vežba ${STANJE.aktivnaNedelja}`;
    el.innerHTML = `<span><strong>${esc(timTxt)}</strong></span> · <span>${esc(vezbaTxt)}</span> · <span>${esc(gpsTxt)}</span> · <span>${esc(sadTxt)}</span>`;
  }

  function sacuvajNacrtKompozitora() {
    try {
      const el = document.getElementById('comp-text');
      const tekst = el ? el.value : '';
      const tagovi = Array.from(STANJE.kompozitorTagovi || []);
      if (!tekst.trim() && tagovi.length === 0) {
        localStorage.removeItem(LS_NACRT);
      } else {
        localStorage.setItem(LS_NACRT, JSON.stringify({ tekst, tagovi, ts: Date.now() }));
      }
    } catch {}
  }

  function obrisiNacrtKompozitora() {
    try { localStorage.removeItem(LS_NACRT); } catch {}
  }

  function otvoriKompozitor() {
    if (!STANJE.sesija || !STANJE.sesija.tajna) {
      toast(t('potrebnaPrijava'));
      pripremiPrijavuPanel();
      return;
    }
    if (STANJE.gps && Date.now() - (STANJE.gps.ts || 0) > GPS_SVEZ_MS) {
      STANJE.gps = null;
      osveziGpsPrikaz();
    }
    pokreniGps(false);
    ocistiKompozitor();
    // Ako je mobilni OS ugasio karticu dok je kamera bila otvorena, automatski vrati započeti tekst i tagove!
    try {
      const nacrt = JSON.parse(localStorage.getItem(LS_NACRT) || 'null');
      if (nacrt && Date.now() - (nacrt.ts || 0) < 24 * 3600 * 1000) {
        if (typeof nacrt.tekst === 'string' && nacrt.tekst) {
          document.getElementById('comp-text').value = nacrt.tekst;
        }
        if (Array.isArray(nacrt.tagovi)) {
          for (const tg of nacrt.tagovi) {
            STANJE.kompozitorTagovi.add(tg);
            const chip = document.querySelector(`#comp-tags .choice-chip[data-tag="${CSS.escape(tg)}"]`);
            if (chip) chip.classList.add('selected');
          }
        }
      }
    } catch {}
    otvoriPanel('modal-composer');
    azurirajKompozitorMeta();
  }

  function ocistiKompozitor() {
    zaustaviSnimanjeZvuka(true);
    for (const p of STANJE.kompozitorPrilozi) {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    }
    STANJE.kompozitorPrilozi = [];
    STANJE.kompozitorTagovi.clear();
    document.getElementById('comp-text').value = '';
    document.getElementById('comp-error').hidden = true;
    document.querySelectorAll('#comp-tags .choice-chip').forEach(b => b.classList.remove('selected'));
    crtajKompozitorPriloge();
  }

  function dodajPrilogUKompozitor(stavka) {
    if (STANJE.kompozitorPrilozi.length >= 6) {
      toast('Najviše 6 priloga po jednom zapisu.');
      return;
    }
    stavka.id = Math.random().toString(36).slice(2);
    if (stavka.vrsta === 'foto') {
      stavka.previewUrl = URL.createObjectURL(stavka.blob);
    }
    STANJE.kompozitorPrilozi.push(stavka);
    crtajKompozitorPriloge();
  }

  function crtajKompozitorPriloge() {
    const el = document.getElementById('comp-attachments');
    el.innerHTML = STANJE.kompozitorPrilozi.map(p => {
      const kb = Math.max(1, Math.round(p.blob.size / 1024));
      const vel = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
      const thumb = p.previewUrl ? `<img src="${esc(p.previewUrl)}" alt="">` : `<span>${p.vrsta === 'zvuk' ? '🎙️' : '🎬'}</span>`;
      return `
        <div class="attached-item">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            ${thumb}
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <strong>${esc(p.ime)}</strong> <span style="color:var(--ink-soft)">(${vel})</span>
            </div>
          </div>
          <button type="button" class="close-btn" data-rm-att="${esc(p.id)}" aria-label="Ukloni">✕</button>
        </div>
      `;
    }).join('');
    el.querySelectorAll('[data-rm-att]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-rm-att');
        const idx = STANJE.kompozitorPrilozi.findIndex(x => x.id === id);
        if (idx >= 0) {
          if (STANJE.kompozitorPrilozi[idx].previewUrl) URL.revokeObjectURL(STANJE.kompozitorPrilozi[idx].previewUrl);
          STANJE.kompozitorPrilozi.splice(idx, 1);
          crtajKompozitorPriloge();
        }
      };
    });
  }

  function generisiUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'uz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function sacuvajNoviZapis() {
    zaustaviSnimanjeZvuka(false);
    const errEl = document.getElementById('comp-error');
    const btn = document.getElementById('btn-save-entry');
    errEl.hidden = true;

    if (!STANJE.gps || (STANJE.gps.ts && Date.now() - STANJE.gps.ts > GPS_MAKS_STAROST_MS)) {
      if (STANJE.gps) {
        STANJE.gps = null;
        osveziGpsPrikaz();
      }
      errEl.textContent = t('potrebanGps');
      errEl.hidden = false;
      pokreniGps(false);
      return;
    }

    const tekst = document.getElementById('comp-text').value.trim();
    if (!tekst && STANJE.kompozitorPrilozi.length === 0) {
      errEl.textContent = t('potrebanPrilog');
      errEl.hidden = false;
      return;
    }

    btn.disabled = true;
    try {
      const zapisZaRed = {
        uuid_klijenta: generisiUuid(),
        tim: STANJE.sesija.tim,
        nadimak: STANJE.sesija.nadimak || '',
        oznaka_uredjaja: STANJE.sesija.oznaka || '',
        nedelja: STANJE.aktivnaNedelja || 1,
        tema: 'subjektivni-dozivljaj',
        kategorije: Array.from(STANJE.kompozitorTagovi),
        lat: STANJE.gps.lat,
        lon: STANJE.gps.lon,
        tacnost_m: STANJE.gps.tacnost_m,
        radijus_m: Math.min(25, Math.max(5, Math.round(STANJE.gps.tacnost_m))),
        vreme_telefona: new Date().toISOString(),
        tekst,
        prilozi: STANJE.kompozitorPrilozi.map(p => ({
          vrsta: p.vrsta,
          ime: p.ime,
          mime: p.mime,
          blob: p.blob,
          sirina: p.sirina || 0,
          visina: p.visina || 0,
          trajanje: p.trajanje || 0
        }))
      };

      // 1. Uvek prvo zapiši u IndexedDB telefona (nula gubitka čak i ako pukne signal u sred slanja!)
      const mojUuid = zapisZaRed.uuid_klijenta;
      await idbUpisiURed(zapisZaRed);
      obrisiNacrtKompozitora();
      STANJE.lokalniRed = await idbSviIzReda();
      osveziStatusTraku();
      ocistiKompozitor();
      zatvoriSvePanele();
      crtajPodatke();

      if (STANJE.mapa && STANJE.mapaSpremna) {
        STANJE.mapa.flyTo({ center: [zapisZaRed.lon, zapisZaRed.lat], zoom: Math.max(STANJE.mapa.getZoom(), 17), duration: 700 });
      }

      // 2. Odmah pokušaj slanje na PC server
      const poslato = await sinhronizujRed(true);
      const uReduPosle = STANJE.lokalniRed.find(x => x.uuid_klijenta === mojUuid);
      if (uReduPosle && uReduPosle.trajna_greska) {
        toast(uReduPosle.trajna_greska);
      } else {
        const idePozadinom = !poslato && uReduPosle && jeVelikiZapis(uReduPosle) && STANJE.serverDostupan;
        toast(poslato ? t('sacuvanoUzivo') : t(idePozadinom ? 'saljeSeVeliki' : 'sacuvanoOffline'));
      }
    } catch (e) {
      errEl.textContent = 'Greška pri čuvanju: ' + (e && e.message ? e.message : String(e));
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // --- Sinhronizacija offline reda sa PC serverom (otporna na „otrovnu stavku“ tako da 4xx greška na #1 nikad ne blokira #2..#N!) ---
  // iOS/Safari 26.5+ (WebKit 319985): Blob pročitan iz IndexedDB-a, dodat pravo u FormData, ode kao prazno telo zahteva.
  // Zato se svaki prilog pre slanja pročita u memoriju (ArrayBuffer). Prvi put slanja je FormData sa novim Blob-om iz tih bajtova;
  // ako server i tada javi prazno telo, isti zapis se odmah šalje rezervnim putem: multipart sklopljen ručno kao niz bajtova,
  // bez FormData i bez Blob-a, pa greška pregledača nema na čemu da se okine.
  async function procitajBajtovePriloga(blob) {
    if (!blob) return new ArrayBuffer(0);
    if (typeof blob.arrayBuffer === 'function') {
      try { return await blob.arrayBuffer(); } catch {}
    }
    try { return await new Response(blob).arrayBuffer(); } catch {}
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error || new Error('čitanje priloga'));
      fr.readAsArrayBuffer(blob);
    });
  }

  function poljaZapisaZaSlanje(stavka) {
    const pril = stavka.prilozi || [];
    const polja = [
      ['uuid_klijenta', stavka.uuid_klijenta],
      ['nedelja', String(stavka.nedelja || 1)],
      ['tema', stavka.tema || 'subjektivni-dozivljaj'],
      ['kategorije', JSON.stringify(stavka.kategorije || [])],
      ['lat', String(stavka.lat)],
      ['lon', String(stavka.lon)],
      ['tacnost_m', String(stavka.tacnost_m)],
      ['vreme_telefona', stavka.vreme_telefona],
      ['nadimak', stavka.nadimak || ''],
      ['tekst', stavka.tekst || '']
    ];
    for (let i = 0; i < pril.length; i++) {
      polja.push([`sirina_${i}`, String(pril[i].sirina || 0)]);
      polja.push([`visina_${i}`, String(pril[i].visina || 0)]);
      polja.push([`trajanje_${i}`, String(pril[i].trajanje || 0)]);
    }
    return polja;
  }

  function tipPriloga(p) {
    return String((p && p.blob && p.blob.type) || (p && p.mime) || 'application/octet-stream').replace(/[\r\n]/g, '');
  }

  // Ručno sklopljen multipart/form-data (RFC 7578) kao jedan Uint8Array.
  function sklopiMultipartRucno(polja, pril, bajtovi) {
    let nasumicno = '';
    for (let i = 0; i < 4; i++) nasumicno += Math.random().toString(36).slice(2, 10);
    const granica = '----uzRucno' + nasumicno;
    const enc = new TextEncoder();
    const delovi = [];
    for (const [ime, vrednost] of polja) {
      delovi.push(enc.encode(`--${granica}\r\nContent-Disposition: form-data; name="${ime}"\r\n\r\n${vrednost == null ? '' : String(vrednost)}\r\n`));
    }
    for (let i = 0; i < pril.length; i++) {
      const imeFajla = String(pril[i].ime || `prilog-${i}`).replace(/["\r\n\\]/g, '_');
      delovi.push(enc.encode(`--${granica}\r\nContent-Disposition: form-data; name="fajl_${i}"; filename="${imeFajla}"\r\nContent-Type: ${tipPriloga(pril[i])}\r\n\r\n`));
      delovi.push(new Uint8Array(bajtovi[i]));
      delovi.push(enc.encode('\r\n'));
    }
    delovi.push(enc.encode(`--${granica}--\r\n`));
    let ukupno = 0;
    for (const d of delovi) ukupno += d.length;
    const telo = new Uint8Array(ukupno);
    let poz = 0;
    for (const d of delovi) { telo.set(d, poz); poz += d.length; }
    return { telo, tip: 'multipart/form-data; boundary=' + granica };
  }

  // Odbijanje zbog praznog tela nije greška zapisa: prepoznaje se po šifri novog servera ili po poruci starog.
  function jeOdgovorPraznogTela(status, j) {
    return status === 400 && !!j && (j.kod_greske === 'PRAZNO_TELO' || String(j.poruka || '').includes('uuid_klijenta'));
  }
  function jeGreskaPraznogTela(stavka) {
    if (!stavka || !stavka.trajna_greska) return false;
    return !!stavka.prazno_telo || (Number(stavka.status_greske) === 400 && String(stavka.trajna_greska).includes('uuid_klijenta'));
  }
  // Brojač je vezan za izdanje (polje auto_pokusaja_v2): zapisi koje je prethodno izdanje već iscrpelo dobijaju nove pokušaje.
  const MAKS_AUTO_POKUSAJA_PRAZNOG_TELA = 3;

  // --- Mali izveštaj posle neuspelog slanja (izdanje 2026-11-20.3) ---
  // Ide kao običan JSON bez priloga, pa ga greška pregledača sa praznim telom ne pogađa. Ne nosi tekst, GPS ni sadržaj zapisa:
  // samo verziju aplikacije, broj zapisa u redu, veličine priloga i ishod svakog koraka slanja. Server ga piše u audit.
  const izvestajPokusaji = [];
  let izvestajPoslatoPuta = 0;
  let izvestajPoslednjiMs = 0;
  const MAKS_IZVESTAJA_PO_OTVARANJU = 10;
  const RAZMAK_IZVESTAJA_MS = 15000;

  function zabeleziZaIzvestaj(dn) {
    izvestajPokusaji.push(dn);
    if (izvestajPokusaji.length > 12) izvestajPokusaji.splice(0, izvestajPokusaji.length - 12);
  }

  function opisGreskeSlanja(e) {
    return 'mreza:' + String((e && e.name) || 'Error') + ' ' + String((e && e.message) || '').slice(0, 70);
  }

  async function posaljiIzvestajSlanja() {
    if (izvestajPokusaji.length === 0) return;
    if (!STANJE.sesija || !STANJE.sesija.tajna) return;
    if (izvestajPoslatoPuta >= MAKS_IZVESTAJA_PO_OTVARANJU) { izvestajPokusaji.length = 0; return; }
    if (Date.now() - izvestajPoslednjiMs < RAZMAK_IZVESTAJA_MS) return;
    const pokusaji = izvestajPokusaji.splice(0, izvestajPokusaji.length);
    izvestajPoslatoPuta++;
    izvestajPoslednjiMs = Date.now();
    let samostalno = false;
    try { samostalno = !!navigator.standalone || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches); } catch {}
    const telo = {
      verzija_app: VERZIJA_APP,
      u_redu: (STANJE.lokalniRed || []).length,
      na_mrezi: navigator.onLine === false ? 'ne' : 'da',
      veza: String((navigator.connection && navigator.connection.effectiveType) || ''),
      samostalno: samostalno ? 'da' : 'ne',
      sw: navigator.serviceWorker && navigator.serviceWorker.controller ? 'da' : 'ne',
      vidljivo: String(document.visibilityState || ''),
      pokusaji
    };
    try {
      await apiPoziv('/api/izvestaj-slanja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telo)
      }, false);
    } catch {}
  }

  // Da li server baš sada odgovara na mali zahtev. Razdvaja „nema veze“ od „veza radi, a slanje zapisa pregledač prijavi kao grešku“.
  async function serverOdgovaraSada() {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tajmer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
    try {
      const r = await apiPoziv('/api/zdravlje', Object.assign({ method: 'GET', cache: 'no-store' }, ctrl ? { signal: ctrl.signal } : {}), false);
      return String(r.status);
    } catch (e) {
      return opisGreskeSlanja(e);
    } finally {
      if (tajmer) clearTimeout(tajmer);
    }
  }

  // Rok jednog slanja raste sa veličinom priloga: 60 s osnove i vreme za prenos pri sporoj vezi (64 KB/s), od 90 s do 20 min.
  // Fiksnih 90 s je prekidalo video od 58 MB pre kraja prenosa, a svaki novi pokušaj šalje ceo fajl iznova.
  function rokSlanjaMs(bajtova) {
    return Math.min(20 * 60000, Math.max(90000, 60000 + Math.ceil(bajtova / 64000) * 1000));
  }

  async function posaljiJedanIzReda(stavka) {
    const pril = stavka.prilozi || [];
    const bajtovi = [];
    const dn = {
      uuid_kraj: String(stavka.uuid_klijenta || '').slice(-8),
      priloga: pril.length,
      velicine: pril.map(p => (p && p.blob ? Number(p.blob.size) || 0 : -1)).join(','),
      tipovi: pril.map(tipPriloga).join(',')
    };
    let t0 = Date.now();
    try {
      for (let i = 0; i < pril.length; i++) {
        const ab = await procitajBajtovePriloga(pril[i].blob);
        bajtovi.push(ab);
        if (pril[i].blob && pril[i].blob.size > 0 && ab.byteLength === 0) throw new Error('prazan prilog');
      }
    } catch (e) {
      dn.procitano = bajtovi.map(b => b.byteLength).join(',');
      dn.citanje_ms = Date.now() - t0;
      dn.ishod = 'citanje:' + String((e && e.name) || 'Error') + ' ' + String((e && e.message) || '').slice(0, 20);
      zabeleziZaIzvestaj(dn);
      stavka.trajna_greska = STANJE.jezik === 'en'
        ? 'An attachment could not be read from phone storage. The entry stays on the phone; tap Retry.'
        : 'Prilog nije mogao da se pročita iz memorije telefona. Zapis ostaje u telefonu; dodirni „Probaj opet“.';
      stavka.status_greske = 0;
      await idbUpisiURed(stavka);
      return { ishod: 'trajna_greska', poruka: stavka.trajna_greska };
    }
    dn.procitano = bajtovi.map(b => b.byteLength).join(',');
    dn.citanje_ms = Date.now() - t0;

    const polja = poljaZapisaZaSlanje(stavka);
    const rokMs = rokSlanjaMs(bajtovi.reduce((zbir, b) => zbir + b.byteLength, 0));
    const upit = put => '/api/zapisi?v=' + encodeURIComponent(VERZIJA_APP) + '&put=' + put;
    const opisOdgovora = (odg, telo) => String(odg.status) + (telo && telo.kod_greske ? ' ' + telo.kod_greske : '');

    // Prvi put: FormData sa Blob-ovima iz memorije.
    let fd = new FormData();
    for (const [ime, vrednost] of polja) fd.append(ime, vrednost);
    for (let i = 0; i < pril.length; i++) {
      fd.append(`fajl_${i}`, new Blob([bajtovi[i]], { type: tipPriloga(pril[i]) }), pril[i].ime || `prilog-${i}`);
    }
    let r = null;
    let j = null;
    let greskaFd = null;
    t0 = Date.now();
    try {
      r = await apiPoziv(upit('fd'), { method: 'POST', body: fd, rokMs });
      try { j = await r.json(); } catch {}
      dn.fd = opisOdgovora(r, j);
    } catch (e) {
      greskaFd = e;
      dn.fd = opisGreskeSlanja(e);
    }
    dn.fd_ms = Date.now() - t0;
    fd = null;

    // Rezervni put (multipart sklopljen ručno kao niz bajtova, bez FormData i Blob-a) ide u dva slučaja:
    //  a) server je odgovorio da je telo stiglo prazno;
    //  b) pregledač je FormData slanje prijavio kao mrežnu grešku, a server u istom trenutku odgovara na mali zahtev.
    //     Kad veze stvarno nema, ili je istekao naš rok slanja, rezervni put se ne proba i zapis čeka sledeći krug kao i do sada.
    let putRucno = '';
    if (r && jeOdgovorPraznogTela(r.status, j)) {
      putRucno = 'rucno';
    } else if (greskaFd) {
      const istekaoRok = greskaFd.name === 'AbortError';
      dn.ping = istekaoRok ? 'rok' : await serverOdgovaraSada();
      if (dn.ping !== '200') {
        // Obična mreža bez veze: bez izveštaja (ne bi ni stigao), osim kad je istekao rok dok veza postoji.
        if (istekaoRok) { dn.ishod = 'rok'; zabeleziZaIzvestaj(dn); }
        throw greskaFd;
      }
      putRucno = 'rucno-m';
    }

    if (putRucno) {
      t0 = Date.now();
      r = null;
      j = null;
      try {
        const rucno = sklopiMultipartRucno(polja, pril, bajtovi);
        r = await apiPoziv(upit(putRucno), { method: 'POST', headers: { 'Content-Type': rucno.tip }, body: rucno.telo, rokMs });
        try { j = await r.json(); } catch {}
        dn.rucno = opisOdgovora(r, j);
        dn.rucno_ms = Date.now() - t0;
      } catch (e) {
        dn.rucno = opisGreskeSlanja(e);
        dn.rucno_ms = Date.now() - t0;
        dn.ishod = 'mreza';
        zabeleziZaIzvestaj(dn);
        throw e;
      }
    }

    if (r.status === 401) {
      sacuvajSesiju(null);
      return { ishod: 'auth_pala', poruka: (j && j.poruka) || 'Potrebna je ponovna QR prijava tima.' };
    }
    if (r.ok && j && j.ok) {
      await idbObrisiIzReda(stavka.uuid_klijenta);
      pripremljeniIzvoz.delete(stavka.uuid_klijenta);
      if (putRucno) { dn.ishod = 'poslato'; zabeleziZaIzvestaj(dn); }
      return { ishod: 'poslato' };
    }
    // Trajno odbijanje konkretne stavke (400/403/413/422): zabeleži grešku na toj stavci i NASTAVI slanje ostalih zapisa!
    if (r.status === 400 || r.status === 403 || r.status === 413 || r.status === 422) {
      stavka.trajna_greska = (j && j.poruka) || `Server je odbio zapis (${r.status}).`;
      stavka.status_greske = r.status;
      if (j && j.kod_greske === 'PRAZNO_TELO') stavka.prazno_telo = true;
      else delete stavka.prazno_telo;
      await idbUpisiURed(stavka);
      dn.ishod = 'odbijeno ' + r.status;
      zabeleziZaIzvestaj(dn);
      return { ishod: 'trajna_greska', poruka: stavka.trajna_greska };
    }
    // Prolazni kvar (408/429/5xx): zadrži u redu za automatsko ponovno slanje
    if (putRucno) { dn.ishod = 'prolazno ' + r.status; zabeleziZaIzvestaj(dn); }
    throw new Error((j && j.poruka) || 'Privremeni prekid veze.');
  }

  // --- Kopija neposlatog zapisa van aplikacije (deljenje ili preuzimanje), ako slanje na server ne uspeva ---
  const pripremljeniIzvoz = new Map();

  async function pripremiIzvozZapisa(st) {
    const pril = st.prilozi || [];
    const osnova = ('zapis-' + String(st.tim || 'tim') + '-' + String(st.vreme_telefona || '').replace(/[^0-9T]/g, '').slice(0, 13)).replace(/[^A-Za-z0-9-]/g, '');
    const mediji = [];
    let neprocitano = 0;
    for (let i = 0; i < pril.length; i++) {
      try {
        const ab = await procitajBajtovePriloga(pril[i].blob);
        if (!ab || ab.byteLength === 0) throw new Error('prazan prilog');
        const ime = osnova + '-' + (i + 1) + '-' + String(pril[i].ime || 'prilog').replace(/[^A-Za-z0-9._-]/g, '_').slice(-40);
        mediji.push(new File([ab], ime, { type: tipPriloga(pril[i]) }));
      } catch { neprocitano++; }
    }
    const tekst = [
      'Urbani žurnal · neposlat zapis',
      'Tim: ' + (st.tim || ''),
      'Autor: ' + (st.nadimak || st.oznaka_uredjaja || ''),
      'Vreme telefona: ' + (st.vreme_telefona || ''),
      'GPS: ' + st.lat + ', ' + st.lon + ' (±' + Math.round(Number(st.tacnost_m) || 0) + ' m)',
      'Nedelja: ' + (st.nedelja || 1),
      'Kategorije: ' + (st.kategorije || []).join(', '),
      'Priloga: ' + pril.length + (neprocitano ? ' (nepročitano: ' + neprocitano + ')' : ''),
      'ID zapisa: ' + st.uuid_klijenta,
      '',
      st.tekst || ''
    ].join('\n');
    const opis = new File([tekst], osnova + '.txt', { type: 'text/plain' });
    return { naslov: osnova, tekst, mediji, opis, neprocitano };
  }

  async function sacuvajKopijuZapisa(uuid) {
    const st = (STANJE.lokalniRed || []).find(x => x.uuid_klijenta === uuid);
    if (!st) return;
    const en = STANJE.jezik === 'en';
    let paket = pripremljeniIzvoz.get(uuid);
    try {
      if (!paket) {
        toast(en ? 'Preparing a copy…' : 'Pripremam kopiju zapisa…');
        paket = await pripremiIzvozZapisa(st);
        pripremljeniIzvoz.set(uuid, paket);
      }
    } catch {
      toast(en ? 'The copy could not be prepared.' : 'Kopija nije mogla da se pripremi.');
      return;
    }
    if (typeof navigator.share === 'function') {
      const moze = d => { try { return typeof navigator.canShare === 'function' ? navigator.canShare(d) : !d.files; } catch { return false; } };
      let podaci = null;
      const sve = paket.mediji.concat([paket.opis]);
      if (moze({ files: sve })) podaci = { files: sve, title: paket.naslov };
      else if (paket.mediji.length && moze({ files: paket.mediji })) podaci = { files: paket.mediji, title: paket.naslov, text: paket.tekst };
      else if (!paket.mediji.length) podaci = { title: paket.naslov, text: paket.tekst };
      if (podaci) {
        try {
          await navigator.share(podaci);
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          if (e && e.name === 'NotAllowedError') {
            // Pregledač traži svež dodir: kopija je već pripremljena, drugi dodir deli odmah.
            toast(en ? 'The copy is ready. Tap “Save a copy” once more.' : 'Kopija je spremna. Dodirni „Sačuvaj kopiju“ još jednom.');
            return;
          }
        }
      }
    }
    // Bez deljenja (desktop, stariji pregledač): preuzimanje fajlova.
    for (const fajl of paket.mediji.concat([paket.opis])) {
      const url = URL.createObjectURL(fajl);
      const a = document.createElement('a');
      a.href = url;
      a.download = fajl.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      await new Promise(res => setTimeout(res, 350));
    }
    toast(en ? 'A copy was downloaded.' : 'Kopija zapisa je preuzeta.');
  }

  // --- Slanje reda iz telefona: dve nezavisne trake ---
  // Zapis sa velikim prilogom (video) može da se šalje minutima. Zato ide svojom trakom, a mali zapisi (tekst, fotografije, zvuk)
  // svojom, da ne čekaju iza njega. Unutar trake zapisi idu redom po vremenu nastanka; prekid mreže zaustavlja samo tu traku,
  // do sledećeg kruga osvežavanja.
  const PRAG_VELIKOG_ZAPISA = 8 * 1024 * 1024;

  function bajtovaPriloga(st) {
    return ((st && st.prilozi) || []).reduce((zbir, p) => zbir + (p && p.blob ? Number(p.blob.size) || 0 : 0), 0);
  }
  function jeVelikiZapis(st) {
    return bajtovaPriloga(st) >= PRAG_VELIKOG_ZAPISA;
  }

  let aktivnihTraka = 0;

  // Traka vraća funkciju slanja. Poziv dok je krug u toku ne otvara drugi krug: traži još jedan prolaz i vraća isto obećanje.
  // Obećanje daje true kad traku nije prekinula mreža ni istekla prijava.
  function napraviTrakuSlanja(pripadaTraci) {
    let aktivanKrug = null;
    let traziDodatniKrug = false;

    return function posaljiTraku(ukljuciOdbijene = false) {
      if (aktivanKrug) {
        traziDodatniKrug = true;
        return aktivanKrug;
      }
      aktivanKrug = (async () => {
        aktivnihTraka++;
        STANJE.sinhronizacijaUToku = true;
        let mrezniPrekid = false;
        let poslatoBarJedno = false;
        try {
          do {
            traziDodatniKrug = false;
            STANJE.lokalniRed = await idbSviIzReda();
            osveziStatusTraku();
            if (!STANJE.sesija || !STANJE.sesija.tajna) break;
            const zaSlanje = STANJE.lokalniRed
              .filter(pripadaTraci)
              .sort((x, y) => String(x.vreme_telefona).localeCompare(String(y.vreme_telefona)));
            for (const st of zaSlanje) {
              // Zapisi odbijeni zbog praznog tela šalju se sami ponovo (najviše nekoliko puta), bez dodira studenta.
              const autoOpet = !ukljuciOdbijene && jeGreskaPraznogTela(st)
                && (Number(st.auto_pokusaja_v2) || 0) < MAKS_AUTO_POKUSAJA_PRAZNOG_TELA;
              if (st.trajna_greska && !ukljuciOdbijene && !autoOpet) continue;
              if (st.trajna_greska) {
                if (autoOpet) st.auto_pokusaja_v2 = (Number(st.auto_pokusaja_v2) || 0) + 1;
                delete st.trajna_greska;
                delete st.status_greske;
                delete st.prazno_telo;
              }
              try {
                const rez = await posaljiJedanIzReda(st);
                if (rez.ishod === 'poslato') {
                  poslatoBarJedno = true;
                } else if (rez.ishod === 'auth_pala') {
                  mrezniPrekid = true;
                  traziDodatniKrug = false;
                  toast(rez.poruka);
                  break;
                }
              } catch {
                mrezniPrekid = true;
                traziDodatniKrug = false;
                break;
              }
            }
            ukljuciOdbijene = false;
          } while (traziDodatniKrug && !mrezniPrekid);

          STANJE.lokalniRed = await idbSviIzReda();
          osveziStatusTraku();
          posaljiIzvestajSlanja().catch(() => {});
          if (!mrezniPrekid || poslatoBarJedno) {
            await ucitajStanjeSaServera(false);
          } else {
            crtajPodatke(true);
          }
        } finally {
          aktivnihTraka--;
          STANJE.sinhronizacijaUToku = aktivnihTraka > 0;
          aktivanKrug = null;
        }
        return !mrezniPrekid;
      })();
      return aktivanKrug;
    };
  }

  const posaljiMaleZapise = napraviTrakuSlanja(st => !jeVelikiZapis(st));
  const posaljiVelikeZapise = napraviTrakuSlanja(jeVelikiZapis);

  // Pokreće obe trake. Čeka samo male zapise; veliki nastavljaju u pozadini.
  // Vraća true kad je red u telefonu prazan (sve poslato).
  async function sinhronizujRed(ukljuciOdbijene = false) {
    posaljiVelikeZapise(ukljuciOdbijene).catch(() => {});
    const maliProsli = await posaljiMaleZapise(ukljuciOdbijene);
    return maliProsli && STANJE.lokalniRed.length === 0;
  }

  async function ukloniIzLokalnogReda(uuid) {
    if (!uuid) return;
    const pit = STANJE.jezik === 'en'
      ? 'This entry exists only on this phone and has not been sent. Delete it for good?'
      : 'Ovaj zapis postoji samo u ovom telefonu i još nije poslat. Obrisati ga zauvek?';
    if (!window.confirm(pit)) return;
    await idbObrisiIzReda(uuid);
    pripremljeniIzvoz.delete(uuid);
    STANJE.lokalniRed = await idbSviIzReda();
    osveziStatusTraku();
    zatvoriSvePanele();
    crtajPodatke(true);
    toast(STANJE.jezik === 'en' ? 'Removed from phone queue.' : 'Zapis je uklonjen iz reda slanja.');
  }

  function jeMojServerZapis(z) {
    if (!z || z.uTelefonu || !STANJE.sesija || !STANJE.sesija.uredjaj_id) return false;
    return Number(z.uredjaj_id) === Number(STANJE.sesija.uredjaj_id);
  }

  async function obrisiSopstveniZapis(zapisId) {
    const pit = STANJE.jezik === 'en' ? 'Delete your entry from the shared map?' : 'Obrisati ovaj tvoj zapis sa zajedničke mape?';
    if (!window.confirm(pit)) return;
    try {
      const r = await apiPoziv('/api/zapisi/' + encodeURIComponent(zapisId), { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast((j && j.poruka) || 'Brisanje nije uspelo.');
        return;
      }
      zatvoriSvePanele();
      await ucitajStanjeSaServera(false);
      toast(STANJE.jezik === 'en' ? 'Entry deleted.' : 'Tvoj zapis je obrisan.');
    } catch {
      toast('Server trenutno nije dostupan — pokušaj ponovo.');
    }
  }

  async function sacuvajIzmenuSopstvenogZapisa(zapisId, noviTekst) {
    try {
      const r = await apiPoziv('/api/zapisi/' + encodeURIComponent(zapisId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tekst: noviTekst })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast((j && j.poruka) || 'Izmena nije uspela.');
        return false;
      }
      await ucitajStanjeSaServera(false);
      toast(STANJE.jezik === 'en' ? 'Entry updated.' : 'Zapis je ažuriran.');
      return true;
    } catch {
      toast('Server trenutno nije dostupan — pokušaj ponovo.');
      return false;
    }
  }

  // --- Učitavanje javnog stanja mape i dnevnika (ETag kratki spoj + zaštita od zastarelih paralelnih odgovora) ---
  let stanjeZahtevGen = 0;
  let poslednjiPrimenjenGen = 0;

  async function ucitajStanjeSaServera(koristiEtag = true) {
    if (STANJE.ucitavanjeStanjaUToku && koristiEtag) return;
    STANJE.ucitavanjeStanjaUToku = true;
    const mojGen = ++stanjeZahtevGen;
    try {
      const qs = koristiEtag && STANJE.poslednjiEtag && STANJE.serverZapisi.length >= 0
        ? '?v=' + encodeURIComponent(STANJE.poslednjiEtag)
        : '';
      const r = await apiPoziv('/api/stanje' + qs, { method: 'GET' });
      if (r.status === 304) return;
      if (!r.ok || mojGen < poslednjiPrimenjenGen) return;
      const j = await r.json();
      if (!j || !j.ok || mojGen < poslednjiPrimenjenGen) return;
      if (j.neizmenjeno) {
        if (j.etag) STANJE.poslednjiEtag = j.etag;
        return;
      }
      poslednjiPrimenjenGen = mojGen;
      STANJE.poslednjiEtag = j.etag || r.headers.get('etag') || '';
      STANJE.aktivnaNedelja = j.aktivna_nedelja || 1;
      STANJE.serverZapisi = Array.isArray(j.zapisi) ? j.zapisi : [];
      STANJE.serverStatistika = j.statistika || { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} };
      await idbSacuvajKes('poslednje_stanje', {
        aktivnaNedelja: STANJE.aktivnaNedelja,
        zapisi: STANJE.serverZapisi,
        statistika: STANJE.serverStatistika
      });
      crtajPodatke(false);
    } catch {
      // U offline režimu prikaži poslednje keširano stanje
      if (STANJE.serverZapisi.length === 0) {
        const kes = await idbProcitajKes('poslednje_stanje');
        if (kes) {
          STANJE.aktivnaNedelja = kes.aktivnaNedelja || 1;
          STANJE.serverZapisi = kes.zapisi || [];
          STANJE.serverStatistika = kes.statistika || STANJE.serverStatistika;
          crtajPodatke(false);
        }
      }
    } finally {
      STANJE.ucitavanjeStanjaUToku = false;
    }
  }

  function sviVidljiviZapisi() {
    const serverUuidSkup = new Set();
    for (const sz of STANJE.serverZapisi) {
      if (sz && sz.uuid_klijenta) serverUuidSkup.add(sz.uuid_klijenta);
    }
    const lokalni = STANJE.lokalniRed
      .filter(q => !q.uuid_klijenta || !serverUuidSkup.has(q.uuid_klijenta))
      .map(q => ({
        id: 'local-' + q.uuid_klijenta,
        uuid_klijenta: q.uuid_klijenta,
        uTelefonu: true,
        trajna_greska: q.trajna_greska || '',
        tim: q.tim,
        autor: q.nadimak || q.oznaka_uredjaja || 'član tima',
        nedelja: q.nedelja,
        kategorije: q.kategorije || [],
        lat: q.lat,
        lon: q.lon,
        tacnost_m: q.tacnost_m,
        radijus_m: q.radijus_m,
        vreme: q.vreme_telefona,
        tekst: q.tekst,
        prilozi: (q.prilozi || []).map(p => ({
          vrsta: p.vrsta,
          mime: p.mime,
          lokalniBlob: p.blob
        }))
      }));
    const spojeno = [...lokalni, ...STANJE.serverZapisi].sort((a, b) =>
      String(b.vreme || '').localeCompare(String(a.vreme || ''))
    );
    if (STANJE.filter === 'tim' && STANJE.sesija && STANJE.sesija.tim) {
      return spojeno.filter(z => z.tim === STANJE.sesija.tim);
    }
    return spojeno;
  }

  function punUrlMedija(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
    return (STANJE.apiBaza || '') + url;
  }

  // --- Prikaz u listi Dnevnika i ažuriranje 3D mape ---
  let aktivniBlobUrlovi = [];
  function oslobodiAktivneBlobUrlove() {
    for (const u of aktivniBlobUrlovi) URL.revokeObjectURL(u);
    aktivniBlobUrlovi = [];
  }

  function formatVreme(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(STANJE.jezik === 'en' ? 'en-GB' : 'sr-RS', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function htmlPriloziZapisa(prilozi, uDetalju = false) {
    if (!prilozi || !prilozi.length) return '';
    const slike = [];
    const av = [];
    const preloadMod = uDetalju ? 'metadata' : 'none';
    for (const p of prilozi) {
      let src = '';
      if (p.lokalniBlob) {
        src = URL.createObjectURL(p.lokalniBlob);
        aktivniBlobUrlovi.push(src);
      } else {
        src = punUrlMedija(p.url);
      }
      if (!src) continue;
      if (p.vrsta === 'foto') {
        slike.push(`<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" loading="lazy" decoding="async" alt="Fotografija sa terena"></a>`);
      } else if (p.vrsta === 'zvuk') {
        av.push(`<audio controls preload="${preloadMod}" src="${esc(src)}"></audio>`);
      } else if (p.vrsta === 'video') {
        if (p.obrada_status === 'obrada') {
          av.push(`<div class="video-proc-note">${esc(t('videoObrada'))}</div>`);
        }
        av.push(`<video controls playsinline preload="${preloadMod}" src="${esc(src)}"></video>`);
      }
    }
    return `
      ${slike.length ? `<div class="entry-media-grid">${slike.join('')}</div>` : ''}
      ${av.length ? `<div class="entry-media-full">${av.join('')}</div>` : ''}
    `;
  }

  let poslednjiPotpisPrikaza = '';

  function napraviPotpisPrikaza(zapisi, m2) {
    const limit = Math.min(zapisi.length, STANJE.dnevnikPrikazano);
    const delovi = [`${STANJE.jezik}|${STANJE.filter}|${STANJE.apiBaza || ''}|${m2}|${zapisi.length}|${limit}`];
    for (let i = 0; i < limit; i++) {
      const z = zapisi[i];
      const pr = (z.prilozi || []).map(p => `${p.id || 'L'}:${p.vrsta}:${p.obrada_status || ''}:${p.url || ''}`).join(',');
      const kat = (z.kategorije || []).join(',');
      delovi.push(`${z.id}|${z.uuid_klijenta || ''}|${z.uTelefonu ? 1 : 0}|${z.trajna_greska || ''}|${z.tim}|${z.autor}|${z.vreme}|${kat}|${z.tekst || ''}|${pr}`);
    }
    return delovi.join('~');
  }

  function aktivnaReprodukcijaUDnevniku(feed) {
    if (!feed) return null;
    const mediji = feed.querySelectorAll('audio, video');
    for (const m of mediji) {
      if (!m.paused && !m.ended) return m;
    }
    return null;
  }

  function crtajPodatke(prisilno = false) {
    const zapisi = sviVidljiviZapisi();
    document.getElementById('count-entries').textContent = String(zapisi.length);

    // Metrika otkrivenosti (m²)
    let m2 = STANJE.serverStatistika.otkriveno_m2_ukupno || 0;
    if (STANJE.filter === 'tim' && STANJE.sesija && STANJE.sesija.tim) {
      const stTim = (STANJE.serverStatistika.po_timu || {})[STANJE.sesija.tim];
      m2 = stTim ? stTim.otkriveno_m2 : 0;
    }
    document.getElementById('metric-m2').textContent = `${m2.toLocaleString('sr-RS')} m²`;

    // Uvek osveži slojeve 3D mape (brzo i bez prekidanja DOM elemenata)
    azurirajSlojeveMape(zapisi);

    // Dok je student na 3D mapi, ne pregrađuj skriveni DOM dnevnika (sprečava nepotrebno povlačenje slika pri stotinama unosa!)
    if (STANJE.pogled === 'mapa' && !prisilno) {
      STANJE.dnevnikPrljav = true;
      return;
    }

    const noviPotpis = napraviPotpisPrikaza(zapisi, m2);
    if (!prisilno && !STANJE.dnevnikPrljav && noviPotpis === poslednjiPotpisPrikaza) {
      return;
    }

    // Ne prekidaj aktivno slušanje zvuka ili gledanje videa u Dnevniku pri pozadinskom osvežavanju
    const feed = document.getElementById('journal-feed');
    const aktivniMedij = !prisilno ? aktivnaReprodukcijaUDnevniku(feed) : null;
    if (aktivniMedij) {
      if (!aktivniMedij._cekaOsvezavanje) {
        aktivniMedij._cekaOsvezavanje = true;
        const odlozeno = () => {
          aktivniMedij._cekaOsvezavanje = false;
          crtajPodatke(true);
        };
        aktivniMedij.addEventListener('pause', odlozeno, { once: true });
        aktivniMedij.addEventListener('ended', odlozeno, { once: true });
      }
      return;
    }

    STANJE.dnevnikPrljav = false;
    poslednjiPotpisPrikaza = noviPotpis;
    if (document.getElementById('modal-detail').hidden) {
      oslobodiAktivneBlobUrlove();
    }

    // Hronološki feed u Dnevniku (straničeno po 30 zapisa radi trenutnog odziva bez zagušenja mreže)
    if (zapisi.length === 0) {
      feed.innerHTML = `<div class="entry-card"><p class="entry-text" style="color:var(--ink-soft)">${esc(t('nemaZapisa'))}</p></div>`;
    } else {
      const zaPrikaz = zapisi.slice(0, STANJE.dnevnikPrikazano);
      const preostalo = Math.max(0, zapisi.length - zaPrikaz.length);
      const karticeHtml = zaPrikaz.map((z, idx) => {
        const tagHtml = (z.kategorije || []).length
          ? `<div class="tag-row">${z.kategorije.map(k => `<span class="tag-pill">${esc(k)}</span>`).join('')}</div>`
          : '';
        const qBadge = z.uTelefonu
          ? (z.trajna_greska
              ? `<div class="alert-box err" style="padding:6px 10px;font-size:12px">${esc(z.trajna_greska)}</div>`
              : `<div class="alert-box warn" style="padding:5px 9px;font-size:11.5px">${esc(t('uTelefonuOznaka'))}</div>`)
          : '';
        const akcijeReda = z.uTelefonu
          ? `${z.trajna_greska ? `<button type="button" class="link-btn" data-retry-uuid="${esc(z.uuid_klijenta)}">${esc(t('probajOpet'))}</button>
             <button type="button" class="link-btn" data-copy-uuid="${esc(z.uuid_klijenta)}">${esc(t('sacuvajKopiju'))}</button>` : ''}
             <button type="button" class="link-btn danger" data-drop-uuid="${esc(z.uuid_klijenta)}">${esc(t('otkaziRed'))}</button>`
          : (jeMojServerZapis(z)
              ? `<button type="button" class="link-btn" data-edit-id="${esc(z.id)}">${esc(t('urediMoj'))}</button>
                 <button type="button" class="link-btn danger" data-del-id="${esc(z.id)}">${esc(t('obrisiMoj'))}</button>`
              : '');
        return `
          <article class="entry-card ${z.uTelefonu ? 'queued' : ''}" data-card-id="${esc(z.id)}">
            <div class="entry-head">
              <div>
                <span class="entry-team-badge">${esc(z.tim)}</span>
                <span class="entry-author">${esc(z.autor)}</span>
              </div>
              <time class="entry-time">${esc(formatVreme(z.vreme))}</time>
            </div>
            ${qBadge}
            ${tagHtml}
            ${z.tekst ? `<p class="entry-text">${esc(z.tekst)}</p>` : ''}
            <div class="inline-edit-holder" data-edit-holder="${esc(z.id)}" hidden></div>
            ${htmlPriloziZapisa(z.prilozi, false)}
            <div class="entry-foot">
              <span>±${Math.round(z.tacnost_m || 12)} m · R=${Math.round(z.radijus_m || 12)} m</span>
              <div class="entry-foot-actions">
                ${akcijeReda}
                <button type="button" class="link-btn" data-goto-idx="${idx}">${esc(t('prikaziNaMapi'))}</button>
              </div>
            </div>
          </article>
        `;
      }).join('');

      const viseHtml = preostalo > 0
        ? `<button type="button" class="load-more-btn" id="btn-load-more">${esc(t('josZapisa', preostalo))}</button>`
        : '';

      feed.innerHTML = karticeHtml + viseHtml;

      feed.querySelectorAll('[data-goto-idx]').forEach(btn => {
        btn.onclick = () => {
          const z = zapisi[Number(btn.getAttribute('data-goto-idx'))];
          if (!z) return;
          postaviPogled('mapa');
          if (STANJE.mapa && STANJE.mapaSpremna) {
            STANJE.mapa.flyTo({ center: [z.lon, z.lat], zoom: 18, duration: 750 });
          }
        };
      });

      feed.querySelectorAll('[data-drop-uuid]').forEach(btn => {
        btn.onclick = () => ukloniIzLokalnogReda(btn.getAttribute('data-drop-uuid'));
      });
      feed.querySelectorAll('[data-copy-uuid]').forEach(btn => {
        btn.onclick = () => sacuvajKopijuZapisa(btn.getAttribute('data-copy-uuid'));
      });
      feed.querySelectorAll('[data-retry-uuid]').forEach(btn => {
        btn.onclick = () => sinhronizujRed(true);
      });
      feed.querySelectorAll('[data-del-id]').forEach(btn => {
        btn.onclick = () => obrisiSopstveniZapis(Number(btn.getAttribute('data-del-id')));
      });
      feed.querySelectorAll('[data-edit-id]').forEach(btn => {
        btn.onclick = () => {
          const zid = Number(btn.getAttribute('data-edit-id'));
          const z = zapisi.find(x => Number(x.id) === zid);
          const holder = feed.querySelector(`[data-edit-holder="${CSS.escape(String(zid))}"]`);
          if (!z || !holder) return;
          if (!holder.hidden) { holder.hidden = true; holder.innerHTML = ''; return; }
          holder.hidden = false;
          holder.innerHTML = `
            <div class="inline-edit-box">
              <textarea class="textarea" rows="3" maxlength="2000">${esc(z.tekst || '')}</textarea>
              <div style="display:flex;gap:6px;justify-content:flex-end">
                <button type="button" class="btn-secondary" data-cancel-ed style="padding:6px 12px;min-height:34px">Otkaži</button>
                <button type="button" class="btn-primary" data-save-ed style="width:auto;padding:6px 14px;min-height:34px">Sačuvaj</button>
              </div>
            </div>
          `;
          holder.querySelector('[data-cancel-ed]').onclick = () => { holder.hidden = true; holder.innerHTML = ''; };
          holder.querySelector('[data-save-ed]').onclick = async () => {
            const val = holder.querySelector('textarea').value.trim();
            await sacuvajIzmenuSopstvenogZapisa(zid, val);
          };
        };
      });

      const btnMore = document.getElementById('btn-load-more');
      if (btnMore) {
        btnMore.onclick = () => {
          STANJE.dnevnikPrikazano += 30;
          crtajPodatke(true);
        };
      }
    }
  }

  // --- 3D Mapa Beograda (MapLibre GL + OpenFreeMap + klasterisanje + metrički krugovi iskustva) ---
  function napraviPoligonKruga(lon, lat, radijusM, tacaka = 32) {
    const koordinate = [];
    const dLat = radijusM / 111132;
    const dLon = radijusM / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= tacaka; i++) {
      const ugao = (i / tacaka) * 2 * Math.PI;
      koordinate.push([lon + dLon * Math.cos(ugao), lat + dLat * Math.sin(ugao)]);
    }
    return [koordinate];
  }

  function otvoriDetaljZapisa(ulaz, aktivniIndeks = 0) {
    const lista = Array.isArray(ulaz) ? ulaz.filter(Boolean) : (ulaz ? [ulaz] : []);
    if (!lista.length) return;
    const i = Math.max(0, Math.min(lista.length - 1, Number(aktivniIndeks) || 0));
    const z = lista[i];

    document.getElementById('detail-title').textContent = lista.length > 1
      ? `${z.tim} · ${z.autor} (${i + 1}/${lista.length})`
      : `${z.tim} · ${z.autor}`;

    const prekidacHtml = lista.length > 1
      ? `<div class="detail-switcher">${lista.map((st, k) =>
          `<button type="button" class="detail-switch-btn ${k === i ? 'active' : ''}" data-det-idx="${k}">${k + 1}. ${esc(st.tim)} · ${esc(st.autor)}</button>`
        ).join('')}</div>`
      : '';

    const tagHtml = (z.kategorije || []).length
      ? `<div class="tag-row">${z.kategorije.map(k => `<span class="tag-pill">${esc(k)}</span>`).join('')}</div>`
      : '';
    const sopstveneAkcijeHtml = z.uTelefonu
      ? `<div style="display:flex;gap:8px;justify-content:flex-end;padding-top:6px">
           ${z.trajna_greska ? `<button type="button" class="link-btn" id="det-retry-q">${esc(t('probajOpet'))}</button>
           <button type="button" class="link-btn" id="det-copy-q">${esc(t('sacuvajKopiju'))}</button>` : ''}
           <button type="button" class="link-btn danger" id="det-drop-q">${esc(t('otkaziRed'))}</button>
         </div>`
      : (jeMojServerZapis(z)
          ? `<div style="display:flex;gap:10px;justify-content:flex-end;padding-top:6px">
               <button type="button" class="link-btn danger" id="det-del-own">${esc(t('obrisiMoj'))}</button>
             </div>`
          : '');
    const teloEl = document.getElementById('detail-body');
    teloEl.innerHTML = `
      ${prekidacHtml}
      <div class="meta-strip">
        <span>${esc(formatVreme(z.vreme))}</span> ·
        <span>GPS ${Number(z.lat).toFixed(5)}, ${Number(z.lon).toFixed(5)} (±${Math.round(z.tacnost_m || 12)} m)</span>
      </div>
      ${z.uTelefonu ? `<div class="alert-box ${z.trajna_greska ? 'err' : 'warn'}">${esc(z.trajna_greska || t('uTelefonuOznaka'))}</div>` : ''}
      ${tagHtml}
      ${z.tekst ? `<p class="entry-text">${esc(z.tekst)}</p>` : ''}
      ${htmlPriloziZapisa(z.prilozi, true)}
      ${sopstveneAkcijeHtml}
    `;
    teloEl.querySelectorAll('[data-det-idx]').forEach(btn => {
      btn.onclick = () => otvoriDetaljZapisa(lista, Number(btn.getAttribute('data-det-idx')));
    });
    const btnDropQ = document.getElementById('det-drop-q');
    if (btnDropQ) btnDropQ.onclick = () => ukloniIzLokalnogReda(z.uuid_klijenta);
    const btnCopyQ = document.getElementById('det-copy-q');
    if (btnCopyQ) btnCopyQ.onclick = () => sacuvajKopijuZapisa(z.uuid_klijenta);
    const btnRetryQ = document.getElementById('det-retry-q');
    if (btnRetryQ) btnRetryQ.onclick = () => { zatvoriSvePanele(); sinhronizujRed(true); };
    const btnDelOwn = document.getElementById('det-del-own');
    if (btnDelOwn) btnDelOwn.onclick = () => obrisiSopstveniZapis(Number(z.id));
    otvoriPanel('modal-detail');
  }

  function nadjiFontStila(mapa) {
    try {
      const st = mapa.getStyle();
      const slojevi = (st && st.layers) || [];
      for (const sl of slojevi) {
        const tf = sl.layout && sl.layout['text-font'];
        if (Array.isArray(tf) && tf.length && typeof tf[0] === 'string') {
          return tf;
        }
      }
    } catch {}
    return ['Noto Sans Regular'];
  }

  function azurirajSlojeveMape(zapisi) {
    if (!STANJE.mapa || !STANJE.mapaSpremna) return;
    const mojTim = STANJE.sesija ? STANJE.sesija.tim : '';

    // Grupiši zapise koji padaju u istu mikro-ćeliju (~3 m) kako se pinovi na uličnom zumu ne bi preklapali
    const grupeBliskih = new Map();
    zapisi.forEach((z, idx) => {
      const lat = Number(z.lat);
      const lon = Number(z.lon);
      const kljuc = `${Math.round(lat * 37000)}:${Math.round(lon * 26000)}`;
      let g = grupeBliskih.get(kljuc);
      if (!g) {
        g = [];
        grupeBliskih.set(kljuc, g);
      }
      g.push(idx);
    });

    const pomereneTacke = new Map();
    for (const indeksi of grupeBliskih.values()) {
      if (indeksi.length <= 1) continue;
      const br = indeksi.length;
      indeksi.forEach((zIdx, poz) => {
        const z = zapisi[zIdx];
        const lat = Number(z.lat);
        const lon = Number(z.lon);
        const prsten = Math.floor(poz / 6);
        const uPrstenu = Math.min(6, br - prsten * 6);
        const ugao = ((poz % 6) / uPrstenu) * 2 * Math.PI;
        const rMetara = 3.2 + prsten * 2.2;
        const dLat = (rMetara * Math.sin(ugao)) / 111132;
        const dLon = (rMetara * Math.cos(ugao)) / (111320 * Math.cos((lat * Math.PI) / 180));
        pomereneTacke.set(zIdx, [lon + dLon, lat + dLat]);
      });
    }

    const krugoviFeatures = zapisi.map((z, idx) => ({
      type: 'Feature',
      properties: {
        idx,
        moj: z.tim === mojTim ? 1 : 0,
        uTelefonu: z.uTelefonu ? 1 : 0
      },
      geometry: {
        type: 'Polygon',
        coordinates: napraviPoligonKruga(Number(z.lon), Number(z.lat), Number(z.radijus_m) || 12)
      }
    }));

    const tackeFeatures = zapisi.map((z, idx) => ({
      type: 'Feature',
      properties: {
        idx,
        oznaka: `${z.tim} · ${z.autor}`,
        moj: z.tim === mojTim ? 1 : 0,
        uTelefonu: z.uTelefonu ? 1 : 0
      },
      geometry: {
        type: 'Point',
        coordinates: pomereneTacke.get(idx) || [Number(z.lon), Number(z.lat)]
      }
    }));

    STANJE._poslednjiZapisiMape = zapisi;
    const srcK = STANJE.mapa.getSource('uz-krugovi');
    const srcT = STANJE.mapa.getSource('uz-tacke');
    if (srcK) srcK.setData({ type: 'FeatureCollection', features: krugoviFeatures });
    if (srcT) srcT.setData({ type: 'FeatureCollection', features: tackeFeatures });
  }

  function azurirajPlavuTackuNaMapi() {
    if (!STANJE.mapa || !STANJE.mapaSpremna || !STANJE.gps) return;
    if (!STANJE.korisnikMarker) {
      const el = document.createElement('div');
      el.className = 'user-gps-dot';
      STANJE.korisnikMarker = new window.maplibregl.Marker({ element: el })
        .setLngLat([STANJE.gps.lon, STANJE.gps.lat])
        .addTo(STANJE.mapa);
    } else {
      STANJE.korisnikMarker.setLngLat([STANJE.gps.lon, STANJE.gps.lat]);
    }
  }

  function napraviRezervniRasterStil() {
    return {
      version: 8,
      sources: {
        'uz-osm-raster': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap'
        }
      },
      layers: [
        { id: 'uz-bg-papir', type: 'background', paint: { 'background-color': '#ebe5d6' } },
        { id: 'uz-raster-ulice', type: 'raster', source: 'uz-osm-raster', minzoom: 0, maxzoom: 20 }
      ]
    };
  }

  function napraviOfflineLokalniStil() {
    return {
      version: 8,
      sources: {},
      layers: [
        { id: 'uz-offline-bg', type: 'background', paint: { 'background-color': '#ebe5d6' } }
      ]
    };
  }

  function montirajUzSlojeveNaMapu(mapa) {
    if (!mapa || mapa.getSource('uz-tacke')) return;
    STANJE.mapaSpremna = true;
    window.__uzMapaSpremna = true;
    if (window.innerWidth <= 640) {
      const att = document.querySelector('#map .maplibregl-ctrl-attrib');
      if (att) {
        att.classList.remove('maplibregl-compact-show');
        att.removeAttribute('open');
      }
    }
    const stObj = mapa.getStyle() || {};
    const imaGlyphs = Boolean(stObj.glyphs);
    const fontStila = nadjiFontStila(mapa);

    mapa.addSource('uz-krugovi', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    mapa.addSource('uz-tacke', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 15,
      clusterRadius: 38,
      clusterProperties: {
        moj_zbir: ['+', ['get', 'moj']],
        lokal_zbir: ['+', ['get', 'uTelefonu']]
      }
    });

    mapa.addLayer({
      id: 'uz-krugovi-ispuna',
      type: 'fill',
      source: 'uz-krugovi',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'uTelefonu'], 1], '#d97706',
          ['==', ['get', 'moj'], 1], '#b8861b',
          '#176646'
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.05, 14.5, 0.13, 17, 0.22]
      }
    });

    mapa.addLayer({
      id: 'uz-krugovi-ivica',
      type: 'line',
      source: 'uz-krugovi',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'uTelefonu'], 1], '#b45309',
          ['==', ['get', 'moj'], 1], '#8a6d1f',
          '#115037'
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16.5, 1.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.22, 14.5, 0.45, 17, 0.72]
      }
    });

    mapa.addLayer({
      id: 'uz-klasteri-krug',
      type: 'circle',
      source: 'uz-tacke',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 18, 40, 22],
        'circle-color': [
          'case',
          ['>', ['get', 'lokal_zbir'], 0], '#d97706',
          ['>', ['get', 'moj_zbir'], 0], '#8a6d1f',
          '#176646'
        ],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff'
      }
    });

    if (imaGlyphs) {
      mapa.addLayer({
        id: 'uz-klasteri-broj',
        type: 'symbol',
        source: 'uz-tacke',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': fontStila,
          'text-size': 12,
          'text-allow-overlap': true
        },
        paint: { 'text-color': '#ffffff' }
      });
    }

    mapa.addLayer({
      id: 'uz-tacke-krug',
      type: 'circle',
      source: 'uz-tacke',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5.5, 16, 8, 19, 10],
        'circle-color': [
          'case',
          ['==', ['get', 'uTelefonu'], 1], '#d97706',
          ['==', ['get', 'moj'], 1], '#8a6d1f',
          '#176646'
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    if (imaGlyphs) {
      mapa.addLayer({
        id: 'uz-tacke-oznaka',
        type: 'symbol',
        source: 'uz-tacke',
        minzoom: 17.2,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', 'oznaka'],
          'text-font': fontStila,
          'text-size': 11,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.95,
          'text-optional': true
        },
        paint: {
          'text-color': '#1f1d18',
          'text-halo-color': 'rgba(252, 251, 247, 0.94)',
          'text-halo-width': 1.6
        }
      });
    }

    if (!mapa._uzKlikPovezan) {
      mapa._uzKlikPovezan = true;
      mapa.on('click', 'uz-klasteri-krug', e => {
        if (!e.features || !e.features.length) return;
        const f = e.features[0];
        const cid = f.properties && f.properties.cluster_id;
        const koordinate = f.geometry && f.geometry.coordinates ? f.geometry.coordinates.slice() : null;
        const src = mapa.getSource('uz-tacke');
        if (!src || cid == null || !koordinate) return;
        const zumirajNa = z => {
          mapa.easeTo({
            center: koordinate,
            zoom: Math.min(Math.max(Number(z) || 16.2, mapa.getZoom() + 1.5), 17.4),
            duration: 550
          });
        };
        try {
          const rez = src.getClusterExpansionZoom(cid, (err, z) => {
            if (!err && z != null) zumirajNa(z);
          });
          if (rez && typeof rez.then === 'function') {
            rez.then(z => zumirajNa(z)).catch(() => zumirajNa(16.2));
          }
        } catch {
          zumirajNa(16.2);
        }
      });

      mapa.on('click', 'uz-tacke-krug', e => {
        if (!e.features || !e.features.length) return;
        const svi = STANJE._poslednjiZapisiMape || [];
        let kandidati = e.features;
        if (e.point && typeof mapa.queryRenderedFeatures === 'function') {
          try {
            const uBlizini = mapa.queryRenderedFeatures(
              [[e.point.x - 18, e.point.y - 18], [e.point.x + 18, e.point.y + 18]],
              { layers: ['uz-tacke-krug'] }
            );
            if (uBlizini && uBlizini.length) kandidati = uBlizini;
          } catch {}
        }
        const kliknutiIdx = Number(e.features[0].properties.idx);
        const vidjeni = new Set();
        const listaZapisa = [];
        let aktivni = 0;
        for (const f of kandidati) {
          const ix = Number(f.properties && f.properties.idx);
          if (!Number.isFinite(ix) || vidjeni.has(ix) || !svi[ix]) continue;
          vidjeni.add(ix);
          if (ix === kliknutiIdx) aktivni = listaZapisa.length;
          listaZapisa.push(svi[ix]);
        }
        if (!listaZapisa.length && svi[kliknutiIdx]) {
          listaZapisa.push(svi[kliknutiIdx]);
        }
        if (listaZapisa.length) otvoriDetaljZapisa(listaZapisa, aktivni);
      });

      for (const slojId of ['uz-klasteri-krug', 'uz-tacke-krug']) {
        mapa.on('mouseenter', slojId, () => { mapa.getCanvas().style.cursor = 'pointer'; });
        mapa.on('mouseleave', slojId, () => { mapa.getCanvas().style.cursor = ''; });
      }
    }

    azurirajPlavuTackuNaMapi();
    azurirajSlojeveMape(sviVidljiviZapisi());
  }

  function inicijalizujMapu() {
    if (!window.maplibregl) {
      document.getElementById('map-fallback').hidden = false;
      return;
    }
    try {
      const q = new URLSearchParams(location.search);
      const primarniStil = q.get('mapStyle') || (navigator.onLine === false
        ? napraviOfflineLokalniStil()
        : 'https://tiles.openfreemap.org/styles/liberty');
      let nivoRezerve = typeof primarniStil === 'object' ? 2 : 0;

      const mapa = new window.maplibregl.Map({
        container: 'map',
        style: primarniStil,
        center: BEOGRAD_CENTAR,
        zoom: 13.4,
        pitch: nivoRezerve === 0 ? 52 : 0,
        bearing: nivoRezerve === 0 ? -12 : 0,
        maxPitch: 75,
        attributionControl: false
      });
      mapa.addControl(new window.maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      STANJE.mapa = mapa;

      const prebaciNaRezervniStil = () => {
        if (STANJE.mapaSpremna) return;
        if (nivoRezerve === 0 && navigator.onLine !== false) {
          nivoRezerve = 1;
          try { mapa.setStyle(napraviRezervniRasterStil()); } catch {}
          setTimeout(() => {
            if (!STANJE.mapaSpremna) prebaciNaRezervniStil();
          }, 4500);
        } else if (nivoRezerve < 2) {
          nivoRezerve = 2;
          try { mapa.setStyle(napraviOfflineLokalniStil()); } catch {}
        }
      };

      const cuvarStila = setTimeout(() => {
        if (!STANJE.mapaSpremna) prebaciNaRezervniStil();
      }, 6500);

      mapa.on('load', () => {
        clearTimeout(cuvarStila);
        montirajUzSlojeveNaMapu(mapa);
      });
      mapa.on('style.load', () => {
        clearTimeout(cuvarStila);
        montirajUzSlojeveNaMapu(mapa);
      });

      mapa.on('error', e => {
        const por = String((e && e.error && e.error.message) || '');
        if (/webgl/i.test(por)) {
          clearTimeout(cuvarStila);
          document.getElementById('map-fallback').hidden = false;
          return;
        }
        if (!STANJE.mapaSpremna && (!e.sourceId || e.sourceId === '')) {
          prebaciNaRezervniStil();
        }
      });
    } catch {
      document.getElementById('map-fallback').hidden = false;
    }
  }

  function postaviPogled(p) {
    STANJE.pogled = p;
    const jeMapa = p === 'mapa';
    document.getElementById('map-wrap').hidden = !jeMapa;
    document.getElementById('list-wrap').hidden = jeMapa;
    document.getElementById('view-map-btn').classList.toggle('active', jeMapa);
    document.getElementById('view-map-btn').setAttribute('aria-selected', String(jeMapa));
    document.getElementById('view-list-btn').classList.toggle('active', !jeMapa);
    document.getElementById('view-list-btn').setAttribute('aria-selected', String(!jeMapa));
    if (jeMapa && STANJE.mapa) {
      setTimeout(() => STANJE.mapa.resize(), 30);
    } else if (!jeMapa && STANJE.dnevnikPrljav) {
      crtajPodatke(true);
    }
  }

  // --- Povezivanje događaja ---
  function poveziDogadjaje() {
    document.querySelectorAll('[data-close-modal]').forEach(b => {
      b.onclick = zatvoriSvePanele;
    });

    document.getElementById('btn-lang').onclick = () => {
      STANJE.jezik = STANJE.jezik === 'sr' ? 'en' : 'sr';
      localStorage.setItem(LS_JEZIK, STANJE.jezik);
      primeniJezik();
    };

    document.getElementById('btn-info').onclick = () => otvoriPanel('modal-info');

    document.getElementById('btn-profil').onclick = async () => {
      if (!STANJE.sesija || !STANJE.sesija.tajna) {
        pripremiPrijavuPanel();
        return;
      }
      const ispisiRezime = () => {
        const s = STANJE.sesija;
        if (!s) return;
        const mesta = s.limit > 0 ? ` · povezano ${s.zauzeto}/${s.limit} uređaja u timu` : '';
        document.getElementById('prof-summary').textContent =
          `Tim ${s.tim} · ${s.oznaka || 'aktivan uređaj'}${mesta}`;
      };
      ispisiRezime();
      document.getElementById('prof-nadimak').value = STANJE.sesija.nadimak || '';
      const qb = document.getElementById('prof-queue-box');
      if (STANJE.lokalniRed.length > 0) {
        qb.hidden = false;
        qb.textContent = `Zapisi u telefonu koji čekaju slanje na server: ${STANJE.lokalniRed.length}`;
      } else {
        qb.hidden = true;
      }
      otvoriPanel('modal-profile');
      try {
        const r = await apiPoziv('/api/ja', { method: 'GET' });
        const j = await r.json();
        if (r.ok && j && j.ok && STANJE.sesija) {
          STANJE.sesija.uredjaj_id = j.uredjaj_id || STANJE.sesija.uredjaj_id || 0;
          STANJE.sesija.zauzeto = j.zauzeto;
          STANJE.sesija.limit = j.limit;
          STANJE.sesija.oznaka = j.oznaka || STANJE.sesija.oznaka;
          sacuvajSesiju(STANJE.sesija);
          ispisiRezime();
        } else if (r.status === 401) {
          sacuvajSesiju(null);
          zatvoriSvePanele();
          toast((j && j.poruka) || 'Mesto za ovaj uređaj je oslobođeno. Skeniraj ponovo QR kod tima.');
        }
      } catch {}
    };

    document.getElementById('btn-save-profile').onclick = async () => {
      if (!STANJE.sesija) return;
      const novi = document.getElementById('prof-nadimak').value.trim().slice(0, 32);
      STANJE.sesija.nadimak = novi;
      sacuvajSesiju(STANJE.sesija);
      zatvoriSvePanele();
      toast('Potpis je sačuvan.');
      try {
        await apiPoziv('/api/ja', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nadimak: novi })
        });
        await ucitajStanjeSaServera(false);
      } catch {}
    };

    document.getElementById('btn-sync-now').onclick = async () => {
      const ok = await sinhronizujRed(true);
      await ucitajStanjeSaServera(false);
      toast(ok ? 'Svi zapisi su sinhronizovani!' : 'Neki zapisi još čekaju slanje u telefonu.');
    };

    document.getElementById('btn-status').onclick = async () => {
      if (STANJE.lokalniRed.length > 0) {
        const ok = await sinhronizujRed(true);
        toast(ok ? 'Poslati svi zapisi iz telefona!' : t('cekaSlanje', STANJE.lokalniRed.length));
      } else {
        await ucitajStanjeSaServera(false);
      }
    };

    document.getElementById('view-map-btn').onclick = () => postaviPogled('mapa');
    document.getElementById('view-list-btn').onclick = () => postaviPogled('lista');

    document.getElementById('filter-all-btn').onclick = () => {
      STANJE.filter = 'svi';
      STANJE.dnevnikPrikazano = 30;
      document.getElementById('filter-all-btn').classList.add('active');
      document.getElementById('filter-team-btn').classList.remove('active');
      crtajPodatke();
    };

    document.getElementById('filter-team-btn').onclick = () => {
      if (!STANJE.sesija || !STANJE.sesija.tim) {
        toast(t('potrebnaPrijava'));
        pripremiPrijavuPanel();
        return;
      }
      STANJE.filter = 'tim';
      STANJE.dnevnikPrikazano = 30;
      document.getElementById('filter-team-btn').classList.add('active');
      document.getElementById('filter-all-btn').classList.remove('active');
      crtajPodatke();
    };

    const listWrap = document.getElementById('list-wrap');
    listWrap.addEventListener('scroll', () => {
      if (STANJE.pogled !== 'lista') return;
      if (listWrap.scrollTop + listWrap.clientHeight >= listWrap.scrollHeight - 260) {
        const ukupno = sviVidljiviZapisi().length;
        if (STANJE.dnevnikPrikazano < ukupno) {
          STANJE.dnevnikPrikazano += 30;
          crtajPodatke(true);
        }
      }
    }, { passive: true });

    document.getElementById('btn-my-loc').onclick = () => {
      if (STANJE.gps && STANJE.mapa && STANJE.mapaSpremna) {
        STANJE.mapa.flyTo({ center: [STANJE.gps.lon, STANJE.gps.lat], zoom: 17.5, duration: 700 });
      } else {
        STANJE.gpsRucno = true;
        pokreniGps(true);
      }
    };

    document.getElementById('btn-toggle-3d').onclick = () => {
      STANJE.mapa3D = !STANJE.mapa3D;
      document.getElementById('btn-toggle-3d').classList.toggle('active', STANJE.mapa3D);
      if (STANJE.mapa && STANJE.mapaSpremna) {
        STANJE.mapa.easeTo({ pitch: STANJE.mapa3D ? 55 : 0, duration: 450 });
      }
    };

    document.getElementById('btn-zoom-in').onclick = () => {
      if (STANJE.mapa) STANJE.mapa.zoomIn({ duration: 250 });
    };
    document.getElementById('btn-zoom-out').onclick = () => {
      if (STANJE.mapa) STANJE.mapa.zoomOut({ duration: 250 });
    };

    document.getElementById('btn-gps-bar').onclick = () => {
      if (!STANJE.gps && STANJE.gpsGreskaKod === 1) {
        otvoriPanel('modal-gps-help');
      }
      STANJE.gpsRucno = true;
      if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
      STANJE.gpsGreska = '';
      osveziGpsPrikaz();
      pokreniGps(true);
    };

    const btnRetryGps = document.getElementById('btn-retry-gps');
    if (btnRetryGps) {
      btnRetryGps.onclick = () => {
        zatvoriSvePanele();
        STANJE.gpsRucno = true;
        if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
        STANJE.gpsGreska = '';
        osveziGpsPrikaz();
        pokreniGps(true);
      };
    }

    document.getElementById('btn-open-composer').onclick = otvoriKompozitor;
    document.getElementById('btn-submit-login').onclick = izvrsiPrijavu;
    document.getElementById('btn-scan-qr-cam').onclick = pokreniQrKameru;
    document.getElementById('btn-stop-qr-cam').onclick = zaustaviQrKameru;
    document.getElementById('inp-qr-image').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) await dekodirajQrIzFajla(f);
    };
    document.getElementById('inp-qr-snap').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) await dekodirajQrIzFajla(f);
    };

    document.getElementById('btn-transfer-session').onclick = async () => {
      const linkPrenosa = napraviLinkPrenosa();
      if (!linkPrenosa) return;
      try {
        await navigator.clipboard.writeText(linkPrenosa);
        toast(STANJE.jezik === 'en'
          ? 'Transfer link copied! Paste it into Chrome or Safari (uses the same team seat).'
          : 'Link za prenos prijave je kopiran! Otvori Chrome ili Safari i nalepi ga u adresnu traku.');
      } catch {
        prompt('Kopiraj link i nalepi u Chrome ili Safari:', linkPrenosa);
      }
    };

    document.getElementById('btn-copy-qr-link').onclick = async () => {
      const qr = STANJE.pendingQr || {
        tim: document.getElementById('inp-tim').value.trim(),
        kod: document.getElementById('inp-kod').value.trim()
      };
      const punLink = qr.tim && qr.kod
        ? `${location.origin}${location.pathname}#${qr.tim}-${qr.kod}`
        : location.href;
      try {
        await navigator.clipboard.writeText(punLink);
        toast(t('kopirano'));
      } catch {
        prompt('Kopiraj link i otvori u Safari / Chrome:', punLink);
      }
    };

    document.querySelectorAll('#comp-tags .choice-chip').forEach(chip => {
      chip.onclick = () => {
        const tag = chip.getAttribute('data-tag');
        if (STANJE.kompozitorTagovi.has(tag)) {
          STANJE.kompozitorTagovi.delete(tag);
          chip.classList.remove('selected');
        } else {
          STANJE.kompozitorTagovi.add(tag);
          chip.classList.add('selected');
        }
        sacuvajNacrtKompozitora();
      };
    });

    const compTextEl = document.getElementById('comp-text');
    if (compTextEl) {
      compTextEl.addEventListener('input', sacuvajNacrtKompozitora);
    }

    const dodajSliku = async f => {
      try {
        const opt = await optimizujSliku(f);
        dodajPrilogUKompozitor(opt);
      } catch (err) {
        // Ako pregledač (npr. Windows/Android Chrome za iPhone .HEIC/.AVIF) ne ume sam da otvori sliku,
        // pošalji original do 15 MB da ga PC server automatski konvertuje i očisti od EXIF-a!
        if (f && f.size > 0 && f.size <= 15 * 1024 * 1024) {
          dodajPrilogUKompozitor({
            vrsta: 'foto',
            ime: f.name || 'slika.heic',
            mime: f.type || 'image/heic',
            blob: f,
            sirina: 0,
            visina: 0,
            trajanje: 0
          });
        } else {
          toast((err && err.message) || 'Slika nije mogla da se obradi.');
        }
      }
    };
    const dodajSnimak = f => {
      if (f.size > 90 * 1024 * 1024) {
        toast('Fajl prelazi 90 MB. Snimi kraći video (do 60 sekundi).');
        return;
      }
      const jeZvuk = (f.type || '').startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|aac)$/i.test(f.name || '');
      dodajPrilogUKompozitor({
        vrsta: jeZvuk ? 'zvuk' : 'video',
        ime: f.name || (jeZvuk ? 'zvuk.m4a' : 'video.mp4'),
        mime: f.type || (jeZvuk ? 'audio/mp4' : 'video/mp4'),
        blob: f,
        sirina: 0,
        visina: 0,
        trajanje: 0
      });
    };
    const jeSlika = f => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|bmp|tiff?|gif)$/i.test(f.name || '');
    const uzmiFajlove = e => { const l = Array.from(e.target.files || []); e.target.value = ''; return l; };

    document.getElementById('inp-cam-photo').onchange = async e => {
      for (const f of uzmiFajlove(e)) await dodajSliku(f);
    };
    document.getElementById('inp-cam-video').onchange = e => {
      for (const f of uzmiFajlove(e)) dodajSnimak(f);
    };
    document.getElementById('inp-file-galerija').onchange = async e => {
      for (const f of uzmiFajlove(e)) {
        if (jeSlika(f)) await dodajSliku(f); else dodajSnimak(f);
      }
    };

    document.getElementById('btn-record-audio').onclick = prekidacSnimanjaZvuka;
    document.getElementById('btn-save-entry').onclick = sacuvajNoviZapis;

    window.addEventListener('online', () => {
      sinhronizujRed();
      ucitajStanjeSaServera();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (STANJE.gps && Date.now() - (STANJE.gps.ts || 0) > GPS_SVEZ_MS) {
          STANJE.gps = null;
          osveziGpsPrikaz();
        }
        pokreniGps(false);
        sinhronizujRed();
        ucitajStanjeSaServera();
      }
    });
  }

  // --- Inicijalizacija ---
  async function start() {
    const prenetaPrijava = procitajPrenosIzUrl();
    STANJE.pendingQr = prenetaPrijava ? null : procitajQrIzUrl();
    if (!STANJE.sesija && !prenetaPrijava) {
      const idbSes = await idbProcitajKes('sesija_rezerva');
      if (idbSes && idbSes.tim && idbSes.tajna) {
        sacuvajSesiju(idbSes);
      }
    }
    poveziDogadjaje();
    primeniJezik();
    inicijalizujMapu();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    STANJE.lokalniRed = await idbSviIzReda();
    osveziStatusTraku();

    await razresiApiBazu(false);

    // Proveri postojeću prijavu uređaja ako postoji
    if (STANJE.sesija && STANJE.sesija.tajna) {
      // Ako student skenira QR DRUGOG tima, ponudi prijavu u taj novi tim
      if (STANJE.pendingQr && STANJE.pendingQr.tim !== STANJE.sesija.tim) {
        await pripremiPrijavuPanel();
      } else {
        try {
          const r = await apiPoziv('/api/ja', { method: 'GET' });
          const j = await r.json();
          if (r.ok && j.ok) {
            sessionStorage.removeItem(SS_PENDING_QR);
            STANJE.pendingQr = null;
            sacuvajSesiju(Object.assign({}, STANJE.sesija, {
              uredjaj_id: j.uredjaj_id || STANJE.sesija.uredjaj_id || 0,
              nadimak: j.nadimak || STANJE.sesija.nadimak || '',
              oznaka: j.oznaka || STANJE.sesija.oznaka || '',
              zauzeto: j.zauzeto,
              limit: j.limit
            }));
            if (prenetaPrijava) {
              toast(`${j.tim} · ${j.nadimak || j.oznaka} (isto mesto preneto)`);
            }
            pokreniGps(prenetaPrijava);
          } else if (r.status === 401) {
            sacuvajSesiju(null);
            if (STANJE.pendingQr) await pripremiPrijavuPanel();
            else toast(j.poruka || 'Potrebna je ponovna QR prijava.');
          }
        } catch {
          // Offline sa postojećom sesijom: pusti studenta da nesmetano radi u offline modu!
          pokreniGps(false);
        }
      }
    } else if (STANJE.pendingQr) {
      await pripremiPrijavuPanel();
    } else if (!localStorage.getItem(LS_PRVI_PUT)) {
      otvoriPanel('modal-info');
      localStorage.setItem(LS_PRVI_PUT, '1');
    }

    await ucitajStanjeSaServera(false);
    if (STANJE.lokalniRed.length > 0) {
      sinhronizujRed();
    }

    // Raspršeno osvežavanje (24–32s jitter) kako 100+ telefona ne bi slalo istovremeni talas ka tunelu
    const zakaziOsvezavanje = () => {
      const razmakMs = 24000 + Math.floor(Math.random() * 8000);
      setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          if (STANJE.lokalniRed.length > 0) sinhronizujRed();
          await ucitajStanjeSaServera(true);
        }
        zakaziOsvezavanje();
      }, razmakMs);
    };
    zakaziOsvezavanje();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
