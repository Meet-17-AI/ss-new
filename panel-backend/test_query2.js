const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://safe_stories_user:sDngXN15T8LIfd0LhPq8Z6zNn1Fj9EwQ@dpg-ctg3g8ij1k6c73aq7kcg-a.singapore-postgres.render.com/safe_stories',
  ssl: { rejectUnauthorized: false }
});
pool.query(`
  SELECT u.id, u.name, u.full_name, u.therapist_id, t.specialization,
         CASE WHEN u.google_calendar_tokens IS NOT NULL THEN true ELSE false END as google_calendar_connected
  FROM users u
  LEFT JOIN therapists t ON u.therapist_id = t.therapist_id
  WHERE u.role = 'therapist' AND COALESCE(t.is_active, true) = true
  ORDER BY COALESCE(u.full_name, u.name)
`).then(r => {
  console.log('success');
  console.log(r.rows);
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
