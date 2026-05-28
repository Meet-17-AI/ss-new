import pool from '../lib/db';
import { therapistData } from '../lib/sessionData';

async function setupTherapyServices() {
  const client = await pool.connect();
  try {
    console.log('Creating therapy_services table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS therapy_services (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        duration VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        detailed_description TEXT,
        edit_view_description TEXT,
        charges VARCHAR(50) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        label VARCHAR(255),
        therapist_id VARCHAR(255) NOT NULL,
        therapist_name VARCHAR(255) NOT NULL,
        schedule_id INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ therapy_services table created.');

    // Fetch therapists to map names to therapist_id
    const therapistsResult = await client.query('SELECT therapist_id, name FROM therapists');
    const therapistMap = new Map<string, string>();
    therapistsResult.rows.forEach(t => {
      therapistMap.set(t.name.toLowerCase().trim(), t.therapist_id);
    });

    console.log('Seeding therapy_services from sessionData...');
    for (const [ownerName, data] of Object.entries(therapistData)) {
      const therapistId = therapistMap.get(ownerName.toLowerCase().trim());
      if (!therapistId) {
        console.warn(`⚠️ No therapist found in DB for name: ${ownerName}`);
        continue;
      }

      for (const service of data.services) {
        // Resolve schedule_id from therapist_resources
        // First try to match by therapy_name or resource_name
        let resolvedScheduleId = null;
        let therapyCategory = service.label?.split('/')[0] || ''; // e.g. "individual", "couple", "adolescent"
        let therapyNameSearch = '';
        if (therapyCategory.toLowerCase().includes('individual')) therapyNameSearch = 'Individual Therapy';
        else if (therapyCategory.toLowerCase().includes('couple')) therapyNameSearch = 'Couples Therapy';
        else if (therapyCategory.toLowerCase().includes('adolescent')) therapyNameSearch = 'Adolescent Therapy';

        const resourceResult = await client.query(
          `SELECT schedule_id 
           FROM therapist_resources 
           WHERE therapist_id = $1 
             AND (therapy_name ILIKE $2 OR resource_name ILIKE $3) 
           LIMIT 1`,
          [therapistId, `%${therapyNameSearch}%`, `%${ownerName}%`]
        );

        if (resourceResult.rows.length > 0) {
          resolvedScheduleId = resourceResult.rows[0].schedule_id;
        } else {
          // Fallback: get any schedule_id for this therapist
          const fallbackResult = await client.query(
            'SELECT MAX(schedule_id) as schedule_id FROM therapist_resources WHERE therapist_id = $1',
            [therapistId]
          );
          resolvedScheduleId = fallbackResult.rows[0]?.schedule_id || null;
        }

        console.log(`Mapping service "${service.title}" for ${ownerName} to schedule_id ${resolvedScheduleId}`);

        await client.query(`
          INSERT INTO therapy_services (
            title, duration, type, description, detailed_description, 
            edit_view_description, charges, slug, label, therapist_id, therapist_name, schedule_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (slug) DO UPDATE SET
            title = EXCLUDED.title,
            duration = EXCLUDED.duration,
            type = EXCLUDED.type,
            description = EXCLUDED.description,
            detailed_description = EXCLUDED.detailed_description,
            edit_view_description = EXCLUDED.edit_view_description,
            charges = EXCLUDED.charges,
            label = EXCLUDED.label,
            therapist_id = EXCLUDED.therapist_id,
            therapist_name = EXCLUDED.therapist_name,
            schedule_id = EXCLUDED.schedule_id;
        `, [
          service.title,
          service.duration,
          service.type,
          service.description,
          service.detailedDescription,
          service.editViewDescription,
          service.charges,
          service.slug,
          service.label,
          therapistId,
          ownerName,
          resolvedScheduleId
        ]);
      }
    }
    console.log('✓ Seeding complete.');
  } catch (error) {
    console.error('Error during setup:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

setupTherapyServices();
