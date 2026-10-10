# Fleet Pulse Implementation Plan

## Assignment Requirements Available

No assignment PDF was present in the repository during inspection, so this plan is based on the pasted assignment brief. If the PDF is added later, its exact contracts should supersede any inferred shapes below.

## Existing Implementation

- Frontend lives in `frontend/fleet-pulse-ui` and is Angular 21 standalone.
- The current dashboard UI is visually complete, but most data and behavior are implemented inside `src/app/app.ts`.
- Existing frontend behavior includes local generation of 2,000 services, local filtering/sorting/pagination, selected service details, local incidents, and local alert-rule actions.
- Backend lives in `backend` and currently contains shared types, error helpers, and chaos-state helpers only.
- No assignment PDF was found by `Get-ChildItem -Recurse -Filter *.pdf`.

## Missing Functionality

- Express server entry point and route implementations.
- Authentication, access-token expiry, refresh-token rotation, and role enforcement.
- Real API-backed services, metrics, replay, alert rules, chaos controls, and health diagnostics.
- WebSocket and SSE streaming endpoints.
- Backend tests and usable package scripts.
- Frontend API integration, auth token handling, route guards, lazy feature routes, and reusable component split.
- Docker Compose and root-level README/status documentation.

## Planned File Structure

### Backend

- `src/server.ts`: app/server factory, Express routes, WebSocket upgrade, SSE handlers, graceful shutdown.
- `src/auth.ts`: demo users, token signing/verification, refresh-token rotation, auth middleware.
- `src/data.ts`: deterministic 2,000 service generation, metrics state, history, replay buffer, alert rules.
- `src/stream.ts`: event pump, WebSocket/SSE broadcast, chaos behavior, replay support.
- `tests/*.test.ts`: integration coverage for auth, services, metrics/replay, rules, and chaos.

### Frontend

- `src/app/core/models/api.models.ts`: typed API models.
- `src/app/core/auth/*`: auth service, interceptor, auth guard, role guard.
- `src/app/core/http/fleet-api.service.ts`: typed HTTP API client.
- `src/app/core/realtime/realtime.service.ts`: WebSocket/SSE handling, replay offset tracking.
- `src/app/shared/components/*`: status badge, stat card, pagination, loading/error/empty states.
- `src/app/features/*`: dashboard, services, alert rules, incidents, login, chaos pages.

The first implementation stage preserves the existing dashboard shell while replacing backend mocks and adding typed integration points. A deeper component extraction remains tracked in `IMPLEMENTATION_STATUS.md`.

## API Contracts

All errors:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": []
  }
}
```

Auth:

- `POST /auth/login` with `{ "email": string, "password": string }`
- `POST /auth/refresh` with `{ "refreshToken": string }`
- Response: `{ "user": User, "accessToken": string, "refreshToken": string, "expiresAt": number }`

Services:

- `GET /services?q=&status=&team=&region=&sort=&direction=&page=&pageSize=`
- Response: `{ "items": FleetService[], "page": number, "pageSize": number, "total": number, "teams": string[], "regions": string[] }`

Metrics:

- `GET /metrics/snapshot`
- Response: `{ "offset": number, "generatedAt": number, "summary": FleetSummary, "services": ServiceMetric[] }`
- `GET /metrics/history?serviceId=&minutes=`
- Response: `{ "serviceId": string, "minutes": number, "items": MetricPoint[] }`
- `GET /metrics/replay?since=`
- Response: `{ "since": number, "latestOffset": number, "items": MetricEvent[] }`

Realtime:

- WebSocket `/stream?token=&since=`
- SSE `/stream/sse?token=&since=`
- Events are metric events with monotonic `offset` and per-service `seq`. Ping events indicate liveness.

Rules:

- `GET /alert-rules`
- `POST /alert-rules`
- `PUT /alert-rules/:id`
- `PATCH /alert-rules/:id`
- `DELETE /alert-rules/:id`
- `GET /alert-rules/validate-name?name=&excludeId=`

Chaos:

- `GET /chaos`
- `POST /chaos`
- `DELETE /chaos`

Health:

- `GET /health`

## Stage Tasks

1. Backend server and deterministic domain state.
2. Auth, authorization, services, metrics, rules, chaos, health routes.
3. WebSocket/SSE stream with replay buffer and bounded history.
4. Backend tests and validation scripts.
5. Frontend typed API/auth/realtime services and production-path backend integration.
6. Frontend route/component extraction and tests.
7. Docker Compose, README, and final implementation status.

## Validation Commands

Backend:

```powershell
cd C:\Projects\fleet-pulse\backend
npm test
npm run build
```

Frontend:

```powershell
cd C:\Projects\fleet-pulse\frontend\fleet-pulse-ui
npm test
npm run build
```

Docker:

```powershell
cd C:\Projects\fleet-pulse
docker compose up --build
```
