import * as Minio from 'minio';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 's3.fluidjobs.ai',
  port: parseInt(process.env.MINIO_PORT || '9002'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'Fluid@bucket2026',
});

const bucketName = process.env.MINIO_BUCKET_NAME || 'safestories-panel';

async function setupMinIO() {
  try {
    console.log('🔧 Setting up MinIO bucket structure...\n');

    // Check if bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    
    if (!bucketExists) {
      console.log(`📦 Creating bucket: ${bucketName}`);
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`✅ Bucket created: ${bucketName}\n`);
    } else {
      console.log(`✅ Bucket already exists: ${bucketName}\n`);
    }

    // Create folder structure by uploading empty objects with trailing slashes
    const folders = [
      'profile-pictures/',
      'qualification-pdfs/'
    ];

    console.log('📁 Creating folder structure...');
    
    for (const folder of folders) {
      try {
        // Check if folder marker exists
        const stream = await minioClient.getObject(bucketName, folder);
        stream.destroy();
        console.log(`✅ Folder already exists: ${folder}`);
      } catch (error: any) {
        if (error.code === 'NoSuchKey') {
          // Folder doesn't exist, create it
          await minioClient.putObject(
            bucketName,
            folder,
            Buffer.from(''),
            0,
            {
              'Content-Type': 'application/x-directory'
            }
          );
          console.log(`✅ Created folder: ${folder}`);
        } else {
          console.error(`❌ Error checking folder ${folder}:`, error.message);
        }
      }
    }

    console.log('\n🎉 MinIO setup completed successfully!');
    console.log('\n📋 Bucket Structure:');
    console.log(`   ${bucketName}/`);
    console.log(`   ├── profile-pictures/`);
    console.log(`   └── qualification-pdfs/`);
    console.log('\n🔗 Access URLs:');
    console.log(`   Console: https://console.fluidjobs.ai:9003`);
    console.log(`   API Endpoint: https://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`);

  } catch (error: any) {
    console.error('❌ Error setting up MinIO:', error.message);
    console.error('Full error:', error);
    console.error('Error keys:', Object.keys(error));
    console.error('Error stringified:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    process.exit(1);
  }
}

// Run setup
setupMinIO();
