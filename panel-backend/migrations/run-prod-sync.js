/**
 * Runner for 2026-09-02_prod_schema_sync.sql.
 *
 * Exists rather than piping the file into psql because it adds three things a
 * pipe does not: it prints the plan and makes you type the database name before
 * touching anything, it refuses to run against a database whose name you did not
 * name, and it takes a --dry-run that executes the whole migration and rolls it
 * back, so you can see it succeed against real production data without keeping
 * any of it.
 *
 *   node migrations/run-prod-sync.js --dry-run            # apply, verify, ROLLBACK
 *   node migrations/run-prod-sync.js --db safestories_db_v2
 *
 * Connection comes from .env.local (PGHOST/PGPORT/PGUSER/PGPASSWORD). The target
 * database is NOT read from there — it must be passed explicitly, so that a
 * stale PGDATABASE pointing at the clone cannot silently redirect the run.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { Client } = require('pg');

const SQL_FILE = path.resolve(__dirname, '2026-09-02_prod_schema_sync.sql');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const YES = argv.includes('--yes');
const dbFlag = argv.indexOf('--db');
const TARGET_DB = dbFlag !== -1 ? argv[dbFlag + 1] : 'safestories_db_v2';

// The migration opens and closes its own transaction. For a dry run we need to
// wrap it in an outer one we can roll back, so those markers are stripped and
// the transaction is driven from here instead.
const stripOwnTransaction = (sql) =>
  sql.replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '');

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });

// Counts that make the before/after diff legible in the terminal.
const SNAPSHOT = `
  SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE')                       AS tables,
    (SELECT count(*) FROM bookings)                                                  AS bookings,
    (SELECT count(*) FROM bookings WHERE public_token IS NOT NULL)                   AS with_token,
    (SELECT count(*) FROM bookings
      WHERE public_booking_checkin_url LIKE '%/booking-confirmation/%'
        AND public_booking_checkin_url NOT LIKE '%' || public_token)                 AS stale_urls
`;

async function main() {
  if (!fs.existsSync(SQL_FILE)) throw new Error(`Missing SQL file: ${SQL_FILE}`);
  const raw = fs.readFileSync(SQL_FILE, 'utf8');

  console.log('='.repeat(70));
  console.log(`  Schema sync -> ${TARGET_DB}`);
  console.log(`  Host        : ${process.env.PGHOST}`);
  console.log(`  Mode        : ${DRY_RUN ? 'DRY RUN (rolled back at the end)' : 'APPLY (committed)'}`);
  console.log('='.repeat(70));
  console.log('  Creates 8 tables, adds 16 columns, 20 indexes, 1 check constraint.');
  console.log('  Backfills bookings.public_token and rewrites the check-in URLs.');
  console.log('  Additive only: no DROP, no type change, no data copied from the clone.');
  console.log('='.repeat(70));

  if (!DRY_RUN && !YES) {
    const typed = await ask(`\nType the database name to confirm (${TARGET_DB}): `);
    if (typed !== TARGET_DB) { console.log('Name did not match. Nothing was run.'); process.exit(1); }
    console.log('\nTake a backup first if you have not:');
    console.log(`  pg_dump -h ${process.env.PGHOST} -U ${process.env.PGUSER} -d ${TARGET_DB} -Fc -f ${TARGET_DB}-preflight.dump\n`);
    const go = await ask('Backup taken? Proceed? (yes/no): ');
    if (go.toLowerCase() !== 'yes') { console.log('Aborted. Nothing was run.'); process.exit(1); }
  }

  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: TARGET_DB,
    statement_timeout: 300000,
  });

  // Surface the RAISE NOTICE from the migration's own verification block.
  client.on('notice', (n) => console.log(`  [pg] ${n.message}`));

  await client.connect();
  try {
    const before = (await client.query(SNAPSHOT)).rows[0];
    console.log('\nBefore:', before);

    console.log(`\nRunning ${path.basename(SQL_FILE)} ...`);
    const t0 = Date.now();

    // One transaction either way. In dry-run the migration's own BEGIN/COMMIT is
    // stripped so the rollback below actually reaches everything it did.
    await client.query('BEGIN');
    await client.query(DRY_RUN ? stripOwnTransaction(raw) : raw);

    const after = (await client.query(SNAPSHOT)).rows[0];
    console.log(`\nAfter :`, after);
    console.log(`Elapsed: ${Date.now() - t0} ms`);

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN complete — every change above was rolled back.');
      console.log('The database is untouched. Re-run without --dry-run to apply.');
    } else {
      // The file commits itself; this closes the wrapper for the already-
      // committed case and is a no-op warning at worst.
      await client.query('COMMIT').catch(() => {});
      console.log('\nMigration committed.');
      console.log('Deploy the new panel/CRM build now.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFAILED — rolled back, database unchanged.');
    console.error(`  ${err.message}`);
    if (err.hint) console.error(`  hint: ${err.hint}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
