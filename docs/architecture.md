# Architecture Overview

The portal is intentionally simple and low-cost for hackathon evaluation:

1. A Node.js HTTP server serves both the API and frontend assets.
2. The frontend is a vanilla JavaScript single-page app.
3. Data is persisted in `backend/data/db.json`.
4. CSV reports are generated directly from the persisted goal and achievement records.
5. Audit events are written on workflow and post-lock changes.

## Main Modules

- `server.js`: API routing, validation, workflow enforcement, audit logging, CSV export, and static file serving.
- `public/index.html`: SPA shell.
- `public/app.js`: role-specific dashboards and UI workflows.
- `public/styles.css`: responsive application styling.
- `backend/data/db.json`: seeded users, goals, check-ins, notifications, escalations, and audit data.

## Hosting Choice

Because the app has no external runtime dependencies, it can be hosted on a minimal Node platform. For production, replace the JSON file with PostgreSQL or Azure SQL, add Microsoft Entra ID authentication, and move notifications to email / Teams integrations.
