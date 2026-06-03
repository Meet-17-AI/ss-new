const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://safe_stories_user:sDngXN15T8LIfd0LhPq8Z6zNn1Fj9EwQ@dpg-ctg3g8ij1k6c73aq7kcg-a.singapore-postgres.render.com/safe_stories',
  ssl: { rejectUnauthorized: false }
});
pool.query(`
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'therapists';
`).then(r => {
  console.log(r.rows);
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
