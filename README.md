# Fleet Pulse

Fleet Pulse is a real-time operations dashboard with an Angular 21 frontend and a Node.js/TypeScript backend.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop, optional

## Install

```powershell
cd C:\Projects\fleet-pulse\backend
npm install

cd C:\Projects\fleet-pulse\frontend\fleet-pulse-ui
npm install
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

## Demo Credentials

- Operator: `operator@fleetpulse.dev` / `operator123`
- Viewer: `viewer@fleetpulse.dev` / `viewer123`

Open `/login` and use either demo account. The login form is prefilled with the operator credentials for quick review.

## API

Base URL: `http://localhost:3000`

- `POST /auth/login`
- `POST /auth/refresh`
- `GET /services`
- `GET /metrics/snapshot`
- `GET /metrics/history?serviceId=&minutes=`
- `GET /metrics/replay?since=`
- WebSocket `/stream?token=&since=`
- SSE `/stream/sse?token=&since=`
- `GET /alert-rules`
- `POST /alert-rules`
- `PUT /alert-rules/:id`
- `PATCH /alert-rules/:id`
- `DELETE /alert-rules/:id`
- `GET /alert-rules/validate-name?name=&excludeId=`
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
```

## Docker

```powershell
cd C:\Projects\fleet-pulse
docker compose up --build
```

Frontend: `http://localhost:8080`
Backend: `http://localhost:3000`

## Chaos Testing

Authenticate as an operator, then call `POST /chaos`.

Examples:

```powershell
$login = Invoke-RestMethod http://localhost:3000/auth/login -Method Post -ContentType application/json -Body '{"email":"operator@fleetpulse.dev","password":"operator123"}'
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod http://localhost:3000/chaos -Method Post -Headers $headers -ContentType application/json -Body '{"rate":2000,"chaos":["duplicate","shuffle"],"token_ttl":10}'
Invoke-RestMethod http://localhost:3000/chaos -Method Delete -Headers $headers
```

Supported chaos controls include rate changes, WebSocket down/silent, SSE down, dropped/duplicate/shuffled/malformed events, token TTL, HTTP 500/429, slow HTTP responses, and process kill.

## Architecture Notes

- Backend state is deterministic in memory and generates 2,000 services.
- Metric events use a monotonic global offset and per-service sequence numbers.
- Replay and per-service history are bounded in memory.
- Frontend preserves the original dark operations dashboard and now consumes typed backend APIs plus WebSocket/SSE realtime updates.

Known limitations are tracked in `IMPLEMENTATION_STATUS.md`.
