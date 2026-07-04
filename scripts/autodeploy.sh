#!/bin/bash
# Autodeploy Script for Safestories VPS
# Run this script via cron every 1-2 minutes to pull changes and deploy them automatically.

cd /opt/safestories

# Fetch latest changes from GitHub
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u})

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "🔄 New changes detected on GitHub! Starting autodeploy..."
    
    # Save the current commit in case of rollback
    PREVIOUS_COMMIT=$LOCAL
    
    # Reset local repository to match origin/main
    git reset --hard origin/main
    
    # Set VPS Hostname
    export DOMAIN_NAME=$(hostname -f)
    
    echo "🐳 Building Docker image..."
    if ! docker compose build panel-backend; then
      echo "❌ Build failed! Rolling back to commit $PREVIOUS_COMMIT..."
      git reset --hard $PREVIOUS_COMMIT
      exit 1
    fi

    echo "🚀 Starting backend service and waiting for healthcheck..."
    if ! docker compose up -d --wait panel-backend; then
      echo "❌ Deployment failed health check! Rolling back to commit $PREVIOUS_COMMIT..."
      docker compose logs --tail 50 panel-backend
      git reset --hard $PREVIOUS_COMMIT
      docker compose build panel-backend
      docker compose up -d panel-backend
      exit 1
    fi

    echo "✅ Autodeploy successful! Backend is healthy and running."
fi
