# Public demo + private builder hostname via Cloudflare Tunnel

This deployment publishes the local PANDAWA APEX Docker app without exposing the
server's inbound ports or PostgreSQL. It uses one **remotely-managed Cloudflare Tunnel**.

## Hostname design

Replace `domain-anda.com` with the domain already active in your Cloudflare zone.

| Hostname | Audience | Cloudflare policy | Origin |
| --- | --- | --- | --- |
| `demo.domain-anda.com` | Public demo users | No Access login; apply WAF/rate limits | `http://app:8080` |
| `builder.domain-anda.com` | Maintainers only | Cloudflare Access: allow only named maintainer emails / IdP group | `http://app:8080` |

**Important current-repository limitation:** PANDAWA APEX is currently Phase 1 (runtime from YAML specs).
The visual builder is Phase 2 and is not yet implemented. The private hostname is therefore a protected
alias to the same app service, not a functioning builder UI. Keep the Access policy in place now; when
the builder routes are implemented, this hostname can be used without changing the tunnel connector.

Both routes terminate at the same app container. Cloudflare Access is applied to the *builder hostname*
at the edge, not to the public demo hostname. Do not create a broad Access policy covering the parent
domain or the demo hostname.

## 1. Prerequisites

- Domain is active in Cloudflare DNS (full setup recommended).
- Local server has Docker Engine + Compose plugin and outbound internet.
- Cloudflare Tunnel can establish outbound connections. On restrictive firewalls, allow outbound
  connectivity to Cloudflare Tunnel (including port 7844 as documented by Cloudflare).
- Existing PANDAWA APEX checkout and local Compose deployment work before adding the tunnel.

The connector initiates outbound connections; do not port-forward 8080 or 5432 on the router.
PostgreSQL remains private on the Docker network. The base Compose file binds its optional host ports
to loopback (127.0.0.1), not all interfaces.

## 2. Create the remotely-managed tunnel

1. Open Cloudflare Dashboard → **Networking → Tunnels** (in some dashboard layouts, Zero Trust → Networks → Tunnels).
2. Select **Create tunnel**, name it `pandawapex-local`, and choose the Docker connector instructions.
3. Copy the tunnel token. Treat it as a production secret; do not paste it into GitHub, an issue, or chat.
4. Open **Public Hostnames / Routes** for this tunnel and add both routes:

   - `demo.domain-anda.com` → Type HTTP, URL `http://app:8080`
   - `builder.domain-anda.com` → Type HTTP, URL `http://app:8080`

   The service address uses Docker service DNS. Do not use `localhost:8080` from inside the
   cloudflared container: localhost would refer to the connector container itself.

5. Save. For a full Cloudflare DNS setup, adding the published routes creates the tunnel DNS records.

## 3. Configure public and private access

### Public demo hostname

- Do **not** attach a Cloudflare Access application/policy to `demo.domain-anda.com`.
- Keep PANDAWA's own application login enabled. Cloudflare Tunnel is transport, not application authentication.
- Enable Cloudflare managed WAF rules and suitable rate limiting for the demo hostname.
- Restrict or block `/healthz` at the Cloudflare edge. The endpoint is for operational checks and should not be a public information endpoint.

### Private builder hostname

1. Cloudflare Zero Trust → Access controls → Applications → Add application → Self-hosted.
2. Set hostname to `builder.domain-anda.com`.
3. Create a **Deny by default / Allow** policy for only the maintainers' verified email addresses or organization IdP group.
4. Enable the intended identity provider and test with an allowed and a denied account.
5. Keep the Access application scoped to the builder hostname only.

Cloudflare recommends validating Access tokens at the origin/tunnel as defense in depth (for example, Protect with Access where supported). Do not assume a hostname is private merely because its name contains "builder".

## 4. Add the Compose overlay

From the repository root:

```bash
cp .env.example .env
cat .env.cloudflare.example >> .env
```

Edit `.env` and set strong unique values:

- `RPX_SECRET`: `openssl rand -hex 32`
- `RPX_DEMO_PASSWORD`: a unique password (at least 10 characters; use a password manager)
- `POSTGRES_PASSWORD`: a strong unique database password
- `CLOUDFLARE_TUNNEL_TOKEN`: token copied from the tunnel setup page
- `RPX_PUBLIC_URL=https://demo.domain-anda.com`
- `RPX_SECURE_COOKIES=1`

Never commit `.env`. The token grants tunnel connectivity; rotate it in Cloudflare if exposed.

Start or update the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml config
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs -f cloudflared
```

The existing base Compose services are retained. The overlay adds only the connector and does not publish
any additional host ports.

## 5. Critical application/database hardening before public exposure

**Do not expose the current sample Compose stack to the public internet unchanged.** The repository's
local quick-start intentionally uses PostgreSQL superuser credentials for convenience, including the
app runtime. The architecture and README specify that the runtime should connect as `rpx_engine`,
not `postgres`. This needs to be corrected for a public demo before opening the hostname.

Required before public use:

1. Provision a dedicated `rpx_engine` login with a strong password and use it only for
   `RPX_DATABASE_URL`. The migration creates/grants the role and grants metadata access to it.
2. Keep the database owner/admin URL for setup/migrations only; do not give it to the long-running app.
3. Ensure workspace roles are `NOLOGIN` and the engine is the only role allowed to assume them.
4. Change all seeded demo passwords. The local install guide currently assigns one shared password to
   multiple pilot users; do not publish that credential. Disable or remove unused accounts.
5. Use synthetic data only. Do not load employee, customer, financial, production, or other confidential data.
6. Keep `DB_PORT` and `APP_PORT` bound to `127.0.0.1`. Never add a public mapping for PostgreSQL 5432.
7. Audit `trustProxy` and forwarded headers in Fastify: only accept proxy headers from the trusted
   tunnel path. Do not expose the app port on a LAN/WAN interface.
8. Keep OS and Docker patched; use disk backups for PostgreSQL and test restore regularly.

The exact role setup must follow the current CLI/migration implementation and be validated against the
database before deployment; do not substitute the local `postgres` password for the engine credential.

## 6. Verification

On the local server:

```bash
curl -fsS http://127.0.0.1:8080/healthz
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs --tail=100 cloudflared
```

From a device outside the local network:

- Open `https://demo.domain-anda.com/r/demo/emp` and sign in with the rotated demo account.
- Open `https://builder.domain-anda.com`; it must show Cloudflare Access authentication.
- Test a non-allowlisted account; it must be denied.
- Confirm the origin is not reachable through a public IP or router port-forward.
- Confirm PostgreSQL 5432 is not reachable externally.
- Confirm `https://demo.domain-anda.com/healthz` is blocked/restricted by the edge rule.

The application paths above are the repository's documented routes. Replace the domain placeholders with
your actual zone before deployment.

## 7. Operations

```bash
# inspect
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs -f app cloudflared

# restart connector only
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml restart cloudflared

# update images and rebuild app
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml pull cloudflared
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build

# stop without deleting PostgreSQL data
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml down
```

Do not use `down -v` unless intentionally deleting the PostgreSQL data volume.
