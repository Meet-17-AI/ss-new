# File Upload Implementation Complete

## Status: ✅ DONE

## What Was Implemented:

### 1. CompleteProfileModal.tsx
- ✅ Added profile picture upload to MinIO before form submission
- ✅ Added qualification PDF upload to MinIO before form submission
- ✅ Shows upload progress messages ("Uploading profile picture...", "Uploading qualification PDF...")
- ✅ Handles upload errors gracefully
- ✅ Only uploads if files are selected
- ✅ Stores actual MinIO URLs in database instead of "pending-upload"

### 2. EditProfile.tsx
- ✅ Already had complete upload functionality implemented
- ✅ Uploads profile picture to MinIO
- ✅ Uploads qualification PDF to MinIO
- ✅ Updates database with actual URLs

### 3. Backend (server/index.ts)
- ✅ `/api/upload-file` endpoint already implemented
- ✅ Uses MinIO client to upload files
- ✅ Supports two folders: `profile-pictures` and `qualification-pdfs`
- ✅ Returns public URL after successful upload

### 4. MinIO Configuration (lib/minio.ts)
- ✅ Properly configured with credentials from .env.local
- ✅ Endpoint: s3.srv1169280.hstgr.cloud:443
- ✅ Bucket: safestories-panel
- ✅ SSL enabled

## Upload Flow:

### Complete Profile (First Time):
1. Therapist fills form and selects files
2. On submit, profile picture uploads first (if selected)
3. Then qualification PDF uploads (if selected)
4. Form data + file URLs sent to `/api/complete-therapist-profile`
5. Data saved to `therapist_details` table with actual URLs
6. Webhook triggered to n8n with all data including file URLs

### Edit Profile (After Approval):
1. Therapist opens Edit Profile
2. Current files displayed (if any)
3. Can select new files to replace
4. On save, new files upload to MinIO
5. Profile updated with new URLs

## File URL Format:
```
https://s3.srv1169280.hstgr.cloud:443/safestories-panel/profile-pictures/1708689071234-filename.jpg
https://s3.srv1169280.hstgr.cloud:443/safestories-panel/qualification-pdfs/1708689071234-document.pdf
```

## Error Handling:
- ✅ File size validation (2MB for images, 5MB for PDFs)
- ✅ File type validation (JPG/PNG/WebP for images, PDF for documents)
- ✅ Upload failure shows error message
- ✅ Form submission stops if upload fails

## Testing:
To test, fill out the Complete Profile form with:
1. Profile picture (JPG/PNG/WebP, max 2MB)
2. Qualification PDF (PDF, max 5MB)
3. Submit form
4. Check database for actual MinIO URLs (not "pending-upload")
5. Check n8n webhook receives file URLs

## Database Fields Updated:
- `therapist_details.profile_picture_url` - Now stores actual MinIO URL
- `therapist_details.qualification_pdf_url` - Now stores actual MinIO URL
- `therapists.profile_picture_url` - Updated when profile approved
- `therapists.qualification_pdf_url` - Updated when profile approved

## Next Steps:
1. Test file upload with actual files
2. Verify files are accessible via URLs
3. Confirm webhook receives file URLs
4. Test Edit Profile file replacement
