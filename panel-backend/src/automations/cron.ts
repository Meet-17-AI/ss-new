import pool from '../lib/db';
import { 
    send1HrReminderOnline, 
    send1HrReminderInPerson, 
    send24HrReminderOnline, 
    send24HrReminderInPerson, 
    sendPostSessionTherapistForm 
} from './whatsapp';

// A helper to format time correctly for the Whatsapp template
function formatTime(isoString: string): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true,
        timeZone: 'Asia/Kolkata' // assuming India standard time based on previous templates
    });
}

export function startSessionRemindersCron() {
    console.log('[Cron] Starting Session Reminders and Post-Session Forms background job...');
    
    // Run every 5 minutes (300000 ms)
    setInterval(async () => {
        try {
            await check24HourReminders();
            await check1HourReminders();
            await checkPostSessionForms();
        } catch (err) {
            console.error('[Cron] Error running session reminders cron:', err);
        }
    }, 300000);
}

// 1. 24-Hour Reminders
async function check24HourReminders() {
    const query = `
        SELECT 
            b.booking_id, b.invitee_name, b.invitee_phone, b.booking_resource_name, 
            b.booking_start_at, b.booking_mode, b.booking_joining_link
        FROM bookings b
        WHERE b.booking_status IN ('scheduled', 'rescheduled')
          AND b.booking_start_at > NOW() + INTERVAL '23 hours 50 minutes'
          AND b.booking_start_at <= NOW() + INTERVAL '24 hours 10 minutes'
          AND NOT EXISTS (
              SELECT 1 FROM automation_logs al 
              WHERE al.booking_id = b.booking_id 
                AND al.automation_type IN (
                    'whatsapp_clientsessionreminder_24hr_onlinemeeting_pabbly_api',
                    'whatsapp_clientsessionreminder_24hr_in_person_pabbly_api'
                )
                AND al.status = 'success'
          )
    `;

    const { rows } = await pool.query(query);
    if (rows.length > 0) {
        console.log(`[Cron] Found ${rows.length} sessions for 24-hour reminder.`);
    }

    for (const booking of rows) {
        try {
            const timeStr = formatTime(booking.booking_start_at);
            const isOnline = booking.booking_mode?.toLowerCase().includes('online') || booking.booking_mode?.toLowerCase().includes('meet');
            
            if (isOnline) {
                await send24HrReminderOnline(
                    booking.booking_id, 
                    booking.invitee_phone, 
                    booking.invitee_name, 
                    booking.booking_resource_name || 'Therapy Session', 
                    timeStr, 
                    booking.booking_joining_link || ''
                );
            } else {
                await send24HrReminderInPerson(
                    booking.booking_id, 
                    booking.invitee_phone, 
                    booking.invitee_name, 
                    booking.booking_resource_name || 'Therapy Session', 
                    timeStr
                );
            }
        } catch (err) {
            console.error(`[Cron] Failed to send 24-hr reminder for ${booking.booking_id}`, err);
        }
    }
}

// 2. 1-Hour Reminders
async function check1HourReminders() {
    const query = `
        SELECT 
            b.booking_id, b.invitee_name, b.invitee_phone, b.booking_resource_name, 
            b.booking_start_at, b.booking_mode, b.booking_joining_link
        FROM bookings b
        WHERE b.booking_status IN ('scheduled', 'rescheduled')
          AND b.booking_start_at > NOW() + INTERVAL '50 minutes'
          AND b.booking_start_at <= NOW() + INTERVAL '70 minutes'
          AND NOT EXISTS (
              SELECT 1 FROM automation_logs al 
              WHERE al.booking_id = b.booking_id 
                AND al.automation_type IN (
                    'whatsapp_1hr_onlinesession_reminder_api_campaign',
                    'whatsapp_clientsessionreminder_1hr_inperson_pabbly_api'
                )
                AND al.status = 'success'
          )
    `;

    const { rows } = await pool.query(query);
    if (rows.length > 0) {
        console.log(`[Cron] Found ${rows.length} sessions for 1-hour reminder.`);
    }

    for (const booking of rows) {
        try {
            const timeStr = formatTime(booking.booking_start_at);
            const isOnline = booking.booking_mode?.toLowerCase().includes('online') || booking.booking_mode?.toLowerCase().includes('meet');
            
            if (isOnline) {
                await send1HrReminderOnline(
                    booking.booking_id, 
                    booking.invitee_phone, 
                    booking.invitee_name, 
                    booking.booking_resource_name || 'Therapy Session', 
                    timeStr, 
                    booking.booking_joining_link || ''
                );
            } else {
                await send1HrReminderInPerson(
                    booking.booking_id, 
                    booking.invitee_phone, 
                    booking.invitee_name, 
                    booking.booking_resource_name || 'Therapy Session', 
                    timeStr
                );
            }
        } catch (err) {
            console.error(`[Cron] Failed to send 1-hr reminder for ${booking.booking_id}`, err);
        }
    }
}

// 3. Post-Session Document Link (to Therapist)
async function checkPostSessionForms() {
    const query = `
        SELECT 
            b.booking_id, b.invitee_name, b.booking_start_at, 
            b.booking_host_name, b.booking_host_phone
        FROM bookings b
        WHERE b.booking_status IN ('scheduled', 'rescheduled', 'completed')
          AND b.booking_end_at > NOW() - INTERVAL '30 minutes'
          AND b.booking_end_at <= NOW()
          AND NOT EXISTS (
              SELECT 1 FROM automation_logs al 
              WHERE al.booking_id = b.booking_id 
                AND al.automation_type = 'whatsapp_session_completion_client_status_update_api' 
                AND al.status = 'success'
          )
    `;

    const { rows } = await pool.query(query);
    if (rows.length > 0) {
        console.log(`[Cron] Found ${rows.length} sessions for post-session therapist form.`);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://safestories-dashboard.vercel.app';

    for (const booking of rows) {
        try {
            const timeStr = formatTime(booking.booking_start_at);
            const shortLink = `${frontendUrl}/session-notes/${booking.booking_id}`;
            
            // Note: The template requires therapistPhone. If we don't have it, we shouldn't send, 
            // but we'll try with whatever is in booking_host_phone.
            if (booking.booking_host_phone) {
                await sendPostSessionTherapistForm(
                    booking.booking_id, 
                    booking.booking_host_phone, 
                    booking.booking_host_name || 'Therapist', 
                    booking.invitee_name || 'Client', 
                    timeStr, 
                    shortLink
                );
            } else {
                console.warn(`[Cron] Missing therapist phone for booking ${booking.booking_id}, skipping form.`);
            }
        } catch (err) {
            console.error(`[Cron] Failed to send post-session form for ${booking.booking_id}`, err);
        }
    }
}
