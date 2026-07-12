# Someday Lease

A someday list where nothing gets to squat forever.

Every "someday" item is added on a **lease** (three, six, or twelve months, or a custom term). When the lease expires, the item comes up for a decision:

- **Renew it** — write one fresh line on why it still matters, pick a new term.
- **Act on it** — it graduates to the "did it" shelf with a closing note.
- **Let it go** — it rests on the released shelf, with dignity. It can always be leased again.

The renewal decision is the product. A normal someday list only ever grows; a leased list stays short, current, and honest, because every item on it has recently re-earned its place.

## Privacy

Static, local-first, no backend, no accounts, no cookies, no analytics, and **zero external network requests at runtime** (check the DevTools network tab). All data lives in your browser's localStorage.

Because localStorage can be evicted (Safari clears it after about 7 days of disuse), the **Export backup** button saves everything as a JSON file, and **Import** restores it. The export file is the real home of the data.

## Files

Vanilla HTML, CSS, and JavaScript as ES modules. No frameworks, no build step, no npm.

| File | What it does |
|---|---|
| `index.html` | The page skeleton |
| `styles.css` | Design tokens (shared across the tool family) and all styling |
| `engine.js` | Pure functions: lease dates, expiry derivation, stats. No DOM, no storage |
| `app.js` | Rendering and event wiring |
| `storage.js` | localStorage load/save, export/import, backup-age tracking |

`engine.js` can be tested from the browser console:

```js
const engine = await import("./engine.js");
engine.addMonths("2026-11-30", 3);   // "2027-02-28" (clamps to month end)
engine.timeLeftText("2027-01-12", "2026-07-12");   // "6 months left"
```

## Running locally

ES modules need a web server (opening `index.html` directly with `file://` won't work in most browsers). Any static server does:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

Hosted on GitHub Pages: repository Settings → Pages → deploy from the main branch, root folder. No build step needed.

## Data schema

Exports carry `"schemaVersion": 1`; import checks it and offers merge or replace. See the PRD for the full item schema. "Up for renewal" is always derived (`status === "active" && leaseEnd < today`), never stored.
