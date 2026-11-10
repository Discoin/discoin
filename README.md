# Discoin

A stock exchange market for discord bots. Discoin is a platform that allows users to exchange one discord bot currency for another. It is designed to facilitate the trading of bot currencies in a secure and efficient manner.

## Run with Docker

Build and start the frontend and API with Docker Compose:

```sh
docker compose up --build
```

Compose starts PostgreSQL (`postgres:latest`), waits for it to become healthy, and requires the API to connect to it before the API starts. The frontend is available at <http://localhost:8080>, and the API at <http://localhost:8000>. The API health endpoint checks database connectivity and is available at <http://localhost:8080/api/health> through the frontend's reverse proxy.

The local database defaults are `discoin` for the database, user, and password. Override them with `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` in the environment when needed. Do not use the development password in production.

## Continuous integration

GitHub Actions checks frontend linting, formatting, and builds; API linting, formatting, and lockfile consistency; npm and Python dependency vulnerabilities; and Docker Compose configuration and image builds. Dependabot checks for dependency and GitHub Actions updates weekly.
