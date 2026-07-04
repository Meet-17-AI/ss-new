# Quick Setup: Auto-Deploy & Error Monitoring

Follow these steps **in order**:

---

## Phase 1: SSH Keys (5 minutes)

### Step 1: Create SSH Key on VPS

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Create deploy user
adduser deploy
usermod -aG docker deploy
su deploy

# Create SSH key
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""

# Show private key (copy this!)
cat ~/.ssh/deploy_key

# Add public key to authorized
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

✅ You now have: **Private SSH Key** (save it!)

---

## Phase 2: GitHub Secrets (5 minutes)

### Step 2: Add Secrets to GitHub

1. Go to: **GitHub Repo → Settings → Secrets and variables → Actions**

2. Click **"New repository secret"** and add:

```
VPS_HOST = your-vps-ip-or-domain.com
VPS_USER = deploy
VPS_PORT = 22
VPS_SSH_KEY = (paste the PRIVATE key from step 1)
```

3. Also add these secrets (your actual values):

```
PGHOST = your-database-host
PGPORT = 5432
PGDATABASE = safestories_db_v2
PGUSER = your-db-user
PGPASSWORD = your-db-password
JWT_SECRET = your-jwt-secret
RAZORPAY_KEY_ID = your-razorpay-key
RAZORPAY_KEY_SECRET = your-razorpay-secret
MINIO_ENDPOINT = s3.fluidjobs.ai
MINIO_PORT = 443
MINIO_ACCESS_KEY = your-minio-access-key
MINIO_SECRET_KEY = your-minio-secret-key
FRONTEND_URL = http://localhost:3006
ALLOWED_ORIGINS = http://localhost:3006
SSL_EMAIL = your-email@domain.com
DOMAIN_NAME = your-domain.com
```

✅ All secrets added

---

## Phase 3: First Deployment (10 minutes)

### Step 3: Manual Test Deploy

Before automating, test manually on VPS:

```bash
# SSH to VPS
ssh deploy@your-vps-ip

# Navigate to project
cd /opt/safestories

# Check if volume exists
docker volume ls | grep panel_backend_data

# If not, create it
docker volume create panel_backend_data

# Check docker-compose.yml is there
ls -la docker-compose.yml

# Try building
docker-compose build panel-backend

# Start service
docker-compose up -d panel-backend

# Check it's running
docker-compose ps

# Check logs
docker-compose logs -f panel-backend

# Test the API
curl -I http://localhost:5000

# Exit
exit
```

✅ Backend running on VPS

---

## Phase 4: GitHub Actions Workflow (Already Done!)

The file `.github/workflows/deploy.yml` is already created. It will:
- ✅ Watch for commits to main branch
- ✅ Connect to your VPS via SSH
- ✅ Pull latest code
- ✅ Build Docker image
- ✅ Restart service
- ✅ Show deployment status

---

## Phase 5: Test Auto-Deploy (5 minutes)

### Step 4: Make a Test Commit

```bash
# On your local machine
# Make a small change to backend code
echo "# Test deploy" >> panel-backend/README.md

# Commit and push
git add .
git commit -m "Test: trigger auto-deploy"
git push origin main
```

### Step 5: Watch the Deployment

1. Go to: **GitHub Repo → Actions**
2. See your workflow running (🟡 yellow = running)
3. Wait for it to complete (🟢 green = success)
4. Check the logs to see each step

---

## Phase 6: Error Monitoring (15 minutes)

### Step 6: Set Up Sentry

1. Go to https://sentry.io
2. Sign up (free)
3. Create new project: **Node.js**
4. Copy the **DSN** (looks like: `https://xxx@ooo.ingest.sentry.io/123456`)
5. In GitHub repo secrets, add:
   ```
   SENTRY_DSN = (paste your DSN here)
   ```

### Step 7: Update Backend Code

Edit `panel-backend/src/index.ts`:

```typescript
import * as Sentry from "@sentry/node";

// Add after imports
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});

// Add this BEFORE other middleware
app.use(Sentry.Handlers.requestHandler());

// Add this AFTER all routes
app.use(Sentry.Handlers.errorHandler());
```

Install Sentry:
```bash
npm install @sentry/node
```

### Step 8: Commit & Deploy

```bash
git add .
git commit -m "Add Sentry error monitoring"
git push origin main
```

Wait for auto-deploy to complete. Now errors go to Sentry! 📊

---

## Phase 7: Health Checks (10 minutes)

### Step 9: Add Health Endpoint

Edit `panel-backend/src/index.ts`:

```typescript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});
```

### Step 10: Set Up Monitoring Script

On your VPS:

```bash
# Create monitoring script
cat > ~/check-backend.sh << 'EOF'
#!/bin/bash

ENDPOINT="https://api.your-domain.com/health"
EMAIL="your-email@domain.com"

response=$(curl -s -o /dev/null -w "%{http_code}" $ENDPOINT)

if [ $response -ne 200 ]; then
  echo "Backend is down! Status: $response" | mail -s "🚨 Backend Alert" $EMAIL
  cd /opt/safestories && docker-compose restart panel-backend
fi
EOF

chmod +x ~/check-backend.sh

# Add to crontab (run every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/check-backend.sh") | crontab -
```

---

## ✅ You're Done!

### What You Now Have:

| Feature | Status |
|---------|--------|
| Auto-deploy on git push | ✅ GitHub Actions |
| Error tracking | ✅ Sentry |
| Health monitoring | ✅ Cron job |
| SSL/HTTPS | ✅ Traefik |
| Logs | ✅ Docker |
| Rollback ability | ✅ Git revert |

### How It Works Now:

```
You push code → GitHub Actions runs → VPS updates → Backend restarts
```

### If Something Goes Wrong:

**1. Check GitHub Actions logs:**
   - Go to Actions tab
   - See what failed

**2. Check VPS logs:**
   ```bash
   docker-compose logs panel-backend
   ```

**3. Check Sentry:**
   - Go to sentry.io dashboard
   - See what error occurred

**4. Rollback:**
   ```bash
   git revert <commit-hash>
   git push origin main
   # Auto-deploy reverts it!
   ```

---

## Real Examples

### Example 1: You Push Code

```bash
git push origin main
```

On GitHub:
- Actions tab shows: "Deploy Backend to VPS" 🟡 Running
- After 2 minutes: 🟢 Success
- On VPS: New code running

### Example 2: Code Has Error

User hits `/health` endpoint and crashes.

In Sentry dashboard:
- Red alert appears
- Full error stack trace shown
- You can replay the request
- You see what went wrong

### Example 3: You Need to Rollback

```bash
git revert <commit-hash>
git push origin main
```

GitHub Actions:
- Detects new commit
- Deploys old code
- Backend is fixed again

---

## Troubleshooting

**Q: Deploy fails with "Permission denied"**
A: SSH key has wrong permissions. On VPS:
```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/deploy_key
```

**Q: Backend doesn't start after deploy**
A: Check logs:
```bash
docker-compose logs panel-backend
```

**Q: Sentry not receiving errors**
A: Check DSN is in environment:
```bash
docker-compose exec panel-backend printenv | grep SENTRY
```

**Q: Health check not working**
A: Verify endpoint exists:
```bash
curl http://localhost:5000/health
```

---

## Next: Going Live

1. ✅ Complete all steps above
2. ✅ Test auto-deploy with 1-2 commits
3. ✅ Verify Sentry is receiving data
4. ✅ Verify health checks working
5. 🎉 Stop using Render
6. 🎉 Point frontend to: `https://api.your-domain.com`

Your backend is now on YOUR VPS with the same automation as Render! 🚀
