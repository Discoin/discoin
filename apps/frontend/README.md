# Discoin dashboard

Preact and Vite. Run tasks through nx from the repo root, like `npx nx run frontend:dev`.

## Picking the API

Every Vite command needs `--mode http` or `--mode mock`, and the app refuses to load with any other mode.

- `http` talks to the real API at `/api`. The dev and preview servers proxy `/api` to `http://localhost:8000`, and nginx does the same in Docker.
- `mock` uses the in-memory API in `src/mocks`, which follows the same contract.

| Script | Mode | What it does |
| --- | --- | --- |
| `dev` | mock | Dev server at http://localhost:5173 |
| `dev:http` | http | Dev server against a local API |
| `build` | http | Production build into `dist/`, with prerendered routes |
| `build:mock`, `preview:mock` | mock | Build into `dist-mock/` and serve it, for the e2e tests |
| `test` | mock | Unit tests |
| `e2e` | mock | Playwright, including axe, alignment and reflow checks |
| `smoke` | http | Playwright against a running stack. Set `SMOKE_URL`, like `http://127.0.0.1:4080` |

For the real API locally, start the API (`npx nx run api:serve`) with `FRONTEND_URL=http://localhost:5173/`, then `npx nx run frontend:dev:http`.
