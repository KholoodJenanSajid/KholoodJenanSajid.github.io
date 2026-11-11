// Shared live-location feed (index.html chip + pune.html map).
// Firebase Realtime Database over plain REST: an EventSource stream, falling back to
// polling. When live-config.js is empty there is no relay, so pages that ask for it
// follow this device's own GPS, and otherwise a demo route around Pune.
(function () {
  const CFG = window.LIVE_CONFIG || {};
  const DB = (CFG.databaseURL || '').replace(/\/+$/, '');
  const DEMO = !DB, STALE = 120000;
  const subs = [];
  let raw = null, area = '', wantArea = false, geoAt = null, geoT = 0, started = false;
  let source = DEMO ? 'demo' : 'firebase', deviceErr = null, demoOn = false;

  const hav = (a, b) => {
    const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
    const q = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(q));
  };
  const ago = ms => ms < 5000 ? 'NOW' : ms < 60000 ? (ms / 1000 | 0) + 'S AGO' : ms < 3600000 ? (ms / 60000 | 0) + ' MIN AGO'
    : ms < 86400000 ? (ms / 3600000 | 0) + ' H AGO' : (ms / 86400000 | 0) + ' D AGO';

  function state() {
    const base = { demo: DEMO, source, deviceErr, area };
    if (!raw || typeof raw.lat != 'number' || typeof raw.lng != 'number') return Object.assign(base, { fix: null });
    const age = Math.max(0, Date.now() - (raw.t || 0));
    const live = source == 'device' || (raw.on !== false && !raw.paused && age < STALE);
    return Object.assign(base, { fix: raw, age, paused: !!raw.paused, live });
  }
  const emit = () => { const s = state(); subs.forEach(f => f(s)); };

  function lookup(lat, lng) {
    const now = Date.now();
    if (!wantArea || (geoAt && hav(geoAt, [lat, lng]) < 300) || now - geoT < 30000) return;
    geoT = now; geoAt = [lat, lng];
    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=en&lat=' + lat + '&lon=' + lng)
      .then(r => r.json())
      .then(d => {
        const a = d.address || {};
        area = (a.suburb || a.neighbourhood || a.city_district || a.quarter || a.city || 'Pune').toUpperCase();
        emit();
      })
      .catch(() => {});
  }
  function set(d) {
    raw = d && typeof d == 'object' ? d : null;
    if (raw && typeof raw.lat == 'number') lookup(raw.lat, raw.lng);
    emit();
  }

  function apply(path, data, patch) {
    if (path == '/') set(patch ? Object.assign({}, raw, data) : data);
    else { const k = path.slice(1).split('/')[0]; set(Object.assign({}, raw, { [k]: data })); }
  }
  function poll() {
    const go = () => fetch(DB + '/live.json').then(r => r.json()).then(set).catch(() => {});
    go(); setInterval(go, 10000);
  }
  function connect() {
    if (!window.EventSource) return poll();
    let errs = 0;
    const es = new EventSource(DB + '/live.json');
    es.addEventListener('put', e => { errs = 0; const m = JSON.parse(e.data); apply(m.path, m.data, false); });
    es.addEventListener('patch', e => { errs = 0; const m = JSON.parse(e.data); apply(m.path, m.data, true); });
    es.onerror = () => { if (++errs > 4) { es.close(); poll(); } };
  }
  function device() {
    if (!navigator.geolocation || !window.isSecureContext) { deviceErr = navigator.geolocation ? 'insecure' : 'unsupported'; return demo(); }
    source = 'device';
    let got = false;
    navigator.geolocation.watchPosition(p => {
      got = true;
      const c = p.coords;
      set({ lat: c.latitude, lng: c.longitude, acc: c.accuracy, spd: c.speed == null ? null : c.speed, on: true, t: Date.now() });
    }, e => {
      if (got) return;
      deviceErr = e.code;
      demo();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function demo() {
    if (demoOn) return;
    demoOn = true;
    source = 'demo';
    const P = [[18.5195, 73.8553], [18.5150, 73.8530], [18.5018, 73.8636], [18.5130, 73.8740], [18.5286, 73.8743], [18.5362, 73.8930],
      [18.5390, 73.8780], [18.5308, 73.8475], [18.5236, 73.8410], [18.5167, 73.8417], [18.5195, 73.8553]];
    const seg = P.slice(1).map((p, i) => hav(P[i], p)), tot = seg.reduce((a, b) => a + b, 0), V = 14;
    let s = 0;
    const tick = () => {
      s = (s + V) % tot;
      let r = s, i = 0;
      while (r > seg[i]) { r -= seg[i]; i++; }
      const a = P[i], b = P[i + 1], f = r / seg[i];
      set({ lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, acc: 12, spd: V, on: true, t: Date.now() });
    };
    tick(); setInterval(tick, 1000);
  }
  function start(opts) {
    if (started) return;
    started = true;
    if (!DEMO) connect();
    else if (opts && opts.device) device();
    else demo();
    setInterval(emit, 1000);
  }

  window.KJSLive = {
    DEMO, STALE, hav, ago,
    // opts.area: also resolve the neighbourhood name (OpenStreetMap Nominatim, throttled)
    // opts.device: with no Firebase relay, follow this device's GPS instead of the demo route
    subscribe(fn, opts) {
      if (opts && opts.area && !wantArea) { wantArea = true; if (raw && typeof raw.lat == 'number') lookup(raw.lat, raw.lng); }
      subs.push(fn); start(opts); fn(state());
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    }
  };
})();
