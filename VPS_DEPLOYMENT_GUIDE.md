# Complete VPS Deployment & Auto-Deploy Guide

## Understanding the Difference

### Render (Managed Service)
- ✅ Auto-deploys on every git push
- ✅ Built-in monitoring & error tracking
- ✅ Automatic SSL certificates
- ✅ No server maintenance
- ❌ Limited customization
- ❌ Cost per dyno
- ❌ Vendor lock-in

### Your VPS (Self-Managed)
- ✅ Full control & customization
- ✅ Cheaper at scale
- ✅ No vendor lock-in
- ✅ Can run multiple services (n8n, MinIO, etc.)
- ❌ You manage updates & security
- ❌ You manage backups
- ❌ Need to set up monitoring yourself

---

## Complete Setup Overview

```
GitHub Repo
    ↓ (git push)
GitHub Actions (CI/CD)
    ↓ (on every commit)
Your VPS (Docker)
    ↓
Running Backend
    ↓
Error Monitoring (Sentry/CloudWatch)
```

---

## Step 1: SSH Keys Setup (One Time)

Create SSH keys so GitHub Actions can access your VPS:

```bash
# On your VPS
ssh-keygen -t ed25519 -f /home/deploy/.ssh/deploy_key -N ""

# View the private key (keep this secret!)
cat /home/deploy/.ssh/deploy_key

# Add public key to authorized_keys
cat /home/deploy/.ssh/deploy_key.pub >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

---

## Step 2: GitHub Secrets Setup

Add to your GitHub repo settings → Secrets and Variables → Actions:

```
VPS_HOST: your-vps-ip-or-domain.com
VPS_USER: deploy
VPS_SSH_KEY: (paste the PRIVATE key from above)
VPS_PORT: 22
```

Also add all your environment variables as secrets:
```
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
JWT_SECRET
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
MINIO_ENDPOINT
MINIO_PORT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
```

---

## Step 3: Create GitHub Actions Workflow

Create file: `.github/workflows/deploy.yml`

```yaml
name: Deploy to VPS

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v0.1.10
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT }}
          script: |
            cd /opt/safestories
            git pull origin main
            
            # Create .env file from secrets
            cat > .env.production << EOF
            NODE_ENV=production
            PGHOST=${{ secrets.DB_HOST }}
            PGPORT=${{ secrets.DB_PORT }}
            PGDATABASE=${{ secrets.DB_NAME }}
            PGUSER=${{ secrets.DB_USER }}
            PGPASSWORD=${{ secrets.DB_PASSWORD }}
            JWT_SECRET=${{ secrets.JWT_SECRET }}
            RAZORPAY_KEY_ID=${{ secrets.RAZORPAY_KEY_ID }}
            RAZORPAY_KEY_SECRET=${{ secrets.RAZORPAY_KEY_SECRET }}
            MINIO_ENDPOINT=${{ secrets.MINIO_ENDPOINT }}
            MINIO_PORT=${{ secrets.MINIO_PORT }}
            MINIO_ACCESS_KEY=${{ secrets.MINIO_ACCESS_KEY }}
            MINIO_SECRET_KEY=${{ secrets.MINIO_SECRET_KEY }}
            FRONTEND_URL=${{ secrets.FRONTEND_URL }}
            ALLOWED_ORIGINS=${{ secrets.ALLOWED_ORIGINS }}
            EOF
            
            # Rebuild and restart
            docker-compose build panel-backend
            docker-compose up -d panel-backend
            
            # Check if running
            sleep 5
            docker-compose ps

      - name: Notify on Failure
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Deployment failed! Check the Actions tab for details.'
            })
```

---

## Step 4: Error Monitoring Setup

### Option A: Sentry (Recommended - Like Render's Monitoring)

**Step 4a: Add Sentry to Backend**

```bash
# On your VPS, in panel-backend
npm install @sentry/node
```

Update `panel-backend/src/index.ts`:

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());

// Your error handler middleware...
```

**Step 4b: Set up Sentry**

1. Go to https://sentry.io
2. Sign up (free tier available)
3. Create new project for Node.js
4. Copy DSN
5. Add to GitHub Secrets: `SENTRY_DSN`
6. Add to `.env.production`: `SENTRY_DSN=${SENTRY_DSN}`

**What you get:**
- 📊 Real-time error tracking
- 📈 Performance monitoring
- 🔔 Email alerts on errors
- 📱 Mobile app notifications
- 📝 Full error logs & stack traces

### Option B: LogRocket (Alternative)

```bash
npm install @logrocket/node
```

Similar to Sentry, better for session replay.

### Option C: ELK Stack (Self-Hosted - Advanced)

If you want full control:
- Elasticsearch (storage)
- Logstash (processing)
- Kibana (visualization)

Add to docker-compose.yml (more complex setup).

