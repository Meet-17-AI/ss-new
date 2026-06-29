const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const scheduleId = 99999;
    const therapistIdStr = 'SafeStories';
    const therapistName = 'SafeStories';

    // 1. Insert into therapist_schedules
    await pool.query(
      `INSERT INTO therapist_schedules (schedule_id, therapist_id, name, time_zone, availability, date_overrides, exclusions)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       ON CONFLICT (schedule_id) DO NOTHING`,
      [
        scheduleId,
        therapistIdStr,
        `${therapistName}'s Schedule`,
        'Asia/Calcutta',
        JSON.stringify([
          { day: "monday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "tuesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "wednesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "thursday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "friday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "saturday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "sunday", is_available: false, times: [{ start: "09:00", end: "17:00" }] }
        ]),
        JSON.stringify([]),
        JSON.stringify([])
      ]
    );
    console.log('Inserted into therapist_schedules');

    // 2. Insert into therapist_resources
    await pool.query(
      `INSERT INTO therapist_resources (resource_id, resource_name, therapist_id, therapist_name, therapy_name, schedule_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        Math.floor(Math.random() * 10000),
        'Platform Calendar',
        therapistIdStr,
        therapistName,
        'Platform Calendar',
        scheduleId
      ]
    );
    console.log('Inserted into therapist_resources');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
