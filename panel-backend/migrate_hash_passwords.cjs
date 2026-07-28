/**
 * One-time migration: bcrypt-hash any users.password still stored as plaintext.
 *
 * Safe to run with users logged in and no cutover window: verifyPassword() in
 * index.ts already accepts both formats, and hashing a known plaintext preserves
 * the exact same login. Idempotent — rows already hashed are skipped.
 */
require('dotenv').config({ path: __dirname + '/.env.local' });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');
const BCRYPT_RE = /^\$2[aby]\$/;
const isHashed = (s) => typeof s === 'string' && BCRYPT_RE.test(s);

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const { rows } = await c.query('SELECT id, username, password FROM users ORDER BY id');
    const plain = rows.filter((r) => !isHashed(r.password));
    console.log(`total users: ${rows.length} | already hashed: ${rows.length - plain.length} | to migrate: ${plain.length}`);

    if (plain.length === 0) {
      await c.query('COMMIT');
      console.log('nothing to do ✅');
      return;
    }

    for (const u of plain) {
      const original = u.password;
      const hash = await bcrypt.hash(original, ROUNDS);

      // The whole point: the SAME password must still log in afterwards.
      if (!(await bcrypt.compare(original, hash))) {
        throw new Error(`hash self-check failed for user ${u.id}`);
      }

      const r = await c.query('UPDATE users SET password = $1 WHERE id = $2', [hash, u.id]);
      if (r.rowCount !== 1) throw new Error(`expected 1 row for user ${u.id}, got ${r.rowCount}`);

      // Re-read what actually landed and re-verify against the original plaintext.
      const back = await c.query('SELECT password FROM users WHERE id = $1', [u.id]);
      if (!(await bcrypt.compare(original, back.rows[0].password))) {
        throw new Error(`post-write verify failed for user ${u.id}`);
      }
      console.log(`  ✓ id ${String(u.id).padEnd(5)} ${String(u.username).padEnd(22)} ${original.length} -> ${back.rows[0].password.length} chars`);
    }

    // Final gate: every row must now be hashed.
    const after = await c.query('SELECT id, username, password FROM users');
    const stillPlain = after.rows.filter((r) => !isHashed(r.password));
    if (stillPlain.length > 0) {
      throw new Error(`still plaintext: ${stillPlain.map((r) => r.username).join(', ')}`);
    }
    console.log(`AFTER: ${after.rows.length} of ${after.rows.length} hashed`);

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
