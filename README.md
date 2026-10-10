# Fleet Pulse

Fleet Pulse is a real-time operations dashboard with an Angular 21 frontend and a Node.js/TypeScript backend.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop, optional

## Install

```powershell
cd C:\Projects\fleet-pulse\backend
npm ci

cd C:\Projects\fleet-pulse\frontend\fleet-pulse-ui
npm ci
```

## Run Locally

Backend:

```powershell
cd C:\Projects\fleet-pulse\backend
npm.cmd run dev
```

Frontend:

```powershell
cd C:\Projects\fleet-pulse\frontend\fleet-pulse-ui
npm.cmd start
```

Open `http://localhost:4200/`.
The mock API listens on `http://localhost:4000`.

## Demo Credentials

- Operator: `operator@pulse.dev` / `pulse123`
- Viewer: `viewer@pulse.dev` / `pulse123`

Open `/login` and use either demo account. The login form is prefilled with the operator credentials.

## API

Base URL: `http://localhost:4000`

- `POST /auth/login`
- `POST /auth/refresh`
- `GET /services`
- `GET /metrics/snapshot`
- `GET /metrics/history?serviceId=&minutes=`
- `GET /metrics/replay?since=`
- WebSocket `/stream?token=&since=`
- SSE `/stream/sse?token=&since=`
- `GET /rules`
- `GET /rules/:id`
- `POST /rules`
- `PUT /rules/:id`
- `DELETE /rules/:id`
- `GET /rules/check-name?name=&excludeId=`
- `GET /chaos`
- `POST /chaos`
- `DELETE /chaos`
- `GET /health`

Errors use:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": []
  }
}
```

## Validation

Backend:

```powershell
cd C:\Projects\fleet-pulse\backend
npm.cmd test
npm.cmd run build
```

Frontend:

```powershell
cd C:\Projects\fleet-pulse\frontend\fleet-pulse-ui
npm.cmd test -- --watch=false
npm.cmd run build
npm.cmd run lint
```

## Docker

```powershell
cd C:\Projects\fleet-pulse
docker compose up --build
```

Frontend: `http://localhost:8080`
Backend: `http://localhost:4000`

## Chaos Testing

Authenticate as an operator, then call `POST /chaos`.

Examples:

```powershell
$login = Invoke-RestMethod http://localhost:4000/auth/login -Method Post -ContentType application/json -Body '{"email":"operator@pulse.dev","password":"pulse123"}'
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod http://localhost:4000/chaos -Method Post -Headers $headers -ContentType application/json -Body '{"rate":2000,"chaos":["duplicate","shuffle"],"token_ttl":10}'
Invoke-RestMethod http://localhost:4000/chaos -Method Delete -Headers $headers
```

Supported chaos controls include rate changes, WebSocket down/silent, SSE down, dropped/duplicate/shuffled/malformed events, token TTL, HTTP 500/429, slow HTTP responses, and process kill.

## HTTP Resilience

The Angular HTTP client applies a 10 second timeout per attempt. GET requests are retried up to three times for timeouts, network failures, HTTP 429 and HTTP 502/503/504. Rule creation includes an `Idempotency-Key` and is safe to retry; other mutations are not retried. HTTP 429 responses honor `Retry-After`.

## Architecture Notes

- Backend state is deterministic in memory and generates 2,000 services.
- Metric events use a monotonic global offset and per-service sequence numbers.
- Replay and per-service history are bounded in memory.
- The Angular standalone feature pages call typed API/auth services; `FleetStore` owns table state, snapshots, stream-applied metrics, chart history and in-browser rule evaluation.
- Realtime uses WebSocket, then SSE, then 2-second snapshot polling; it probes for WebSocket recovery and handles offline/online, heartbeat inactivity, replay repair, and malformed/duplicate/gap diagnostics.
- Realtime metrics are applied in 250ms batches; a service-id index keeps rule evaluation constant-time per event. Chart.js renders the history panels; series retain at most 300 points and longer histories are bucket-averaged while preserving the first and last points.
- The services view paginates 100 results per page, keeps at most 40 rows in the DOM while scrolling, and restores search, filters, sort and page state from URL query parameters.
- Service rows open their detail page when clicked, and the page-sized table area keeps pagination visible at common desktop viewport heights.
- Adding alert-rule conditions picks an unused valid metric/operator pair (up to five); route headings and browser-tab titles update with the active page.
- Breadcrumbs follow the active route. The live connection card keeps a fixed size, and its offset uses tabular digits and a fixed minimum width to avoid shifting as event counts change.
- Frontend preserves the dark operations dashboard, uses Angular Material 21 with a custom dark theme and handwritten responsive SCSS, and consumes typed backend APIs plus the realtime fallback ladder.
- Rule creation is idempotent when sent with an `Idempotency-Key`; the backend caches results for 24 hours and rejects reuse of a key with a different payload.
- Settings are stored locally and apply the polling interval during transport fallback, the stale-event threshold, and the dashboard color scheme.

## Assignment gaps and measurement notes

The frontend table paginates the 2,000 services and virtualizes each page to 40 rendered rows. A 12.1-second headless Chrome run with 4x CPU throttling and 2,000 configured events/second measured 42.5 FPS, so the smooth 60-FPS target is not met. Docker startup could not be completed because the Docker Engine daemon was unavailable, and a broad screen-reader/keyboard accessibility audit remains outstanding. See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for measured results and other gaps.

## Assignment Conformance

The assignment-facing server configuration uses port `4000`, `/rules` endpoints, and the specified demo credentials. Automated backend/frontend checks pass; this does not establish live failure-drill or performance compliance. Remaining contract and verification gaps are called out in [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
