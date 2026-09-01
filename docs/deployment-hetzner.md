# Hetzner public-domain scanner deployment

This deployment exposes only the public domain-scan route through Nginx. The
container binds its host port to `127.0.0.1`.

## Service

Run the service from `/opt/quantumsentinel`:

```sh
docker compose -f docker-compose.production.yml up -d --build
```

Check the local health endpoint:

```sh
curl --fail http://127.0.0.1:8790/api/health
```

## Nginx routes

Proxy only these routes:

```nginx
location = /api/quantumsentinel/health {
    proxy_pass http://127.0.0.1:8790/api/health;
    proxy_set_header Host $host;
}

location = /api/quantumsentinel/public/domain-scans {
    proxy_pass http://127.0.0.1:8790/api/public/domain-scans;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Do not proxy `/api/probes`, `/api/repository-scans`, or the general
QuantumSentinel API to the public internet.
