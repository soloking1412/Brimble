# Brimble Deployment Demo

One page, one API, one pipeline.

This repo accepts either a public Git URL or a local `.zip`, builds it with Railpack, starts the result as a Docker container, rewrites Caddy through the admin API, and streams build and deploy logs live into the UI over SSE.

## Stack

- Frontend: Vite + React + TanStack Router + TanStack Query
- Backend: Fastify + TypeScript + SQLite via `better-sqlite3`
- Builder: Railpack + Docker Buildx
- Runtime: Docker sibling containers on a shared Compose network
- Ingress: Caddy

## Prerequisites

- Docker with Compose
- Docker Buildx available to the Docker daemon
- No external accounts or cloud services

If Docker Desktop on your machine exposes the socket at `~/.docker/run/docker.sock` instead of `/var/run/docker.sock`, use:

```bash
DOCKER_SOCKET_PATH="$HOME/.docker/run/docker.sock" docker compose up --build
```

## Run

```bash
docker compose up --build
```

Open `http://localhost:8080`.

## What To Try

1. Click `Download sample zip` in the UI or use `examples/hello-node.zip`
2. Start a deployment from the sample archive
3. Watch it move through `pending -> building -> deploying -> running`
4. Open the generated URL such as `http://hello-node-xxxxxxxx.localhost:8080`
5. Refresh during the build and confirm the log history replays before the live tail resumes

You can also submit a public Git repository URL instead of a zip.

## API Surface

- `POST /api/deployments`
  - `multipart/form-data`
  - accepts exactly one of `gitUrl` or `archive`
- `GET /api/deployments`
- `GET /api/deployments/:id`
- `GET /api/deployments/stream`
  - SSE feed for deployment list updates
- `GET /api/deployments/:id/events`
  - SSE feed for persisted log replay plus live tail
- `GET /api/sample-app`
  - downloads the bundled sample zip used by the upload flow

## Architecture Notes

- Host-based routing won over path-based routing because real apps break less often when they run at `/` instead of under a prefix. Every successful deployment gets `http://<slug>.localhost:8080`.
- The API owns a single in-process worker queue. That keeps the local demo deterministic and makes failure handling easier to reason about.
- Logs are persisted before broadcast. That keeps SSE reconnect-safe and makes refresh behavior predictable.
- Caddy is the single ingress point. The bootstrap config serves the UI and API. Successful deployments cause the API to regenerate the full Caddyfile and hot-load it through Caddy's admin API.
- Deployment containers run as siblings on the shared `brimble-network`. The backend talks to the host Docker daemon through the mounted socket. That is the sharpest local-demo tradeoff in the repo and the first thing I would narrow in a production system.
- Archive extraction is path-validated, and Git input is limited to `http` and `https` URLs. The demo is intentionally permissive on app shape, not on filesystem access.

## Project Layout

- `apps/web`
  - one-page UI
- `apps/api`
  - API, SQLite persistence, SSE, worker queue, Railpack/Docker/Caddy orchestration
- `infra/caddy/Caddyfile`
  - bootstrap ingress config
- `examples/hello-node`
  - sample app for upload testing

## Local Checks

```bash
npm install
npm run build
npm test
docker compose config
```

## Meaningful Tradeoffs

- I used direct SQL instead of an ORM. The schema is small, the queries are explicit, and the state machine is easier to audit when it is close to the database writes.
- The worker assumes deployed apps bind `0.0.0.0:$PORT` and injects `PORT=3000`. When that contract is violated, the failure is surfaced directly in persisted logs and the API also captures container logs before marking the deployment failed.
- Build cache is image-layer-based: each build tags the result as `brimble/{slug}:latest` and passes `--cache-from` on the next build. This works without an external registry and without a mounted cache volume, which avoids BuildKit cache path accessibility issues in Docker-out-of-Docker.
- Runtime log streaming uses `docker logs -f --tail 0` started after the container is healthy. Logs are appended to SQLite and broadcast over the same SSE infrastructure as build logs — reconnecting clients get the full history automatically.
- The frontend stays intentionally lean. I spent the time on state clarity, replay behavior, and failure visibility rather than on a component library or animation-heavy shell.

## What I Would Change With Another Weekend

- Replace the Docker socket mount with a narrower runtime control boundary
- Add zero-downtime replacement when redeploying to the same route (currently each redeploy gets a fresh URL)
- Workspace-level build cache persistence across API restarts (currently cache lives in image layers, not on a mounted volume)

## What I Would Remove Later

- The in-process queue once multiple API instances exist
- Full-Caddyfile regeneration once the number of routes grows
- Direct Docker CLI shell-outs as the long-term runtime contract

## Submission Notes

- `docker-compose.yml` brings up the full stack with a single `docker compose up --build`
- `examples/hello-node.zip` is the bundled sample upload for testing the archive path
- Time spent: [fill in before submitting]
- Walkthrough: [Loom URL — fill in before submitting]

## Brimble Deploy And Feedback

Deployed: [fill in URL before submitting]

[Fill in 1-2 paragraphs of honest feedback — where the platform felt sharp, where it was confusing, what broke expectations, what slowed the deploy or required workarounds]
