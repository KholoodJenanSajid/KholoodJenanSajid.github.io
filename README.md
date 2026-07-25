# kholoodjenansajid.github.io

Personal portfolio — a data engineer's site.

**Live**: https://kholoodjenansajid.github.io/

## Stack

Plain HTML + CSS + a sprinkle of vanilla JS. No build step, no framework.
Fonts are loaded from Google Fonts:

- **JetBrains Mono** — structural / techy
- **Instrument Serif** (italic) — accent words
- **Inter** — body text
- **Caveat** — handwritten notes & signature

## Files

- `index.html` — the portfolio site (live at `/`)
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
