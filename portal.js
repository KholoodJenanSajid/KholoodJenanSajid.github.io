/* Portal navigation — black-hole suction from gaze point into content panels.
   Shares the same ambient-field lighting as the landing hero (no harsh overlay). */

(() => {
  'use strict';

  const body = document.body;
  const root = document.documentElement;
  const overlays = document.querySelectorAll('.overlay');
  const openTriggers = document.querySelectorAll('[data-open]');
  const closeTriggers = document.querySelectorAll('[data-close]');
  const overlayRoot = document.querySelector('.overlay-root');
  const singularity = document.getElementById('singularity');

  let activePanel = null;
  let transitioning = false;

  function readGazeViewport() {
    const cs = getComputedStyle(root);
    const x = parseFloat(cs.getPropertyValue('--gaze-vx')) || window.innerWidth * 0.5;
    const y = parseFloat(cs.getPropertyValue('--gaze-vy')) || window.innerHeight * 0.34;
    return { x, y };
  }

  function setActiveNav(name) {
    document.querySelectorAll('.pill-nav .nav-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.open === name);
    });
  }

  function setPortalOrigin(x, y) {
    root.style.setProperty('--portal-x', `${x}px`);
    root.style.setProperty('--portal-y', `${y}px`);
    if (singularity) {
      singularity.style.setProperty('--portal-x', `${x}px`);
      singularity.style.setProperty('--portal-y', `${y}px`);
    }
  }

  function setPanelTransformOrigin(panel, x, y) {
    const el = panel?.querySelector('.overlay-inner');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const ox = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
    const oy = Math.min(100, Math.max(0, ((y - r.top) / r.height) * 100));
    el.style.transformOrigin = `${ox}% ${oy}%`;
  }

  function runSingularity(onMid) {
    body.classList.add('singularity-active');
    if (singularity) singularity.classList.add('is-active');
    setTimeout(onMid, 460);
    setTimeout(() => {
      body.classList.remove('singularity-active');
      if (singularity) singularity.classList.remove('is-active');
    }, 980);
  }

  function openPanel(name) {
    if (transitioning) return;
    const panel = document.querySelector(`.overlay[data-panel="${name}"]`);
    if (!panel) return;

    transitioning = true;
    const { x, y } = readGazeViewport();
    setPortalOrigin(x, y);

    runSingularity(() => {
      overlays.forEach((o) => {
        if (o !== panel) {
          o.hidden = true;
          o.classList.remove('is-open');
        }
      });
      panel.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setPanelTransformOrigin(panel, x, y);
        panel.classList.add('is-open');
        overlayRoot.setAttribute('aria-hidden', 'false');
        body.classList.add('portal-open');
        activePanel = panel;
        const closeBtn = panel.querySelector('[data-close]');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
        history.replaceState(null, '', `#${name}`);
        setActiveNav(name);
        transitioning = false;
      }));
    });
  }

  function closePanel() {
    if (!activePanel || transitioning) return;
    transitioning = true;
    const panel = activePanel;
    panel.classList.remove('is-open');
    activePanel = null;

    const { x, y } = readGazeViewport();
    setPortalOrigin(x, y);
    body.classList.add('singularity-exit');

    setTimeout(() => {
      panel.hidden = true;
      overlayRoot.setAttribute('aria-hidden', 'true');
      body.classList.remove('portal-open', 'singularity-exit');
      history.replaceState(null, '', '#');
      setActiveNav('');
      transitioning = false;
    }, 580);
  }

  openTriggers.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openPanel(el.dataset.open);
    });
  });
  closeTriggers.forEach((el) => {
    el.addEventListener('click', closePanel);
  });

  overlayRoot.addEventListener('click', (e) => {
    if (e.target.classList.contains('overlay-backdrop')) closePanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) closePanel();
  });

  const hash = window.location.hash.slice(1);
  if (['work', 'about', 'contact'].includes(hash)) {
    setTimeout(() => openPanel(hash), 400);
  }
})();
