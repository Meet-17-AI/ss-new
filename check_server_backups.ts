import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('🔍 Checking for Database Backups...\n');
    console.log('Server Details:');
    console.log(`   Host: ${process.env.PGHOST}`);
    console.log(`   Database: ${process.env.PGDATABASE}`);
    console.log(`   User: ${process.env.PGUSER}\n`);
    
    // Check PostgreSQL version and settings
    const versionResult = await pool.query('SELECT version()');
    console.log('PostgreSQL Version:');
    console.log(`   ${versionResult.rows[0].version}\n`);
    
    // Check if pg_dump is available
    const pgDumpResult = await pool.query(`
      SELECT current_setting('data_directory') as data_dir
    `);
    console.log('Data Directory:');
    console.log(`   ${pgDumpResult.rows[0].data_dir}\n`);
    
    // Check for WAL archiving (backup feature)
    const walResult = await pool.query(`
      SELECT 
        name,
        setting
      FROM pg_settings
      WHERE name IN ('archive_mode', 'archive_command', 'wal_level')
    `);
    
    console.log('───────────────────────────────────────────────────────');
    console.log('WAL Archiving Settings (Backup Configuration):');
    console.log('───────────────────────────────────────────────────────\n');
    walResult.rows.forEach(row => {
      console.log(`   ${row.name.padEnd(20)} ${row.setting}`);
    });
    
    // Check database size
    const sizeResult = await pool.query(`
      SELECT 
        pg_size_pretty(pg_database_size('${process.env.PGDATABASE}')) as db_size
    `);
    console.log(`\nDatabase Size: ${sizeResult.rows[0].db_size}\n`);
    
    // Check last database activity
    const activityResult = await pool.query(`
      SELECT 
        datname,
        stats_reset,
        NOW() - stats_reset as time_since_reset
      FROM pg_stat_database
      WHERE datname = '${process.env.PGDATABASE}'
    `);
    
    if (activityResult.rows.length > 0) {
      console.log('Last Stats Reset:');
      console.log(`   ${activityResult.rows[0].stats_reset}\n`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('BACKUP STATUS:');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const archiveMode = walResult.rows.find(r => r.name === 'archive_mode')?.setting;
    
    if (archiveMode === 'on') {
      console.log('✅ WAL archiving is ENABLED');
      console.log('   Continuous backups may be available\n');
    } else {
      console.log('❌ WAL archiving is DISABLED');
      console.log('   No automatic backups configured\n');
    }
    
    console.log('⚠️  RECOMMENDATION:');
    console.log('   Contact your hosting provider to check for:');
    console.log('   1. Automated database snapshots');
    console.log('   2. Point-in-time recovery options');
    console.log('   3. Manual backup files (.sql or .dump)\n');
    
    console.log(`   Server: ${process.env.PGHOST}`);
    console.log('   Database: safestories_db\n');
    
    console.log('═══════════════════════════════════════════════════════\n');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
})();
