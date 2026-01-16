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
└── sync-ssh-keys.sh   # SSH key synchronization (93 lines)
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

| Service | Container | Port | Health Check |
|---------|-----------|------|--------------|
| Backend | sdc-backend | 8000 | `/health` endpoint |
| Frontend | sdc-frontend | 3000 | HTTP check |
| Nginx | sdc-nginx | 80, 443 | Proxy check |

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
| Path | Destination |
|------|-------------|
| `/api/*` | FastAPI backend |
| `/auth/*` | Supabase auth proxy |
| `/*` | Next.js frontend |

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
- Runs on cron schedule

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