---

## Step 5: Container Logs Monitoring

### View Logs in Real-Time

```bash
# On your VPS
docker-compose logs -f panel-backend
```

### Save Logs to File

Update docker-compose.yml:

```yaml
panel-backend:
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
```

Access logs:
```bash
docker logs panel-backend --tail 100 -f
```

---

## Step 6: Health Checks & Alerts

### Simple Health Endpoint

Add to `panel-backend/src/index.ts`:

```typescript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    uptime: process.uptime()
  });
});
```

### Monitor with Cron Job on VPS

Create `/home/deploy/check-backend.sh`:

```bash
#!/bin/bash

ENDPOINT="https://api.yourdomain.com/health"
EMAIL="your-email@domain.com"

response=$(curl -s -o /dev/null -w "%{http_code}" $ENDPOINT)

if [ $response -ne 200 ]; then
  echo "Backend is down! Status: $response" | \
  mail -s "🚨 Backend Alert" $EMAIL
  
  # Optionally restart
  cd /opt/safestories && docker-compose restart panel-backend
fi
```

Make executable and add to crontab:
```bash
chmod +x /home/deploy/check-backend.sh

# Run every 5 minutes
*/5 * * * * /home/deploy/check-backend.sh
```

---

## Step 7: Complete Workflow

### When You Push to GitHub:

1. **GitHub detects commit**
   ```bash
   git push origin main
   ```

2. **GitHub Actions runs**
   - Checks out code
   - Connects to your VPS via SSH
   - Pulls latest code
   - Builds Docker image
   - Restarts container

3. **Backend updates on VPS**
   - Old container stops
   - New image built
   - New container starts
   - Health check runs

4. **Errors are monitored**
   - Sentry captures errors
   - Logs stored in Docker
   - Cron job checks health
   - You get alerts

5. **You see the update live**
   - No downtime (usually < 30 seconds)
   - New features instantly available
   - Old code removed

---

## Step 8: Rollback if Something Goes Wrong

```bash
# On your VPS
git log --oneline -5
git revert <commit-hash>
git push origin main

# Auto-deploy triggers and reverts!
```

Or manually rollback:
```bash
cd /opt/safestories
docker-compose down panel-backend
git reset --hard <commit-hash>
docker-compose up -d panel-backend
```

---

## Comparison: Render vs VPS Setup

| Feature | Render | Your VPS |
|---------|--------|---------|
| Auto-deploy | ✅ Built-in | ✅ GitHub Actions |
| Error monitoring | ✅ Built-in | ✅ Sentry (free) |
| SSL Certificates | ✅ Auto | ✅ Traefik Auto |
| Scaling | ✅ Easy | ⚠️ Manual |
| Cost | ❌ $7-12/month | ✅ $5/month VPS |
| Control | ❌ Limited | ✅ Full |
| Data ownership | ❌ Render owns | ✅ You own |

---

## Complete Checklist

- [ ] Create SSH keys for deploy user
- [ ] Add VPS_HOST, VPS_USER, VPS_SSH_KEY to GitHub Secrets
- [ ] Add all DB/API secrets to GitHub Secrets
- [ ] Create `.github/workflows/deploy.yml`
- [ ] Test first deployment manually
- [ ] Set up Sentry account & get DSN
- [ ] Add SENTRY_DSN to GitHub Secrets
- [ ] Update panel-backend code with Sentry
- [ ] Push code to trigger auto-deploy
- [ ] Verify on VPS with `docker-compose ps`
- [ ] Check logs with `docker-compose logs -f panel-backend`
- [ ] Verify error tracking in Sentry
- [ ] Set up health check cron job
- [ ] Test rollback process

---

## Troubleshooting

### Deploy fails with permission error
```bash
# On VPS, check permissions
ls -la /home/deploy/.ssh/
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/deploy_key
```

### Container doesn't start after deploy
```bash
# Check logs
docker-compose logs panel-backend

# Check env vars were written
docker-compose exec panel-backend printenv

# Manually rebuild
docker-compose build --no-cache panel-backend
```

### Health check failing
```bash
# Test endpoint manually
curl -vI https://api.yourdomain.com/health

# Check if port is exposed
docker-compose exec panel-backend wget -O- http://localhost:5000/health
```

### Sentry not receiving errors
```bash
# Check DSN in running container
docker-compose exec panel-backend printenv | grep SENTRY

# Test Sentry in code
throw new Error("Test error from backend");
```

---

## Next Steps

1. Push current code to GitHub
2. Set up SSH keys
3. Add GitHub Secrets
4. Create GitHub Actions workflow
5. Push a test commit to trigger deploy
6. Monitor the action running
7. Verify backend is running on VPS
8. Set up error monitoring

Your VPS setup will now work exactly like Render - auto-deploy on every commit + error tracking! 🚀
