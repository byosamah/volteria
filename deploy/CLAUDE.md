# Deploy - CLAUDE.md

> Infrastructure and deployment configuration for Volteria platform

## Quick Reference

```bash
# Deploy to production
git push origin main
ssh volteria "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"

# Fix 502 errors
ssh volteria "docker restart sdc-nginx"

# View logs
ssh volteria "docker logs sdc-backend --tail=50"
ssh volteria "docker logs sdc-frontend --tail=50"

# Check status
ssh volteria "docker-compose -f /opt/solar-diesel-controller/docker-compose.yml ps"
```

## Structure

```
deploy/
├── nginx.conf         # Reverse proxy + SSL (268 lines)
├── setup-server.sh    # Initial server setup (193 lines)
├── sync-ssh-keys.sh   # SSH key synchronization (93 lines)
└── maintenance.sh     # Daily automated cleanup (NEW)
```

## Server Details

| Property | Value |
|----------|-------|
| Provider | DigitalOcean Droplet |
| IP | 159.223.224.203 |
| OS | Ubuntu 22.04 |
| Domain | volteria.org |
| SSH Host | `volteria` (in ~/.ssh/config) |
| App Path | `/opt/solar-diesel-controller` |

## Docker Services

Defined in `docker-compose.yml` at project root:

| Service | Container | Port | Resources | Health Check |
|---------|-----------|------|-----------|--------------|
| Backend | sdc-backend | 8000 | 1 CPU, 512MB | `/health` endpoint |
| Frontend | sdc-frontend | 3000 | 0.5 CPU, 384MB | HTTP check |
| Nginx | sdc-nginx | 80, 443 | 0.25 CPU, 64MB | Proxy check |

**Log Rotation**: All services configured with `max-size: 10m`, `max-file: 3`

## Nginx Configuration

### Upstream Servers
```nginx
upstream backend {
    server backend:8000;
}
upstream frontend {
    server frontend:3000;
}
```

### Route Mapping
| Path | Destination | Notes |
|------|-------------|-------|
| `/api/admin/*` | Next.js frontend | Admin API routes |
| `/api/controllers/{id}/(update\|reboot\|ssh\|logs\|logging-stats\|logging-debug\|...)` | FastAPI backend | Controller operations |
| `/api/controllers/*` | Next.js frontend | Heartbeats, lookup |
| `/api/dashboards/*` | Next.js frontend | Dashboard widgets |
| `/api/historical` | Next.js frontend | Historical data (regex match) |
| `/api/sites/*` | Next.js frontend | Site status |
| `/api/projects/*` | Next.js frontend | Project status |
| `/api/devices/*` | Next.js frontend | Device registers |
| `/api/*` | FastAPI backend | All other API routes |
| `/*` | Next.js frontend | Frontend pages |

**Important**: `/api/historical` uses regex `^/api/historical(/|$)` to match with/without trailing slash. This prevents redirect loops between nginx (adds slash) and Next.js (removes slash).

### Security Features
- SSL/TLS with Let's Encrypt
- Security headers (X-Frame-Options, XSS-Protection)
- Rate limiting: 10r/s API, 5r/m login
- Gzip compression enabled

## Setup Script (setup-server.sh)

Automated setup for fresh Ubuntu 22.04 server:

1. Update system packages
2. Install Docker + Docker Compose
3. Install Certbot for SSL
4. Clone repository
5. Configure environment variables
6. Obtain SSL certificate
7. Start Docker services
8. Configure firewall (UFW)

## SSH Key Sync (sync-ssh-keys.sh)

Synchronizes controller SSH public keys from database to server:
- Fetches keys from `controllers_master` table
- Updates `authorized_keys` for controller access
- Runs every 5 minutes via cron

## Maintenance Script (maintenance.sh)

Daily automated cleanup running at 3 AM:
- Docker prune (images >24h, unused volumes/networks)
- Journal vacuum (7 days retention)
- APT autoremove and clean
- Truncate large volteria logs (>10MB)
- Health report (disk, memory, container status)

**Cron Schedule**:
```bash
*/5 * * * * /opt/.../deploy/sync-ssh-keys.sh   # SSH sync
0 3 * * * /opt/.../deploy/maintenance.sh       # Daily cleanup
```

**Logrotate** (`/etc/logrotate.d/volteria`):
```
/var/log/volteria-*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

## Deployment Checklist

### Pre-Deploy
- [ ] Run `npm run build` locally
- [ ] Run `npm test` locally
- [ ] Commit all changes
- [ ] Push to GitHub

### Deploy
```bash
ssh volteria "cd /opt/solar-diesel-controller && git pull && docker-compose up -d --build"
```

### Post-Deploy
- [ ] Verify all 3 containers running
- [ ] Check backend health: `curl localhost:8000/health`
- [ ] Check frontend: `curl localhost:3000/login`
- [ ] Visit https://volteria.org

## Troubleshooting

### 502 Bad Gateway
```bash
# Nginx started before services were ready
docker restart sdc-nginx
```

### Container Won't Start
```bash
# Check logs for errors
docker logs sdc-backend --tail=100
docker logs sdc-frontend --tail=100
```

### ERR_TOO_MANY_REDIRECTS
```bash
# Check nginx access logs for redirect pattern (301 → 308 loop)
docker logs sdc-nginx --tail=50
```

**Root cause**: Nginx `location /api/path/` (with trailing slash) redirects requests to `/api/path` (no slash), causing infinite loop.

**Fix**: Use regex pattern instead of exact path:
```nginx
# BAD - causes redirect loop
location /api/sites/ {
    proxy_pass http://frontend;
}

# GOOD - handles both /api/sites and /api/sites/
location ~ ^/api/sites(/.*)?$ {
    proxy_pass http://frontend;
}
```

**Debug tip**: Check nginx location blocks FIRST when debugging redirect loops.

### SSL Certificate Renewal
```bash
# Certbot auto-renews, but manual renewal:
certbot renew
docker restart sdc-nginx
```

### Full Recovery
```bash
# Complete restart of all services
ssh volteria "cd /opt/solar-diesel-controller && docker-compose down && docker-compose up -d --build"
```

## Environment Variables

Required in `.env` on server:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional
NODE_ENV=production
```

## Important Notes

1. **Never modify files directly on server** - Always deploy via git
2. **Don't interrupt builds** - Can corrupt Docker images
3. **Wait for builds** - Frontend build takes ~2-3 minutes
4. **Always restart nginx** after 502 errors
5. **SSL auto-renews** via Certbot cron job
