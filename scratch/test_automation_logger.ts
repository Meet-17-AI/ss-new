import { sendBookingConfirmedClient } from '../panel-backend/src/automations/whatsapp.ts';
import pool from '../panel-backend/src/lib/db.ts';

const ADMIN_PHONE = "+917410713350";
const TEST_NAME = "Test User DB Logger";
const TEST_BOOKING_ID = "test-log-12345";

async function testLogging() {
    console.log("Dispatching test WhatsApp message through wrapped automation...");
    
    // We intentionally pass a dummy booking ID to track it in DB
    await sendBookingConfirmedClient(
        TEST_BOOKING_ID,
        ADMIN_PHONE, 
        TEST_NAME, 
        "Test Therapy Session", 
        "Friday, May 29, 2026 at 10:00 AM IST", 
        "https://safestories-dashboard.vercel.app/test-link"
    );

    console.log("Message sent. Checking automation_logs table...");
    
    // Allow a brief moment for async DB logging to complete
    await new Promise(r => setTimeout(r, 1000));
    
    const res = await pool.query("SELECT * FROM automation_logs WHERE booking_id = $1", [TEST_BOOKING_ID]);
    
    console.log(`Found ${res.rows.length} log entry(s):`);
    console.dir(res.rows, { depth: null });
    
    await pool.end();
}

testLogging().catch(console.error);
