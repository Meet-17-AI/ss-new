import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT p.booking_id, p.client_id as pc_client_id, p.session_date, p.session_duration, b.invitee_phone, b.invitee_email
      FROM client_progress_notes p
      LEFT JOIN bookings b ON p.booking_id = b.booking_id::text
      ORDER BY p.updated_at DESC
      LIMIT 5
    `);
    console.log('Recent Progress Notes:', res.rows);

    const cRes = await pool.query(`
      SELECT p.booking_id, b.invitee_phone, b.invitee_email
      FROM pretherapy_call_forms p
      LEFT JOIN bookings b ON p.booking_id = b.booking_id::text
      ORDER BY p.booking_id DESC
      LIMIT 5
    `);
    console.log('Recent Pretherapy forms:', cRes.rows);

    const sRes = await pool.query(`
      SELECT p.booking_id, p.therapist_id, b.invitee_phone, b.invitee_email
      FROM client_session_notes p
      LEFT JOIN bookings b ON p.booking_id::text = b.booking_id::text
      ORDER BY p.updated_at DESC
      LIMIT 5
    `);
    console.log('Recent Client Session Notes:', sRes.rows);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
