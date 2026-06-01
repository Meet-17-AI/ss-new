import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.PGHOST || '72.60.103.151',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'safestories_db',
  user: process.env.PGUSER || 'fluidadmin',
  password: process.env.PGPASSWORD || 'admin123',
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
