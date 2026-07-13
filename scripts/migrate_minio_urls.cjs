const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  console.log('Starting MinIO URL database migration...');
  try {
    // Update users profile pictures
    let res = await pool.query(`
      UPDATE users 
      SET profile_picture_url = REPLACE(profile_picture_url, 's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443') 
      WHERE profile_picture_url LIKE '%s3.fluidjobs.ai:9002%'
    `);
    console.log(`Updated ${res.rowCount} rows in users.profile_picture_url`);

    // Update therapists profile pictures
    res = await pool.query(`
      UPDATE therapists 
      SET profile_picture_url = REPLACE(profile_picture_url, 's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443') 
      WHERE profile_picture_url LIKE '%s3.fluidjobs.ai:9002%'
    `);
    console.log(`Updated ${res.rowCount} rows in therapists.profile_picture_url`);

    // Update therapist_details profile pictures
    res = await pool.query(`
      UPDATE therapist_details 
      SET profile_picture_url = REPLACE(profile_picture_url, 's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443') 
      WHERE profile_picture_url LIKE '%s3.fluidjobs.ai:9002%'
    `);
    console.log(`Updated ${res.rowCount} rows in therapist_details.profile_picture_url`);

    // Update therapists qualification PDFs
    res = await pool.query(`
      UPDATE therapists 
      SET qualification_pdf_url = REPLACE(qualification_pdf_url, 's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443') 
      WHERE qualification_pdf_url LIKE '%s3.fluidjobs.ai:9002%'
    `);
    console.log(`Updated ${res.rowCount} rows in therapists.qualification_pdf_url`);

    // Update therapist_details qualification PDFs
    res = await pool.query(`
      UPDATE therapist_details 
      SET qualification_pdf_url = REPLACE(qualification_pdf_url, 's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443') 
      WHERE qualification_pdf_url LIKE '%s3.fluidjobs.ai:9002%'
    `);
    console.log(`Updated ${res.rowCount} rows in therapist_details.qualification_pdf_url`);

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    pool.end();
  }
}

run();
