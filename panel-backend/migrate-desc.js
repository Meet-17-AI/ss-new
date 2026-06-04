const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const res = await pool.query('SELECT id, edit_view_description FROM therapy_services');
  for (const row of res.rows) {
    if (!row.edit_view_description) continue;
    let html = row.edit_view_description;
    
    // Convert bold markdown to HTML strong tags
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert newlines to break tags
    html = html.replace(/\n/g, '<br/>');

    await pool.query('UPDATE therapy_services SET description = $1 WHERE id = $2', [html, row.id]);
    console.log(`Updated id ${row.id}`);
  }
  console.log('Done!');
  process.exit(0);
}

migrate();
