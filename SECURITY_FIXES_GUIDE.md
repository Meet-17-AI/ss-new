# 🔐 SafeStories Security Fixes Implementation Guide

**Status:** Partially Started | **Priority:** CRITICAL

---

## ✅ COMPLETED FIXES

1. **Removed N8N Webhook Interception** - `panel-backend/src/index.ts:5-17`
   - ✅ Restored real webhook functionality

2. **Updated CORS Configuration** - `panel-backend/src/index.ts:69-75`
   - ✅ Changed from `cors()` to restricted origins list
   - ✅ Added allowed headers and credentials

3. **Added Authentication Middleware** - `panel-backend/src/index.ts:77-110`
   - ✅ JWT token validation middleware
   - ✅ Role-based authorization middleware

4. **Updated Environment Variables** - `panel-backend/.env.local`
   - ✅ Added JWT_SECRET, BCRYPT_ROUNDS, ALLOWED_ORIGINS
   - ✅ Added service configuration variables

5. **Database Configuration Hardening** - `panel-backend/src/lib/db.ts`
   - ✅ Removed hardcoded credentials fallbacks
   - ✅ Added environment variable validation
   - ✅ Exit on missing credentials

6. **MinIO Security** - `panel-backend/src/lib/minio.ts`
   - ✅ Removed hardcoded credentials  
   - ✅ Added path traversal prevention in deleteFile()
   - ✅ Added environment variable validation

7. **Login Endpoint Refactored** - `panel-backend/src/index.ts:451-500`
   - ✅ Changed to bcrypt password verification
   - ✅ Removed origin-based access control
   - ✅ Added JWT token generation
   - ⏳ Needs: Password validation in database (must hash existing passwords first)

---

## 🔴 REMAINING CRITICAL FIXES NEEDED

### **PHASE 1: Password Hashing (CRITICAL)**

**Task:** Implement bcrypt password hashing across all password operations

**Files to Update:**
1. `panel-backend/src/index.ts` - Lines:
   - `575-593` - `/api/verify-password` endpoint
   - `596-623` - `/api/change-password` endpoint  
   - `2113-2145` - `/api/update-password` endpoint
   - `701-900` - `/api/complete-therapist-profile` endpoint (password storage)
   - `826+` - Therapist creation (password storage)
   - `2291-2328` - `/api/forgot-password/reset` endpoint

**Action Items:**
```typescript
// BEFORE (plaintext):
const result = await pool.query(
  'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
  [username, password]
);

// AFTER (hashed):
const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
const result = await pool.query(
  'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
  [hashedPassword, userId]
);
```

**Database Migration Needed:**
- Must hash all existing passwords before deployment
- Run migration script: `node scripts/hash-existing-passwords.js`

---

### **PHASE 2: SQL Injection Fix (CRITICAL)**

**Location:** `panel-backend/src/index.ts:1405-1410`

**Vulnerable Code:**
```typescript
const therapistUpdate = therapistIdToSet ? `, therapist_id = ${therapistIdToSet}` : '';
const query = `UPDATE leads SET ... ${therapistUpdate}...`;
```

**Fix:**
```typescript
// Use parameterized query instead
let query = `UPDATE leads SET ... WHERE id = $1`;
const params = [remarkValue, leadId];
if (therapistIdToSet) {
  query = query.replace('WHERE', 'therapist_id = $' + (params.length + 1) + ' WHERE');
  params.splice(params.length - 1, 0, therapistIdToSet);
}
await pool.query(query, params);
```

---

### **PHASE 3: Add Authentication to All Admin Endpoints (HIGH)**

**Endpoints needing `@authMiddleware` + `requireRole(['admin'])`:**

1. `POST /api/admin/therapists-calendars` - Line 378
2. `POST /api/admin/generate-payment-link` - Line 7855
3. `POST /api/audit-logs/clear` - Line 4705
4. `POST /api/crm-audit-logs` - Line 4731
5. `DELETE /api/therapists/:id` - Line 1536
6. `PATCH /api/therapists/:id/deactivate` - Line 1551
7. `DELETE /api/therapy-calendars/:id` - Line 8051
8. `PATCH /api/therapy-calendars/:id/deactivate` - Line 8066

**Implementation Pattern:**
```typescript
// Before:
app.post('/api/admin/endpoint', async (req, res) => { ... });

// After:
app.post('/api/admin/endpoint', authMiddleware, requireRole(['admin']), async (req, res) => { ... });
```

---

### **PHASE 4: Add Authentication to Payment Endpoints (HIGH)**

**Endpoints needing signature validation + rate limiting:**

1. `POST /api/razorpay/create-order` - Line 5860
2. `POST /api/razorpay/verify-payment` - Line 6089  
3. `POST /api/mark-payment-failed` - Line 5900
4. `POST /api/cron/verify-pending-payments` - Line 6129 (**MUST ADD AUTH**)
5. `POST /api/confirm-payment` - Line 7964

**Action:**
- Add authentication header requirement
- Add request signing validation
- Implement rate limiting (max 5 requests/minute per IP)

---

### **PHASE 5: Fix Unprotected Data Endpoints (HIGH)**

**Endpoints needing authentication:**

```
GET    /api/public/booking/:booking_id         - Line 3381
GET    /api/case-history                       - Line 7182
GET    /api/session-notes                      - Line 4841
POST   /api/session-notes                      - Line 4999
GET    /api/progress-notes                     - Line 7242
GET    /api/client-details                     - Line 3863
POST   /api/transfer-client                    - Line 4553
GET    /api/therapist-details                  - Line 3756
GET    /api/therapist-profile                  - Line 963
```

