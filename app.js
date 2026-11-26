/* Urbani žurnal · Computing Studio — klijentska aplikacija (mobilni i desktop) */
(function () {
  'use strict';

  // Oznaka izdanja aplikacije: ide uz svako slanje zapisa (?v=), da se u tragu servera vidi koji kod telefon vrti.
  // Ne menja se ručno: upisuje je `node tools/studenti.cjs --zakljucaj` (izvor je tools/studentski-otisak.json).
  const VERZIJA_APP = '2026-11-26.1';
  const SS_AUTO_RELOAD_V = 'uz_auto_reload_v1';
  const BEOGRAD_CENTAR = [20.4612, 44.8154];
  const LS_SESIJA = 'uz_sesija_v1';
  const KOLACIC_SESIJA = 'uz_sesija_c1';
  const LS_NACRT = 'uz_nacrt_v1';
  const LS_JEZIK = 'uz_jezik_v1';
  const LS_API = 'uz_poslednji_api_v1';
  const LS_PRVI_PUT = 'uz_upoznat_v1';
  const LS_PRIVATNOST = 'uz_privatnost_v1';
  const LS_RASPORED = 'uz_dnevnik_raspored_v1';
  const LS_VEZBA = 'uz_vezba_v1';          // broj vežbe koju je student izabrao na ovom telefonu
  const LS_SNIMANJE = 'uz_snimanje_ok_v1'; // vežbe čije je uputstvo o snimanju potvrđeno, npr. "2"
  const ZASTOJ_SLANJA_MS = 25000;          // slanje priloga koje ovoliko dugo ne pošalje nijedan bajt se prekida
  const SS_PENDING_QR = 'uz_pending_qr_v1';
  const RAW_ENDPOINT_FALLBACK = 'https://raw.githubusercontent.com/3esign/computing-studio-cartography/main/endpoint.json';
  const GPS_SVEZ_MS = 3 * 60 * 1000;      // 3 min posle buđenja ekrana
  const GPS_MAKS_STAROST_MS = 5 * 60 * 1000; // 5 min apsolutni plafon pre čuvanja zapisa
  const GPS_BEZ_PRACENJA_MS = 20 * 1000;  // jednokratno očitavanje važi 20 s; duže samo dok praćenje radi

  const STANJE = {
    jezik: localStorage.getItem(LS_JEZIK) === 'en' ? 'en' : 'sr',
    apiBaza: '',
    serverDostupan: false,
    sesija: ucitajSesiju(), // { tim, oznaka, nadimak, tajna, zauzeto, limit }
    pendingQr: null,        // { tim, kod }
    gps: null,              // { lat, lon, tacnost_m, vreme }
    gpsGreska: '',
    pogled: 'mapa',         // 'mapa' | 'lista'
    filter: 'svi',          // 'svi' | 'tim' (izvedeno iz filterTim; menja ga samo postaviFilter)
    filterTim: '',          // '' = ceo grad, inače oznaka tima čiji se zapisi prikazuju
    filterClan: 0,          // 0 = ceo tim, inače uredjaj_id člana čiji se dnevnik prikazuje
    rangOtvoreni: new Set(), // timovi čiji su članovi rašireni u rang-listi
    trebaUokviriti: false,  // posle izbora tima ili člana mapa se jednom uokviri na njihove zapise
    aktivnaNedelja: 1,      // najmanja otvorena vežba po serveru; vežbu u kojoj student radi daje aktivnaNedelja()
    izabranaVezba: (() => { try { return Number(localStorage.getItem(LS_VEZBA)) || 0; } catch { return 0; } })(), // 0 = još nije birao
    teme: [],               // vežbe sa tekstovima (server, tabela teme)
    kontakt: '',            // adresa za pitanja i zahteve; stiže sa servera, u kodu aplikacije je nema
    sviServerZapisi: [],    // zapisi svih vežbi, onako kako su stigli sa servera
    sveStatistika: null,    // statistika sa servera pre izbora vežbe
    poVezbi: false,         // true kad su otvorene bar dve vežbe, pa se prikazuje samo izabrana
    slanjeNapredak: null,   // { procenat } dok se prilog šalje
    serverZapisi: [],       // zapisi koji se prikazuju: izabrana vežba, ili svi dok je otvorena samo jedna
    serverStatistika: { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} },
    poslednjiEtag: '',
    ucitavanjeStanjaUToku: false,
    dnevnikPrikazano: 30,
    dnevnikPrljav: false,
    raspored: 'lista',      // 'lista' ili 'mreza' — raspored kartica u Dnevniku
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
    cekaFokusMape: null,
    korisnikMarker: null,
    novaVerzijaDostupna: '',
    obaveznoOsvezavanje: false,
    skladisteNeRadi: false, // proba pri pokretanju: ova kartica ne može da sačuva prilog na telefonu
    swRegistracija: null
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
      gpsMiruje: 'Lokacija se ne čita',
      mestoCeka: 'mesto: dodaj sliku sa lokacijom ili snimi iz aplikacije',
      potrebanGpsOdbijen: 'Pregledač ne dozvoljava lokaciju, a zapis nema sliku ni video sa lokacijom. Dodaj sliku iz galerije koja nosi lokaciju, ili dozvoli lokaciju: uputstvo je odmah ispod.',
      mestoIzSlike: 'Mesto zapisa je uzeto iz slike.',
      mestoIzSlikeKratko: 'mesto iz slike',
      mestoIzVidea: 'Mesto zapisa je uzeto iz videa.',
      mestoIzVideaKratko: 'mesto iz videa',
      snimljenoKratko: 'snimljeno',
      videoBezLokacije: ime => `Video „${ime}“ nije dodat jer u sebi nema lokaciju, pa ga ne možemo postaviti na mapu. Na licu mesta snimi dugmetom „Snimi video“. iPhone: u galeriji dodirni „Options“ (Opcije) i uključi „Location“ pre izbora videa. Android: galerija najčešće briše lokaciju, zato snimaj iz aplikacije.`,
      nivoKratko: n => `nivo ${n}/3`,
      nivoOpis: n => (n === 3
        ? 'Potpun: prilog i najmanje dva od tri elementa (tekst ≥ 40 znakova, sloj doživljaja, bogat medij: 3+ priloga ili 2+ vrste)'
        : n === 2
          ? 'Opisan: ima tekst ≥ 40 znakova, sloj doživljaja ili bogat medij (3+ priloga ili 2+ vrste)'
          : 'Osnovni: mesto i prilog'),
      faliPrilog: 'prilog (slika, zvuk ili video)',
      faliTekst: 'tekst od najmanje 40 znakova',
      faliSloj: 'sloj doživljaja',
      ili: 'ili',
      zaNivo3: fali => `Za nivo 3 još treba: ${fali}.`,
      zaNivo3Uredi: fali => `Za nivo 3 još treba: ${fali}. Dopuni u Dnevniku dugmetom „Uredi“.`,
      nivo3Dostignut: 'Zapis je potpun (nivo 3).',
      rangDugme: 'Rang',
      fajlNijeZvuk: ime => `Fajl „${ime}“ nije dodat jer nije zvučni zapis. Dugme „Zvučni fajl“ prima samo zvuk; sliku i video dodaj dugmetom „Iz galerije“.`,
      slikaBezLokacije: ime => `Slika „${ime}“ nije dodata jer u sebi nema lokaciju, pa je ne možemo postaviti na mapu. Na licu mesta slikaj dugmetom „Slikaj“. iPhone: u galeriji dodirni „Options“ (Opcije) i uključi „Location“ pre izbora slike. Android: galerija najčešće briše lokaciju, zato slikaj iz aplikacije.`,
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
      potrebanGps: 'Ovaj zapis nema sliku ni video sa lokacijom, pa mu treba mesto telefona. Ako pregledač pita, dozvoli lokaciju; zapis se čuva sam čim se mesto očita. Bez dozvole: dodaj sliku iz galerije koja nosi lokaciju.',
      potrebanPrilog: 'Dodaj bar zapažanje u tekstu, fotografiju, zvuk ili video.',
      sacuvanoUzivo: 'Zapis je upisan u Urbani žurnal i vidljiv na mapi!',
      sacuvanoOffline: 'Sačuvano u telefonu! Poslaće se automatski čim server bude dostupan.',
      saljeSeVeliki: 'Sačuvano u telefonu. Veliki prilog se šalje u pozadini; ostavi aplikaciju otvorenu dok ne stigne.',
      nastaviKao: (ime, n) => `Nastavi kao ${ime} (${n} ${n % 10 === 1 && n % 100 !== 11 ? 'zapis' : 'zapisa'})`,
      izborPovratka: (ime, tim) => `U timu ${tim} već postoji „${ime}“ sa zapisima. Ako si to ti, nastavi na svom mestu da ne zauzmeš drugo.`,
      kopirano: 'Link je kopiran! Otvori Safari ili Chrome i nalepi ga u adresnu traku.',
      snimam: s => `Zaustavi (${s}s)`,
      snimiZvuk: 'Snimi zvuk',
      novaVerzijaBaner: 'Dostupna je nova verzija aplikacije. Osveži stranicu.',
      obaveznoOsvezavanjeBaner: 'Ova kartica koristi staru verziju aplikacije. Osveži pre slanja zapisa.',
      potrebnoOsvezavanje: 'Prvo osveži aplikaciju (dugme na vrhu ekrana) — zapisi ostaju sačuvani u telefonu.',
      skladisteNeRadi: 'Ova kartica ne može da sačuva zapis na telefonu. Ako je privatna kartica, otvori sajt u običnoj kartici i tamo napravi zapis.',
      izdanjeApp: 'Izdanje aplikacije:'
    },
    en: {
      uzivo: 'Live',
      offline: 'On phone',
      cekaSlanje: n => `Pending (${n})`,
      prijava: 'Sign in',
      nasTim: t => (t ? `Team ${t}` : 'Our team'),
      gpsTrazi: 'Acquiring GPS…',
      mestoIzSlike: 'Entry location was taken from the photo.',
      mestoIzSlikeKratko: 'location from photo',
      mestoIzVidea: 'Entry location was taken from the video.',
      mestoIzVideaKratko: 'location from video',
      snimljenoKratko: 'taken',
      videoBezLokacije: ime => `Video “${ime}” was not added because it carries no location, so it cannot be placed on the map. On site, use “Record video”. iPhone: in the gallery tap “Options” and turn on “Location” before choosing. Android: the gallery usually strips location, so record in the app.`,
      nivoKratko: n => `level ${n}/3`,
      nivoOpis: n => (n === 3
        ? 'Complete: attachment and at least two of three elements (text ≥ 40 characters, experience layer, rich media: 3+ attachments or 2+ types)'
        : n === 2
          ? 'Described: has text ≥ 40 characters, an experience layer, or rich media (3+ attachments or 2+ types)'
          : 'Basic: place and attachment'),
      faliPrilog: 'an attachment (photo, sound or video)',
      faliTekst: 'text of at least 40 characters',
      faliSloj: 'an experience layer',
      ili: 'or',
      zaNivo3: fali => `Level 3 still needs: ${fali}.`,
      zaNivo3Uredi: fali => `Level 3 still needs: ${fali}. Add it in the Journal with “Edit”.`,
      nivo3Dostignut: 'The entry is complete (level 3).',
      rangDugme: 'Ranking',
      fajlNijeZvuk: ime => `File “${ime}” was not added because it is not a sound recording. “Sound file” accepts sound only; add photos and video with “From gallery”.`,
      slikaBezLokacije: ime => `Photo “${ime}” was not added because it carries no location, so it cannot be placed on the map. On site, use “Take photo”. iPhone: in the gallery tap “Options” and turn on “Location” before choosing. Android: the gallery usually strips location, so take the photo in the app.`,
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
      potrebanGps: 'This entry has no photo or video with location, so it needs the phone\'s position. If the browser asks, allow location; the entry saves itself as soon as the position is read. Without permission: add a gallery photo that carries location.',
      gpsMiruje: 'Location not in use',
      mestoCeka: 'place: add a photo with location or capture in the app',
      potrebanGpsOdbijen: 'The browser blocks location and the entry has no photo or video with location. Add a gallery photo that carries location, or allow location (guide is under the location bar at the bottom).',
      potrebanPrilog: 'Add at least a text note, photo, sound, or video.',
      sacuvanoUzivo: 'Entry saved to Urban Journal and live on the map!',
      sacuvanoOffline: 'Saved on your phone! Will sync automatically once connected.',
      saljeSeVeliki: 'Saved on your phone. The large attachment is uploading in the background; keep the app open until it arrives.',
      nastaviKao: (ime, n) => `Continue as ${ime} (${n} ${n === 1 ? 'entry' : 'entries'})`,
      izborPovratka: (ime, tim) => `Team ${tim} already has “${ime}” with entries. If that is you, continue in your seat so you do not take a second one.`,
      kopirano: 'Link copied! Open Safari or Chrome and paste it into the address bar.',
      snimam: s => `Stop (${s}s)`,
      snimiZvuk: 'Record sound',
      novaVerzijaBaner: 'A newer version of the app is available. Refresh the page.',
      obaveznoOsvezavanjeBaner: 'This tab is running an outdated app version. Refresh before sending entries.',
      potrebnoOsvezavanje: 'Please refresh the app first (button at the top) — your entries stay safe on your phone.',
      skladisteNeRadi: 'This tab cannot save entries on the phone. If it is a private tab, open the site in a regular tab and make your entry there.',
      izdanjeApp: 'App release:'
    }
  };

  function t(kljuc, ...args) {
    const v = TXT[STANJE.jezik][kljuc];
    return typeof v === 'function' ? v(...args) : v;
  }

  // Obaveštenje o lokaciji i privatnosti. Svaka rečenica mora odgovarati onome što kod stvarno radi:
  // čitanje lokacije (pokreniGps, zaustaviGps), čišćenje medija (server/lib/mediji.cjs), javno stanje (server/lib/stanje.cjs).
  const PRIVATNOST = [
    ['Svaki zapis mora imati mesto. Dobija ga iz slike ili videa koji u sebi nose lokaciju, ili sa telefona dok praviš zapis.',
     'Every entry needs a place. It comes from a photo or video that carries location, or from the phone while you make the entry.'],
    ['Ne želiš da pregledaču dopustiš lokaciju? Slikaj kamerom telefona sa uključenom lokacijom, pa sliku dodaj dugmetom „Iz galerije“. Zapis se sam postavlja na mesto snimka. Na Androidu galerija često briše lokaciju iz slike; tada ovaj put ne radi i ostaje dozvola pregledaču.',
     'Prefer not to give the browser your location? Take the photo with the phone camera with location on, then add it with “From gallery”. The entry is placed where the photo was taken. On Android the gallery often strips location from the photo; then this route does not work and browser permission remains the only way.'],
    ['Lokaciju telefona aplikacija čita samo dok je zapis otvoren ili kad sam dodirneš dugme lokacije. Kad zatvoriš zapis, čitanje prestaje. Serveru ide samo tačka zapisa koji sačuvaš.',
     'The app reads the phone\'s location only while an entry is open or when you tap the location button yourself. When you close the entry, reading stops. Only the point of an entry you save goes to the server.'],
    ['Iz slike, videa i zvuka brišemo metapodatke (lokaciju u fajlu, model telefona) pre objave. Na mapi ostaje samo tačka zapisa.',
     'We strip metadata (location inside the file, phone model) from photos, video and sound before publishing. Only the entry point stays on the map.'],
    ['Mapu i zapise vide svi koji imaju link: potpis, tim, tačku, vreme, tekst i priloge. Za potpis je dovoljno ime ili nadimak; prezime nije potrebno.',
     'Anyone with the link can see the map and entries: signature, team, point, time, text and attachments. A first name or nickname is enough as a signature; no surname needed.'],
    ['Svoj zapis možeš da obrišeš u Dnevniku i on odmah nestaje sa mape. Kopija može ostati u rezervi na profesorovom računaru; za potpuno brisanje javi se profesoru.',
     'You can delete your own entry in the Journal and it disappears from the map at once. A copy may remain in the backup on the professor\'s computer; for full deletion, contact the professor.'],
    ['Server ne čuva tvoju IP adresu. Čuva vrstu telefona i pregledača, radi otklanjanja grešaka.',
     'The server does not store your IP address. It stores the phone and browser type, for troubleshooting.'],
    ['Aplikaciju, vezu do servera i podlogu mape isporučuju spoljni servisi (GitHub, Cloudflare, OpenFreeMap, Carto, OpenStreetMap); oni pri tome vide tvoju IP adresu.',
     'The app, the link to the server and the base map are delivered by outside services (GitHub, Cloudflare, OpenFreeMap, Carto, OpenStreetMap); they see your IP address in the process.'],
    ['Podaci služe za nastavu na predmetu Osnove računarstva.',
     'The data is used for teaching in the Computing Fundamentals course.'],
    ['Sistem vodi Semir Poturak, nastavnik predmeta. Pitanja i zahtevi: {kontakt}.',
     'The system is run by Semir Poturak, the course teacher. Questions and requests: {kontakt}.'],
    ['Čuvamo: tvoj potpis, tim, oznaku telefona i tvoje zapise (tačku, vreme, tekst, priloge). Ne tražimo prezime, broj indeksa ni nalog.',
     'We keep: your signature, team, phone label and your entries (point, time, text, attachments). We do not ask for a surname, student number or account.'],
    ['Zapisi se ne koriste u naučnom radu. Ako se to promeni, bićeš posebno pitan, a tvoj odgovor neće uticati na ocenu.',
     'Entries are not used in research. If that changes, you will be asked separately, and your answer will not affect your grade.'],
    ['Ako se vraćaš na isto mesto, mapa pokazuje kada si tamo bio. Potpiši se nadimkom ako ne želiš da se to veže za tvoje ime.',
     'If you keep returning to one place, the map shows when you were there. Sign with a nickname if you do not want that tied to your name.'],
    ['Ko god je na snimku, ili ti sam, može tražiti sklanjanje zapisa mejlom. Zapis se sakriva sa mape i iz Dnevnika; na zahtev se briše i iz rezervi.',
     'Anyone in a recording, or you, can ask by email for an entry to be taken down. It is hidden from the map and the Journal; on request it is also deleted from backups.']
  ];

  // {kontakt} u tekstu je adresa koju šalje server (STANJE.kontakt). Dok je nema, stoji opis umesto adrese.
  function saKontaktom(tekst, en) {
    return String(tekst).replace('{kontakt}', STANJE.kontakt || (en ? 'ask the course teacher' : 'javi se nastavniku'));
  }

  function crtajPrivatnost() {
    document.querySelectorAll('[data-privacy-list]').forEach(ul => {
      ul.textContent = '';
      for (const [sr, en] of PRIVATNOST) {
        const li = document.createElement('li');
        li.setAttribute('data-sr', saKontaktom(sr, false));
        li.setAttribute('data-en', saKontaktom(en, true));
        li.textContent = li.getAttribute(STANJE.jezik === 'en' ? 'data-en' : 'data-sr');
        ul.appendChild(li);
      }
    });
  }

  // --- Vežbe: otvorenih može biti više i student bira svoju; tekstovi stižu sa servera (tabela teme, server/lib/vezbe.cjs) ---
  function otvoreneVezbe() {
    return (STANJE.teme || []).filter(v => v && Number(v.aktivna) === 1);
  }

  // Vežba u kojoj student radi: njegov izbor ako je ta vežba otvorena, inače najmanja otvorena po serveru.
  // Napredak i rang broje zapise te vežbe (server: rangTima u server/lib/stanje.cjs); menjaju se zajedno.
  function aktivnaNedelja() {
    const izbor = Number(STANJE.izabranaVezba) || 0;
    if (izbor && otvoreneVezbe().some(v => Number(v.nedelja) === izbor)) return izbor;
    return Number(STANJE.aktivnaNedelja) || 1;
  }

  function temaVezbe(n) {
    const broj = Number(n) || aktivnaNedelja();
    return (STANJE.teme || []).find(v => v && Number(v.nedelja) === broj) || null;
  }

  function nazivVezbe(v, kratak) {
    const en = STANJE.jezik === 'en';
    if (!v) return (en ? 'Exercise ' : 'Vežba ') + aktivnaNedelja();
    if (kratak) {
      const k = en ? (v.kratko_en || v.kratko_sr) : v.kratko_sr;
      return k ? `${v.nedelja} · ${k}` : String(v.nedelja);
    }
    return (en ? v.naziv_en : v.naziv_sr) || ((en ? 'Exercise ' : 'Vežba ') + v.nedelja);
  }

  // STANJE.serverZapisi i STANJE.serverStatistika su pogled na izabranu vežbu; iz njih čitaju mapa, Dnevnik, napredak i rang.
  // Dok je otvorena samo jedna vežba ništa se ne filtrira, pa je prikaz isti kao pre uvođenja birača.
  function primeniIzborVezbe() {
    const sve = STANJE.sveStatistika || { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} };
    const n = aktivnaNedelja();
    const statVezbe = otvoreneVezbe().length > 1 && sve.po_vezbi && sve.po_vezbi[n];
    STANJE.poVezbi = Boolean(statVezbe);
    if (!statVezbe) {
      STANJE.serverZapisi = STANJE.sviServerZapisi;
      STANJE.serverStatistika = sve;
      return;
    }
    STANJE.serverZapisi = STANJE.sviServerZapisi.filter(z => Number(z.nedelja || 1) === n);
    STANJE.serverStatistika = Object.assign({}, sve, statVezbe);
  }

  // Novo stanje sa servera ili iz keša telefona.
  function primiStanje(izvor) {
    const s = izvor || {};
    STANJE.aktivnaNedelja = Number(s.aktivnaNedelja) || 1;
    STANJE.teme = Array.isArray(s.teme) ? s.teme : [];
    STANJE.sviServerZapisi = Array.isArray(s.zapisi) ? s.zapisi : [];
    STANJE.sveStatistika = s.statistika || { ukupno_zapisa: 0, otkriveno_m2_ukupno: 0, po_timu: {} };
    const kontakt = String(s.kontakt || '').slice(0, 120);
    if (kontakt !== STANJE.kontakt) {
      STANJE.kontakt = kontakt;
      crtajPrivatnost();
    }
    primeniIzborVezbe();
    primeniTekstoveVezbe();
  }

  function postaviDvojezicno(el, sr, en) {
    if (!el || !sr) return;
    el.setAttribute('data-sr', sr);
    el.setAttribute('data-en', en || sr);
    el.textContent = STANJE.jezik === 'en' ? (en || sr) : sr;
  }

  function dodajDvojezicno(roditelj, oznaka, sr, en, klasa) {
    const el = document.createElement(oznaka);
    if (klasa) el.className = klasa;
    postaviDvojezicno(el, sr, en);
    roditelj.appendChild(el);
    return el;
  }

  // Birač vežbe (traka pogleda i prozor za unos). Pregrađuje se samo kad se promeni sadržaj, da dodir ne padne u prazno.
  function crtajBiracVezbe() {
    const otvorene = otvoreneVezbe();
    const n = aktivnaNedelja();
    const en = STANJE.jezik === 'en';
    const potpis = otvorene.length < 2 ? '' : [STANJE.jezik, n, otvorene.map(v => `${v.nedelja}:${v.kratko_sr}:${v.kratko_en}`).join(',')].join('|');
    document.querySelectorAll('[data-vezba-switch]').forEach(kutija => {
      kutija.hidden = !potpis;
      if (kutija.getAttribute('data-potpis') === potpis) return;
      kutija.setAttribute('data-potpis', potpis);
      kutija.innerHTML = !potpis ? '' :
        `<span class="vezba-cap">${esc(en ? 'Exercise' : 'Vežba')}</span>` +
        `<div class="seg-group" role="group" aria-label="${esc(en ? 'Choose exercise' : 'Izbor vežbe')}">${otvorene.map(v =>
          `<button type="button" class="seg-btn${Number(v.nedelja) === n ? ' active' : ''}" data-vezba="${Number(v.nedelja)}" aria-pressed="${Number(v.nedelja) === n}" title="${esc(nazivVezbe(v))}">${esc(nazivVezbe(v, true))}</button>`
        ).join('')}</div>`;
    });
  }

  // Slojevi zapisa izabrane vežbe (dugmad u prozoru za unos; ista dugmad čita i uređivanje zapisa u Dnevniku).
  function crtajOznakeVezbe(v) {
    const kutija = document.getElementById('comp-tags');
    if (!kutija || !Array.isArray(v.oznake) || !v.oznake.length) return;
    const vazece = new Set(v.oznake.map(o => o.oznaka));
    for (const tg of Array.from(STANJE.kompozitorTagovi)) if (!vazece.has(tg)) STANJE.kompozitorTagovi.delete(tg);
    kutija.textContent = '';
    for (const o of v.oznake) {
      const dugme = dodajDvojezicno(kutija, 'button', o.oznaka, o.en, 'choice-chip' + (STANJE.kompozitorTagovi.has(o.oznaka) ? ' selected' : ''));
      dugme.type = 'button';
      dugme.setAttribute('data-tag', o.oznaka);
    }
  }

  // Naziv, uvod, saveti, pitanje, zadatak i slojevi izabrane vežbe. Server sa starim kodom ne šalje ove tekstove,
  // a telefon bez mreže i bez keša ih nema: tada ostaje tekst Vežbe 1 ugrađen u stranicu.
  let potpisTekstovaVezbe = '';
  function primeniTekstoveVezbe() {
    crtajBiracVezbe();
    const n = aktivnaNedelja();
    postaviDvojezicno(document.getElementById('rank-title'), `Napredak, timovi i članovi · Zadatak ${n}`, `Progress, teams and members · Task ${n}`);
    const saSnimanjem = vezbaSaUputstvomSnimanja();
    document.querySelectorAll('[data-open-snimanje]').forEach(b => { b.hidden = !saSnimanjem; });
    const v = temaVezbe();
    if (!v || !v.pitanje_sr) return;
    const potpis = JSON.stringify(v);
    if (potpis === potpisTekstovaVezbe) return;
    potpisTekstovaVezbe = potpis;
    const el = id => document.getElementById(id);
    postaviDvojezicno(el('vezba-naslov-dnevnik'), 'Urbani žurnal · ' + v.naziv_sr, 'Urban Journal · ' + v.naziv_en);
    postaviDvojezicno(el('vezba-uvod-dnevnik'),
      v.uputstvo_sr + ' Zapažanja svih članova tima i svih timova spajaju se ovde u živu mapu Beograda.',
      v.uputstvo_en + ' Entries from all team members merge here into a shared map of Belgrade.');
    postaviDvojezicno(el('vezba-naslov-info'), v.naziv_sr, v.naziv_en);
    postaviDvojezicno(el('vezba-uvod-info'), v.uputstvo_sr, v.uputstvo_en);
    postaviDvojezicno(el('vezba-zadatak-info'), v.zadatak_sr, v.zadatak_en);
    postaviDvojezicno(el('vezba-pitanje'), v.pitanje_sr, v.pitanje_en);
    const kako = el('vezba-kako-info');
    if (kako) {
      kako.textContent = '';
      const redovi = Array.isArray(v.kako_sr) ? v.kako_sr : [];
      redovi.forEach((sr, i) => dodajDvojezicno(kako, 'li', sr, (v.kako_en || [])[i]));
      kako.hidden = redovi.length === 0;
    }
    crtajOznakeVezbe(v);
  }

  // --- Uputstvo o snimanju ljudi: potvrđuje se jednom po vežbi, pre prvog zapisa u njoj; stalno je dostupno uz privatnost ---
  const potvrdjenoUOvojKartici = new Set(); // rezerva kad kartica ne može da piše u localStorage (privatna kartica)

  function imaUputstvoSnimanja(v) {
    return Boolean(v && Array.isArray(v.snimanje_sr) && v.snimanje_sr.length);
  }

  function vezbaSaUputstvomSnimanja() {
    const v = temaVezbe();
    return imaUputstvoSnimanja(v) ? v : (otvoreneVezbe().find(imaUputstvoSnimanja) || null);
  }

  function trebaPotvrdaSnimanja(n) {
    const v = temaVezbe(n);
    if (!imaUputstvoSnimanja(v)) return false;
    const kljuc = String(v.nedelja);
    if (potvrdjenoUOvojKartici.has(kljuc)) return false;
    try { return !String(localStorage.getItem(LS_SNIMANJE) || '').split(',').includes(kljuc); } catch { return true; }
  }

  let panelVezbeBroj = 0;
  let poslePanelaVezbe = ''; // '' | 'kompozitor' (otvori nov zapis) | 'kompozitor-nastavi' (vrati započeti zapis)

  function otvoriPanelVezbe(n, posle) {
    const v = (n && temaVezbe(n)) || vezbaSaUputstvomSnimanja() || temaVezbe();
    if (!v) return;
    panelVezbeBroj = Number(v.nedelja);
    poslePanelaVezbe = posle || '';
    postaviDvojezicno(document.getElementById('vezba-title'), v.naziv_sr, v.naziv_en);
    const telo = document.getElementById('vezba-body');
    telo.textContent = '';
    dodajDvojezicno(telo, 'p', v.uputstvo_sr, v.uputstvo_en);
    if (Array.isArray(v.kako_sr) && v.kako_sr.length) {
      const ul = document.createElement('ul');
      v.kako_sr.forEach((sr, i) => dodajDvojezicno(ul, 'li', sr, (v.kako_en || [])[i]));
      telo.appendChild(ul);
    }
    if (imaUputstvoSnimanja(v)) {
      dodajDvojezicno(telo, 'h3', 'Kako snimati ljude', 'Recording people');
      // Red oblika „1. **Naslov.** tekst“ je pravilo u numerisanoj listi; ostali redovi su pasusi.
      const pravilo = /^\d+\.\s+\*\*(.+?)\*\*\s*(.*)$/;
      let lista = null;
      v.snimanje_sr.forEach((sr, i) => {
        const en = (v.snimanje_en || [])[i] || sr;
        const mSr = pravilo.exec(sr);
        const mEn = pravilo.exec(en);
        if (!mSr) {
          lista = null;
          dodajDvojezicno(telo, 'p', sr, en);
          return;
        }
        if (!lista) {
          lista = document.createElement('ol');
          telo.appendChild(lista);
        }
        const li = document.createElement('li');
        dodajDvojezicno(li, 'strong', mSr[1], mEn ? mEn[1] : mSr[1]);
        li.appendChild(document.createTextNode(' '));
        dodajDvojezicno(li, 'span', mSr[2], mEn ? mEn[2] : mSr[2]);
        lista.appendChild(li);
      });
      // Red o podešavanju kamere važi samo za iPhone; vidljivost je već odredio kod uz „hint-zvuk-ios“.
      const izvor = document.getElementById('hint-video-ios');
      if (izvor && !izvor.hidden) dodajDvojezicno(telo, 'p', izvor.getAttribute('data-sr'), izvor.getAttribute('data-en'), 'vezba-napomena');
    }
    const ceka = trebaPotvrdaSnimanja(v.nedelja);
    postaviDvojezicno(document.getElementById('btn-vezba-razumem'),
      ceka ? 'Razumem i držaću se ovoga' : 'Razumem',
      ceka ? 'I understand and will follow this' : 'Got it');
    otvoriPanel('modal-vezba');
  }

  function potvrdiPanelVezbe() {
    const v = temaVezbe(panelVezbeBroj);
    if (imaUputstvoSnimanja(v)) {
      const kljuc = String(v.nedelja);
      potvrdjenoUOvojKartici.add(kljuc);
      try {
        const skup = new Set(String(localStorage.getItem(LS_SNIMANJE) || '').split(',').filter(Boolean));
        skup.add(kljuc);
        localStorage.setItem(LS_SNIMANJE, Array.from(skup).join(','));
      } catch {}
    }
    const posle = poslePanelaVezbe;
    poslePanelaVezbe = '';
    if (posle === 'kompozitor-nastavi') {
      otvoriPanel('modal-composer');
      azurirajKompozitorMeta();
      gpsVecDozvoljen().then(da => { if (da) traziMestoTelefona(); });
      return;
    }
    zatvoriSvePanele();
    if (posle === 'kompozitor') otvoriKompozitor();
  }

  function izaberiVezbu(n) {
    const broj = Number(n) || 0;
    if (!broj || !otvoreneVezbe().some(v => Number(v.nedelja) === broj)) return;
    const promena = broj !== aktivnaNedelja();
    STANJE.izabranaVezba = broj;
    try { localStorage.setItem(LS_VEZBA, String(broj)); } catch {}
    if (promena) {
      // Slojevi su različiti po vežbi; izabrani slojevi stare vežbe ne prelaze u novu.
      STANJE.kompozitorTagovi.clear();
      STANJE.dnevnikPrikazano = 30;
    }
    primeniIzborVezbe();
    primeniTekstoveVezbe();
    azurirajKompozitorMeta();
    crtajPodatke(true);
    if (trebaPotvrdaSnimanja(broj)) otvoriPanelVezbe(broj, kompozitorOtvoren() ? 'kompozitor-nastavi' : '');
  }

  // --- Brojač dana: u koliko različitih dana (po beogradskom vremenu) su zapisi nastali. Prikaz, nije uslov zadatka. ---
  const FORMAT_DANA = (() => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return null; }
  })();

  function danZapisa(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try { if (FORMAT_DANA) return FORMAT_DANA.format(d); } catch {}
    return d.toISOString().slice(0, 10);
  }

  function brojiDane() {
    const v = temaVezbe();
    return Boolean(v && Number(v.brojac_dana) === 1);
  }

  function tekstDana(n) {
    return STANJE.jezik === 'en' ? `days: ${n}` : `dana: ${n}`;
  }

  function primeniJezik() {
    document.documentElement.lang = STANJE.jezik === 'en' ? 'en' : 'sr-Latn';
    document.getElementById('btn-lang').textContent = STANJE.jezik === 'en' ? 'SR' : 'EN';
    primeniTekstoveVezbe();
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
    osveziBanerVerzije();
    osveziUpozorenjeSkladista();
    crtajPodatke();
  }

  // --- Provera verzije aplikacije i automatsko osvežavanje zastarelih kartica ---
  function uporediVerzijeApp(a, b) {
    const pa = String(a || '').trim().split(/[.-]/).map(n => Number(n) || 0);
    const pb = String(b || '').trim().split(/[.-]/).map(n => Number(n) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da < db ? -1 : 1;
    }
    return 0;
  }

  function osveziBanerVerzije() {
    const baner = document.getElementById('update-banner');
    const txt = document.getElementById('update-banner-text');
    if (!baner || !txt) return;
    if (!STANJE.obaveznoOsvezavanje && !STANJE.novaVerzijaDostupna) {
      baner.hidden = true;
      baner.classList.remove('obavezno');
      return;
    }
    baner.classList.toggle('obavezno', Boolean(STANJE.obaveznoOsvezavanje));
    txt.textContent = STANJE.obaveznoOsvezavanje ? t('obaveznoOsvezavanjeBaner') : t('novaVerzijaBaner');
    baner.hidden = false;
  }

  async function osveziAplikaciju(ciljnaVerzija) {
    const cilj = String(ciljnaVerzija || STANJE.novaVerzijaDostupna || '1');
    try {
      sessionStorage.setItem(SS_AUTO_RELOAD_V, cilj);
    } catch {}
    try {
      if (STANJE.swRegistracija && typeof STANJE.swRegistracija.update === 'function') {
        await STANJE.swRegistracija.update();
      }
    } catch {}
    try {
      if ('caches' in window) {
        const kljucevi = await caches.keys();
        await Promise.all(kljucevi.filter(k => k.startsWith('uz-ljuska')).map(k => caches.delete(k)));
      }
    } catch {}
    // Prisili HTTP keš pregledača (naročito iOS Safari / GitHub Pages max-age=600) da povuče sveže fajlove pre reload-a.
    try {
      await Promise.allSettled([
        fetch('./', { cache: 'reload' }),
        fetch('./index.html', { cache: 'reload' }),
        fetch('./app.js', { cache: 'reload' }),
        fetch('./app.css', { cache: 'reload' })
      ]);
    } catch {}
    location.reload();
  }

  function kompozitorOtvoren() {
    const m = document.getElementById('modal-composer');
    return Boolean(m && !m.hidden);
  }

  function imaOtvorenPanel() {
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el && !el.hidden) return true;
    }
    return false;
  }

  function trebaAutomatskiOsveziti(u) {
    if (!u || !u.cilj) return false;
    if (u.vecProbao && u.vecProbao === u.cilj) return false;
    if (u.kompozitorOtvoren || u.sinhronizacijaUToku || u.snimanjeAktivno) return false;
    if (u.obavezno) return true;
    if (u.imaNova) return !u.imaOtvorenPanel && u.brojURedu === 0;
    return false;
  }

  function pokusajAutomatskoOsvezavanje() {
    const cilj = STANJE.novaVerzijaDostupna || '';
    if (!cilj) return false;
    let vecProbao = '';
    try { vecProbao = sessionStorage.getItem(SS_AUTO_RELOAD_V) || ''; } catch {}
    const ok = trebaAutomatskiOsveziti({
      cilj,
      vecProbao,
      obavezno: Boolean(STANJE.obaveznoOsvezavanje),
      imaNova: Boolean(STANJE.novaVerzijaDostupna),
      kompozitorOtvoren: kompozitorOtvoren(),
      imaOtvorenPanel: imaOtvorenPanel(),
      sinhronizacijaUToku: Boolean(STANJE.sinhronizacijaUToku),
      snimanjeAktivno: Boolean(STANJE.snimacZvuka),
      brojURedu: Array.isArray(STANJE.lokalniRed) ? STANJE.lokalniRed.length : 0
    });
    if (ok) {
      osveziAplikaciju(cilj);
      return true;
    }
    return false;
  }

  function proveriVerzijuSaServera(podaci) {
    if (!podaci || typeof podaci !== 'object') return;
    const minV = String(podaci.min_verzija_app || '').trim();
    const aktV = String(podaci.verzija_app || '').trim();
    const mora = Boolean(minV && uporediVerzijeApp(VERZIJA_APP, minV) < 0);
    const imaNova = Boolean(aktV && uporediVerzijeApp(VERZIJA_APP, aktV) < 0);
    if (mora) STANJE.obaveznoOsvezavanje = true;
    if (imaNova || mora) STANJE.novaVerzijaDostupna = aktV || minV || STANJE.novaVerzijaDostupna;
    osveziBanerVerzije();
    if (mora || imaNova) pokusajAutomatskoOsvezavanje();
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

  // --- Proba skladišta: može li ova kartica da sačuva prilog na telefonu ---
  // Privatna kartica Safarija odbija Blob u IndexedDB (WebKit bagovi 198278 i 286561), pa zapis sa slikom ili
  // zvukom tu ne može da čeka slanje. Proba upiše i obriše jedan mali Blob. Vraća false samo kad je upis stvarno
  // odbijen; ako skladište ne odgovori u roku, ne tvrdi ništa (true), da ispravna kartica ne dobije lažnu poruku.
  function probajSkladiste(otvori, napraviBlob, rokMs) {
    const upis = (async () => {
      try {
        const db = await otvori();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('kes', 'readwrite');
          const s = tx.objectStore('kes');
          s.put({ kljuc: 'proba_skladista', vrednost: napraviBlob() });
          s.delete('proba_skladista');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        return true;
      } catch {
        return false;
      }
    })();
    return Promise.race([upis, new Promise(resolve => setTimeout(() => resolve(true), rokMs || 4000))]);
  }

  function osveziUpozorenjeSkladista() {
    const el = document.getElementById('comp-storage-warn');
    if (!el) return;
    el.textContent = STANJE.skladisteNeRadi ? t('skladisteNeRadi') : '';
    el.hidden = !STANJE.skladisteNeRadi;
  }

  // --- Otkrivanje adrese PC servera (endpoint.json + raw.githubusercontent.com rezerva bez čekanja CDN-a) ---
  // Adresa servera iz linka (?api=) važi samo kad je aplikacija otvorena sa lokalne adrese, za razvoj i testove.
  // Na javnom sajtu se ne čita: aplikacija na adresu servera šalje tajnu uređaja, pa bi je lažan link odneo.
  function apiIzAdrese(hostname, upit) {
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return '';
    return (new URLSearchParams(upit || '').get('api') || '').replace(/\/+$/, '');
  }

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
    const zadata = apiIzAdrese(location.hostname, location.search);
    if (zadata) {
      STANJE.apiBaza = zadata;
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

  // Slanje priloga kroz XMLHttpRequest: jedini put kojim pregledač javlja koliko je bajtova otišlo (fetch to ne ume).
  // Vraća ono što kodu posle slanja treba od fetch odgovora: status, ok, headers.get i json(). Prekida se u dva slučaja:
  //  - istekao je ukupni rok (greška AbortError, isto kao kod fetch-a);
  //  - prenos stoji: ZASTOJ_SLANJA_MS bez ijednog novog bajta dok telo još nije otišlo (greška ZastojSlanja).
  // Posle zastoja zapis ide rezervnim putem (posaljiJedanIzReda), koji nema čuvara zastoja, da spora veza ne vrti u krug.
  function posaljiSaNapretkom(url, opcije, zaglavlja, rokMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let gotovo = false;
      let teloOtislo = false;
      let cuvar = null;
      const greska = (ime, poruka) => { const e = new Error(poruka); e.name = ime; return e; };
      const zavrsi = (fn, v) => {
        if (gotovo) return;
        gotovo = true;
        clearTimeout(rok);
        clearTimeout(cuvar);
        fn(v);
      };
      const prekini = (ime, poruka) => {
        zavrsi(reject, greska(ime, poruka));
        try { xhr.abort(); } catch {}
      };
      const rok = setTimeout(() => prekini('AbortError', 'istekao rok slanja'), rokMs);
      const navijCuvara = () => {
        clearTimeout(cuvar);
        if (teloOtislo || gotovo) return;
        cuvar = setTimeout(() => prekini('ZastojSlanja', 'bez napretka ' + Math.round(ZASTOJ_SLANJA_MS / 1000) + ' s'), ZASTOJ_SLANJA_MS);
      };
      const javi = udeo => { try { opcije.napredak(udeo); } catch {} };
      xhr.open(opcije.method || 'POST', url, true);
      for (const k of Object.keys(zaglavlja)) xhr.setRequestHeader(k, zaglavlja[k]);
      xhr.upload.onprogress = e => {
        navijCuvara();
        if (e.lengthComputable && e.total > 0) javi(e.loaded / e.total);
      };
      xhr.upload.onload = () => {
        teloOtislo = true;
        clearTimeout(cuvar);
        javi(1);
      };
      xhr.onload = () => zavrsi(resolve, {
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        headers: { get: ime => xhr.getResponseHeader(ime) },
        json: async () => JSON.parse(xhr.responseText)
      });
      xhr.onerror = () => zavrsi(reject, greska('TypeError', 'mrežna greška pri slanju'));
      xhr.onabort = () => zavrsi(reject, greska('AbortError', 'slanje prekinuto'));
      navijCuvara();
      xhr.send(opcije.body);
    });
  }

  // Udeo poslatih bajtova priloga (0–1) za traku statusa; null kad slanje završi.
  function javiNapredakSlanja(udeo) {
    const procenat = udeo === null ? null : Math.max(0, Math.min(100, Math.round(udeo * 100)));
    const stari = STANJE.slanjeNapredak ? STANJE.slanjeNapredak.procenat : null;
    if (procenat === stari) return;
    STANJE.slanjeNapredak = procenat === null ? null : { procenat };
    osveziStatusTraku();
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
      const r = typeof opcije.napredak === 'function' && typeof XMLHttpRequest !== 'undefined'
        ? await posaljiSaNapretkom(baza + putanja, opcije, zaglavlja, rokMs)
        : await fetch(
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
  const SVI_PANELI = ['modal-login', 'modal-info', 'modal-composer', 'modal-detail', 'modal-profile', 'modal-gps-help', 'modal-rank', 'modal-privacy', 'modal-vezba'];

  function otvoriPanel(id) {
    if (id !== 'modal-login') zaustaviQrKameru();
    const tst = document.getElementById('toast');
    if (tst) tst.hidden = true;
    const zapisBioOtvoren = kompozitorOtvoren();
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el) el.hidden = pid !== id;
    }
    if (zapisBioOtvoren && id !== 'modal-composer') zaustaviGps();
  }

  function zatvoriSvePanele() {
    zaustaviSnimanjeZvuka(true);
    zaustaviQrKameru();
    const zapisBioOtvoren = kompozitorOtvoren();
    for (const pid of SVI_PANELI) {
      const el = document.getElementById(pid);
      if (el) el.hidden = true;
    }
    if (zapisBioOtvoren) zaustaviGps();
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
      txt.textContent = STANJE.slanjeNapredak ? `↑ ${STANJE.slanjeNapredak.procenat} %` : t('cekaSlanje', brRed);
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

  // --- GPS lokacija (bez ručnog nišanjenja + zaštita od zastarele lokacije posle prevoza) ---
  // Od izdanja 2026-11-23.6 lokacija telefona se čita samo dok je zapis otvoren ili na izričit dodir dugmeta lokacije.
  // Pregledač pita za dozvolu tek kad zapisu zatreba mesto telefona: kad se doda prilog bez svoje lokacije
  // ili kad se čuva zapis bez slike sa lokacijom. Praćenje se gasi kad se zapis zatvori i kad kartica ode u pozadinu.
  let gpsWatchId = null;
  let gpsCita = false;    // jedno očitavanje je u toku
  let gpsZaZapis = false; // otvoreni zapis je zatražio mesto telefona
  let cuvanjeCekaMesto = false; // „Sačuvaj“ je dodirnut pre nego što je mesto očitano; zapis se čuva sam čim stigne

  function prekiniGpsPracenje() {
    if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }

  // Kraj čitanja: bez praćenja, bez zapamćene tačke i bez plave tačke na mapi.
  function zaustaviGps() {
    prekiniGpsPracenje();
    gpsZaZapis = false;
    cuvanjeCekaMesto = false;
    gpsCita = false;
    STANJE.gps = null;
    if (STANJE.korisnikMarker) {
      STANJE.korisnikMarker.remove();
      STANJE.korisnikMarker = null;
    }
    osveziGpsPrikaz();
  }

  // Mesto telefona koje sme u zapis: sveže, i starije od 20 s samo ako ga praćenje i dalje održava.
  function mestoTelefona() {
    const g = STANJE.gps;
    if (!g) return null;
    const starost = Date.now() - (g.ts || 0);
    if (starost > GPS_MAKS_STAROST_MS) return null;
    if (gpsWatchId === null && starost > GPS_BEZ_PRACENJA_MS) return null;
    return g;
  }

  // Zapis traži mesto telefona. Ne radi ništa ako zapis nije otvoren ili već ima mesto iz slike ili videa.
  function traziMestoTelefona() {
    if (!kompozitorOtvoren() || gpsIzPrilogaKompozitora()) return;
    gpsZaZapis = true;
    pokreniGps(false, true);
  }

  // Da li je pregledač već dobio dozvolu, pa čitanje ne otvara nikakav upit.
  async function gpsVecDozvoljen() {
    try {
      const s = await navigator.permissions.query({ name: 'geolocation' });
      return s.state === 'granted';
    } catch {
      return false;
    }
  }

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
    } else if (gpsCita || gpsWatchId !== null) {
      dot.className = 'dot warn';
      lbl.textContent = t('gpsTrazi');
    } else {
      dot.className = 'dot';
      lbl.textContent = t('gpsMiruje');
    }
    azurirajKompozitorMeta();
  }

  // prati = true drži praćenje dok je zapis otvoren; bez toga je jedno očitavanje (dugme lokacije na mapi i u traci).
  function pokreniGps(centrirajAkoDobije = false, prati = false) {
    if (!navigator.geolocation) {
      STANJE.gpsGreska = 'Geolokacija nije podržana.';
      osveziGpsPrikaz();
      return;
    }
    const naPoziciju = pos => {
      gpsCita = false;
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
      if (cuvanjeCekaMesto && kompozitorOtvoren()) {
        cuvanjeCekaMesto = false;
        sacuvajNoviZapis();
      }
    };
    const naGresku = err => {
      gpsCita = false;
      if (err && err.code === 1) {
        prekiniGpsPracenje(); // odbijena dozvola: nema šta da se prati
        if (cuvanjeCekaMesto && kompozitorOtvoren()) document.getElementById('comp-error').textContent = t('potrebanGpsOdbijen');
        cuvanjeCekaMesto = false;
      }
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
    // Posle greške (na primer odbijene dozvole) staro praćenje ne oživljava samo; novi pokušaj kreće od početka.
    if (STANJE.gpsGreska) prekiniGpsPracenje();
    gpsCita = true;
    osveziGpsPrikaz();
    navigator.geolocation.getCurrentPosition(naPoziciju, naGresku, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: prati ? 15000 : 0 // dodir dugmeta lokacije uvek traži sveže očitavanje
    });
    if (prati && gpsWatchId === null) {
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
    document.getElementById('login-return-box').hidden = true;
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

  // Server je našao mesto sa zapisima pod istim imenom na istom tipu telefona: pitaj umesto da se otvori drugo mesto.
  function prikaziIzborPovratka(j) {
    const box = document.getElementById('login-return-box');
    const opcije = document.getElementById('login-return-options');
    const mesta = Array.isArray(j.mesta) ? j.mesta : [];
    // Ime se ispisuje onako kako je upisano na postojećem mestu, ne kako je sada otkucano.
    document.getElementById('login-return-text').textContent = t('izborPovratka', (mesta[0] && mesta[0].nadimak) || j.nadimak || '', j.tim || '');
    opcije.textContent = '';
    for (const m of mesta) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-primary';
      b.textContent = t('nastaviKao', m.nadimak || j.nadimak || '', Number(m.zapisa) || 0);
      b.onclick = () => izvrsiPrijavu({ povratak_uredjaj_id: m.uredjaj_id });
      opcije.appendChild(b);
    }
    box.hidden = false;
  }

  async function izvrsiPrijavu(izbor) {
    const btn = document.getElementById('btn-submit-login');
    const errBox = document.getElementById('login-error-box');
    const izborBox = document.getElementById('login-return-box');
    izborBox.hidden = true;
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
          postojeca_tajna: STANJE.sesija && STANJE.sesija.tim === tim ? STANJE.sesija.tajna : '',
          podrzava_izbor: true,
          ...(izbor || {})
        })
      });
      const j = await r.json();
      if (r.status === 409 && j.kod_greske === 'IZBOR_POVRATKA') {
        prikaziIzborPovratka(j);
        return;
      }
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
      try { localStorage.setItem(LS_PRIVATNOST, '1'); } catch {}
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist().catch(() => {});
      }
      zatvoriSvePanele();
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

  // >>> exif-gps
  // Lokacija iz slike (EXIF GPS). Radi nad sirovim bajtovima JPEG/HEIC/WebP fajla pre nego što optimizacija obriše EXIF.
  // Vraća { lat, lon, tacnost_m, vreme? } ili null (vreme = trenutak snimanja, ISO UTC, kad ga slika nosi). iPhone šalje GPS samo za sliku iz galerije kad je u biraču pod „Options“
  // uključena lokacija; Android birač slika lokaciju briše pre stranice, pa tamo po pravilu vraća null.
  function gpsIzExifBajtova(u8) {
    if (!u8 || u8.length < 16) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const kraj = u8.length;
    const pokusaj = tiff => {
      if (tiff + 8 > kraj) return null;
      const b0 = u8[tiff], b1 = u8[tiff + 1];
      let le;
      if (b0 === 0x49 && b1 === 0x49) le = true; else if (b0 === 0x4D && b1 === 0x4D) le = false; else return null;
      if (dv.getUint16(tiff + 2, le) !== 42) return null;
      const u16 = o => dv.getUint16(o, le);
      const u32 = o => dv.getUint32(o, le);
      const nadjiUnos = (ifd, tag) => {
        if (ifd < tiff || ifd + 2 > kraj) return -1;
        const n = u16(ifd);
        if (n > 512) return -1;
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 12 > kraj) return -1;
          if (u16(e) === tag) return e;
        }
        return -1;
      };
      const racionalni = (e, koliko) => {
        if (e < 0 || u16(e + 2) !== 5 || u32(e + 4) < koliko) return null;
        const o = tiff + u32(e + 8);
        if (o + koliko * 8 > kraj) return null;
        const izl = [];
        for (let i = 0; i < koliko; i++) {
          const br = u32(o + i * 8), im = u32(o + i * 8 + 4);
          if (!im) return null;
          izl.push(br / im);
        }
        return izl;
      };
      const eGps = nadjiUnos(tiff + u32(tiff + 4), 0x8825);
      if (eGps < 0) return null;
      const gps = tiff + u32(eGps + 8);
      const eLatRef = nadjiUnos(gps, 1), eLonRef = nadjiUnos(gps, 3);
      const dLat = racionalni(nadjiUnos(gps, 2), 3), dLon = racionalni(nadjiUnos(gps, 4), 3);
      if (eLatRef < 0 || eLonRef < 0 || !dLat || !dLon) return null;
      const latRef = String.fromCharCode(u8[eLatRef + 8]).toUpperCase();
      const lonRef = String.fromCharCode(u8[eLonRef + 8]).toUpperCase();
      if ((latRef !== 'N' && latRef !== 'S') || (lonRef !== 'E' && lonRef !== 'W')) return null;
      let lat = dLat[0] + dLat[1] / 60 + dLat[2] / 3600;
      let lon = dLon[0] + dLon[1] / 60 + dLon[2] / 3600;
      if (latRef === 'S') lat = -lat;
      if (lonRef === 'W') lon = -lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null;
      const greska = racionalni(nadjiUnos(gps, 0x1F), 1); // GPSHPositioningError, metri
      const tacnost = greska && greska[0] > 0 ? Math.min(500, Math.max(3, Math.round(greska[0]))) : 30;
      // Vreme snimanja: DateTimeOriginal (+ OffsetTimeOriginal) iz Exif pod-IFD-a; bez zone važi zona telefona.
      // Rezerva je GPS datum i vreme iz slike (UTC). Vraća se kao `vreme` (ISO, UTC) samo kad je pročitano.
      const ascii = (e, najvise) => {
        if (e < 0 || u16(e + 2) !== 2) return '';
        const n = Math.min(u32(e + 4), najvise);
        const o = n <= 4 ? e + 8 : tiff + u32(e + 8);
        if (o < 0 || o + n > kraj) return '';
        let s = '';
        for (let i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]);
        return s.trim();
      };
      let vremeMs = NaN;
      const eExif = nadjiUnos(tiff + u32(tiff + 4), 0x8769);
      if (eExif >= 0) {
        const exif = tiff + u32(eExif + 8);
        const dto = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(nadjiUnos(exif, 0x9003), 20));
        if (dto) {
          const zona = /^[+-]\d{2}:\d{2}$/.exec(ascii(nadjiUnos(exif, 0x9011), 7));
          vremeMs = zona
            ? Date.parse(`${dto[1]}-${dto[2]}-${dto[3]}T${dto[4]}:${dto[5]}:${dto[6]}${zona[0]}`)
            : new Date(+dto[1], +dto[2] - 1, +dto[3], +dto[4], +dto[5], +dto[6]).getTime();
        }
      }
      if (Number.isNaN(vremeMs)) {
        const dat = /^(\d{4}):(\d{2}):(\d{2})$/.exec(ascii(nadjiUnos(gps, 0x1D), 11));
        const sat = racionalni(nadjiUnos(gps, 7), 3);
        if (dat && sat) vremeMs = Date.UTC(+dat[1], +dat[2] - 1, +dat[3], Math.floor(sat[0]), Math.floor(sat[1]), Math.floor(sat[2]));
      }
      const rez = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, tacnost_m: tacnost };
      if (Number.isFinite(vremeMs) && vremeMs > 946684800000 && vremeMs < 4102444800000) rez.vreme = new Date(vremeMs).toISOString();
      return rez;
    };
    // "Exif\0\0" + TIFF (JPEG APP1, HEIC Exif stavka) ili "EXIF" + dužina + TIFF (WebP)
    for (let i = 0; i + 14 < kraj; i++) {
      if (u8[i] === 0x45 && (u8[i + 1] | 0x20) === 0x78 && (u8[i + 2] | 0x20) === 0x69 && (u8[i + 3] | 0x20) === 0x66) {
        const r = (u8[i + 4] === 0 && u8[i + 5] === 0 ? pokusaj(i + 6) : null) || pokusaj(i + 8) || pokusaj(i + 14);
        if (r) return r;
      }
    }
    return null;
  }
  // <<< exif-gps

  async function procitajGpsIzSlike(fajl) {
    try {
      if (!fajl || !fajl.size) return null;
      const deo = fajl.slice(0, Math.min(fajl.size, 2 * 1024 * 1024));
      return gpsIzExifBajtova(new Uint8Array(await procitajBajtovePriloga(deo)));
    } catch {
      return null;
    }
  }

  // >>> video-meta
  // Mesto i vreme iz video fajla iz galerije (MP4/MOV), čitano iz atoma `moov`. Lokacija je ISO 6709 zapis
  // („+44.8202+020.4620/“): iPhone ga piše pod ključem com.apple.quicktime.location.ISO6709, Android u `©xyz`.
  // Vreme: Apple creationdate (sa zonom) ili creation_time iz `mvhd` (sekunde od 1904, UTC).
  // Vraća { lat, lon, tacnost_m, izvor: 'video', vreme? } ili null. Da li birač galerije ostavlja ove podatke zavisi od telefona.
  function metaIzMoovBajtova(u8) {
    if (!u8 || u8.length < 16) return null;
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    const m = /([+-]\d{2}\.\d{2,})([+-]\d{3}\.\d{2,})(?:[+-]\d+(?:\.\d+)?)?(?:CRS[A-Za-z0-9_]+)?\//.exec(s);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null;
    const rez = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, tacnost_m: 30, izvor: 'video' };
    let ms = NaN;
    const d = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})/.exec(s);
    if (d) ms = Date.parse(d[1] + (d[2] === 'Z' ? 'Z' : d[2].slice(0, 3) + ':' + d[2].slice(-2)));
    if (Number.isNaN(ms)) {
      const i = s.indexOf('mvhd');
      if (i >= 0 && i + 20 <= u8.length) {
        const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        const sek = u8[i + 4] === 1 ? dv.getUint32(i + 8) * 4294967296 + dv.getUint32(i + 12) : dv.getUint32(i + 8);
        const kandidat = (sek - 2082844800) * 1000;
        if (kandidat > 1104537600000) ms = kandidat; // posle 2005; nula u zaglavlju znači da vreme nije upisano
      }
    }
    if (Number.isFinite(ms) && ms > 946684800000 && ms < 4102444800000) rez.vreme = new Date(ms).toISOString();
    return rez;
  }
  // <<< video-meta

  // Prolazi kroz atome najvišeg nivoa samo po zaglavljima (16 bajtova po atomu), pa čita `moov` (najviše 6 MB).
  async function procitajMetaIzVidea(fajl) {
    try {
      if (!fajl || !fajl.size) return null;
      let poz = 0;
      for (let k = 0; k < 200 && poz + 8 <= fajl.size; k++) {
        const zag = new DataView(await procitajBajtovePriloga(fajl.slice(poz, poz + 16)));
        if (zag.byteLength < 8) return null;
        let duz = zag.getUint32(0);
        const tip = String.fromCharCode(zag.getUint8(4), zag.getUint8(5), zag.getUint8(6), zag.getUint8(7));
        if (duz === 1 && zag.byteLength >= 16) duz = zag.getUint32(8) * 4294967296 + zag.getUint32(12);
        else if (duz === 0) duz = fajl.size - poz;
        if (duz < 8) return null;
        if (tip === 'moov') {
          const deo = fajl.slice(poz, poz + Math.min(duz, 6 * 1024 * 1024));
          return metaIzMoovBajtova(new Uint8Array(await procitajBajtovePriloga(deo)));
        }
        poz += duz;
      }
    } catch {}
    return null;
  }

  // Vreme nastanka priloga koji je dao mesto (slika ili video iz galerije). Prazno = važi vreme čuvanja.
  function vremeSnimkaIzPriloga(g) {
    if (!g || !g.vreme) return '';
    const ms = Date.parse(g.vreme);
    if (Number.isNaN(ms) || ms > Date.now() + 10 * 60 * 1000 || ms < 946684800000) return '';
    return new Date(ms).toISOString();
  }

  function gpsIzPrilogaKompozitora() {
    const p = STANJE.kompozitorPrilozi.find(x => x.gpsSlike);
    return p ? p.gpsSlike : null;
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
    const izSlike = gpsIzPrilogaKompozitora();
    const gpsTxt = izSlike
      ? `${t(izSlike.izvor === 'video' ? 'mestoIzVideaKratko' : 'mestoIzSlikeKratko')}: ${izSlike.lat.toFixed(5)}, ${izSlike.lon.toFixed(5)} (±${izSlike.tacnost_m} m)`
      : STANJE.gps
      ? `${STANJE.gps.lat.toFixed(5)}, ${STANJE.gps.lon.toFixed(5)} (±${STANJE.gps.tacnost_m} m)`
      : t(gpsCita || gpsWatchId !== null ? 'gpsTrazi' : 'mestoCeka');
    const vremeIzPriloga = vremeSnimkaIzPriloga(izSlike);
    const sadTxt = vremeIzPriloga
      ? `${t('snimljenoKratko')} ${formatVreme(vremeIzPriloga)}`
      : new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    const vezbaTxt = nazivVezbe(temaVezbe(), false);
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
    if (STANJE.obaveznoOsvezavanje) {
      osveziBanerVerzije();
      toast(t('potrebnoOsvezavanje'));
      return;
    }
    if (!STANJE.sesija || !STANJE.sesija.tajna) {
      toast(t('potrebnaPrijava'));
      pripremiPrijavuPanel();
      return;
    }
    // Vežba sa uputstvom o snimanju ljudi: prvo uputstvo i potvrda, pa tek onda zapis.
    if (trebaPotvrdaSnimanja(aktivnaNedelja())) {
      otvoriPanelVezbe(aktivnaNedelja(), 'kompozitor');
      return;
    }
    // Tačka zaostala od ranijeg dodira dugmeta lokacije važi samo ako je sasvim sveža.
    if (!mestoTelefona()) STANJE.gps = null;
    gpsZaZapis = false;
    osveziGpsPrikaz();
    // Kad je dozvola već data, čitanje kreće odmah i bez upita, da mesto bude spremno do čuvanja.
    gpsVecDozvoljen().then(da => { if (da) traziMestoTelefona(); });
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
            // Sloj iz nacrta važi samo ako postoji u izabranoj vežbi.
            const chip = document.querySelector(`#comp-tags .choice-chip[data-tag="${CSS.escape(tg)}"]`);
            if (!chip) continue;
            STANJE.kompozitorTagovi.add(tg);
            chip.classList.add('selected');
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
    cuvanjeCekaMesto = false; // zapis se promenio; čuva se tek na nov dodir
    crtajKompozitorPriloge();
    azurirajKompozitorMeta();
    // Prilog bez svoje lokacije (snimak iz aplikacije, zvuk) traži mesto telefona; tek tada pregledač pita za dozvolu.
    if (!stavka.gpsSlike) traziMestoTelefona();
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
          azurirajKompozitorMeta();
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

    // Slika iz galerije sa upisanom lokacijom određuje mesto zapisa; tada GPS telefona nije uslov.
    const gpsSlike = gpsIzPrilogaKompozitora();
    const mestoTel = gpsSlike ? null : mestoTelefona();
    if (!gpsSlike && !mestoTel) {
      STANJE.gps = null;
      errEl.textContent = t(STANJE.gpsGreskaKod === 1 ? 'potrebanGpsOdbijen' : 'potrebanGps');
      errEl.hidden = false;
      cuvanjeCekaMesto = true;
      traziMestoTelefona();
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
      const mesto = gpsSlike || mestoTel;
      const zapisZaRed = {
        uuid_klijenta: generisiUuid(),
        tim: STANJE.sesija.tim,
        nadimak: STANJE.sesija.nadimak || '',
        oznaka_uredjaja: STANJE.sesija.oznaka || '',
        // Vežba izabrana u trenutku čuvanja. Šifru teme upisuje server; ovde ide samo zbog zapisa koji čeka u telefonu.
        nedelja: aktivnaNedelja(),
        tema: (temaVezbe() && temaVezbe().sifra) || 'subjektivni-dozivljaj',
        kategorije: Array.from(STANJE.kompozitorTagovi),
        lat: mesto.lat,
        lon: mesto.lon,
        tacnost_m: mesto.tacnost_m,
        radijus_m: Math.min(25, Math.max(5, Math.round(mesto.tacnost_m))),
        izvor_lokacije: gpsSlike ? (gpsSlike.izvor === 'video' ? 'video' : 'slika') : 'uredjaj',
        vreme_telefona: new Date().toISOString(),
        // Kad je slika ili video iz galerije snimljen; prazno znači da važi vreme čuvanja.
        vreme_snimka: vremeSnimkaIzPriloga(gpsSlike),
        izvor_vremena: vremeSnimkaIzPriloga(gpsSlike) ? (gpsSlike.izvor === 'video' ? 'video' : 'slika') : 'uredjaj',
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
      errEl.textContent = STANJE.skladisteNeRadi
        ? t('skladisteNeRadi')
        : 'Greška pri čuvanju: ' + (e && e.message ? e.message : String(e));
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
      ['izvor_lokacije', stavka.izvor_lokacije === 'slika' || stavka.izvor_lokacije === 'video' ? stavka.izvor_lokacije : 'uredjaj'],
      ['vreme_telefona', stavka.vreme_telefona],
      ['nadimak', stavka.nadimak || ''],
      ['tekst', stavka.tekst || '']
    ];
    if (stavka.vreme_snimka) {
      polja.push(['vreme_snimka', stavka.vreme_snimka]);
      polja.push(['izvor_vremena', stavka.izvor_vremena === 'video' ? 'video' : 'slika']);
    }
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
    if (STANJE.obaveznoOsvezavanje) {
      osveziBanerVerzije();
      return { ishod: 'stara_verzija', poruka: t('potrebnoOsvezavanje') };
    }
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
      // Zapis sa prilogom ide putem koji javlja napredak i prekida zastoj; zapis samo sa tekstom ostaje na fetch-u.
      r = await apiPoziv(upit('fd'), Object.assign({ method: 'POST', body: fd, rokMs }, pril.length ? { napredak: javiNapredakSlanja } : {}));
      try { j = await r.json(); } catch {}
      dn.fd = opisOdgovora(r, j);
    } catch (e) {
      greskaFd = e;
      dn.fd = opisGreskeSlanja(e);
    }
    dn.fd_ms = Date.now() - t0;
    fd = null;
    javiNapredakSlanja(null);

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
      if (j && j.kod_greske === 'STARA_VERZIJA') {
        stavka.stara_verzija = true;
        delete stavka.prazno_telo;
        await idbUpisiURed(stavka);
        STANJE.obaveznoOsvezavanje = true;
        proveriVerzijuSaServera(j);
        return { ishod: 'stara_verzija', poruka: stavka.trajna_greska };
      }
      delete stavka.stara_verzija;
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
      ...(st.vreme_snimka ? ['Vreme snimka: ' + st.vreme_snimka] : []),
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

  // --- Budan ekran dok traje veliko slanje ---
  // Zaključan ekran zamrzne karticu i prekine prenos, pa veliki prilog kreće iznova. Dok se veliki zapis šalje, tražimo da ekran
  // ostane upaljen (Screen Wake Lock; Safari 16.4+). Gde to nije podržano ili je odbijeno, sve radi kao i bez toga.
  // Pregledač bravu sam pušta kad kartica ode u pozadinu; po povratku je tražimo ponovo ako slanje još traje.
  let velikihSlanjaUToku = 0;
  let bravaEkrana = null;
  let bravaSeTrazi = false;

  async function drziEkranBudnim() {
    if (bravaEkrana || bravaSeTrazi || velikihSlanjaUToku === 0) return;
    if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
    bravaSeTrazi = true;
    try {
      const brava = await navigator.wakeLock.request('screen');
      brava.addEventListener('release', () => { if (bravaEkrana === brava) bravaEkrana = null; });
      bravaEkrana = brava;
      if (velikihSlanjaUToku === 0) pustiEkran();
    } catch {
    } finally {
      bravaSeTrazi = false;
    }
  }

  function pustiEkran() {
    const brava = bravaEkrana;
    bravaEkrana = null;
    if (brava) brava.release().catch(() => {});
  }

  async function posaljiUzBudanEkran(st) {
    if (!jeVelikiZapis(st)) return posaljiJedanIzReda(st);
    velikihSlanjaUToku++;
    drziEkranBudnim();
    try {
      return await posaljiJedanIzReda(st);
    } finally {
      velikihSlanjaUToku--;
      if (velikihSlanjaUToku === 0) pustiEkran();
    }
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
                const rez = await posaljiUzBudanEkran(st);
                if (rez.ishod === 'poslato') {
                  poslatoBarJedno = true;
                } else if (rez.ishod === 'auth_pala' || rez.ishod === 'stara_verzija') {
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

  async function sacuvajIzmenuSopstvenogZapisa(zapisId, noviTekst, kategorije) {
    try {
      const r = await apiPoziv('/api/zapisi/' + encodeURIComponent(zapisId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.isArray(kategorije) ? { tekst: noviTekst, kategorije } : { tekst: noviTekst })
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
      proveriVerzijuSaServera(j);
      if (j.neizmenjeno) {
        if (j.etag) STANJE.poslednjiEtag = j.etag;
        return;
      }
      poslednjiPrimenjenGen = mojGen;
      STANJE.poslednjiEtag = j.etag || r.headers.get('etag') || '';
      primiStanje({ aktivnaNedelja: j.aktivna_nedelja, teme: j.teme, kontakt: j.kontakt, zapisi: j.zapisi, statistika: j.statistika });
      await idbSacuvajKes('poslednje_stanje', {
        aktivnaNedelja: STANJE.aktivnaNedelja,
        teme: STANJE.teme,
        kontakt: STANJE.kontakt,
        zapisi: STANJE.sviServerZapisi,
        statistika: STANJE.sveStatistika
      });
      crtajPodatke(false);
    } catch {
      // U offline režimu prikaži poslednje keširano stanje
      if (STANJE.sviServerZapisi.length === 0) {
        const kes = await idbProcitajKes('poslednje_stanje');
        if (kes) {
          primiStanje(kes);
          crtajPodatke(false);
        }
      }
    } finally {
      STANJE.ucitavanjeStanjaUToku = false;
    }
  }

  function sviVidljiviZapisi() {
    const serverUuidSkup = new Set();
    for (const sz of STANJE.sviServerZapisi) {
      if (sz && sz.uuid_klijenta) serverUuidSkup.add(sz.uuid_klijenta);
    }
    const lokalni = STANJE.lokalniRed
      .filter(q => !q.uuid_klijenta || !serverUuidSkup.has(q.uuid_klijenta))
      .filter(q => !STANJE.poVezbi || Number(q.nedelja || 1) === aktivnaNedelja())
      .map(q => ({
        id: 'local-' + q.uuid_klijenta,
        uuid_klijenta: q.uuid_klijenta,
        uTelefonu: true,
        trajna_greska: q.trajna_greska || '',
        tim: q.tim,
        uredjaj_id: (STANJE.sesija && STANJE.sesija.tim === q.tim && Number(STANJE.sesija.uredjaj_id)) || 0,
        autor: q.nadimak || q.oznaka_uredjaja || 'član tima',
        nedelja: q.nedelja,
        kategorije: q.kategorije || [],
        lat: q.lat,
        lon: q.lon,
        tacnost_m: q.tacnost_m,
        radijus_m: q.radijus_m,
        vreme: q.vreme_snimka || q.vreme_telefona,
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
    if (STANJE.filterTim) {
      const clan = STANJE.filterClan;
      return spojeno.filter(z => z.tim === STANJE.filterTim && (!clan || Number(z.uredjaj_id) === clan));
    }
    return spojeno;
  }

  // --- Dnevnik jednog tima ili jednog člana (isti filter važi i za mapu) ---
  // „Član“ je telefon (uredjaj_id), kao i u rang-listi; ime je potpis sa njegovog najnovijeg zapisa.
  function clanoviTima(tim) {
    const poId = new Map();
    for (const z of STANJE.serverZapisi) {
      if (z.tim !== tim) continue;
      const id = Number(z.uredjaj_id) || 0;
      let c = poId.get(id);
      if (!c) {
        c = { id, ime: z.autor || 'član tima', zapisa: 0, zadatak: 0, nivoi: [0, 0, 0], vrste: { foto: 0, video: 0, zvuk: 0 }, dani: new Set(), prvi: z.vreme, poslednji: z.vreme };
        poId.set(id, c);
      }
      c.zapisa++;
      if (Number(z.nedelja || 1) === aktivnaNedelja()) {
        c.zadatak++;
        c.dani.add(danZapisa(z.vreme));
        c.nivoi[nivoZapisa(z) - 1]++;
      }
      for (const p of z.prilozi || []) if (p && c.vrste[p.vrsta] !== undefined) c.vrste[p.vrsta]++;
      if (String(z.vreme || '') < String(c.prvi || '')) c.prvi = z.vreme;
      if (String(z.vreme || '') > String(c.poslednji || '')) c.poslednji = z.vreme;
    }
    return Array.from(poId.values()).sort((a, b) => b.zadatak - a.zadatak || b.zapisa - a.zapisa || a.ime.localeCompare(b.ime));
  }

  function saberiClanove(clanovi) {
    const s = { zapisa: 0, zadatak: 0, nivoi: [0, 0, 0], vrste: { foto: 0, video: 0, zvuk: 0 }, prvi: '', poslednji: '' };
    for (const c of clanovi) {
      s.zapisa += c.zapisa;
      s.zadatak += c.zadatak;
      for (let i = 0; i < 3; i++) s.nivoi[i] += c.nivoi[i];
      for (const k of Object.keys(s.vrste)) s.vrste[k] += c.vrste[k];
      if (!s.prvi || String(c.prvi) < s.prvi) s.prvi = String(c.prvi || '');
      if (String(c.poslednji || '') > s.poslednji) s.poslednji = String(c.poslednji || '');
    }
    return s;
  }

  function tekstNivoa(n) {
    return STANJE.jezik === 'en'
      ? `level 1: ${n[0]} · level 2: ${n[1]} · level 3: ${n[2]}`
      : `nivo 1: ${n[0]} · nivo 2: ${n[1]} · nivo 3: ${n[2]}`;
  }

  function tekstVrsta(v) {
    return STANJE.jezik === 'en'
      ? `photos ${v.foto} · videos ${v.video} · sounds ${v.zvuk}`
      : `slika ${v.foto} · videa ${v.video} · zvukova ${v.zvuk}`;
  }

  function htmlTrakaNivoa(n) {
    const uk = n[0] + n[1] + n[2];
    return `<div class="rank-bar lvl" role="img" aria-label="${esc(tekstNivoa(n))}">${[0, 1, 2].map(i =>
      (n[i] > 0 ? `<i class="l${i + 1}" style="width:${((n[i] / uk) * 100).toFixed(1)}%"></i>` : '')).join('')}</div>`;
  }

  function linkDnevnika(tim, clan) {
    const u = new URL(location.href);
    u.hash = '';
    u.searchParams.set('dnevnik', clan ? `${tim}.${clan}` : tim);
    return u.toString();
  }

  function postaviFilter(tim, clan) {
    STANJE.filterTim = tim ? String(tim) : '';
    STANJE.filterClan = STANJE.filterTim && Number(clan) > 0 ? Number(clan) : 0;
    STANJE.filter = STANJE.filterTim ? 'tim' : 'svi';
    STANJE.dnevnikPrikazano = 30;
    STANJE.trebaUokviriti = Boolean(STANJE.filterTim);
    crtajPodatke();
    if (STANJE.pogled === 'mapa') uokviriOpsegNaMapi();
  }

  let potpisIzboraFiltera = '';
  // Birači tima i člana, dugmad „Ceo grad / Naš tim“, oznaka na mapi i kartica sa zbirom izabranog dnevnika.
  function osveziPrikazFiltera() {
    const en = STANJE.jezik === 'en';
    const tim = STANJE.filterTim;
    const mojTim = (STANJE.sesija && STANJE.sesija.tim) || '';
    document.getElementById('filter-all-btn').classList.toggle('active', !tim);
    document.getElementById('filter-team-btn').classList.toggle('active', Boolean(tim) && tim === mojTim && !STANJE.filterClan);

    const selTim = document.getElementById('scope-team');
    const selClan = document.getElementById('scope-member');
    const karta = document.getElementById('journal-scope-card');
    const cip = document.getElementById('map-scope-chip');
    if (!selTim || !selClan || !karta || !cip) return;

    const brojPoTimu = new Map();
    for (const z of STANJE.serverZapisi) brojPoTimu.set(z.tim, (brojPoTimu.get(z.tim) || 0) + 1);
    if (tim && !brojPoTimu.has(tim)) brojPoTimu.set(tim, 0);
    const timovi = Array.from(brojPoTimu.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const clanovi = tim ? clanoviTima(tim) : [];
    const izabran = STANJE.filterClan ? clanovi.find(c => c.id === STANJE.filterClan) : null;

    // Birači se pregrađuju samo kad se promeni njihov sadržaj, da otvoren birač na telefonu ne bude zatvoren osvežavanjem.
    const potpis = [STANJE.jezik, tim, mojTim, timovi.map(k => k + ':' + brojPoTimu.get(k)).join(','), clanovi.map(c => `${c.id}:${c.ime}:${c.zapisa}`).join(',')].join('|');
    if (potpis !== potpisIzboraFiltera) {
      potpisIzboraFiltera = potpis;
      selTim.innerHTML = `<option value="">${esc(en ? 'All teams' : 'Svi timovi')} (${STANJE.serverZapisi.length})</option>` +
        timovi.map(k => `<option value="${esc(k)}">${esc(k)}${k === mojTim ? (en ? ' · our team' : ' · naš tim') : ''} (${brojPoTimu.get(k)})</option>`).join('');
      selClan.innerHTML = `<option value="0">${esc(en ? 'Whole team' : 'Ceo tim')}</option>` +
        clanovi.map(c => `<option value="${c.id}">${esc(c.ime)} (${c.zapisa})</option>`).join('');
    }
    selTim.value = tim;
    selClan.value = String(izabran ? izabran.id : 0);
    document.getElementById('scope-member-field').hidden = !tim || clanovi.length === 0;
    document.getElementById('journal-intro-card').hidden = Boolean(tim);

    cip.hidden = !tim;
    karta.hidden = !tim;
    if (!tim) { karta.innerHTML = ''; return; }
    const imeClana = STANJE.filterClan ? ((izabran && izabran.ime) || (en ? 'member' : 'član')) : '';
    cip.textContent = `${tim}${imeClana ? ' · ' + imeClana : ''}  ✕`;
    cip.title = en ? 'Showing only these entries. Tap to show the whole city.' : 'Prikazani su samo ovi zapisi. Dodirni za ceo grad.';

    const zbir = STANJE.filterClan ? (izabran || saberiClanove([])) : saberiClanove(clanovi);
    const min = minimumPoClanu();
    const stTim = (STANJE.serverStatistika.po_timu || {})[tim];
    const redovi = [];
    if (STANJE.filterClan) {
      redovi.push(`${en ? 'Task' : 'Zadatak'} ${aktivnaNedelja()}: ${zbir.zadatak}/${min}${zbir.zadatak >= min ? ' ✓' : ''}` +
        (brojiDane() && zbir.dani ? ' · ' + tekstDana(zbir.dani.size) : ''));
    } else {
      const z = stTim && stTim.zadatak;
      redovi.push((en ? `entries ${zbir.zapisa} · members with entries ${clanovi.length}` : `zapisa ${zbir.zapisa} · članova sa zapisima ${clanovi.length}`) +
        (z ? (en ? ` · done ${z.ispunilo}/${z.clanova}` : ` · ispunilo ${z.ispunilo}/${z.clanova}`) : '') +
        (stTim ? ` · ${Number(stTim.otkriveno_m2 || 0).toLocaleString('sr-RS')} m²` : ''));
    }
    redovi.push(tekstNivoa(zbir.nivoi) + ' · ' + tekstVrsta(zbir.vrste));
    if (zbir.zapisa > 0) redovi.push(`${formatVreme(zbir.prvi)} – ${formatVreme(zbir.poslednji)}`);
    karta.innerHTML = `
      <h2><span class="entry-team-badge">${esc(tim)}</span><span>${esc(STANJE.filterClan
        ? (en ? `Journal · ${imeClana}` : `Dnevnik · ${imeClana}`)
        : (en ? 'Team journal' : 'Dnevnik tima'))}</span></h2>
      ${zbir.zadatak > 0 ? `<div class="rank-line">${htmlTrakaNivoa(zbir.nivoi)}</div>` : ''}
      ${redovi.map(r => `<div class="rank-sub">${esc(r)}</div>`).join('')}
      <div class="scope-actions">
        ${STANJE.filterClan ? `<button type="button" class="link-btn" data-scope-team>${esc(en ? 'Whole team' : 'Ceo tim')}</button>` : ''}
        <button type="button" class="link-btn" data-scope-map>${esc(en ? 'Show on map' : 'Prikaži na mapi')}</button>
        <button type="button" class="link-btn" data-scope-link>${esc(en ? 'Copy link' : 'Kopiraj link')}</button>
        <button type="button" class="link-btn" data-scope-all>${esc(en ? 'All teams' : 'Svi timovi')}</button>
      </div>`;
    const naDugme = (sel, fn) => { const b = karta.querySelector(sel); if (b) b.onclick = fn; };
    naDugme('[data-scope-team]', () => postaviFilter(tim, 0));
    naDugme('[data-scope-all]', () => postaviFilter('', 0));
    naDugme('[data-scope-map]', () => { STANJE.trebaUokviriti = true; postaviPogled('mapa'); });
    naDugme('[data-scope-link]', async () => {
      const link = linkDnevnika(tim, STANJE.filterClan);
      try {
        await navigator.clipboard.writeText(link);
        toast(en ? 'Link copied.' : 'Link je kopiran.');
      } catch {
        window.prompt(en ? 'Copy the link:' : 'Kopiraj link:', link);
      }
    });
  }

  // Uokviruje na mapi sve zapise izabranog tima ili člana; jednom po izboru, da ne otima mapu dok je student pomera.
  function uokviriOpsegNaMapi() {
    if (!STANJE.trebaUokviriti || !STANJE.filterTim || !STANJE.mapa || !STANJE.mapaSpremna) return;
    const tacke = sviVidljiviZapisi().filter(z => Number.isFinite(Number(z.lat)) && Number.isFinite(Number(z.lon)));
    if (!tacke.length) return;
    STANJE.trebaUokviriti = false;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const z of tacke) {
      minLon = Math.min(minLon, Number(z.lon)); maxLon = Math.max(maxLon, Number(z.lon));
      minLat = Math.min(minLat, Number(z.lat)); maxLat = Math.max(maxLat, Number(z.lat));
    }
    setTimeout(() => {
      try { STANJE.mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 70, maxZoom: 18, duration: 700 }); } catch {}
    }, 80);
  }

  // Link oblika ?dnevnik=T53 ili ?dnevnik=T53.12 otvara odmah dnevnik tima ili člana.
  function primeniFilterIzAdrese() {
    const sirovo = String(new URLSearchParams(location.search).get('dnevnik') || '').trim();
    const m = /^([A-Za-z0-9_-]{1,12})(?:\.(\d{1,9}))?$/.exec(sirovo);
    if (!m) return;
    STANJE.filterTim = m[1];
    STANJE.filterClan = Number(m[2]) || 0;
    STANJE.filter = 'tim';
    STANJE.trebaUokviriti = true;
    STANJE.pogled = 'lista';
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
    // Godina se ispisuje samo kad nije tekuća: slika iz galerije može biti starija od vežbe i to mora da se vidi.
    const opcije = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    if (d.getFullYear() !== new Date().getFullYear()) opcije.year = 'numeric';
    return d.toLocaleString(STANJE.jezik === 'en' ? 'en-GB' : 'sr-RS', opcije);
  }

  // --- Zadatak 1: minimum po članu, tri nivoa popunjenosti i rang timova ---
  // Isto pravilo nivoa je na serveru (server/lib/stanje.cjs, imaBogatMedij, nivoZapisa); menjaju se zajedno.
  function imaBogatMedij(prilozi) {
    if (!Array.isArray(prilozi) || !prilozi.length) return false;
    if (prilozi.length >= 3) return true;
    const vrste = new Set();
    for (const p of prilozi) if (p && p.vrsta) vrste.add(p.vrsta);
    return vrste.size >= 2;
  }

  function nivoZapisa(z) {
    const prilozi = Array.isArray(z && z.prilozi) ? z.prilozi : [];
    const imaPrilog = prilozi.length > 0;
    const imaTekst = String((z && z.tekst) || '').trim().length >= 40;
    const imaSloj = Array.isArray(z && z.kategorije) && z.kategorije.length > 0;
    const bogat = imaBogatMedij(prilozi);
    const stubova = (imaTekst ? 1 : 0) + (imaSloj ? 1 : 0) + (bogat ? 1 : 0);
    if (imaPrilog && stubova >= 2) return 3;
    return stubova >= 1 ? 2 : 1;
  }

  function staFaliZaNivo3(tekst, kategorije, prilozi) {
    const listaPriloga = Array.isArray(prilozi) ? prilozi : [];
    const imaPrilog = listaPriloga.length > 0;
    const imaTekst = String(tekst || '').trim().length >= 40;
    const imaSloj = Array.isArray(kategorije) && kategorije.length > 0;
    const bogat = imaBogatMedij(listaPriloga);
    const stubova = (imaTekst ? 1 : 0) + (imaSloj ? 1 : 0) + (bogat ? 1 : 0);
    if (imaPrilog && stubova >= 2) return '';
    if (bogat && !imaTekst && !imaSloj) return `${t('faliTekst')} ${t('ili')} ${t('faliSloj')}`;
    const fali = [];
    if (!imaPrilog) fali.push(t('faliPrilog'));
    if (!imaTekst) fali.push(t('faliTekst'));
    if (!imaSloj) fali.push(t('faliSloj'));
    return fali.join(', ');
  }

  function htmlNivoa(z) {
    const n = nivoZapisa(z);
    return `<span class="lvl-badge lvl-${n}" title="${esc(t('nivoOpis', n))}"><span class="lvl-dots" aria-hidden="true">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span> ${esc(t('nivoKratko', n))}</span>`;
  }

  function htmlCipoviSloja(izabrani) {
    const skup = new Set(izabrani || []);
    const poznati = Array.from(document.querySelectorAll('#comp-tags .choice-chip'))
      .map(c => ({ tag: c.getAttribute('data-tag'), naziv: c.textContent }));
    for (const k of skup) {
      if (!poznati.some(p => p.tag === k)) poznati.push({ tag: k, naziv: k });
    }
    return poznati.map(p =>
      `<button type="button" class="choice-chip ${skup.has(p.tag) ? 'selected' : ''}" data-edit-tag="${esc(p.tag)}">${esc(p.naziv)}</button>`
    ).join('');
  }

  function minimumPoClanu() {
    return Number(STANJE.serverStatistika && STANJE.serverStatistika.minimum_po_clanu) || 15;
  }

  // „Član“ je telefon: broje se zapisi Zadatka 1 poslati sa ovog uređaja koji su stigli na server.
  function mojNapredak() {
    if (!STANJE.sesija || !STANJE.sesija.uredjaj_id) return null;
    const mojId = Number(STANJE.sesija.uredjaj_id);
    const nivoi = [0, 0, 0];
    const dani = new Set();
    let zapisa = 0;
    for (const z of STANJE.serverZapisi) {
      if (Number(z.uredjaj_id) !== mojId || Number(z.nedelja || 1) !== aktivnaNedelja()) continue;
      zapisa++;
      nivoi[nivoZapisa(z) - 1]++;
      dani.add(danZapisa(z.vreme));
    }
    return { zapisa, nivoi, dana: dani.size };
  }

  function osveziRangCip() {
    const lbl = document.getElementById('rang-label');
    const btn = document.getElementById('btn-rang');
    if (!lbl || !btn) return;
    const ja = mojNapredak();
    const min = minimumPoClanu();
    lbl.textContent = ja ? `${ja.zapisa}/${min}` : t('rangDugme');
    btn.classList.toggle('done', Boolean(ja && ja.zapisa >= min));
  }

  function crtajRangListu() {
    const telo = document.getElementById('rank-body');
    if (!telo) return;
    const en = STANJE.jezik === 'en';
    const min = minimumPoClanu();
    const st = STANJE.serverStatistika || {};
    const poTimu = st.po_timu || {};
    const procenat = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
    const nivoiTxt = tekstNivoa;
    const trakaNivoa = htmlTrakaNivoa;
    const mojId = Number(STANJE.sesija && STANJE.sesija.uredjaj_id) || 0;
    const htmlClanova = tim => {
      const clanovi = clanoviTima(tim).filter(c => c.zadatak > 0);
      if (!clanovi.length) return '';
      return `
          <details class="rank-members-box" data-rank-box="${esc(tim)}"${STANJE.rangOtvoreni.has(tim) ? ' open' : ''}>
            <summary>${esc(en ? `Members (${clanovi.length})` : `Članovi (${clanovi.length})`)}</summary>
            <ul class="rank-member-list">${clanovi.map(c => `
              <li class="rank-member ${c.id === mojId ? 'me' : ''}">
                <button type="button" class="rank-member-btn" data-rank-tim="${esc(tim)}" data-rank-clan="${c.id}" title="${esc(en ? 'Open the journal of this member' : 'Otvori dnevnik ovog člana')}">
                  <span class="rank-member-name">${esc(c.ime)}</span>
                  <div class="rank-bar"><i style="width:${procenat(c.zadatak, min).toFixed(1)}%"></i></div>
                  <span class="rank-num">${c.zadatak}/${min}${c.zadatak >= min ? ' ✓' : ''}</span>
                </button>
                <div class="rank-line">${trakaNivoa(c.nivoi)}</div>
                <div class="rank-sub">${esc(nivoiTxt(c.nivoi) + ' · ' + tekstVrsta(c.vrste) + (brojiDane() ? ' · ' + tekstDana(c.dani.size) : '') + ' · ' + (en ? 'last ' : 'poslednji ') + formatVreme(c.poslednji))}</div>
              </li>`).join('')}
            </ul>
          </details>`;
    };

    let html = '';
    const ja = mojNapredak();
    if (ja) {
      const fali = Math.max(0, min - ja.zapisa);
      html += `
        <section class="rank-me">
          <strong>${esc(en ? `My progress · Task ${aktivnaNedelja()}` : `Moj napredak · Zadatak ${aktivnaNedelja()}`)}</strong>
          <div class="rank-line">
            <div class="rank-bar"><i style="width:${procenat(ja.zapisa, min).toFixed(1)}%"></i></div>
            <span class="rank-num">${ja.zapisa}/${min}</span>
          </div>
          <div class="rank-sub">${esc(fali > 0
            ? (en ? `${fali} more to complete the task` : `još ${fali} do kompletnog zadatka`)
            : (en ? 'Task complete ✓' : 'Zadatak je kompletan ✓'))}</div>
          ${brojiDane() && ja.zapisa > 0 ? `<div class="rank-sub">${esc(en ? `Different days with entries: ${ja.dana}` : `Različitih dana sa zapisima: ${ja.dana}`)}</div>` : ''}
          ${ja.zapisa > 0 ? `<div class="rank-line">${trakaNivoa(ja.nivoi)}</div><div class="rank-sub">${esc(nivoiTxt(ja.nivoi))}</div>` : ''}
        </section>`;
    }

    const redovi = Object.keys(poTimu)
      .filter(k => poTimu[k] && poTimu[k].zadatak && Array.isArray(poTimu[k].zadatak.nivoi))
      .map(k => {
        const z = poTimu[k].zadatak;
        const uk = z.nivoi[0] + z.nivoi[1] + z.nivoi[2];
        return { tim: k, z, uk, udeoClanova: procenat(z.ispunilo, z.clanova), udeoCilja: procenat(z.napredak, z.cilj), udeo3: procenat(z.nivoi[2], uk) };
      })
      .filter(r => r.uk > 0);
    // Redosled: prvo koliko je članova ispunilo minimum, pa koliko je tim blizu cilja, pa udeo potpunih zapisa.
    redovi.sort((a, b) =>
      b.udeoClanova - a.udeoClanova || b.udeoCilja - a.udeoCilja || b.udeo3 - a.udeo3 || b.uk - a.uk || a.tim.localeCompare(b.tim));

    if (!redovi.length) {
      html += `<p class="rank-empty">${esc(Object.keys(poTimu).length
        ? (en ? 'The ranking will appear as soon as the server is updated.' : 'Rang-lista će se pojaviti čim se server osveži.')
        : (en ? 'No entries yet.' : 'Još nema zapisa.'))}</p>`;
    } else {
      const mojTim = STANJE.sesija && STANJE.sesija.tim;
      html += `<ol class="rank-list">${redovi.map((r, i) => `
        <li class="rank-row ${r.tim === mojTim ? 'mine' : ''}">
          <div class="rank-head">
            <span class="rank-pos">${i + 1}</span>
            <span class="entry-team-badge">${esc(r.tim)}</span>
            <span class="rank-members">${r.z.ispunilo}/${r.z.clanova} ${esc(en ? 'members done' : 'članova ispunilo')}${r.z.ispunilo >= r.z.clanova ? ' ✓' : ''}</span>
            <button type="button" class="rank-open" data-rank-tim="${esc(r.tim)}" data-rank-clan="0">${esc(en ? 'Team journal →' : 'Dnevnik tima →')}</button>
          </div>
          <div class="rank-line">
            <span class="rank-cap">${esc(en ? 'Quantity' : 'Količina')}</span>
            <div class="rank-bar"><i style="width:${r.udeoCilja.toFixed(1)}%"></i></div>
            <span class="rank-num">${r.z.napredak}/${r.z.cilj}</span>
          </div>
          <div class="rank-line">
            <span class="rank-cap">${esc(en ? 'Completeness' : 'Popunjenost')}</span>
            ${trakaNivoa(r.z.nivoi)}
            <span class="rank-num">${Math.round(r.udeo3)}%</span>
          </div>
          <div class="rank-sub">${esc((en ? `entries ${r.uk} · ` : `zapisa ${r.uk} · `) + nivoiTxt(r.z.nivoi))}</div>${htmlClanova(r.tim)}
        </li>`).join('')}</ol>`;
      const bez = Math.max(0, (Number(st.timova_ukupno) || 0) - redovi.length);
      if (bez > 0) html += `<p class="rank-empty">${esc(en ? `${bez} more teams have no entries yet.` : `Još ${bez} timova nema nijedan zapis.`)}</p>`;
    }
    telo.innerHTML = html;
    telo.querySelectorAll('[data-rank-box]').forEach(d => {
      d.addEventListener('toggle', () => {
        const tim = d.getAttribute('data-rank-box');
        if (d.open) STANJE.rangOtvoreni.add(tim); else STANJE.rangOtvoreni.delete(tim);
      });
    });
    telo.querySelectorAll('[data-rank-tim]').forEach(b => {
      b.onclick = () => {
        zatvoriSvePanele();
        postaviFilter(b.getAttribute('data-rank-tim'), Number(b.getAttribute('data-rank-clan')) || 0);
        postaviPogled('lista');
        document.getElementById('list-wrap').scrollTop = 0;
      };
    });
  }

  function urlSliciceMedija(punUrl) {
    if (!punUrl || punUrl.startsWith('blob:') || punUrl.startsWith('data:')) return punUrl;
    return punUrl + (punUrl.includes('?') ? '&' : '?') + 'slicica=1';
  }

  // Raspored Dnevnika: 'lista' (jedna kolona, sve akcije) ili 'mreza' (pločice; dodir otvara ceo zapis).
  // Izbor se pamti na uređaju; bez izbora široki ekran kreće u mreži, a telefon u listi.
  function pocetniRasporedDnevnika(sacuvano, sirinaPx) {
    if (sacuvano === 'mreza' || sacuvano === 'lista') return sacuvano;
    return Number(sirinaPx) >= 900 ? 'mreza' : 'lista';
  }

  function primeniRasporedDnevnika(raspored, zapamti = false) {
    const mreza = raspored === 'mreza';
    STANJE.raspored = mreza ? 'mreza' : 'lista';
    if (zapamti) { try { localStorage.setItem(LS_RASPORED, STANJE.raspored); } catch {} }
    const omot = document.getElementById('list-wrap');
    if (omot) omot.classList.toggle('mreza', mreza);
    const dLista = document.getElementById('layout-list-btn');
    const dMreza = document.getElementById('layout-grid-btn');
    if (dLista) { dLista.classList.toggle('active', !mreza); dLista.setAttribute('aria-pressed', String(!mreza)); }
    if (dMreza) { dMreza.classList.toggle('active', mreza); dMreza.setAttribute('aria-pressed', String(mreza)); }
    // U mreži su zvuk i video sakriveni iza oznake, pa ne smeju da nastave da sviraju nevidljivi.
    if (mreza) document.querySelectorAll('#journal-feed audio, #journal-feed video').forEach(m => { try { m.pause(); } catch {} });
  }

  // Kratka oznaka zvuka i videa za pločicu u mreži (npr. „♪ 1 · ▶ 2“).
  function oznakaAvPriloga(brZvuka, brVidea) {
    const delovi = [];
    if (brZvuka > 0) delovi.push('♪ ' + brZvuka);
    if (brVidea > 0) delovi.push('▶ ' + brVidea);
    return delovi.join(' · ');
  }

  function htmlPriloziZapisa(prilozi, uDetalju = false) {
    if (!prilozi || !prilozi.length) return '';
    const slike = [];
    const av = [];
    const preloadMod = uDetalju ? 'metadata' : 'none';
    let brZvuka = 0;
    let brVidea = 0;
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
        const imgSrc = (!uDetalju && !p.lokalniBlob) ? urlSliciceMedija(src) : src;
        slike.push(`<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(imgSrc)}" loading="lazy" decoding="async" alt="Fotografija sa terena"></a>`);
      } else if (p.vrsta === 'zvuk') {
        brZvuka++;
        av.push(`<audio controls preload="${preloadMod}" src="${esc(src)}"></audio>`);
      } else if (p.vrsta === 'video') {
        brVidea++;
        if (p.obrada_status === 'obrada') {
          av.push(`<div class="video-proc-note">${esc(t('videoObrada'))}</div>`);
        }
        av.push(`<video controls playsinline preload="${preloadMod}" src="${esc(src)}"></video>`);
      }
    }
    return `
      ${slike.length ? `<div class="entry-media-grid"${slike.length > 1 ? ` data-vise="${slike.length - 1}"` : ''}>${slike.join('')}</div>` : ''}
      ${av.length ? `<div class="entry-media-full" data-oznaka="${esc(oznakaAvPriloga(brZvuka, brVidea))}">${av.join('')}</div>` : ''}
    `;
  }

  let poslednjiPotpisPrikaza = '';

  function napraviPotpisPrikaza(zapisi, m2) {
    const limit = Math.min(zapisi.length, STANJE.dnevnikPrikazano);
    const delovi = [`${STANJE.jezik}|${STANJE.filterTim}|${STANJE.filterClan}|${STANJE.apiBaza || ''}|${m2}|${zapisi.length}|${limit}`];
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
    osveziPrikazFiltera();
    osveziRangCip();
    const rangPanel = document.getElementById('modal-rank');
    if (rangPanel && !rangPanel.hidden) crtajRangListu();

    // Metrika otkrivenosti (m²)
    let m2 = STANJE.serverStatistika.otkriveno_m2_ukupno || 0;
    if (STANJE.filterTim) {
      const stTim = (STANJE.serverStatistika.po_timu || {})[STANJE.filterTim];
      m2 = stTim ? stTim.otkriveno_m2 : 0;
    }
    // Površina se računa na serveru po timu; za jednog člana je nema, pa se ne prikazuje tuđi broj.
    document.getElementById('metric-m2').textContent = STANJE.filterClan ? '—' : `${m2.toLocaleString('sr-RS')} m²`;

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
          <article class="entry-card ${z.uTelefonu ? 'queued' : ''}" data-card-id="${esc(z.id)}" data-card-idx="${idx}">
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
              <span class="entry-foot-meta"><span>±${Math.round(z.tacnost_m || 12)} m · R=${Math.round(z.radijus_m || 12)} m</span>${htmlNivoa(z)}</span>
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

      // Mreža: dodir na pločicu (van dugmadi i polja za izmenu) otvara ceo zapis sa svim prilozima.
      feed.onclick = ev => {
        if (STANJE.raspored !== 'mreza') return;
        const meta = ev.target;
        if (!meta || !meta.closest) return;
        if (meta.closest('button, select, textarea, input, .inline-edit-holder')) return;
        const kartica = meta.closest('[data-card-idx]');
        if (!kartica) return;
        const z = zapisi[Number(kartica.getAttribute('data-card-idx'))];
        if (!z) return;
        ev.preventDefault();
        otvoriDetaljZapisa(z);
      };

      feed.querySelectorAll('[data-goto-idx]').forEach(btn => {
        btn.onclick = () => {
          const z = zapisi[Number(btn.getAttribute('data-goto-idx'))];
          if (!z) return;
          STANJE.trebaUokviriti = false;
          if (STANJE.mapa && STANJE.mapaSpremna) {
            STANJE.cekaFokusMape = null;
            postaviPogled('mapa');
            STANJE.mapa.flyTo({ center: [z.lon, z.lat], zoom: 18, duration: 750 });
          } else {
            STANJE.cekaFokusMape = { lon: Number(z.lon), lat: Number(z.lat), zoom: 18 };
            postaviPogled('mapa');
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
              <div class="chip-grid">${htmlCipoviSloja(z.kategorije)}</div>
              <div class="edit-hint" data-edit-hint></div>
              <div style="display:flex;gap:6px;justify-content:flex-end">
                <button type="button" class="btn-secondary" data-cancel-ed style="padding:6px 12px;min-height:34px">Otkaži</button>
                <button type="button" class="btn-primary" data-save-ed style="width:auto;padding:6px 14px;min-height:34px">Sačuvaj</button>
              </div>
            </div>
          `;
          const osveziSavet = () => {
            const kat = holder.querySelectorAll('.choice-chip.selected');
            const fali = staFaliZaNivo3(holder.querySelector('textarea').value, Array.from(kat), z.prilozi);
            holder.querySelector('[data-edit-hint]').textContent = fali ? t('zaNivo3', fali) : t('nivo3Dostignut');
          };
          holder.querySelectorAll('[data-edit-tag]').forEach(c => {
            c.onclick = () => { c.classList.toggle('selected'); osveziSavet(); };
          });
          holder.querySelector('textarea').addEventListener('input', osveziSavet);
          osveziSavet();
          holder.querySelector('[data-cancel-ed]').onclick = () => { holder.hidden = true; holder.innerHTML = ''; };
          holder.querySelector('[data-save-ed]').onclick = async () => {
            const val = holder.querySelector('textarea').value.trim();
            const kat = Array.from(holder.querySelectorAll('.choice-chip.selected')).map(c => c.getAttribute('data-edit-tag'));
            await sacuvajIzmenuSopstvenogZapisa(zid, val, kat);
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
  const kesPoligonaKrugova = new Map();
  let poslednjiPotpisMape = '';

  function napraviPoligonKruga(lon, lat, radijusM, tacaka = 16) {
    const koordinate = [];
    const dLat = radijusM / 111132;
    const dLon = radijusM / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= tacaka; i++) {
      const ugao = (i / tacaka) * 2 * Math.PI;
      koordinate.push([lon + dLon * Math.cos(ugao), lat + dLat * Math.sin(ugao)]);
    }
    return [koordinate];
  }

  function poligonKrugaIzKesa(lon, lat, radijusM) {
    const kljuc = `${lon.toFixed(6)}:${lat.toFixed(6)}:${radijusM}`;
    let pol = kesPoligonaKrugova.get(kljuc);
    if (!pol) {
      if (kesPoligonaKrugova.size > 5000) kesPoligonaKrugova.clear();
      pol = napraviPoligonKruga(lon, lat, radijusM);
      kesPoligonaKrugova.set(kljuc, pol);
    }
    return pol;
  }

  function napraviPotpisMape(zapisi, mojTim) {
    const delovi = [`${mojTim || ''}|${zapisi.length}`];
    for (let i = 0; i < zapisi.length; i++) {
      const z = zapisi[i];
      delovi.push(`${z.id}|${z.uTelefonu ? 1 : 0}|${z.tim}|${z.autor}|${z.lat}|${z.lon}|${z.radijus_m || 12}`);
    }
    return delovi.join('~');
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
        <span>GPS ${Number(z.lat).toFixed(5)}, ${Number(z.lon).toFixed(5)} (±${Math.round(z.tacnost_m || 12)} m)</span> ·
        ${htmlNivoa(z)}
      </div>
      ${jeMojServerZapis(z) && nivoZapisa(z) < 3 ? `<div class="edit-hint">${esc(t('zaNivo3Uredi', staFaliZaNivo3(z.tekst, z.kategorije, z.prilozi)))}</div>` : ''}
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
    const potpis = napraviPotpisMape(zapisi, mojTim);
    if (potpis === poslednjiPotpisMape) {
      STANJE._poslednjiZapisiMape = zapisi;
      return;
    }
    poslednjiPotpisMape = potpis;

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
        coordinates: poligonKrugaIzKesa(Number(z.lon), Number(z.lat), Number(z.radijus_m) || 12)
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
      minzoom: 13.5,
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'uTelefonu'], 1], '#d97706',
          ['==', ['get', 'moj'], 1], '#b8861b',
          '#176646'
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.06, 15, 0.14, 17, 0.22]
      }
    });

    mapa.addLayer({
      id: 'uz-krugovi-ivica',
      type: 'line',
      source: 'uz-krugovi',
      minzoom: 13.5,
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'uTelefonu'], 1], '#b45309',
          ['==', ['get', 'moj'], 1], '#8a6d1f',
          '#115037'
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 13.5, 0.9, 16.5, 1.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.25, 15, 0.48, 17, 0.72]
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

    poslednjiPotpisMape = '';
    azurirajPlavuTackuNaMapi();
    azurirajSlojeveMape(sviVidljiviZapisi());
    if (STANJE.cekaFokusMape) {
      const f = STANJE.cekaFokusMape;
      STANJE.cekaFokusMape = null;
      STANJE.trebaUokviriti = false;
      try { mapa.flyTo({ center: [f.lon, f.lat], zoom: f.zoom || 18, duration: 750 }); } catch {}
    } else if (STANJE.pogled === 'mapa' && STANJE.trebaUokviriti) {
      uokviriOpsegNaMapi();
    }
  }

  function inicijalizujMapu() {
    if (STANJE.mapa) return;
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
    if (jeMapa) {
      if (!STANJE.mapa) {
        inicijalizujMapu();
      } else {
        setTimeout(() => STANJE.mapa.resize(), 30);
        uokviriOpsegNaMapi();
      }
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
    document.querySelectorAll('[data-open-privacy]').forEach(b => {
      b.onclick = () => otvoriPanel('modal-privacy');
    });
    document.querySelectorAll('[data-open-snimanje]').forEach(b => {
      b.onclick = () => otvoriPanelVezbe(0, '');
    });
    document.getElementById('btn-vezba-razumem').onclick = potvrdiPanelVezbe;
    // Birač vežbe se crta na dva mesta i pregrađuje se, pa dodir hvata dokument.
    document.addEventListener('click', e => {
      const dugme = e.target && e.target.closest ? e.target.closest('[data-vezba]') : null;
      if (dugme) izaberiVezbu(dugme.getAttribute('data-vezba'));
    });
    document.getElementById('btn-rang').onclick = () => {
      if (STANJE.sesija && STANJE.sesija.tim && !STANJE.rangOtvoreni.size) STANJE.rangOtvoreni.add(STANJE.sesija.tim);
      crtajRangListu();
      otvoriPanel('modal-rank');
      ucitajStanjeSaServera(true);
    };

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
      document.getElementById('prof-izdanje').textContent = t('izdanjeApp') + ' ' + VERZIJA_APP;
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

    document.getElementById('filter-all-btn').onclick = () => postaviFilter('', 0);
    document.getElementById('map-scope-chip').onclick = () => postaviFilter('', 0);
    document.getElementById('scope-team').onchange = e => postaviFilter(e.target.value, 0);
    document.getElementById('scope-member').onchange = e => postaviFilter(STANJE.filterTim, Number(e.target.value) || 0);

    document.getElementById('filter-team-btn').onclick = () => {
      if (!STANJE.sesija || !STANJE.sesija.tim) {
        toast(t('potrebnaPrijava'));
        pripremiPrijavuPanel();
        return;
      }
      postaviFilter(STANJE.sesija.tim, 0);
    };

    document.getElementById('layout-list-btn').onclick = () => primeniRasporedDnevnika('lista', true);
    document.getElementById('layout-grid-btn').onclick = () => primeniRasporedDnevnika('mreza', true);

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
      prekiniGpsPracenje();
      STANJE.gpsGreska = '';
      pokreniGps(true);
    };

    const btnRetryGps = document.getElementById('btn-retry-gps');
    if (btnRetryGps) {
      btnRetryGps.onclick = () => {
        zatvoriSvePanele();
        STANJE.gpsRucno = true;
        prekiniGpsPracenje();
        STANJE.gpsGreska = '';
        pokreniGps(true);
      };
    }

    document.getElementById('btn-open-composer').onclick = otvoriKompozitor;
    const btnUpd = document.getElementById('btn-update-app');
    if (btnUpd) btnUpd.onclick = () => osveziAplikaciju(STANJE.novaVerzijaDostupna);
    document.getElementById('btn-submit-login').onclick = () => izvrsiPrijavu();
    document.getElementById('btn-login-new-member').onclick = () => izvrsiPrijavu({ novi_clan: true });

    // Dugme „Kako da dozvolim lokaciju“ stoji uz grešku odbijene lokacije i otvara korake unutar zapisa.
    // Panel uputstva bi zatvorio zapis i obrisao dodate priloge, pa se koraci ovde prepisuju iz njega.
    (() => {
      const err = document.getElementById('comp-error');
      const kutija = document.getElementById('comp-gps-help');
      const dugme = document.getElementById('btn-comp-gps-help');
      const koraci = document.getElementById('comp-gps-steps');
      if (!err || !kutija || !dugme || !koraci) return;
      const uskladi = () => {
        const treba = !err.hidden && err.textContent === t('potrebanGpsOdbijen');
        if (kutija.hidden === !treba) return;
        kutija.hidden = !treba;
        if (!treba) {
          koraci.hidden = true;
          dugme.setAttribute('aria-expanded', 'false');
        }
      };
      new MutationObserver(uskladi).observe(err, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
      dugme.onclick = () => {
        if (!koraci.childElementCount) {
          const ua = navigator.userAgent || '';
          const moja = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : '';
          document.querySelectorAll('#modal-gps-help [data-gps-platforma]').forEach(l => {
            if (moja && l.getAttribute('data-gps-platforma') !== moja) return;
            koraci.appendChild(l.parentElement.cloneNode(true));
          });
        }
        koraci.hidden = !koraci.hidden;
        dugme.setAttribute('aria-expanded', String(!koraci.hidden));
        if (!koraci.hidden) koraci.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    })();
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

    // Dugmad slojeva se menjaju sa izabranom vežbom, pa dodir hvata njihova kutija.
    document.getElementById('comp-tags').onclick = e => {
      const chip = e.target && e.target.closest ? e.target.closest('.choice-chip') : null;
      if (!chip) return;
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

    const compTextEl = document.getElementById('comp-text');
    if (compTextEl) {
      compTextEl.addEventListener('input', sacuvajNacrtKompozitora);
    }

    const dodajSliku = async (f, gpsSlike) => {
      try {
        const opt = await optimizujSliku(f);
        if (gpsSlike) opt.gpsSlike = gpsSlike;
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
            trajanje: 0,
            gpsSlike: gpsSlike || null
          });
        } else {
          toast((err && err.message) || 'Slika nije mogla da se obradi.');
        }
      }
    };
    // .qta je QuickTime zvuk koji noviji Voice Memos čuva umesto .m4a; .caf, .flac, .amr i .m4b daju drugi snimači.
    const jeZvukFajl = f => (f.type || '').startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|aac|qta|caf|flac|amr|m4b)$/i.test(f.name || '');
    const jeVideoFajl = f => !jeZvukFajl(f) && ((f.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(f.name || ''));
    // Fajl bez tipa i bez poznatog nastavka: odlučuje početak sadržaja (kontejneri u kojima telefoni čuvaju zvuk).
    const pocetakLiciNaZvuk = b => {
      if (!b || b.length < 12) return false;
      const s = (od, n) => String.fromCharCode(...b.slice(od, od + n));
      return ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(s(4, 4)) || ['RIFF', 'OggS', 'fLaC', 'caff'].includes(s(0, 4)) ||
        s(0, 3) === 'ID3' || s(0, 5) === '#!AMR' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0);
    };
    // Server vrstu priloga čita iz tipa i nastavka. Zvuk koji telefon prijavi bez tipa ili kao video/quicktime (.qta)
    // šalje se kao audio/mp4, da ne završi u grani za video i bude odbijen.
    const kaoZvuk = f => ((f.type || '').startsWith('audio/') ? f : new File([f], f.name || 'zvuk.m4a', { type: 'audio/mp4', lastModified: f.lastModified }));
    const dodajSnimak = (f, gpsSlike) => {
      if (f.size > 90 * 1024 * 1024) {
        toast('Fajl prelazi 90 MB. Snimi kraći video (do 60 sekundi).');
        return;
      }
      const jeZvuk = jeZvukFajl(f);
      dodajPrilogUKompozitor({
        vrsta: jeZvuk ? 'zvuk' : 'video',
        ime: f.name || (jeZvuk ? 'zvuk.m4a' : 'video.mp4'),
        mime: f.type || (jeZvuk ? 'audio/mp4' : 'video/mp4'),
        blob: f,
        sirina: 0,
        visina: 0,
        trajanje: 0,
        gpsSlike: gpsSlike || null
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
    // Red o Voice Memos i „Choose Files“ važi samo za iPhone/iPad; na ostalim telefonima ostaje skriven.
    (() => {
      const red = document.getElementById('hint-zvuk-ios');
      if (red && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) red.hidden = false;
      // Isto važi za red o podešavanju kamere: 122 od 125 videa u Vežbi 1 stiglo je sa iPhone-a, u 1080p ili 4K.
      const redVideo = document.getElementById('hint-video-ios');
      if (redVideo && red && !red.hidden) redVideo.hidden = false;
    })();
    // Od 24.11.2026: zasebno polje bez filtera tipova, jer iPhone u polju sa accept zasivi snimak iz Voice Memos.
    document.getElementById('inp-file-zvuk').onchange = async e => {
      const errEl = document.getElementById('comp-error');
      for (const f of uzmiFajlove(e)) {
        let zvuk = jeZvukFajl(f);
        if (!zvuk && !jeSlika(f) && !jeVideoFajl(f)) {
          try { zvuk = pocetakLiciNaZvuk(new Uint8Array(await f.slice(0, 12).arrayBuffer())); } catch { zvuk = false; }
        }
        if (!zvuk) {
          errEl.textContent = t('fajlNijeZvuk', f.name || 'fajl');
          errEl.hidden = false;
          if (errEl.scrollIntoView) errEl.scrollIntoView({ block: 'nearest' });
          continue;
        }
        errEl.hidden = true;
        dodajSnimak(kaoZvuk(f));
      }
    };
    document.getElementById('inp-file-galerija').onchange = async e => {
      for (const f of uzmiFajlove(e)) {
        if (jeSlika(f)) {
          // Samo slika iz galerije nosi svoje mesto; slika iz kamere nastaje ovde i sada, pa važi GPS telefona.
          const imaoMesto = Boolean(gpsIzPrilogaKompozitora());
          const gpsSlike = await procitajGpsIzSlike(f);
          if (!gpsSlike) {
            // Od izdanja 2026-11-23.2: slika iz galerije bez svoje lokacije se ne prima, jer bi završila na mestu slanja.
            const errEl = document.getElementById('comp-error');
            errEl.textContent = t('slikaBezLokacije', f.name || 'slika');
            errEl.hidden = false;
            if (errEl.scrollIntoView) errEl.scrollIntoView({ block: 'nearest' });
            continue;
          }
          document.getElementById('comp-error').hidden = true;
          await dodajSliku(f, gpsSlike);
          if (gpsSlike && !imaoMesto && gpsIzPrilogaKompozitora()) toast(t('mestoIzSlike'));
        } else if (jeZvukFajl(f)) {
          dodajSnimak(kaoZvuk(f));
        } else {
          // Od izdanja 2026-11-23.3: video iz galerije mora u sebi nositi lokaciju, kao slika; inače bi završio na mestu slanja.
          // Video snimljen dugmetom „Snimi video“ nastaje ovde i sada, pa važi GPS telefona.
          const imaoMesto = Boolean(gpsIzPrilogaKompozitora());
          const metaVidea = await procitajMetaIzVidea(f);
          const errEl = document.getElementById('comp-error');
          if (!metaVidea) {
            errEl.textContent = t('videoBezLokacije', f.name || 'video');
            errEl.hidden = false;
            if (errEl.scrollIntoView) errEl.scrollIntoView({ block: 'nearest' });
            continue;
          }
          errEl.hidden = true;
          dodajSnimak(f, metaVidea);
          if (!imaoMesto && gpsIzPrilogaKompozitora()) toast(t('mestoIzVidea'));
        }
      }
    };

    document.getElementById('btn-record-audio').onclick = prekidacSnimanjaZvuka;
    document.getElementById('btn-save-entry').onclick = sacuvajNoviZapis;

    window.addEventListener('online', () => {
      sinhronizujRed();
      ucitajStanjeSaServera();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        // Kartica u pozadini ne čita lokaciju. Otvoren zapis pamti da je tražio mesto i nastavlja po povratku (npr. iz kamere).
        if (kompozitorOtvoren()) prekiniGpsPracenje();
        else zaustaviGps();
        return;
      }
      {
        if (STANJE.gps && Date.now() - (STANJE.gps.ts || 0) > GPS_SVEZ_MS) {
          STANJE.gps = null;
          osveziGpsPrikaz();
        }
        if (gpsZaZapis) traziMestoTelefona();
        drziEkranBudnim();
        if (STANJE.swRegistracija && typeof STANJE.swRegistracija.update === 'function') {
          STANJE.swRegistracija.update().catch(() => {});
        }
        if (pokusajAutomatskoOsvezavanje()) return;
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
    crtajPrivatnost();
    poveziDogadjaje();
    {
      let sacuvanRaspored = '';
      try { sacuvanRaspored = localStorage.getItem(LS_RASPORED) || ''; } catch {}
      primeniRasporedDnevnika(pocetniRasporedDnevnika(sacuvanRaspored, window.innerWidth));
    }
    primeniFilterIzAdrese();
    if (STANJE.pogled === 'lista') postaviPogled('lista');
    primeniJezik();
    // Na direktnom linku Dnevnika (?dnevnik=...) mapa se ne pokreće dok student ne pređe na 3D Mapu.
    if (STANJE.pogled === 'mapa') inicijalizujMapu();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => { STANJE.swRegistracija = reg; }).catch(() => {});
    }

    // Proba skladišta teče sa strane i ne zadržava pokretanje; poruka se pojavi samo ako je upis odbijen.
    probajSkladiste(otvoriBazu, () => new Blob(['x'], { type: 'text/plain' })).then(radi => {
      if (radi) return;
      STANJE.skladisteNeRadi = true;
      osveziUpozorenjeSkladista();
      toast(t('skladisteNeRadi'));
    });

    // Paralelno učitaj lokalni red, poslednje keširano stanje iz IndexedDB i adresu servera (endpoint.json)
    const apiBazaPromis = razresiApiBazu(false);
    const [lokalniRed, kesStanja] = await Promise.all([
      idbSviIzReda(),
      idbProcitajKes('poslednje_stanje')
    ]);
    STANJE.lokalniRed = lokalniRed;
    // Ako je zapis ranije odbijen zato što je stara kartica bila iz keša, nova verzija čisti tu blokadu da se zapis pošalje sam.
    for (const st of STANJE.lokalniRed) {
      if (st.stara_verzija || (st.status_greske === 422 && /zastarela|Stara verzija/i.test(st.trajna_greska || ''))) {
        delete st.trajna_greska;
        delete st.status_greske;
        delete st.stara_verzija;
        await idbUpisiURed(st);
      }
    }
    if (kesStanja && STANJE.sviServerZapisi.length === 0) {
      primiStanje(kesStanja);
      crtajPodatke(false);
    }
    osveziStatusTraku();

    await apiBazaPromis;

    // Pokreni preuzimanje živog stanja odmah, paralelno sa proverom prijave (/api/ja)
    const stanjePromis = ucitajStanjeSaServera(false);

    // Proveri postojeću prijavu uređaja ako postoji
    let sesijaPromenjena = false;
    if (STANJE.sesija && STANJE.sesija.tajna) {
      // Ako student skenira QR DRUGOG tima, ponudi prijavu u taj novi tim
      if (STANJE.pendingQr && STANJE.pendingQr.tim !== STANJE.sesija.tim) {
        await pripremiPrijavuPanel();
      } else {
        try {
          const stariUredjajId = Number(STANJE.sesija.uredjaj_id || 0);
          const r = await apiPoziv('/api/ja', { method: 'GET' });
          const j = await r.json();
          if (r.ok && j.ok) {
            sessionStorage.removeItem(SS_PENDING_QR);
            STANJE.pendingQr = null;
            const noviUredjajId = j.uredjaj_id || STANJE.sesija.uredjaj_id || 0;
            if (Number(noviUredjajId) !== stariUredjajId) sesijaPromenjena = true;
            sacuvajSesiju(Object.assign({}, STANJE.sesija, {
              uredjaj_id: noviUredjajId,
              nadimak: j.nadimak || STANJE.sesija.nadimak || '',
              oznaka: j.oznaka || STANJE.sesija.oznaka || '',
              zauzeto: j.zauzeto,
              limit: j.limit
            }));
            if (prenetaPrijava) {
              toast(`${j.tim} · ${j.nadimak || j.oznaka} (isto mesto preneto)`);
            }
          } else if (r.status === 401) {
            sesijaPromenjena = true;
            sacuvajSesiju(null);
            if (STANJE.pendingQr) await pripremiPrijavuPanel();
            else toast(j.poruka || 'Potrebna je ponovna QR prijava.');
          }
        } catch {
          // Offline sa postojećom sesijom: pusti studenta da nesmetano radi u offline modu!
        }
      }
    } else if (STANJE.pendingQr) {
      await pripremiPrijavuPanel();
    } else if (!localStorage.getItem(LS_PRVI_PUT)) {
      otvoriPanel('modal-info');
      localStorage.setItem(LS_PRVI_PUT, '1');
    }
    // Telefoni prijavljeni pre izdanja 2026-11-23.6 nisu videli obaveštenje na prijavi; dobijaju ga jednom, ovde.
    if (STANJE.sesija && STANJE.sesija.tajna && !STANJE.pendingQr && !localStorage.getItem(LS_PRIVATNOST)
        && SVI_PANELI.every(pid => document.getElementById(pid).hidden)) {
      otvoriPanel('modal-privacy');
      try { localStorage.setItem(LS_PRIVATNOST, '1'); } catch {}
    }

    await stanjePromis;
    if (sesijaPromenjena) crtajPodatke(false);
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
