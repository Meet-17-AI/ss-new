import * as Minio from 'minio';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Bypass SSL validation since the MinIO server cert is expired or self-signed
if (process.env.MINIO_USE_SSL === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Validate required MinIO configuration
const requiredMinioVars = ['MINIO_ENDPOINT', 'MINIO_PORT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'];
const missingMinioVars = requiredMinioVars.filter(v => !process.env[v]);
if (missingMinioVars.length > 0) {
  console.error('⚠️  Missing MinIO configuration variables:', missingMinioVars);
  console.error('File upload functionality will be disabled');
}

export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
  region: 'us-east-1',
  pathStyle: true,
});

export const bucketName = process.env.MINIO_BUCKET_NAME || 'safestories-panel';

/**
 * Upload a file to MinIO
 * @param file - File buffer
 * @param fileName - Name of the file
 * @param folder - Folder path (e.g., 'profile-pictures', 'qualification-pdfs', or 'issue-screenshots')
 * @param contentType - MIME type of the file
 * @returns Public URL of the uploaded file
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  folder: 'profile-pictures' | 'qualification-pdfs' | 'issue-screenshots',
  contentType: string
): Promise<string> {
  try {
    const objectName = `${folder}/${fileName}`;
    
    console.log('🔄 MinIO upload starting:', {
      bucket: bucketName,
      objectName,
      size: file.length,
      contentType
    });
    
    await minioClient.putObject(
      bucketName,
      objectName,
      file,
      file.length,
      {
        'Content-Type': contentType
      }
    );

    // Generate public URL
    const url = `https://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${bucketName}/${objectName}`;
    
    console.log('✅ MinIO upload complete:', url);
    return url;
  } catch (error: any) {
    console.error('❌ MinIO upload error:', error);
    const msg = error?.message || error?.code || error?.Code || String(error) || 'Unknown error';
    throw new Error(`MinIO upload failed: ${msg}`);
  }
}

/**
 * Delete a file from MinIO
 * @param fileUrl - Full URL of the file to delete
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  try {
    // Extract object name from URL
    const urlParts = fileUrl.split(`/${bucketName}/`);
    if (urlParts.length < 2) {
      throw new Error('Invalid file URL');
    }

    let objectName = urlParts[1];

    // Security: Prevent path traversal attacks
    if (objectName.includes('..') || objectName.startsWith('/')) {
      throw new Error('Invalid object name - path traversal not allowed');
    }

    // Normalize path to prevent bypasses
    objectName = objectName.replace(/\\/g, '/'); // Convert backslashes to forward slashes

    await minioClient.removeObject(bucketName, objectName);
  } catch (error) {
    console.error('Error deleting file from MinIO:', error);
    throw new Error('Failed to delete file');
  }
}

/**
 * Get a presigned URL for temporary access to a file
 * @param objectName - Object name in the bucket
 * @param expirySeconds - Expiry time in seconds (default: 24 hours)
 * @returns Presigned URL
 */
export async function getPresignedUrl(
  objectName: string,
  expirySeconds: number = 86400
): Promise<string> {
  try {
    const url = await minioClient.presignedGetObject(
      bucketName,
      objectName,
      expirySeconds
    );
    return url;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw new Error('Failed to generate presigned URL');
  }
}
