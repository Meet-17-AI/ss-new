# Installation & Setup Guide

## Prerequisites
- Node.js (v16 or higher)
- PostgreSQL database access

## Installation Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   
   The `.env.local` file is already configured with:
   ```
   PGHOST=<DB-HOST>
   PGPORT=5432
   PGDATABASE=safestories_db
   PGUSER=fluidadmin
   PGPASSWORD=<REDACTED-SEE-.env.example>
   ```

3. **Run the Application**
   ```bash
   npm run dev
   ```
   
   This will start:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3002

## What Was Fixed

All critical bugs have been fixed:
- ✅ SQL injection vulnerabilities
- ✅ Missing API endpoints
- ✅ Hardcoded URLs
- ✅ Environment variable loading
- ✅ Error handling

See `BUGS_FIXED.md` for detailed information.

## Troubleshooting

### Port Already in Use
If port 3002 is already in use:
```bash
# Find and kill the process
lsof -ti:3002 | xargs kill -9
```

### Database Connection Issues
- Verify `.env.local` credentials
- Check database server is accessible
- Ensure PostgreSQL is running

### Module Not Found
```bash
rm -rf node_modules package-lock.json
npm install
```

## Default Login Credentials

Check your database `users` table for valid credentials.

## Project Structure

```
├── api/                    # API route handlers (Vercel)
├── components/            # React components
├── lib/                   # Database configuration
├── server/                # Express server
├── scripts/               # Database scripts
├── .env.local            # Environment variables
├── package.json          # Dependencies
└── vite.config.ts        # Vite configuration
```

## Support

For issues, check:
1. Console logs in browser (F12)
2. Server logs in terminal
3. Database connectivity
