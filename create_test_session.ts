import pool from './lib/db.ts';

async function createTestBooking() {
  try {
    // 1. Get an active therapist
    const therapistRes = await pool.query("SELECT therapist_id, name FROM therapists LIMIT 1");
    if (therapistRes.rows.length === 0) {
      console.error('No therapists found in database.');
      process.exit(1);
    }
    const therapist = therapistRes.rows[0];

    const bookingId = 'TEST-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const clientId = 'CLI-TEST-001';
    const clientName = 'Test User';

    console.log(`Creating test booking: ${bookingId} for therapist ${therapist.name}`);

    // 2. Create booking
    await pool.query(`
      INSERT INTO bookings (
        booking_id, invitee_id, invitee_name, invitee_email, 
        therapist_id, booking_status, booking_subject, booking_start_at, booking_end_at,
        booking_resource_name, booking_host_name, booking_duration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '1 hour', NOW(), $8, $9, $10)
    `, [
      bookingId, clientId, clientName, 'test@example.com', 
      therapist.therapist_id, 'completed', 'Free Intake Consultation',
      'Intake Session', 'Safestories', 15
    ]);

    // 3. Create doc form entry with public link
    const publicLink = `https://panel.safestories.in/session-notes/${bookingId}`;
    await pool.query(`
      INSERT INTO client_doc_form (
        booking_id, status, custom_form_link
      ) VALUES ($1, 'pending', $2)
    `, [bookingId, publicLink]);

    console.log(`✅ Test booking created successfully!`);
    console.log(`Booking ID: ${bookingId}`);
    console.log(`Status: COMPLETED (ready for documentation)`);
    console.log(`Link: ${publicLink}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating test booking:', err);
    process.exit(1);
  }
}

createTestBooking();
