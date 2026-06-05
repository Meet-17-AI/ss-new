const { Pool } = require('pg');

const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123',
  ssl: {
    rejectUnauthorized: false
  }
});

const updates = [
  { id: 4, campaign_name: 'indrayani_adolscent_panel_weekly_reminder' },
  { id: 5, campaign_name: 'indrayani_individual_panel_weekly_reminder' },
  { id: 11, campaign_name: 'ambika_adolescent_panel_weekly_reminder' },
  { id: 12, campaign_name: 'ambika_individual_panel_weekly_reminder' },
  { id: 9, campaign_name: 'aastha_adolescent_panel_weekly_reminder' },
  { id: 8, campaign_name: 'aastha_individual_panel_weekly_reminder' },
  { id: 6, campaign_name: 'anjali_adolecent_panel_weekly_reminder' },
  { id: 7, campaign_name: 'anjali_individual_panel_weekly_reminder' },
  { id: 1, campaign_name: 'ishika_adolescent_panel_weekly_reminder' },
  { id: 3, campaign_name: 'ishika_couples_panel_weekly_reminder' },
  { id: 2, campaign_name: 'ishika_individual_panel_weekly_reminder' },
];

async function run() {
  try {
    // First let's check what columns exist in Aisensy_campaign_api
    const colRes = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'aisensy_campaign_api'
    `);
    console.log('Columns:', colRes.rows.map(r => r.column_name));
    
    // Now let's try updating
    for (const item of updates) {
      console.log(`Updating ID ${item.id} -> ${item.campaign_name}...`);
      const res = await pool.query(
        'UPDATE aisensy_campaign_api SET campaign_name = $1 WHERE id = $2',
        [item.campaign_name, item.id]
      );
      if (res.rowCount === 0) {
        console.warn(`⚠️ No row found with ID ${item.id}`);
      } else {
        console.log(`✅ Updated ID ${item.id}`);
      }
    }

    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

run();
