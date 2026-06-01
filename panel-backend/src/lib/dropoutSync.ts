import pool from './db.js';

/**
 * Synchronizes the CRM "Dropouts" pipeline stage with the session-based logic:
 * A lead is considered a dropout if they have exactly 1 non-cancelled session 
 * and that session was more than 30 days ago.
 */
export async function startDropoutSync() {
  console.log('🔄 Dropout Synchronization Service Started');

  async function syncDropouts() {
    console.log('📂 Running Dropout Synchronization check...');
    try {
      // Find leads in 'booked-first-session' who should be moved to 'dropouts'
      // 1. Move to dropouts: exactly 1 session, last one > 30 days ago
      const moveInResult = await pool.query(`
        UPDATE leads l
        SET 
            pipeline_stage = 'dropouts',
            stage_dropouts_at = CURRENT_TIMESTAMP,
            remark_lead_manager = COALESCE(remark_lead_manager, '') || $1,
            updated_at = CURRENT_TIMESTAMP
        FROM (
            SELECT 
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') as norm_phone,
                LOWER(TRIM(invitee_email)) as norm_email,
                COUNT(*) as session_count,
                MAX(booking_start_at) as last_session
            FROM bookings
            WHERE booking_status NOT IN ('cancelled', 'canceled', 'no-show')
            GROUP BY norm_phone, norm_email
        ) b
        WHERE l.pipeline_stage = 'booked-first-session'
        AND (REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(l.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = b.norm_phone
             OR (LOWER(TRIM(l.email)) = b.norm_email AND b.norm_email <> ''))
        AND b.session_count = 1
        AND b.last_session < NOW() - INTERVAL '30 days'
        RETURNING l.id, l.name;
      `, [`\n[System ${new Date().toLocaleDateString('en-IN')}]: Auto-moved to Dropouts (1 session > 30 days ago)`]);

      if (moveInResult.rowCount > 0) {
        moveInResult.rows.forEach(row => {
          console.log(`📉 [Dropout Sync] Moved "${row.name}" (${row.id}) to Dropouts.`);
        });
      }

    } catch (error) {
      console.error('❌ Dropout Sync error:', error);
    }
  }

  // Run immediately
  await syncDropouts();

  // Run every 12 hours
  setInterval(syncDropouts, 12 * 60 * 60 * 1000);
}
