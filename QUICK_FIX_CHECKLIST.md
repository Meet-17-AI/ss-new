# ⚡ Quick Fix Checklist - Security Fixes

## 🚨 CRITICAL PATH (Do These First)

### ✅ Phase 1: Password Hashing
- [ ] Run migration script: `node panel-backend/scripts/hash-existing-passwords.js`
- [ ] Update `/api/login` to use bcrypt.compare()
- [ ] Update `/api/change-password` to hash before storing
- [ ] Update `/api/forgot-password/reset` to hash
- [ ] Update `/api/complete-therapist-profile` to hash
- [ ] Test login with bcrypt hashes

### ✅ Phase 2: SQL Injection Fix
- [ ] Fix lead stage update endpoint (Line 1405-1410)
- [ ] Use only parameterized queries
- [ ] Test with SQL injection payloads
- [ ] Code review by security-aware dev

### ✅ Phase 3: Authentication on Admin Endpoints
- [ ] Add `@authMiddleware` to 12 admin endpoints
- [ ] Add `requireRole(['admin'])` check
- [ ] Test unauthorized access returns 401
- [ ] Test admin access still works

### ✅ Phase 4: Payment Endpoint Auth
- [ ] Add authentication to `/api/cron/verify-pending-payments` ⚠️ CRITICAL
- [ ] Add rate limiting (max 5 req/min per IP)
- [ ] Add request signature validation
- [ ] Test payment operations

### ✅ Phase 5: Data Endpoint Auth
- [ ] Add auth to all `/api/client-*` endpoints
- [ ] Add auth to all `/api/case-history` endpoints
- [ ] Add auth to all `/api/session-notes` endpoints
- [ ] Verify user owns the data before returning

---

## 📋 Secondary Fixes (Complete This Sprint)

### ✅ Phase 6: Password Policy
- [ ] Update validation to require 12+ chars
- [ ] Add uppercase letter requirement
- [ ] Add number requirement
- [ ] Add special character requirement
- [ ] Apply to all password endpoints

### ✅ Phase 7: Remove Hardcoded Credentials
- [ ] Remove from `panel-backend/src/index.ts:122-124`
- [ ] Remove from `crm-backend/src/index.ts`
- [ ] Use only environment variables
- [ ] Validate env vars on startup

### ✅ Phase 8: Remove Test Files
- [ ] Delete `panel-backend/test_db.js`
- [ ] Delete `panel-backend/test_dups.js`
- [ ] Delete `panel-backend/test_empty.js`
- [ ] Delete `panel-backend/test_undefined.js`
- [ ] Delete `panel-backend/patch_verify.cjs`

### ✅ Phase 9: Security Headers
- [ ] Install `helmet` package: `npm install helmet`
- [ ] Add `app.use(helmet())` to index.ts
- [ ] Set X-Content-Type-Options
- [ ] Set X-Frame-Options
- [ ] Set Content-Security-Policy

### ✅ Phase 10: Input Validation
- [ ] Add email format validation
- [ ] Add phone number validation
- [ ] Add max length checks
- [ ] Add amount validation (min/max)
- [ ] Sanitize all user inputs

---

## 🎯 Testing Checklist

Before deploying any changes:

- [ ] Test login with old plaintext password (should fail)
- [ ] Test login with bcrypt hashed password (should succeed)
- [ ] Test SQL injection payload in lead endpoint (should fail)
- [ ] Test accessing admin endpoint without token (should return 401)
- [ ] Test accessing admin endpoint with user token (should return 403)
- [ ] Test accessing case history of another user (should return 403)
- [ ] Test payment verification without signature (should fail)
- [ ] Test weak password (should be rejected)
- [ ] Test strong password (should be accepted)
- [ ] Test with missing environment variables (should fail at startup)

---

## 📊 Code Changes Summary

