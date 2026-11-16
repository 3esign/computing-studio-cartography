/* Urbani žurnal · Computing Studio — klijentska aplikacija (mobilni i desktop) */
(function () {
  'use strict';

  const BEOGRAD_CENTAR = [20.4612, 44.8154];
  const LS_SESIJA = 'uz_sesija_v1';
  const LS_JEZIK = 'uz_jezik_v1';
  const LS_API = 'uz_poslednji_api_v1';
  const LS_PRVI_PUT = 'uz_upoznat_v1';
  const SS_PENDING_QR = 'uz_pending_qr_v1';

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

  function ucitajSesiju() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SESIJA) || 'null');
      if (s && s.tim && s.tajna) return s;
    } catch {}
    return null;
  }

  function sacuvajSesiju(s) {
    STANJE.sesija = s;
    if (s) localStorage.setItem(LS_SESIJA, JSON.stringify(s));
    else localStorage.removeItem(LS_SESIJA);
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
      gpsNema: 'Uključi lokaciju (GPS)',
      nemaZapisa: 'Još nema zapažanja u ovom prikazu. Dodirni „+ Novi zapis“ i zabeleži prvi trag u gradu.',
      uTelefonuOznaka: 'Sačuvano u telefonu · čeka slanje',
      prikaziNaMapi: 'Prikaži na mapi →',
      qrPrepoznat: (tim, sl, lim) => `QR kod prepoznat: Tim ${tim} (${sl}/${lim} zauzetih mesta). Upiši ime ili nadimak i uđi u žurnal.`,
      qrSkeniranOffline: tim => `QR kod prepoznat za tim ${tim}. Proveravam vezu sa serverom…`,
      potrebnaPrijava: 'Prvo se prijavi skeniranjem QR koda svog tima.',
      potrebanGps: 'Sačekaj trenutak da telefon očita GPS lokaciju ili dozvoli pristup lokaciji u pregledaču.',
      potrebanPrilog: 'Dodaj bar zapažanje u tekstu, fotografiju, zvuk ili video.',
      sacuvanoUzivo: 'Zapis je upisan u Urbani žurnal i vidljiv na mapi!',
      sacuvanoOffline: 'Sačuvano u telefonu! Poslaće se automatski čim server bude dostupan.',
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
      gpsNema: 'Enable location (GPS)',
      nemaZapisa: 'No observations in this view yet. Tap "+ New entry" to record your first city trace.',
      uTelefonuOznaka: 'Saved on phone · waiting to sync',
      prikaziNaMapi: 'Show on map →',
      qrPrepoznat: (tim, sl, lim) => `QR verified: Team ${tim} (${sl}/${lim} seats used). Enter your name or nickname to start.`,
      qrSkeniranOffline: tim => `QR recognized for team ${tim}. Checking server connection…`,
      potrebnaPrijava: 'Please sign in first by scanning your team QR code.',
      potrebanGps: 'Please wait for phone GPS fix or allow location permission in your browser.',
      potrebanPrilog: 'Add at least a text note, photo, sound, or video.',
      sacuvanoUzivo: 'Entry saved to Urban Journal and live on the map!',
      sacuvanoOffline: 'Saved on your phone! Will sync automatically once connected.',
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
        ? 'What do you notice here? What impression, sound, detail, or memory does this place hold?'
        : 'Šta primećuješ u prostoru? Kakav utisak, zvuk, detalj ili sećanje nosi ovo mesto?';
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

  // --- Otkrivanje adrese PC servera (endpoint.json / localhost) ---
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
    try {
      const r = await fetch('./endpoint.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j.api === 'string' && j.api.trim()) {
          STANJE.apiBaza = j.api.trim().replace(/\/+$/, '');
          localStorage.setItem(LS_API, STANJE.apiBaza);
          return STANJE.apiBaza;
        }
      }
    } catch {}
    const izLs = localStorage.getItem(LS_API) || '';
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
    try {
      const r = await fetch(baza + putanja, Object.assign({}, opcije, { headers: zaglavlja }));
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
    }
  }

  // --- Čitanje QR koda iz #hash (odmah čisti URL traku!) ---
  function procitajQrIzUrl() {
    const siroviHash = String(location.hash || '').trim();
    let nadjeno = null;
    if (siroviHash.length > 2) {
      // Format 1 (QR-timovi-telefon.pdf): #<tim>-<kod>
      const m = /^#(T\d{2})-([A-Za-z0-9]{4,28})$/i.exec(siroviHash);
      if (m) {
        nadjeno = { tim: m[1].toUpperCase(), kod: m[2].toUpperCase() };
      } else {
        // Format 2: #t=T07&k=XXXXXXXXXX
        const p = new URLSearchParams(siroviHash.slice(1));
        const pt = p.get('t') || p.get('tim');
        const pk = p.get('k') || p.get('kod');
        if (pt && pk) {
          nadjeno = { tim: pt.trim().toUpperCase(), kod: pk.trim().toUpperCase() };
        }
      }
    }
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
    return /Viber|Instagram|FBAN|FBAV|WhatsApp|Line\/|TikTok|BytedanceWebview|; wv\)/i.test(ua);
  }

  // --- Jedinstveni upravljač panelima (uvek najviše jedan otvoren!) ---
  const SVI_PANELI = ['modal-login', 'modal-info', 'modal-composer', 'modal-detail', 'modal-profile'];

  function otvoriPanel(id) {
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el) el.hidden = pid !== id;
    }
  }

  function zatvoriSvePanele() {
    zaustaviSnimanjeZvuka(true);
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

  // --- GPS lokacija (automatski, bez ručnog nišanjenja) ---
  let gpsWatchId = null;
  function osveziGpsPrikaz() {
    const dot = document.getElementById('gps-dot');
    const lbl = document.getElementById('gps-label');
    if (STANJE.gps) {
      dot.className = 'dot ok';
      lbl.textContent = t('gpsOk', STANJE.gps.tacnost_m);
    } else if (STANJE.gpsGreska) {
      dot.className = 'dot err';
      lbl.textContent = STANJE.gpsGreskaKod === 1 ? 'Lokacija odbijena · dodirni za uputstvo' : 'GPS nije očitan · dodirni ponovo';
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
        vreme: new Date().toISOString()
      };
      STANJE.gpsGreska = '';
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
          alert('Pregledač je odbio lokaciju.\n\n1) Uključi Lokaciju u brzim podešavanjima telefona.\n2) Dodirni ikonicu levo od adrese (ili ⋮ → Podešavanja sajta) → Lokacija → Dozvoli.\n3) Podešavanja telefona → Aplikacije → ovaj pregledač → Dozvole → Lokacija → Dozvoli.\n4) Osveži stranicu. Ako i dalje ne radi, otvori link u Chrome-u.');
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
      localStorage.setItem(LS_PRVI_PUT, '1');
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

  // --- Optimizacija slike na telefonu (WebP <= 2048 px, 0 EXIF) ---
  async function optimizujSliku(fajl) {
    const url = URL.createObjectURL(fajl);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Neuspešno čitanje slike.'));
        i.src = url;
      });
      const maksStrana = 2048;
      let sirina = img.naturalWidth || img.width || 1200;
      let visina = img.naturalHeight || img.height || 900;
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

      let blob = await new Promise(res => platno.toBlob(res, 'image/webp', 0.84));
      let mime = 'image/webp';
      let ext = '.webp';
      if (!blob || blob.type !== 'image/webp') {
        blob = await new Promise(res => platno.toBlob(res, 'image/jpeg', 0.86));
        mime = 'image/jpeg';
        ext = '.jpg';
      }
      return {
        vrsta: 'foto',
        ime: 'foto' + ext,
        mime,
        blob,
        sirina,
        visina,
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
    el.innerHTML = `<span><strong>${esc(timTxt)}</strong></span> · <span>Nedelja ${STANJE.aktivnaNedelja}</span> · <span>${esc(gpsTxt)}</span> · <span>${esc(sadTxt)}</span>`;
  }

  function otvoriKompozitor() {
    if (!STANJE.sesija || !STANJE.sesija.tajna) {
      toast(t('potrebnaPrijava'));
      pripremiPrijavuPanel();
      return;
    }
    pokreniGps(false);
    ocistiKompozitor();
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

    if (!STANJE.gps) {
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
      await idbUpisiURed(zapisZaRed);
      STANJE.lokalniRed = await idbSviIzReda();
      osveziStatusTraku();
      ocistiKompozitor();
      zatvoriSvePanele();
      crtajPodatke();

      if (STANJE.mapa && STANJE.mapaSpremna) {
        STANJE.mapa.flyTo({ center: [zapisZaRed.lon, zapisZaRed.lat], zoom: Math.max(STANJE.mapa.getZoom(), 17), duration: 700 });
      }

      // 2. Odmah pokušaj slanje na PC server
      const poslato = await sinhronizujRed();
      toast(poslato ? t('sacuvanoUzivo') : t('sacuvanoOffline'));
    } catch (e) {
      errEl.textContent = 'Greška pri čuvanju: ' + (e && e.message ? e.message : String(e));
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  // --- Sinhronizacija offline reda sa PC serverom ---
  async function posaljiJedanIzReda(stavka) {
    const fd = new FormData();
    fd.append('uuid_klijenta', stavka.uuid_klijenta);
    fd.append('nedelja', String(stavka.nedelja || 1));
    fd.append('tema', stavka.tema || 'subjektivni-dozivljaj');
    fd.append('kategorije', JSON.stringify(stavka.kategorije || []));
    fd.append('lat', String(stavka.lat));
    fd.append('lon', String(stavka.lon));
    fd.append('tacnost_m', String(stavka.tacnost_m));
    fd.append('vreme_telefona', stavka.vreme_telefona);
    fd.append('nadimak', stavka.nadimak || '');
    fd.append('tekst', stavka.tekst || '');

    const pril = stavka.prilozi || [];
    for (let i = 0; i < pril.length; i++) {
      const p = pril[i];
      fd.append(`sirina_${i}`, String(p.sirina || 0));
      fd.append(`visina_${i}`, String(p.visina || 0));
      fd.append(`trajanje_${i}`, String(p.trajanje || 0));
      fd.append(`fajl_${i}`, p.blob, p.ime || `prilog-${i}`);
    }

    const r = await apiPoziv('/api/zapisi', { method: 'POST', body: fd });
    const j = await r.json();
    if (r.status === 401 && j && j.kod_greske === 'OPOZVAN') {
      sacuvajSesiju(null);
      throw new Error(j.poruka || 'Uređaj je opozvan.');
    }
    if (!r.ok || !j.ok) {
      throw new Error((j && j.poruka) || 'Slanje nije uspelo.');
    }
    await idbObrisiIzReda(stavka.uuid_klijenta);
  }

  async function sinhronizujRed() {
    if (STANJE.sinhronizacijaUToku) return false;
    STANJE.lokalniRed = await idbSviIzReda();
    osveziStatusTraku();
    if (STANJE.lokalniRed.length === 0 || !STANJE.sesija || !STANJE.sesija.tajna) {
      return STANJE.lokalniRed.length === 0;
    }

    STANJE.sinhronizacijaUToku = true;
    let sveUspelo = true;
    try {
      // Šaljemo hronološki od najstarijeg ka najnovijem
      const sortirano = [...STANJE.lokalniRed].sort((a, b) => String(a.vreme_telefona).localeCompare(String(b.vreme_telefona)));
      for (const st of sortirano) {
        try {
          await posaljiJedanIzReda(st);
        } catch {
          sveUspelo = false;
          break;
        }
      }
      STANJE.lokalniRed = await idbSviIzReda();
      osveziStatusTraku();
      if (sveUspelo) {
        await ucitajStanjeSaServera();
      } else {
        crtajPodatke();
      }
    } finally {
      STANJE.sinhronizacijaUToku = false;
    }
    return sveUspelo;
  }

  // --- Učitavanje javnog stanja mape i dnevnika ---
  async function ucitajStanjeSaServera() {
    try {
      const r = await apiPoziv('/api/stanje', { method: 'GET' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !j.ok) return;
      STANJE.aktivnaNedelja = j.aktivna_nedelja || 1;
      STANJE.serverZapisi = Array.isArray(j.zapisi) ? j.zapisi : [];
      STANJE.serverStatistika = j.statistika || { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} };
      await idbSacuvajKes('poslednje_stanje', {
        aktivnaNedelja: STANJE.aktivnaNedelja,
        zapisi: STANJE.serverZapisi,
        statistika: STANJE.serverStatistika
      });
      crtajPodatke();
    } catch {
      // U offline režimu prikaži poslednje keširano stanje
      if (STANJE.serverZapisi.length === 0) {
        const kes = await idbProcitajKes('poslednje_stanje');
        if (kes) {
          STANJE.aktivnaNedelja = kes.aktivnaNedelja || 1;
          STANJE.serverZapisi = kes.zapisi || [];
          STANJE.serverStatistika = kes.statistika || STANJE.serverStatistika;
          crtajPodatke();
        }
      }
    }
  }

  function sviVidljiviZapisi() {
    const lokalni = STANJE.lokalniRed.map(q => ({
      id: 'local-' + q.uuid_klijenta,
      uTelefonu: true,
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
    const spojeno = [...lokalni, ...STANJE.serverZapisi];
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

  function htmlPriloziZapisa(prilozi) {
    if (!prilozi || !prilozi.length) return '';
    const slike = [];
    const av = [];
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
        slike.push(`<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" loading="lazy" alt="Fotografija sa terena"></a>`);
      } else if (p.vrsta === 'zvuk') {
        av.push(`<audio controls preload="metadata" src="${esc(src)}"></audio>`);
      } else if (p.vrsta === 'video') {
        av.push(`<video controls playsinline preload="metadata" src="${esc(src)}"></video>`);
      }
    }
    return `
      ${slike.length ? `<div class="entry-media-grid">${slike.join('')}</div>` : ''}
      ${av.length ? `<div class="entry-media-full">${av.join('')}</div>` : ''}
    `;
  }

  function crtajPodatke() {
    oslobodiAktivneBlobUrlove();
    const zapisi = sviVidljiviZapisi();
    document.getElementById('count-entries').textContent = String(zapisi.length);

    // Metrika otkrivenosti (m²)
    let m2 = STANJE.serverStatistika.otkriveno_m2_ukupno || 0;
    if (STANJE.filter === 'tim' && STANJE.sesija && STANJE.sesija.tim) {
      const stTim = (STANJE.serverStatistika.po_timu || {})[STANJE.sesija.tim];
      m2 = stTim ? stTim.otkriveno_m2 : 0;
    }
    document.getElementById('metric-m2').textContent = `${m2.toLocaleString('sr-RS')} m²`;

    // Hronološki feed u Dnevniku
    const feed = document.getElementById('journal-feed');
    if (zapisi.length === 0) {
      feed.innerHTML = `<div class="entry-card"><p class="entry-text" style="color:var(--ink-soft)">${esc(t('nemaZapisa'))}</p></div>`;
    } else {
      feed.innerHTML = zapisi.map((z, idx) => {
        const tagHtml = (z.kategorije || []).length
          ? `<div class="tag-row">${z.kategorije.map(k => `<span class="tag-pill">${esc(k)}</span>`).join('')}</div>`
          : '';
        const qBadge = z.uTelefonu
          ? `<div class="alert-box warn" style="padding:5px 9px;font-size:11.5px">${esc(t('uTelefonuOznaka'))}</div>`
          : '';
        return `
          <article class="entry-card ${z.uTelefonu ? 'queued' : ''}">
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
            ${htmlPriloziZapisa(z.prilozi)}
            <div class="entry-foot">
              <span>±${Math.round(z.tacnost_m || 12)} m · R=${Math.round(z.radijus_m || 12)} m</span>
              <button type="button" class="link-btn" data-goto-idx="${idx}">${esc(t('prikaziNaMapi'))}</button>
            </div>
          </article>
        `;
      }).join('');

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
    }

    azurirajSlojeveMape(zapisi);
  }

  // --- 3D Mapa Beograda (MapLibre GL + OpenFreeMap + metrički krugovi iskustva) ---
  function napraviPoligonKruga(lon, lat, radijusM, tacaka = 40) {
    const koordinate = [];
    const dLat = radijusM / 111132;
    const dLon = radijusM / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= tacaka; i++) {
      const ugao = (i / tacaka) * 2 * Math.PI;
      koordinate.push([lon + dLon * Math.cos(ugao), lat + dLat * Math.sin(ugao)]);
    }
    return [koordinate];
  }

  function otvoriDetaljZapisa(z) {
    document.getElementById('detail-title').textContent = `${z.tim} · ${z.autor}`;
    const tagHtml = (z.kategorije || []).length
      ? `<div class="tag-row">${z.kategorije.map(k => `<span class="tag-pill">${esc(k)}</span>`).join('')}</div>`
      : '';
    document.getElementById('detail-body').innerHTML = `
      <div class="meta-strip">
        <span>${esc(formatVreme(z.vreme))}</span> ·
        <span>GPS ${Number(z.lat).toFixed(5)}, ${Number(z.lon).toFixed(5)} (±${Math.round(z.tacnost_m || 12)} m)</span>
      </div>
      ${z.uTelefonu ? `<div class="alert-box warn">${esc(t('uTelefonuOznaka'))}</div>` : ''}
      ${tagHtml}
      ${z.tekst ? `<p class="entry-text">${esc(z.tekst)}</p>` : ''}
      ${htmlPriloziZapisa(z.prilozi)}
    `;
    otvoriPanel('modal-detail');
  }

  function azurirajSlojeveMape(zapisi) {
    if (!STANJE.mapa || !STANJE.mapaSpremna) return;
    const mojTim = STANJE.sesija ? STANJE.sesija.tim : '';

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
        coordinates: [Number(z.lon), Number(z.lat)]
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

  function inicijalizujMapu() {
    if (!window.maplibregl) {
      document.getElementById('map-fallback').hidden = false;
      return;
    }
    try {
      const mapa = new window.maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: BEOGRAD_CENTAR,
        zoom: 13.4,
        pitch: 52,
        bearing: -12,
        maxPitch: 75,
        attributionControl: false
      });
      mapa.addControl(new window.maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      STANJE.mapa = mapa;

      mapa.on('load', () => {
        STANJE.mapaSpremna = true;
        if (window.innerWidth <= 640) {
          const att = document.querySelector('#map .maplibregl-ctrl-attrib');
          if (att) {
            att.classList.remove('maplibregl-compact-show');
            att.removeAttribute('open');
          }
        }
        mapa.addSource('uz-krugovi', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        mapa.addSource('uz-tacke', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
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
            'fill-opacity': 0.28
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
            'line-width': 1.8
          }
        });

        mapa.addLayer({
          id: 'uz-tacke-krug',
          type: 'circle',
          source: 'uz-tacke',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 8, 19, 10],
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

        mapa.on('click', 'uz-tacke-krug', e => {
          if (!e.features || !e.features.length) return;
          const idx = Number(e.features[0].properties.idx);
          const z = (STANJE._poslednjiZapisiMape || [])[idx];
          if (z) otvoriDetaljZapisa(z);
        });

        mapa.on('mouseenter', 'uz-tacke-krug', () => { mapa.getCanvas().style.cursor = 'pointer'; });
        mapa.on('mouseleave', 'uz-tacke-krug', () => { mapa.getCanvas().style.cursor = ''; });

        azurirajPlavuTackuNaMapi();
        azurirajSlojeveMape(sviVidljiviZapisi());
      });

      mapa.on('error', e => {
        if (e && e.error && /webgl/i.test(String(e.error.message || ''))) {
          document.getElementById('map-fallback').hidden = false;
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

    document.getElementById('btn-profil').onclick = () => {
      if (!STANJE.sesija || !STANJE.sesija.tajna) {
        pripremiPrijavuPanel();
        return;
      }
      document.getElementById('prof-summary').textContent =
        `Tim ${STANJE.sesija.tim} · ${STANJE.sesija.oznaka || 'aktivan uređaj'}`;
      document.getElementById('prof-nadimak').value = STANJE.sesija.nadimak || '';
      const qb = document.getElementById('prof-queue-box');
      if (STANJE.lokalniRed.length > 0) {
        qb.hidden = false;
        qb.textContent = `Zapisi u telefonu koji čekaju slanje na server: ${STANJE.lokalniRed.length}`;
      } else {
        qb.hidden = true;
      }
      otvoriPanel('modal-profile');
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
      } catch {}
    };

    document.getElementById('btn-sync-now').onclick = async () => {
      const ok = await sinhronizujRed();
      await ucitajStanjeSaServera();
      toast(ok ? 'Svi zapisi su sinhronizovani!' : 'PC server trenutno nije dostupan — zapisi ostaju bezbedni u telefonu.');
    };

    document.getElementById('btn-status').onclick = async () => {
      if (STANJE.lokalniRed.length > 0) {
        const ok = await sinhronizujRed();
        toast(ok ? 'Poslati svi zapisi iz telefona!' : t('cekaSlanje', STANJE.lokalniRed.length));
      } else {
        await ucitajStanjeSaServera();
      }
    };

    document.getElementById('view-map-btn').onclick = () => postaviPogled('mapa');
    document.getElementById('view-list-btn').onclick = () => postaviPogled('lista');

    document.getElementById('filter-all-btn').onclick = () => {
      STANJE.filter = 'svi';
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
      document.getElementById('filter-team-btn').classList.add('active');
      document.getElementById('filter-all-btn').classList.remove('active');
      crtajPodatke();
    };

    document.getElementById('btn-my-loc').onclick = () => {
      if (STANJE.gps && STANJE.mapa && STANJE.mapaSpremna) {
        STANJE.mapa.flyTo({ center: [STANJE.gps.lon, STANJE.gps.lat], zoom: 17.5, duration: 700 });
      } else {
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
      STANJE.gpsRucno = true;
      if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
      STANJE.gpsGreska = ''; osveziGpsPrikaz();
      pokreniGps(true);
    };
    document.getElementById('btn-open-composer').onclick = otvoriKompozitor;
    document.getElementById('btn-submit-login').onclick = izvrsiPrijavu;

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
      };
    });

    const dodajSliku = async f => {
      try {
        const opt = await optimizujSliku(f);
        dodajPrilogUKompozitor(opt);
      } catch (err) {
        toast(err.message || 'Slika nije mogla da se obradi.');
      }
    };
    const dodajSnimak = f => {
      if (f.size > 50 * 1024 * 1024) {
        toast('Fajl prelazi 50 MB. Snimi kraći video (do 60 sekundi).');
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
    const jeSlika = f => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name || '');
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
        sinhronizujRed();
        ucitajStanjeSaServera();
      }
    });
  }

  // --- Inicijalizacija ---
  async function start() {
    STANJE.pendingQr = procitajQrIzUrl();
    poveziDogadjaje();
    primeniJezik();
    inicijalizujMapu();

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
              nadimak: j.nadimak || STANJE.sesija.nadimak || '',
              oznaka: j.oznaka || STANJE.sesija.oznaka || '',
              zauzeto: j.zauzeto,
              limit: j.limit
            }));
            pokreniGps(false);
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

    await ucitajStanjeSaServera();
    if (STANJE.lokalniRed.length > 0) {
      sinhronizujRed();
    }

    setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (STANJE.lokalniRed.length > 0) sinhronizujRed();
        ucitajStanjeSaServera();
      }
    }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
