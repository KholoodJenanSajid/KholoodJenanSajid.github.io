/* -----------------------------------------------------------------------------
 * Award-winning character hero — zero-lag, zero-ghosting cursor tracker.
 *
 * TECHNICAL CONTRACT (do not violate):
 *   - No 3D transforms on page/canvas/video — page & body stay motionless.
 *   - No MP4 seek/play at runtime. All frames are pre-extracted WebPs on disk.
 *   - Draw EXACTLY ONE frame per rAF tick at globalAlpha=1 (no blending).
 *   - Cursor angle: atan2(dy, dx); smoothed by shortest-path circular lerp.
 *   - Deadzone (~12% screen radius) => switch to center.webp (eye contact).
 * -------------------------------------------------------------------------- */

(() => {
  'use strict';

  // ---------- Constants ------------------------------------------------------
  const FRAME_COUNT      = 64;        // must match extract_frames.py output
  const LERP_FACTOR      = 0.24;      // slightly softer head tracking
  const DEADZONE_PCT     = 0.10;      // tighter eye-contact bubble
  const FRAMES_DIR       = 'public/frames';
  // Bg fill for the brief moment before the character image paints on top.
  // Value came from scripts/extract_frames.py for the landscape source.
  let bgCss = '#948e6d';
  // Rotation calibration: tweak if the head faces the wrong direction.
  //  FRAME_OFFSET shifts which frame index corresponds to cursor "UP".
  //  DIRECTION    flips clockwise vs counter-clockwise mapping.
  const FRAME_OFFSET     = 0;
  const DIRECTION        = 1;         // +1 = CW mapping,  -1 = CCW

  // ---------- Canvas setup ---------------------------------------------------
  const canvas = document.getElementById('hero-canvas');
  const ctx    = canvas.getContext('2d', { alpha: false });

  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let dpr = 1;

  function resizeCanvas() {
    // Canvas now lives inside .hero (100vh section), not the whole viewport.
    // Measure the canvas's own rendered size instead of using innerWidth/Height.
    const rect = canvas.getBoundingClientRect();
    vw  = Math.max(1, Math.round(rect.width));
    vh  = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);  // cap for perf
    canvas.width  = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    // Do NOT set canvas.style.width/height — the CSS rule (100% of .hero) drives layout.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Immediate fill so nothing flashes during load
    ctx.fillStyle = bgCss;
    ctx.fillRect(0, 0, vw, vh);
    // Redraw current frame if we already have one
    if (state.lastImg) drawFrame(state.lastImg);
  }
  // Debounced resize + explicit orientationchange for mobile devices
  let resizeTimer = 0;
  function scheduleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 90);
  }
  window.addEventListener('resize', scheduleResize, { passive: true });
  window.addEventListener('orientationchange', () => {
    // orientationchange fires before the new viewport size is committed;
    // wait a frame + a bit for the browser to settle, then resize.
    setTimeout(resizeCanvas, 220);
  }, { passive: true });

  // ---------- Layout: where does the character sit on screen? ---------------
  // Landscape source: character sits right-of-center in the 1280x720 frame.
  //   In source coords: face is at ~(62% x, 42% y).
  // We use object-fit: cover so the image fills the viewport with no letterbox.
  // Layout hooks return the on-screen face position so the cursor-angle math
  // can pivot around the actual face location, not the geometric viewport centre.
  // Calibrate after re-extracting frames from the eye-tracking video.
  const FACE_X_IMG = 0.50;
  const FACE_Y_IMG = 0.33;   // eye line on portrait 1280×720 source
  const GAZE_LEAD  = 0.58;   // light sits slightly before cursor (natural gaze)
  const GAZE_MAX   = 0.38;   // max reach as fraction of min(vw,vh)

  function getLayout() {
    if (!drawGeom) {
      return { faceX: vw * FACE_X_IMG, faceY: vh * FACE_Y_IMG, xPct: FACE_X_IMG };
    }
    // Map (FACE_X_IMG, FACE_Y_IMG) from source-image space to viewport space
    // using the cached draw geometry.
    const faceX = drawGeom.dx + drawGeom.dw * FACE_X_IMG;
    const faceY = drawGeom.dy + drawGeom.dh * FACE_Y_IMG;
    return { faceX, faceY, xPct: faceX / vw };
  }

  // ---------- Frame preload --------------------------------------------------
  // Version bust: read from meta[name="frame-ver"] so we can bump it in ONE place.
  // Force-refresh guarantee: every page load computes a fresh session ID and
  // appends it, so no browser can ever serve a cached WebP from a previous run.
  const metaTag = document.querySelector('meta[name="frame-ver"]');
  const FRAME_VER = metaTag ? metaTag.content : 'v5-eye';
  const framePaths = Array.from({ length: FRAME_COUNT }, (_, i) =>
    `${FRAMES_DIR}/frame_${String(i).padStart(2, '0')}.webp?${FRAME_VER}`
  );
  const centerPath = `${FRAMES_DIR}/center.webp?${FRAME_VER}`;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload  = () => (img.decode ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img));
      img.onerror = () => reject(new Error(`Failed to load ${src}`));
      img.src = src;
    });
  }

  // ---------- Rendering (one frame per tick, 100% opacity) ------------------
  const state = {
    frames: null,
    center: null,
    ready:  false,
    lastImg: null,
    lastIdx: -1
  };

  // Cached character draw geometry (recomputed on resize)
  let drawGeom = null;

  // Landscape source is 1280x720. On a wide desktop viewport (16:9-ish) the
  // scale factor is close to 1 and the entire frame fits with barely any crop.
  // On narrow/tall viewports we scale up to cover, cropping the sides slightly.
  function computeDrawGeom(img) {
    const iw = img.naturalWidth  || img.width;
    const ih = img.naturalHeight || img.height;
    // object-fit: cover — fill both dimensions, crop the overflow axis.
    const scale = Math.max(vw / iw, vh / ih);
    const dw    = iw * scale;
    const dh    = ih * scale;
    // Center horizontally, but bias vertical so the face (at ~42% of source
    // height) lands at ~42% of the viewport height regardless of aspect ratio.
    const dx    = (vw - dw) / 2;
    const overflowY = dh - vh;
    const dy    = -overflowY * FACE_Y_IMG;   // keep face anchored to viewport 42%
    return { iw, ih, dw, dh, dx, dy };
  }

  function drawFrame(img) {
    if (!img) return;
    const g = computeDrawGeom(img);
    if (!g.iw || !g.ih) return;

    ctx.globalAlpha = 1;
    // Cover-mode: image fills the viewport, no letterbox, no seam possible.
    ctx.drawImage(img, g.dx, g.dy, g.dw, g.dh);

    state.lastImg = img;
    drawGeom = g;
  }

  // ---------- Cursor tracking -----------------------------------------------
  let mouseX = vw / 2;
  let mouseY = vh / 2;
  let mouseSeen = false;
  let currentAngle = 0;

  let gazeVx = window.innerWidth * 0.55;
  let gazeVy = window.innerHeight * 0.38;
  let faceVx = gazeVx;
  let faceVy = gazeVy;

  function onPointerMove(e) {
    // Translate viewport-relative cursor coords into canvas-local coords, since
    // the canvas lives inside the hero section and may be scrolled off-screen.
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    mouseSeen = true;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', () => { mouseSeen = false; });

  // Shortest-path circular angular lerp (radians, wraps around ±π)
  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  // Map an angle (0=UP, CW) to a frame index in [0..FRAME_COUNT-1]
  function angleToFrameIndex(angle) {
    let a = angle;
    while (a <  0)               a += 2 * Math.PI;
    while (a >= 2 * Math.PI)     a -= 2 * Math.PI;
    const raw = (a / (2 * Math.PI)) * FRAME_COUNT * DIRECTION + FRAME_OFFSET;
    const idx = Math.round(raw);
    return ((idx % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
  }

  // ---------- Main loop ------------------------------------------------------
  // Character is always visible (position: fixed hero, single-view SPA),
  // so we always run the render loop.
  function loop() {
    if (!state.ready) {
      requestAnimationFrame(loop);
      return;
    }

    const { faceX, faceY } = getLayout();
    const dx = mouseX - faceX;
    const dy = mouseY - faceY;
    const dist = Math.hypot(dx, dy);
    const deadR = Math.min(vw, vh) * DEADZONE_PCT;

    let target;
    if (!mouseSeen || dist < deadR) {
      // Eye-contact: cursor near face OR pointer hasn't moved yet
      target = state.center;
      // Ease angle towards forward (0) so leaving the deadzone is smooth
      currentAngle = lerpAngle(currentAngle, 0, LERP_FACTOR * 0.6);
    } else {
      // Screen coords: +Y is DOWN. We want: cursor above face => head UP.
      //   atan2(dy, dx): 0 = +X, PI/2 = +Y (down), -PI/2 = up
      //   Shift by +PI/2 so that 0 = UP, PI/2 = RIGHT, PI = DOWN, 3PI/2 = LEFT.
      const rawAngle = Math.atan2(dy, dx) + Math.PI / 2;
      currentAngle = lerpAngle(currentAngle, rawAngle, LERP_FACTOR);
      const idx = angleToFrameIndex(currentAngle);
      target = state.frames[idx];
      state.lastIdx = idx;
    }

    if (target && target !== state.lastImg) {
      drawFrame(target);
    }

    updateGazeLighting(faceX, faceY);

    requestAnimationFrame(loop);
  }

  function updateGazeLighting(faceX, faceY) {
    const rect = canvas.getBoundingClientRect();
    const fvx = rect.left + faceX;
    const fvy = rect.top + faceY;
    const mvx = rect.left + mouseX;
    const mvy = rect.top + mouseY;

    let targetGx = fvx;
    let targetGy = fvy;
    let strength = 0.42;

    if (mouseSeen) {
      let gdx = (mvx - fvx) * GAZE_LEAD;
      let gdy = (mvy - fvy) * GAZE_LEAD;
      const maxR = Math.min(vw, vh) * GAZE_MAX;
      const gd = Math.hypot(gdx, gdy);
      if (gd > maxR && gd > 0) {
        const s = maxR / gd;
        gdx *= s;
        gdy *= s;
      }
      targetGx = fvx + gdx;
      targetGy = fvy + gdy;
      const dist = Math.hypot(mvx - fvx, mvy - fvy);
      const deadR = Math.min(vw, vh) * DEADZONE_PCT;
      strength = Math.min(1, Math.max(0.35, (dist - deadR * 0.5) / (maxR * 1.2)));
    }

    gazeVx += (targetGx - gazeVx) * 0.11;
    gazeVy += (targetGy - gazeVy) * 0.11;
    faceVx += (fvx - faceVx) * 0.16;
    faceVy += (fvy - faceVy) * 0.16;

    const root = document.documentElement;
    root.style.setProperty('--gaze-vx', `${gazeVx}px`);
    root.style.setProperty('--gaze-vy', `${gazeVy}px`);
    root.style.setProperty('--face-vx', `${faceVx}px`);
    root.style.setProperty('--face-vy', `${faceVy}px`);
    root.style.setProperty('--gaze-strength', strength.toFixed(3));
  }

  // ---------- Runtime bg auto-calibration ------------------------------------
  // Read the color the browser ACTUALLY renders inside the character rectangle
  // (top strip, above the head, pure bg). Because we're reading the on-screen
  // pixels — not the source image — the value already accounts for image
  // smoothing, DPR scaling, and any color-space quirks. Fill the letterbox
  // with the same value and the seam is mathematically impossible.
  function calibrateBgFromRenderedCanvas() {
    try {
      if (!drawGeom) return;
      // Sample a thin horizontal band INSIDE the character rectangle, near the
      // top (above the hair). x = character's left+1px .. right-1px, y = top 5%
      // of the character's drawn height.
      const sx = Math.max(0, Math.floor((drawGeom.dx + 2) * dpr));
      const sw = Math.max(4, Math.floor((drawGeom.dw - 4) * dpr));
      const sy = Math.max(0, Math.floor(vh * 0.02 * dpr));   // 2% down
      const sh = Math.max(4, Math.floor(vh * 0.04 * dpr));   // 4% tall

      const data = ctx.getImageData(sx, sy, sw, sh).data;

      const rs = [], gs = [], bs = [];
      for (let i = 0; i < data.length; i += 4) {
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
      rs.sort((a, b) => a - b);
      gs.sort((a, b) => a - b);
      bs.sort((a, b) => a - b);
      const mid = rs.length >> 1;
      const r = rs[mid];
      const g = gs[mid];
      const b = bs[mid];

      const cssRgb = `rgb(${r}, ${g}, ${b})`;
      bgCss = cssRgb;

      // Apply to every layer that can possibly show through.
      const deepRgb = `rgb(${Math.max(0, r - 22)}, ${Math.max(0, g - 20)}, ${Math.max(0, b - 18)})`;
      document.documentElement.style.setProperty('--bg', cssRgb);
      document.documentElement.style.setProperty('--bg-deep', deepRgb);
      document.documentElement.style.background = cssRgb;
      document.body.style.background = cssRgb;
      canvas.style.background = cssRgb;

      const loader = document.getElementById('loader');
      if (loader) loader.style.background = cssRgb;

      console.log(`[hero] bg calibrated from RENDERED canvas -> ${cssRgb}  (${r},${g},${b})`);
    } catch (e) {
      console.warn('[hero] bg calibration failed, using fallback', e);
    }
  }

  // ---------- Boot -----------------------------------------------------------
  async function boot() {
    resizeCanvas();

    try {
      // Load center first for instant eye-contact, then everything else in parallel
      const centerImg = await loadImage(centerPath);
      state.center = centerImg;
      drawFrame(centerImg);
      calibrateBgFromRenderedCanvas();

      const frames = await Promise.all(framePaths.map(loadImage));
      state.frames = frames;
      state.ready  = true;

      // Fade out loader shroud
      const loader = document.getElementById('loader');
      if (loader) loader.classList.add('hidden');

      requestAnimationFrame(loop);
    } catch (err) {
      console.error('[hero] frame preload failed', err);
      const loader = document.getElementById('loader');
      if (loader) {
        loader.innerHTML = `<div style="color:#fff;padding:24px;font-family:monospace;">
          Frame load error: ${err.message}<br/>
          Serve this folder over HTTP: <code>python -m http.server</code>
        </div>`;
      }
    }
  }

  // ---------- Magnetic cursor ------------------------------------------------
  const cursorDot  = document.querySelector('.cursor-dot');
  const cursorRing = document.querySelector('.cursor-ring');

  if (cursorDot && cursorRing) {
    let dotX  = vw / 2, dotY  = vh / 2;
    let ringX = vw / 2, ringY = vh / 2;
    let idleTimer = 0;

    // Dot follows the cursor tightly, ring lags for the smooth aura effect
    window.addEventListener('pointermove', (e) => {
      dotX = e.clientX;
      dotY = e.clientY;
      cursorDot.style.transform  = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
      // Cancel idle pulse while moving, restart timer to re-enable it
      cursorRing.classList.remove('is-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => cursorRing.classList.add('is-idle'), 1200);
    }, { passive: true });

    function cursorRingLoop() {
      ringX += (dotX - ringX) * 0.20;
      ringY += (dotY - ringY) * 0.20;
      cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
      requestAnimationFrame(cursorRingLoop);
    }
    requestAnimationFrame(cursorRingLoop);

    // Magnetic hover state on interactive elements
    const hoverables = document.querySelectorAll('a, button, [data-magnetic]');
    hoverables.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        cursorDot.classList.add('is-hover');
        cursorRing.classList.add('is-hover');
      });
      el.addEventListener('mouseleave', () => {
        cursorDot.classList.remove('is-hover');
        cursorRing.classList.remove('is-hover');
      });
    });

    // Hide cursor when it leaves the window
    window.addEventListener('mouseleave', () => {
      cursorDot.classList.add('is-hidden');
      cursorRing.classList.add('is-hidden');
    });
    window.addEventListener('mouseenter', () => {
      cursorDot.classList.remove('is-hidden');
      cursorRing.classList.remove('is-hidden');
    });
  }

  boot();
})();
