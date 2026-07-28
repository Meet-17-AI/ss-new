/**
 * Ticketing schema migration — additive only, safe to re-run.
 *
 * Mirrors the block in index.ts so it can be applied without a full (non-readonly)
 * boot. A normal production boot applies the same DDL automatically.
 */
require('dotenv').config({ path: __dirname + '/.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const STEPS = [
  ['reported_by_user_id column',
   `ALTER TABLE report_issues ADD COLUMN IF NOT EXISTS reported_by_user_id INTEGER`],
  ['owner index',
   `CREATE INDEX IF NOT EXISTS idx_report_issues_owner ON report_issues(reported_by_user_id)`],
  ['attachments table',
   `CREATE TABLE IF NOT EXISTS report_issue_attachments (
      id          SERIAL PRIMARY KEY,
      ticket_id   INTEGER NOT NULL REFERENCES report_issues(id) ON DELETE CASCADE,
      file_url    TEXT NOT NULL,
      file_name   TEXT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`],
  ['attachments index',
   `CREATE INDEX IF NOT EXISTS idx_rin_ticket ON report_issue_attachments(ticket_id)`],
  ['backfill ownership from display name',
   `UPDATE report_issues r SET reported_by_user_id = u.id
      FROM users u
     WHERE r.reported_by_user_id IS NULL
       AND LOWER(r.reported_by) IN (LOWER(u.username), LOWER(u.full_name))`],
  ['backfill attachments from legacy screenshot_url',
   `INSERT INTO report_issue_attachments (ticket_id, file_url)
    SELECT r.id, r.screenshot_url FROM report_issues r
     WHERE r.screenshot_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM report_issue_attachments a WHERE a.ticket_id = r.id)`],
];

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [label, sql] of STEPS) {
      const r = await c.query(sql);
      console.log(`  ✓ ${label}${typeof r.rowCount === 'number' && r.rowCount > 0 ? ` (${r.rowCount} rows)` : ''}`);
    }
    await c.query('COMMIT');
    console.log('COMMITTED ✅');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
