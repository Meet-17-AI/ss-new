import bcrypt from 'bcrypt';
import pool from '../lib/db';

async function createUsersTable() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✓ Users table created successfully');
    
    // Insert default admin user. The password is supplied by the operator and
    // stored as a bcrypt hash — this used to seed a hardcoded plaintext one.
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword) {
      throw new Error('Set SEED_ADMIN_PASSWORD to seed the default admin user');
    }
    await pool.query(
      `INSERT INTO users (username, password, name, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      ['admin', await bcrypt.hash(seedPassword, 10), 'Pooja Jain']
    );

    console.log('✓ Default admin user created (username: admin)');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createUsersTable();