| File | Changes | Status |
|------|---------|--------|
| `panel-backend/src/index.ts` | Add bcrypt, JWT, auth middleware, fix SQL injection | ⏳ In Progress |
| `panel-backend/src/lib/db.ts` | Require env vars, validate at startup | ✅ Done |
| `panel-backend/src/lib/minio.ts` | Remove credentials, fix path traversal | ✅ Done |
| `panel-backend/.env.local` | Add all env vars | ✅ Done |
| `panel-backend/src/lib/email.ts` | Remove hardcoded fallback | ⏳ TODO |
| `crm-backend/src/index.ts` | Same as panel-backend | ⏳ TODO |
| `package.json` | Verify bcrypt, jsonwebtoken, helmet included | ⏳ TODO |

---

## 🔑 Key Environment Variables Required

```bash
# Security
JWT_SECRET=your-long-random-secret-key-here
BCRYPT_ROUNDS=10

# Database
PGHOST=your-db-host
PGPORT=5432
PGDATABASE=your-db-name
PGUSER=your-db-user
PGPASSWORD=your-db-password

# CORS
ALLOWED_ORIGINS=http://localhost:5174,http://localhost:3004,https://safestories-panel.vercel.app

# Services
RESEND_API_KEY=your-resend-key
AISENSY_JWT_TOKEN=your-aisensy-token
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_REDIRECT_URI=your-redirect-uri

# MinIO
MINIO_ENDPOINT=your-minio-endpoint
MINIO_PORT=443
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_USE_SSL=true
```

---

## 📞 Implementation Notes

### For Phase 1 (Password Hashing):
1. Create migration script
2. Backup database FIRST
3. Run migration: `node panel-backend/scripts/hash-existing-passwords.js`
4. Verify passwords are hashed (start with `$2b$`)
5. Update code to use bcrypt
6. Test login

### For Phase 2 (SQL Injection):
1. Identify dynamic query construction
2. Replace with parameterized queries
3. Test with SQL injection payloads
4. Code review by someone else

### For Phase 3 (Authentication):
1. Ensure JWT middleware is working
2. Add `@authMiddleware` to endpoint
3. Test without token: expect 401
4. Test with valid token: expect success
5. Test with invalid token: expect 401

### For Phase 4 (Payment Auth):
1. This is financial - extra careful
2. Add signature validation
3. Add rate limiting
4. Test extensively
5. Monitor in production closely

---

## 🚀 Deployment Checklist

### Before Deploying:
- [ ] All critical fixes complete
- [ ] All tests passing
- [ ] No console errors
- [ ] Database backup created
- [ ] Rollback plan documented
- [ ] Team notified of changes
- [ ] Load testing completed

### During Deployment:
- [ ] Deploy to staging first
- [ ] Smoke test all major flows
- [ ] Test admin panel access
- [ ] Test payment endpoint
- [ ] Monitor error logs

### After Deployment:
- [ ] Monitor error rates
- [ ] Watch for authentication failures
- [ ] Check payment success rates
- [ ] Verify email sending works
- [ ] Check audit logs

---

## 🆘 Rollback Plan

If critical issues occur:
```bash
# 1. Revert last commit
git revert HEAD

# 2. Redeploy previous version
npm run build && npm run deploy

# 3. Restore database from backup if needed
# Contact DevOps for database restoration

# 4. Notify users of temporary disruption
```

---

## 📞 Help & Resources

**Documentation:**
- See `SECURITY_FIXES_GUIDE.md` for detailed implementation steps
- See `VULNERABILITY_REFERENCE.md` for technical details of each issue

**Packages Needed:**
```bash
npm install bcrypt jsonwebtoken helmet express-rate-limit joi
```

**Commands:**
```bash
# Hash existing passwords
node panel-backend/scripts/hash-existing-passwords.js

# Test with specific password
npm test -- --grep "password hashing"

# Lint security issues
npm run security-audit
```

---

## ✨ Success Criteria

When all fixes are complete, you should be able to:
- ✅ Login with bcrypt hashed passwords
- ✅ Access admin endpoints only as admin
- ✅ Access user data only as authorized user
- ✅ Create payments only with authentication
- ✅ See no plaintext passwords in database
- ✅ See no hardcoded credentials in code
- ✅ Pass security headers check
- ✅ Reject weak passwords
- ✅ No SQL injection in lead endpoints

---

**Last Updated:** 2026-06-08  
**Status:** Ready for implementation  
**Estimated Time:** 2-3 weeks for critical phase
