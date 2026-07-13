import pool from '../lib/db.ts';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function populateConsultationLinks() {
  try {
    console.log('🔍 Starting consultation link backfill...');
    
    // Determine Base URL (can be overridden by arg or env)
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    const baseUrl = isVercel ? 'https://panel.safestories.in' : 'http://localhost:3004';
    
    console.log(`📍 Using Base URL: ${baseUrl}`);

    // 1. Find all bookings that are consultations
    // Criteria: subject LIKE %Consultation%, subject LIKE %Pre-therapy%, duration 15, or host Safestories
    const bookingsRes = await pool.query(`
      SELECT booking_id, booking_subject, booking_host_name, booking_duration 
      FROM bookings 
      WHERE 
        LOWER(booking_subject) LIKE '%consultation%' OR 
        LOWER(booking_subject) LIKE '%pre-therapy%' OR
        booking_duration = 15 OR
        LOWER(TRIM(booking_host_name)) = 'safestories'
    `);

    const consultationBookings = bookingsRes.rows;
    console.log(`📅 Found ${consultationBookings.length} consultation bookings.`);

    let updatedCount = 0;
    let createdCount = 0;

    for (const booking of consultationBookings) {
      const publicLink = `${baseUrl}/session-notes/${booking.booking_id}`;
      
      // Upsert into client_doc_form
      const result = await pool.query(`
        INSERT INTO client_doc_form (booking_id, status, custom_form_link)
        VALUES ($1, 'pending', $2)
        ON CONFLICT (booking_id) DO UPDATE SET
          custom_form_link = EXCLUDED.custom_form_link
        WHERE (client_doc_form.custom_form_link IS NULL 
           OR client_doc_form.custom_form_link = '' 
           OR client_doc_form.custom_form_link LIKE '%paperform.co%')
        RETURNING *
      `, [booking.booking_id, publicLink]);

      if (result.rows.length > 0) {
        // Find if it was an insert or update (simplified)
        // Since we are using ON CONFLICT, if it returned a row, something was affected
        updatedCount++;
      }
    }

    console.log(`✅ Backfill completed.`);
    console.log(`📊 Total Processed: ${consultationBookings.length}`);
    console.log(`📊 Links Updated/Created: ${updatedCount}`);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during backfill:', err);
    process.exit(1);
  }
}

populateConsultationLinks();
