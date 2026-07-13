import * as Minio from 'minio';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 's3.srv1169280.hstgr.cloud',
  port: parseInt(process.env.MINIO_PORT || '443'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'Fluid@bucket2026',
});

const bucketName = process.env.MINIO_BUCKET_NAME || 'safestories-panel';

async function setupPublicAccess() {
  try {
    console.log('🔧 Setting up public access for MinIO bucket...\n');

    // Set bucket policy to allow public read access
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        }
      ]
    };

    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    console.log('✅ Public read access enabled for bucket:', bucketName);
    console.log('\n📋 Policy applied:');
    console.log('   - Anyone can read/view files');
    console.log('   - Only authenticated users can upload');
    console.log('\n🎉 Setup complete!');

  } catch (error: any) {
    console.error('❌ Error setting up public access:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run setup
setupPublicAccess();
