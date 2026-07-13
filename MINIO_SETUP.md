# MinIO Setup Guide

## Overview
This project uses MinIO (S3-compatible object storage) for storing therapist profile pictures and qualification PDFs.

## Configuration

### Environment Variables
The following variables are configured in `.env.local`:

```env
MINIO_ENDPOINT=s3.srv1169280.hstgr.cloud
$1443
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=Fluid@bucket2026
MINIO_USE_SSL=true
MINIO_BUCKET_NAME=safestories-panel
```

### Bucket Structure
```
safestories-panel/
├── profile-pictures/     # Therapist profile pictures
└── qualification-pdfs/   # Therapist qualification certificates
```

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

This will install the `minio` package along with other dependencies.

### 2. Run Setup Script
```bash
npm run setup:minio
```

This script will:
- Connect to the MinIO server
- Create the `safestories-panel` bucket (if it doesn't exist)
- Create the folder structure for profile pictures and qualification PDFs

### 3. Verify Setup
After running the setup script, you should see:
```
🎉 MinIO setup completed successfully!

📋 Bucket Structure:
   safestories-panel/
   ├── profile-pictures/
   └── qualification-pdfs/

🔗 Access URLs:
   Console: https://console.fluidjobs.ai:9003
   API Endpoint: https://s3.srv1169280.hstgr.cloud:443
```

## Manual Verification

You can manually verify the setup by logging into the MinIO console:

1. Go to: https://console.fluidjobs.ai:9003/login
2. Login with:
   - User: `admin`
   - Password: `Fluid@bucket2026`
3. Navigate to the `safestories-panel` bucket
4. Verify the two folders exist

## Usage in Code

### Upload a File
```typescript
import { uploadFile } from './lib/minio';

const fileBuffer = Buffer.from(fileData);
const fileName = `therapist-${Date.now()}.jpg`;
const url = await uploadFile(
  fileBuffer,
  fileName,
  'profile-pictures',
  'image/jpeg'
);
```

### Delete a File
```typescript
import { deleteFile } from './lib/minio';

await deleteFile('https://s3.srv1169280.hstgr.cloud:443/safestories-panel/profile-pictures/therapist-123.jpg');
```

### Get Presigned URL (Temporary Access)
```typescript
import { getPresignedUrl } from './lib/minio';

const url = await getPresignedUrl('profile-pictures/therapist-123.jpg', 3600); // 1 hour expiry
```

## File Upload Endpoints

The following API endpoints handle file uploads:

- `PUT /api/therapist-profile` - Updates therapist profile (includes file uploads)
- `POST /api/complete-therapist-profile` - Initial profile completion (includes file uploads)

## Security Notes

- All credentials are stored in `.env.local` (not committed to git)
- SSL/TLS is enabled for secure connections
- Files are stored in a private bucket (access controlled)
- Presigned URLs can be generated for temporary access

## Troubleshooting

### Connection Issues
If you get connection errors:
1. Verify the MinIO server is running
2. Check firewall rules allow access to port 443
3. Verify SSL certificate is valid

### Permission Issues
If you get permission errors:
1. Verify the access key and secret key are correct
2. Check the user has permissions to create buckets and upload objects

### Bucket Already Exists
If the bucket already exists, the script will skip creation and just create the folders.

## Support

For issues or questions, contact the development team.
