/**
 * activity_logs schema — additive, idempotent, safe to re-run.
 * Mirrors the block in index.ts so it can be applied without a full boot.
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
  ['activity_logs table', `
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          BIGSERIAL PRIMARY KEY,
      category    TEXT NOT NULL,
      actor_id    TEXT,
      actor_name  TEXT,
      actor_role  TEXT,
      action      TEXT NOT NULL,
      method      TEXT NOT NULL,
      route       TEXT NOT NULL,
      path        TEXT NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      status_code INTEGER,
      duration_ms INTEGER,
      ip_address  TEXT,
      user_agent  TEXT,
      metadata    JSONB,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`],
  ['created_at index', `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC)`],
  ['category index', `CREATE INDEX IF NOT EXISTS idx_activity_category ON activity_logs(category, created_at DESC)`],
  ['actor index', `CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(actor_id, created_at DESC)`],
];

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [label, sql] of STEPS) {
      await c.query(sql);
      console.log(`  ✓ ${label}`);
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
