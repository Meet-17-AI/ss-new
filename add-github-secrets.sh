#!/bin/bash

# GitHub Secrets Auto-Setup Script
# Run this locally: bash add-github-secrets.sh

echo "🔐 Adding GitHub Secrets..."

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI not found!"
    echo "Install from: https://cli.github.com/"
    exit 1
fi

# Check if logged in
if ! gh auth status &> /dev/null; then
    echo "📝 Please login to GitHub..."
    gh auth login
fi

# Add all 19 secrets
echo "Adding secrets..."

gh secret set VPS_HOST --body "srv1169280.hstgr.cloud"
gh secret set VPS_USER --body "deploy"
gh secret set VPS_PORT --body "22"
gh secret set VPS_SSH_KEY --body "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDIC9Az5pQ8F5XtO4CoQsvHFm8oaitCVolkRaGn4uRmpQAAAJjIxo4oyMaO
KAAAAAtzc2gtZWQyNTUxOQAAACDIC9Az5pQ8F5XtO4CoQsvHFm8oaitCVolkRaGn4uRmpQ
AAAEA6Ahs9FbkYAHeP0LG7CqYyVL8n92LnqqvF4A5xSXcELMgL0DPmlDwXle07gKhCy8cW
byhqK0JWiWRFoafi5GalAAAAEWRlcGxveUBzcnYxMTY5MjgwAQIDBA==
-----END OPENSSH PRIVATE KEY-----"

gh secret set PGHOST --body "72.60.103.151"
gh secret set PGPORT --body "5432"
gh secret set PGDATABASE --body "safestories_db_v2"
gh secret set PGUSER --body "fluidadmin"
gh secret set PGPASSWORD --body "admin123"
gh secret set JWT_SECRET --body "416eaa4693222d766c3075d39c632a30dba33692edd7a967fed21344592be70c"
gh secret set RAZORPAY_KEY_ID --body "rzp_live_SaBaiUb2drX26Q"
gh secret set RAZORPAY_KEY_SECRET --body "Pce9pDS10yAq6aOEUbeYOT9f"
gh secret set MINIO_ENDPOINT --body "s3.srv1169280.hstgr.cloud"
gh secret set MINIO_PORT --body "443"
gh secret set MINIO_ACCESS_KEY --body "admin"
gh secret set MINIO_SECRET_KEY --body "Fluidbucket@2026"
gh secret set FRONTEND_URL --body "https://panel.safestories.in"
gh secret set ALLOWED_ORIGINS --body "https://panel.safestories.in,http://localhost:5174,http://localhost:3004"
gh secret set SSL_EMAIL --body "meetpandya@fluid.live"

echo "✅ All secrets added!"
echo ""
echo "📋 Verifying secrets..."
gh secret list
