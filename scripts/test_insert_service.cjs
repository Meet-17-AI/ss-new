const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const title = 'Free Consultation';
    const duration = '50 Mins';
    const type = 'Online';
    const therapy_type = 'Free Consultation';
    const description = 'test';
    const charges = '0';
    const slugBase = '/free-consultation-safestories-test1';
    const therapist_id = 'SafeStories';
    const therapist_name = 'Safestories';
    const payment_gateway = 'Razorpay';
    const schedule_id = null;
    const form_questions = [];
    const requires_tnc = true;
    const is_payment_enabled = true;

    const result = await pool.query(`
      INSERT INTO therapy_services (
        title, duration, type, therapy_type, description, charges, slug, therapist_id, therapist_name,
        payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, true)
      RETURNING *
    `, [
      title,
      duration,
      type,
      therapy_type,
      description,
      charges,
      slugBase,
      therapist_id,
      therapist_name,
      payment_gateway,
      schedule_id,
      JSON.stringify(form_questions),
      requires_tnc,
      is_payment_enabled
    ]);
    console.log('Success:', result.rows[0]);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
