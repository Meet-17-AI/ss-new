import pool from './db.js';

interface CreateNotificationParams {
  userId: string;
  userRole: 'admin' | 'therapist' | 'client';
  notificationType: string;
  title: string;
  message: string;
  relatedId?: string;
}

export async function createNotification(params: CreateNotificationParams) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.userId, params.userRole, params.notificationType, params.title, params.message, params.relatedId]
    );
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

export async function notifyAllAdmins(notificationType: string, title: string, message: string, relatedId?: string) {
  try {
    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins.rows) {
      await createNotification({
        userId: admin.id,
        userRole: 'admin',
        notificationType,
        title,
        message,
        relatedId
      });
    }
  } catch (error) {
    console.error('Error notifying admins:', error);
  }
}

export async function notifyTherapist(therapistId: string, notificationType: string, title: string, message: string, relatedId?: string) {
  try {
    const therapist = await pool.query("SELECT id FROM users WHERE therapist_id = $1 AND role = 'therapist'", [therapistId]);
    if (therapist.rows.length > 0) {
      await createNotification({
        userId: therapist.rows[0].id,
        userRole: 'therapist',
        notificationType,
        title,
        message,
        relatedId
      });
    }
  } catch (error) {
    console.error('Error notifying therapist:', error);
  }
}