**Fix Pattern:**
```typescript
// Add authentication check
app.get('/api/case-history', authMiddleware, async (req, res) => {
  // Verify user owns this data
  if (req.query.clientId && req.user.role !== 'therapist') {
    return res.status(403).json({ error: 'Access denied' });
  }
  // ... rest of endpoint
});
```

---

### **PHASE 6: Password Policy Enforcement (MEDIUM)**

**Update all password validation to require:**
- Minimum 12 characters (was 6)
- At least 1 uppercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*)

**Files to Update:**
- `panel-backend/src/index.ts:605-606` (change-password)
- `panel-backend/src/index.ts:2299` (forgot-password reset)
- All new password creation endpoints

**Code:**
```typescript
function validatePassword(password) {
  if (password.length < 12) return 'At least 12 characters required';
  if (!/[A-Z]/.test(password)) return 'Must contain uppercase letter';
  if (!/[0-9]/.test(password)) return 'Must contain number';
  if (!/[!@#$%^&*]/.test(password)) return 'Must contain special character';
  return null; // Valid
}
```

---

### **PHASE 7: Remove Hardcoded Google OAuth Credentials (CRITICAL)**

**Currently in:** `panel-backend/src/index.ts:122-124`

**Files Needing Updates:**
- `panel-backend/src/index.ts:122-124`
- `crm-backend/src/index.ts` (same issue)
- `panel-backend/.env.local` (already done)

**Action:**
Replace hardcoded values with environment variable usage:
```typescript
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
```

---

### **PHASE 8: Remove Test Files with Credentials (LOW)**

**Files to Delete:**
- `panel-backend/test_db.js` - Contains hardcoded credentials
- `panel-backend/test_dups.js` - Contains hardcoded credentials
- `panel-backend/test_empty.js` - Contains hardcoded credentials
- `panel-backend/test_undefined.js` - Contains hardcoded credentials
- `panel-backend/patch_verify.cjs`

---

### **PHASE 9: Fix N8N Webhook Verification** (MEDIUM)

**Status:** Currently blocked globally

**Files:** `panel-backend/src/index.ts` (lines 5-17 already removed)

**Next Steps:**
- Add N8N webhook signature verification
- Update webhook endpoints to check signatures
- Configure allowed webhook origins

```typescript
// Add N8N signature verification
app.post('/api/webhooks/n8n', async (req, res) => {
  const signature = req.headers['x-n8n-signature'];
  const secret = process.env.N8N_WEBHOOK_SECRET;
  
  // Verify signature before processing
  // ...
});
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Before Deployment:

- [ ] Phase 1: Hash all existing passwords in database
- [ ] Phase 2: Fix SQL injection in lead endpoints
- [ ] Phase 3: Add auth to admin endpoints
- [ ] Phase 4: Add rate limiting to payment endpoints
- [ ] Phase 5: Add auth to data endpoints
- [ ] Phase 6: Enforce password policy
- [ ] Phase 7: Remove hardcoded Google credentials
- [ ] Phase 8: Delete test files
- [ ] Phase 9: Setup N8N webhook verification
- [ ] Comprehensive testing of all endpoints
- [ ] Security audit of CRM backend (same issues likely exist)
- [ ] Load testing with new authentication overhead
- [ ] Update client apps to include JWT token in headers

### Deployment Steps:

1. **Create backup of production database**
2. **Run password hashing migration**
3. **Deploy new code with auth middleware**
4. **Update frontend to store/use JWT tokens**
5. **Monitor for authentication failures**
6. **Gradually roll out auth enforcement** (start with logging-only mode)

---

## ⚠️ ADDITIONAL SECURITY RECOMMENDATIONS

### Immediate (This Sprint):
1. Enable HTTPS everywhere (already done on Vercel)
2. Add rate limiting middleware (npm: `express-rate-limit`)
3. Add request validation with `joi` or `zod`
4. Add security headers with `helmet`
5. Enable database query logging for audit trails

### Short-term (Next Sprint):
1. Implement 2FA for admin accounts
2. Add comprehensive input sanitization
3. Setup weekly security scanning (npm audit)
4. Implement request signing for sensitive operations
5. Add intrusion detection logging

### Long-term:
1. Security code review quarterly
2. Penetration testing annually
3. Implement OAuth2/OIDC for user management
4. Move to managed database with encryption at rest
5. Implement API versioning with deprecation policy

---

## 🛠️ Database Migration Script

**Create:** `panel-backend/scripts/hash-existing-passwords.js`

```javascript
const bcrypt = require('bcrypt');
const pool = require('../src/lib/db');

async function hashExistingPasswords() {
  console.log('Starting password hashing migration...');
  
  try {
    const users = await pool.query('SELECT id, password FROM users WHERE password IS NOT NULL');
    
    for (const user of users.rows) {
      // Skip if already hashed (starts with $2b$)
      if (user.password.startsWith('$2b$')) {
        console.log(`✅ User ${user.id} already hashed`);
        continue;
      }
      
      // Hash the plaintext password
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
      console.log(`✅ Hashed password for user ${user.id}`);
    }
    
    console.log('✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

hashExistingPasswords();
```

**Run before deployment:**
```bash
node panel-backend/scripts/hash-existing-passwords.js
```

---

## 📞 Questions?

For implementation guidance on any phase, refer to the specific file and line numbers listed above.

**Priority Order:**
1. Password hashing (affects all users)
2. SQL injection fix (RCE risk)
3. Admin endpoint auth (data exposure)
4. Remove test files (credential leak)
5. Payment endpoint auth (financial risk)
6. Other data endpoints (privacy)

---

**Last Updated:** 2026-06-08
**Status:** Implementation Guide Created
**Next Step:** Begin Phase 1 (Password Hashing)
