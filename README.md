# kholoodjenansajid.github.io

Personal portfolio — a data engineer's site.

**Live**: https://kholoodjenansajid.github.io/

## Stack

A single self-contained HTML file: canvas 2D for the pixel map, Three.js r128
(cdnjs) for the 3D voxel view. No build step, no framework.
Fonts from Google Fonts: **Press Start 2P** and **VT323**.

## Files

- `index.html` — KJS World Map: pixel-art / Three.js explorable map (live at `/`)
- `classic.html` — the previous colored character hero (archived, unlinked)
- `pipeline.html` — the previous "PIPELINE.EXE" retro-terminal portfolio (archived, live at `/pipeline.html`)
- `funcam.html` — an older interactive camera studio project (archived)
- `preview.png`, `favicon.ico`, `favicon-*.png`, `apple-touch-icon.png` — site metadata assets
- `README.md` — this file

## Local preview

Just open `index.html` in a browser, or run a tiny local server:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000/.

## Deploy

This repo is a GitHub Pages **user site** — anything committed to `main`
is auto-published to `https://kholoodjenansajid.github.io/`.
