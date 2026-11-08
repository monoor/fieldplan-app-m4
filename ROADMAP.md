# Roadmap

- **M0 Foundation (done):** shared model, server, auth/roles/2FA, shares, audit, catalog + import, web shell, Docker/CI, Unraid template.
- **M1 Editor core (done):** port v1 drawing (walls, openings, devices, cables, cameras with FOV, labels, dims, underlays) to React/SVG on the record model; undo/redo; save via push ops.
- **M2 Electrical & panels (in progress):** done: panel editor (breakers, slots, wire sizes), device “powered from” circuits, NEC 220 load calc, Panels schedule + CSV. Next: rack and terminal inside views, voltage drop, feeder sizing between panels.
- **M3 Low voltage (done):** cable schedule + CSV, PoE budgets, port counts, NVR channels through switches, Ethernet length limit, voltage drop, DORI bands and distances, bitrate and NVR storage estimates, Checks view in editor and project page.
- **M4 Offline tablets (done, this repo):** installable PWA (manifest + service worker), editor copy of each opened project in IndexedDB with an outbox of unsent edits, automatic sync on reconnect, keep-latest conflicts (the device's edit wins; the editor shows "N overwritten"). Needs HTTPS for the service worker; on plain http edits are still kept on the device but the app can't open with no signal. Not built: a manual conflict-review screen.
- **M5 Catalog sync (done):** Refresh from source page (price per site, fills empty specs), Refresh prices for all items, price age flags. Vendor feeds and per-vendor camera model packs are not built.
- **M6 Outputs (done):** BOM tab (catalog prices, overrides, slack, markup, labor, CSV), printable client proposal, plan export (SVG/PNG/PDF), multi-sheet PDF set with panel, cable and quantity schedules.

## Canvas & scale (done)
Per-project canvas size (ft), drawing scale (px/ft), grid, and calibration from a Measure line (Editor → "Canvas & scale"). New projects default to a 100×70 ft canvas at 20 px/ft; export can use the whole canvas or crop to the drawing.
