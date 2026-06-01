import pool from '../lib/db';

export async function logAutomationSuccess(booking_id: string, automation_type: string, recipient: string, response_data: any) {
  try {
    await pool.query(
      `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data)
       VALUES ($1, $2, $3, 'success', $4)`,
      [booking_id, automation_type, recipient, response_data]
    );
  } catch (error) {
    console.error(`[AutomationLogger] Failed to write success log for ${automation_type}:`, error);
  }
}

export async function logAutomationFailure(booking_id: string, automation_type: string, recipient: string, error_message: string) {
  try {
    await pool.query(
      `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [booking_id, automation_type, recipient, error_message]
    );
  } catch (error) {
    console.error(`[AutomationLogger] Failed to write failure log for ${automation_type}:`, error);
  }
}
