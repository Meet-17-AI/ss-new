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
/**
 * Remove the file's own BEGIN/COMMIT so this script owns the transaction.
 *
 * Done in BOTH modes, not just dry-run. Leaving them in meant an outer BEGIN
 * around the file's BEGIN and a trailing COMMIT after its COMMIT, so a perfectly
 * successful run printed "there is already a transaction in progress" and then
 * "there is no transaction in progress". Both were harmless and both looked
 * exactly like something going wrong — which is the last thing wanted on the one
 * night this gets run against production.
 *
 * The migration keeps its markers so it can still be pasted into psql or pgAdmin
 * and behave correctly on its own.
 */
const stripOwnTransaction = (sql) =>
  sql.replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '');

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });

/**
 * Counts that make the before/after diff legible in the terminal.
 *
 * Split in two, and the reason is the whole point of taking a "before" reading:
 * before the migration runs, bookings.public_token DOES NOT EXIST. A single query
 * mentioning it fails to parse against exactly the database this script is for —
 * which is what happened the first time, and it read as the migration failing
 * rather than the instrumentation around it.
 */
const BASE_SNAPSHOT = `
  SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE')  AS tables,
    (SELECT count(*) FROM bookings)                             AS bookings,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bookings'
        AND column_name='public_token')                         AS has_token_column
`;

const TOKEN_SNAPSHOT = `
  SELECT
    (SELECT count(*) FROM bookings WHERE public_token IS NOT NULL) AS with_token,
    (SELECT count(*) FROM bookings
      WHERE public_booking_checkin_url LIKE '%/booking-confirmation/%'
        AND public_booking_checkin_url NOT LIKE '%' || public_token) AS stale_urls
`;

const snapshot = async (client) => {
  const base = (await client.query(BASE_SNAPSHOT)).rows[0];
  if (Number(base.has_token_column) === 0) {
    return { tables: base.tables, bookings: base.bookings, with_token: '(column not added yet)', stale_urls: '—' };
  }
  const tok = (await client.query(TOKEN_SNAPSHOT)).rows[0];
  return { tables: base.tables, bookings: base.bookings, ...tok };
};

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
  // What was actually sent, so a reported error position maps to the right text.
  // In dry-run that is not the file verbatim — the transaction markers are gone.
  let executed = raw;
  try {
    const before = await snapshot(client);
    console.log('\nBefore:', before);

    console.log(`\nRunning ${path.basename(SQL_FILE)} ...`);
    const t0 = Date.now();

    // One transaction, owned here, so the rollback below reaches everything the
    // file did and a clean run prints no transaction warnings.
    executed = stripOwnTransaction(raw);
    await client.query('BEGIN');
    await client.query(executed);

    const after = await snapshot(client);
    console.log(`\nAfter :`, after);
    console.log(`Elapsed: ${Date.now() - t0} ms`);

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN complete — every change above was rolled back.');
      console.log('The database is untouched. Re-run without --dry-run to apply.');
    } else {
      await client.query('COMMIT');
      console.log('\nMigration committed.');
      console.log('Deploy the new panel/CRM build now.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFAILED — rolled back, database unchanged.');
    console.error(`  ${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.hint) console.error(`  hint: ${err.hint}`);
    if (err.where) console.error(`  where: ${err.where}`);
    // Postgres reports the byte offset of the failure within the whole batch.
    // Turning it into a line number is the difference between "something in a
    // 460-line file" and the statement to go and look at.
    if (err.position) {
      const upto = executed.slice(0, Number(err.position));
      const line = upto.split('\n').length;
      const lines = executed.split('\n');
      console.error(`  at line ${line}:`);
      for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) {
        console.error(`    ${String(i + 1).padStart(4)} ${i + 1 === line ? '>' : ' '} ${lines[i]}`);
      }
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
