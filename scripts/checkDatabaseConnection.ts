import pool from '../lib/db';

async function checkDatabaseConnection() {
  try {
    console.log('\n=== DATABASE CONNECTION CHECK ===\n');
    
    // Check connection details
    console.log('Connected to:');
    console.log(`  Host: ${process.env.PGHOST}`);
    console.log(`  Database: ${process.env.PGDATABASE || 'safestories_db'}`);
    console.log(`  User: ${process.env.PGUSER || 'fluidadmin'}\n`);

    // Get total bookings count
    const totalCount = await pool.query('SELECT COUNT(*) as count FROM bookings');
    console.log(`Total bookings in database: ${totalCount.rows[0].count}\n`);

    // Check if there are any recent changes
    const recentChanges = await pool.query(`
      SELECT 
        TO_CHAR(MAX(invitee_created_at), 'YYYY-MM-DD HH24:MI:SS') as last_booking_created,
        TO_CHAR(MAX(booking_updated_at), 'YYYY-MM-DD HH24:MI:SS') as last_booking_updated
      FROM bookings
    `);
    console.log('Last activity:');
    console.table(recentChanges.rows);

    // Check the exact data that would be returned for Jan 2026
    console.log('\n=== JAN 2026 DATA CHECK ===\n');
    
    const janData = await pool.query(`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN invitee_payment_amount IS NOT NULL AND invitee_payment_amount > 0 THEN 1 END) as paid_bookings,
        COUNT(CASE WHEN invitee_payment_amount IS NULL OR invitee_payment_amount = 0 THEN 1 END) as free_bookings,
        COALESCE(SUM(invitee_payment_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN invitee_payment_amount IS NOT NULL AND invitee_payment_amount > 0 THEN invitee_payment_amount END), 0) as paid_revenue
      FROM bookings 
      WHERE booking_status NOT IN ('cancelled', 'canceled')
      AND booking_start_at BETWEEN '2026-01-01' AND '2026-01-31 23:59:59'
    `);
    
    console.log('Jan 2026 Statistics:');
    console.table(janData.rows);

    // Calculate what different queries would return
    console.log('\n=== QUERY VARIATIONS ===\n');
    
    // Query 1: Current API query (includes NULL)
    const query1 = await pool.query(`
      SELECT COALESCE(SUM(invitee_payment_amount), 0) as revenue
      FROM bookings 
      WHERE booking_status NOT IN ('cancelled', 'canceled')
      AND booking_start_at BETWEEN '2026-01-01' AND '2026-01-31 23:59:59'
    `);
    console.log(`Current API Query (includes NULL): ₹${parseFloat(query1.rows[0].revenue).toLocaleString()}`);

    // Query 2: Fixed query (excludes NULL)
    const query2 = await pool.query(`
      SELECT COALESCE(SUM(invitee_payment_amount), 0) as revenue
      FROM bookings 
      WHERE booking_status NOT IN ('cancelled', 'canceled')
      AND invitee_payment_amount IS NOT NULL
      AND invitee_payment_amount > 0
      AND booking_start_at BETWEEN '2026-01-01' AND '2026-01-31 23:59:59'
    `);
    console.log(`Fixed Query (excludes NULL): ₹${parseFloat(query2.rows[0].revenue).toLocaleString()}`);

    // Check if there's a difference
    const diff = parseFloat(query1.rows[0].revenue) - parseFloat(query2.rows[0].revenue);
    console.log(`\nDifference: ₹${diff.toLocaleString()}`);
    console.log(`(Should be 0 since NULL contributes 0 to SUM)\n`);

    // Check for any anomalies
    console.log('\n=== CHECKING FOR ANOMALIES ===\n');
    
    const anomalies = await pool.query(`
      SELECT 
        booking_id,
        invitee_name,
        invitee_payment_amount,
        booking_status,
        TO_CHAR(booking_start_at, 'YYYY-MM-DD') as booking_date
      FROM bookings 
      WHERE booking_start_at BETWEEN '2026-01-01' AND '2026-01-31 23:59:59'
      AND (
        invitee_payment_amount < 0 
        OR (invitee_payment_amount IS NOT NULL AND invitee_payment_amount NOT IN (0, 1200, 1700, 2500, 3000))
      )
    `);
    
    if (anomalies.rows.length > 0) {
      console.log('Found unusual payment amounts:');
      console.table(anomalies.rows);
    } else {
      console.log('No anomalies found - all payment amounts are standard (0, 1200, 1700, 2500, 3000)');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkDatabaseConnection();
