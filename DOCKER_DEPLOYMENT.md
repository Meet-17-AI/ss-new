# Docker Deployment Guide - Backend Only

## Overview
Deploy the SafeStories panel-backend on your VPS using Docker and Traefik for automatic HTTPS.

## Prerequisites
- Docker and Docker Compose installed on VPS
- Backend domain configured (e.g., `api.yourdomain.com`)
- DNS A record pointing to your VPS IP
- PostgreSQL database accessible from VPS
- MinIO configured and accessible

## Step 1: Prepare Your VPS

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Create project directory
mkdir -p /opt/safestories
cd /opt/safestories

# Clone the repository
git clone https://github.com/safestories-tech/safestories-panel.git .
```

## Step 2: Update Backend Domain

Edit `docker-compose.yml` and change `api.yourdomain.com` to your actual domain:

```bash
sed -i 's/api.yourdomain.com/your-backend-domain.com/g' docker-compose.yml
```

Example: `api.fluidjobs.ai`, `backend.safestories.in`, etc.

## Step 3: Configure Environment Variables

Create `.env.production` on your VPS with your actual values:

```bash
# Database Configuration
PGHOST=your-db-host.com
PGPORT=5432
PGDATABASE=safestories_db_v2
PGUSER=your-db-user
PGPASSWORD=your-secure-password

# Application
JWT_SECRET=your-secure-jwt-secret-key

# Razorpay
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret

# MinIO
MINIO_ENDPOINT=s3.fluidjobs.ai
MINIO_PORT=443
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key

# Frontend CORS (points to your local frontend)
FRONTEND_URL=http://localhost:3006
ALLOWED_ORIGINS=http://localhost:3006
```

## Step 4: Deploy

```bash
# Build the Docker image
docker-compose build panel-backend

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f panel-backend

# Verify container is running
docker-compose ps
```

## Step 5: Verify It's Working

```bash
# Check Traefik dashboard
# Access: http://your-vps-ip:8080/dashboard/

# Test backend API
curl -I https://api.yourdomain.com

# Check SSL certificate
curl -vI https://api.yourdomain.com
# You should see "Certificate issuer: Let's Encrypt"

# Test a backend endpoint
curl https://api.yourdomain.com/health
```

## Common Commands

```bash
# View backend logs
docker-compose logs -f panel-backend

# Restart backend
docker-compose restart panel-backend

# Stop everything
docker-compose down

# Rebuild and restart
docker-compose build panel-backend
docker-compose up -d panel-backend

# Shell into container
docker-compose exec panel-backend sh

# View environment variables
docker-compose exec panel-backend printenv
```

## Troubleshooting

### SSL Certificate Not Issued
```bash
# Check Traefik logs
docker-compose logs traefik

# Verify domain DNS is pointing to your VPS
nslookup api.yourdomain.com

# Restart Traefik to retry certificate
docker-compose restart traefik
```

### Backend Connection Errors
```bash
# Check database connectivity
docker-compose exec panel-backend npm run start

# View all logs
docker-compose logs
```

### Port 80/443 Already in Use
```bash
# Kill process using the port
sudo lsof -i :80
sudo kill -9 <PID>

# Or stop conflicting service
sudo systemctl stop nginx
```

## Production Checklist

- [ ] Update `.env.production` with real credentials
- [ ] Update domain name in `docker-compose.yml`
- [ ] Push changes to repository
- [ ] SSH into VPS and git pull
- [ ] Run `docker-compose up -d`
- [ ] Verify with `docker-compose ps`
- [ ] Check logs with `docker-compose logs -f`
- [ ] Test API endpoint: `curl https://api.yourdomain.com`

## Updates

When pushing new code:

```bash
# On VPS
git pull origin main

# Rebuild and restart
docker-compose build panel-backend
docker-compose up -d panel-backend
```

## Notes

- Traefik automatically manages HTTPS with Let's Encrypt
- Certificates auto-renew before expiration
- Frontend stays local on your machine (http://localhost:3006)
- Backend is accessed over HTTPS from frontend
