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

// Tables that should exist based on create scripts
const expectedTables = [
  'notifications',
  'client_progress_notes',
  'client_therapy_goals',
  'client_case_history',
  'sos_risk_assessments',
  'client_transfer_history',
  'free_consultation_pretherapy_notes',
  'report_issues',
  'booking_requests',
  'sos_access_tokens',
  'therapists',
  'new_therapist_requests',
  'users',
  'aisensy_campaign_api',
  'therapist_details',
  'therapist_dashboard_stats',
  'therapist_clients_summary',
  'therapist_appointments_cache',
  'audit_logs',
  'password_reset_tokens',
  'password_reset_attempts',
  'all_clients_table',
  'appointment_table',
  'refund_cancellation_table',
  'payments',
  'booking_cancelled'
];

async function checkAllTables() {
  try {
    console.log('Checking all tables in database...\n');
    
    // Get all existing tables
    const existingTablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    const existingTables = existingTablesResult.rows.map(row => row.table_name);
    
    console.log('=== EXISTING TABLES IN DATABASE ===');
    console.log(`Total: ${existingTables.length}\n`);
    existingTables.forEach(table => console.log(`✓ ${table}`));
    
    console.log('\n\n=== EXPECTED TABLES FROM SCRIPTS ===');
    console.log(`Total: ${expectedTables.length}\n`);
    
    const missingTables: string[] = [];
    const presentTables: string[] = [];
    
    expectedTables.forEach(table => {
      if (existingTables.includes(table)) {
        presentTables.push(table);
        console.log(`✓ ${table} - EXISTS`);
      } else {
        missingTables.push(table);
        console.log(`✗ ${table} - MISSING`);
      }
    });
    
    console.log('\n\n=== SUMMARY ===');
    console.log(`Expected tables: ${expectedTables.length}`);
    console.log(`Present in DB: ${presentTables.length}`);
    console.log(`Missing from DB: ${missingTables.length}`);
    
    if (missingTables.length > 0) {
      console.log('\n❌ MISSING TABLES:');
      missingTables.forEach(table => console.log(`  - ${table}`));
      
      console.log('\n📝 Scripts to run:');
      const scriptMapping: { [key: string]: string } = {
        'notifications': 'createNotificationsTable.ts',
        'client_progress_notes': 'createProgressNotesTable.ts',
        'client_therapy_goals': 'createTherapyGoalsTable.ts',
        'client_case_history': 'createCaseHistoryTable.ts',
        'sos_risk_assessments': 'createSOSRiskAssessmentsTable.ts',
        'client_transfer_history': 'createTransferHistoryTable.ts',
        'free_consultation_pretherapy_notes': 'createFreeConsultationNotesTable.ts',
        'report_issues': 'createReportIssuesTable.ts',
        'booking_requests': 'createBookingRequestsTable.ts',
        'sos_access_tokens': 'createSOSAccessTokensTable.ts',
        'therapists': 'createTherapistsTable.ts',
        'new_therapist_requests': 'createNewTherapistRequestsTable.ts',
        'users': 'createUsersTable.ts',
        'aisensy_campaign_api': 'createAisensyCampaignTable.ts',
        'therapist_details': 'createTherapistDetailsTable.ts',
        'therapist_dashboard_stats': 'createTherapistDashboardTables.ts',
        'therapist_clients_summary': 'createTherapistDashboardTables.ts',
        'therapist_appointments_cache': 'createTherapistDashboardTables.ts',
        'audit_logs': 'createAuditLogsTable.ts',
        'password_reset_tokens': 'createPasswordResetTables.ts',
        'password_reset_attempts': 'createPasswordResetTables.ts',
        'all_clients_table': 'createNewTables.ts',
        'appointment_table': 'createNewTables.ts',
        'refund_cancellation_table': 'createNewTables.ts',
        'payments': 'createPaymentsTable.ts',
        'booking_cancelled': 'createPaymentsTable.ts'
      };
      
      const scriptsToRun = new Set<string>();
      missingTables.forEach(table => {
        if (scriptMapping[table]) {
          scriptsToRun.add(scriptMapping[table]);
        }
      });
      
      scriptsToRun.forEach(script => {
        console.log(`  npx tsx scripts/${script}`);
      });
    } else {
      console.log('\n✅ All expected tables are present in the database!');
    }
    
    // Check for extra tables not in expected list
    const extraTables = existingTables.filter(table => !expectedTables.includes(table));
    if (extraTables.length > 0) {
      console.log('\n\n=== EXTRA TABLES (not in create scripts) ===');
      extraTables.forEach(table => console.log(`  + ${table}`));
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkAllTables();
