import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Validate required database environment variables
const requiredDbVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const missingDbVars = requiredDbVars.filter(v => !process.env[v]);
if (missingDbVars.length > 0) {
  console.error('❌ FATAL: Missing database configuration variables:', missingDbVars);
  console.error('Please check your environment variables');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT!),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 5, // Reduced pool size to avoid connection exhaustion
  connectionTimeoutMillis: 30000, // Increased timeout to 30s for slow networks
  idleTimeoutMillis: 60000, // Increased idle timeout
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

export default pool;
