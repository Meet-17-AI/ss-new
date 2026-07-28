import * as dotenv from 'dotenv';
dotenv.config({ path: 'panel-backend/.env.local' });
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'safestories_db',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function findClient() {
  try {
    const phone = '+91 9850444097';
    const normalizedPhone = phone.replace(/[\s\-\(\)\+]/g, '');
    const tenDigits = normalizedPhone.slice(-10);

    console.log(`Searching for phone: ${phone} (Normalized: ${normalizedPhone}, Last 10: ${tenDigits})`);

    // Search in leads
    const leadsResult = await pool.query(
      `SELECT * FROM leads WHERE phone LIKE $1 OR phone LIKE $2`,
      [`%${tenDigits}%`, `%${normalizedPhone}%`]
    );
    console.log('\n--- LEADS MATCHES ---');
    console.table(leadsResult.rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      stage: r.pipeline_stage,
      therapist_id: r.therapist_id,
      created_at: r.created_at
    })));

    // Search in bookings
    const bookingsResult = await pool.query(
      `SELECT booking_id, invitee_name, invitee_phone, booking_host_name, booking_status, booking_start_at 
       FROM bookings 
       WHERE invitee_phone LIKE $1 OR invitee_phone LIKE $2`,
      [`%${tenDigits}%`, `%${normalizedPhone}%`]
    );
    console.log('\n--- BOOKINGS MATCHES ---');
    console.table(bookingsResult.rows);

    // Search by name if phone didn't yield clear results
    if (leadsResult.rows.length === 0) {
      const nameResult = await pool.query(
        `SELECT * FROM leads WHERE name ILIKE $1`,
        ['%Shub%']
      );
      console.log('\n--- LEADS MATCHES BY NAME (Shub) ---');
      console.table(nameResult.rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        stage: r.pipeline_stage,
        therapist_id: r.therapist_id
      })));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

findClient();
