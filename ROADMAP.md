# Roadmap

- **M0 Foundation (done):** shared model, server, auth/roles/2FA, shares, audit, catalog + import, web shell, Docker/CI, Unraid template.
- **M1 Editor core (done):** port v1 drawing (walls, openings, devices, cables, cameras with FOV, labels, dims, underlays) to React/SVG on the record model; undo/redo; save via push ops.
- **M2 Electrical & panels (in progress):** done: panel editor (breakers, slots, wire sizes), device “powered from” circuits, NEC 220 load calc, Panels schedule + CSV. Next: rack and terminal inside views, voltage drop, feeder sizing between panels.
- **M3 Low voltage (done):** cable schedule + CSV, PoE budgets, port counts, NVR channels through switches, Ethernet length limit, voltage drop, DORI bands and distances, bitrate and NVR storage estimates, Checks view in editor and project page.
- **M4 Offline tablets:** PWA with local record store, outbox and sync (pull since seq, push with baseSeq, conflict review).
- **M5 Catalog sync:** vendor feed refresh, datasheet re-read, multi-source pricing in BOMs.
- **M6 Outputs (in progress):** done: BOM tab (catalog prices, overrides, slack, markup, labor, CSV), printable client proposal, plan export (SVG/PNG/PDF), panel and cable schedules. Next: multi-sheet PDF sheet sets.
