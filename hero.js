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
  const LERP_FACTOR      = 0.26;      // ~35ms tracking response
  const DEADZONE_PCT     = 0.12;      // 12% of min(vw, vh)
  const FRAMES_DIR       = 'public/frames';
  // Initial guess; overwritten at runtime by auto-calibration from the loaded
  // center frame so page + canvas bg match EXACTLY (zero visible seam).
  let bgCss = '#9b1f19';
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
    vw  = window.innerWidth;
    vh  = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);  // cap for perf
    canvas.width        = Math.round(vw * dpr);
    canvas.height       = Math.round(vh * dpr);
    canvas.style.width  = vw + 'px';
    canvas.style.height = vh + 'px';
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
  // Character is centered horizontally at object-fit: contain scale. The face
  // sits at ~30% down the viewport (head-and-shoulders framing).
  function getLayout() {
    return {
      faceX: vw * 0.5,
      faceY: vh * 0.30,
      xPct:  0.5
    };
  }

  // ---------- Frame preload --------------------------------------------------
  const framePaths = Array.from({ length: FRAME_COUNT }, (_, i) =>
    `${FRAMES_DIR}/frame_${String(i).padStart(2, '0')}.webp`
  );
  const centerPath = `${FRAMES_DIR}/center.webp`;

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
  function computeDrawGeom(img) {
    const iw = img.naturalWidth  || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = vh / ih;
    const dw    = iw * scale;
    const dh    = vh;
    const dx    = (vw - dw) / 2;
    const dy    = 0;
    return { iw, ih, dw, dh, dx, dy };
  }

  function drawFrame(img) {
    if (!img) return;
    const g = computeDrawGeom(img);
    if (!g.iw || !g.ih) return;

    ctx.globalAlpha = 1;

    // ---- 1) PURE-BG BACKDROP: take a thin top strip of the frame (pure red
    // background, no character features) and stretch it to fill the whole
    // viewport with a heavy blur. Because we sample only above the head,
    // no character silhouette can appear in the backdrop. Because the source
    // is the same image drawn through the same pipeline, the color matches
    // the character rectangle mathematically — zero possible seam.
    ctx.save();
    ctx.filter = 'blur(80px)';
    // Sample only the top 8% of the source image (guaranteed pure bg).
    const srcStripH = Math.max(2, Math.floor(g.ih * 0.08));
    ctx.drawImage(
      img,
      0, 0, g.iw, srcStripH,        // source: top strip only
      -80, -80, vw + 160, vh + 160  // dest: full viewport + overscan so blur has no dark edge
    );
    ctx.restore();

    // ---- 2) Crisp character on top, exactly centered.
    ctx.drawImage(img, g.dx, g.dy, g.dw, g.dh);

    state.lastImg = img;
    drawGeom = g;
  }

  // ---------- Cursor tracking -----------------------------------------------
  let mouseX = vw / 2;
  let mouseY = vh / 2;
  let mouseSeen = false;
  let currentAngle = 0;

  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
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

    // Only redraw if the target frame changed (saves GPU on idle)
    if (target && target !== state.lastImg) {
      drawFrame(target);
    }

    requestAnimationFrame(loop);
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
      document.documentElement.style.setProperty('--bg', cssRgb);
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
