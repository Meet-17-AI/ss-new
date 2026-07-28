import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// No credential fallbacks. Defaults here get committed and end up in git history;
// they also silently pointed this pool at the stale `safestories_db` when the env
// was missing, instead of failing loudly.
const requiredDbVars = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const missingDbVars = requiredDbVars.filter(v => !process.env[v]);
if (missingDbVars.length > 0) {
  throw new Error(`Missing database environment variables: ${missingDbVars.join(', ')}`);
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 1, // Limit connections for serverless
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', (client) => {
  client.query("SET timezone = 'Asia/Kolkata'");
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

export default pool;
