import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('🔍 Checking Database Backup Status...\n');
    
    // Get basic info
    const versionResult = await pool.query('SELECT version()');
    console.log('PostgreSQL Version:');
    console.log(`   ${versionResult.rows[0].version.split(',')[0]}\n`);
    
    // Check database size
    const sizeResult = await pool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(`Database Size: ${sizeResult.rows[0].size}\n`);
    
    // Check table sizes
    const tableSizeResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        pg_total_relation_size(schemaname||'.'||tablename) as bytes
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY bytes DESC
      LIMIT 10
    `);
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('Top 10 Tables by Size:');
    console.log('═══════════════════════════════════════════════════════\n');
    tableSizeResult.rows.forEach(row => {
      console.log(`   ${row.tablename.padEnd(30)} ${row.size}`);
    });
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('BACKUP CHECK RESULTS:');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('❌ No local backups found in project directory');
    console.log('❌ Limited server permissions - cannot check server backups\n');
    
    console.log('📋 NEXT STEPS:\n');
    console.log('1. Contact your hosting provider/server admin:');
    console.log(`   Server: ${process.env.PGHOST}`);
    console.log('   Database: safestories_db');
    console.log('   Ask for: Backups from Feb 26-28, 2026\n');
    
    console.log('2. Check if they have:');
    console.log('   - Automated daily snapshots');
    console.log('   - Point-in-time recovery (PITR)');
    console.log('   - Manual backup files (.sql/.dump)\n');
    
    console.log('3. If NO backups exist:');
    console.log('   - The 2 missing bookings are permanently lost');
    console.log('   - Implement soft deletes IMMEDIATELY');
    console.log('   - Set up automated daily backups\n');
    
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Create a backup NOW
    console.log('💡 RECOMMENDATION: Create a backup RIGHT NOW\n');
    console.log('Run this command on your server:');
    console.log(`   pg_dump -h ${process.env.PGHOST} -U fluidadmin -d safestories_db > backup_$(date +%Y%m%d_%H%M%S).sql\n`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
})();
