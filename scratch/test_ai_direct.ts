import fetch from 'node-fetch';

const AISENSY_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGE1MjM4Njg5NTEwMGQ1MmYwMTBiNCIsIm5hbWUiOiJTYWZldHkgYW5kIFlvdSBXZWxsYmVpbmcgQ2VudHJlIExMUCIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2OGRhNTIzODY4OTUxMDBkNTJmMDEwYWYiLCJhY3RpdmVQbGFuIjoiRlJFRV9GT1JFVkVSIiwiaWF0IjoxNzU5MTM4MzYwfQ.PvyEtnljNQ9nTOaxciZvsGSm7kXi6F0NpHtMk3DYaAU";
const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

async function sendAiSensyMessage(campaignName: string, destination: string, userName: string, templateParams: string[]) {
    try {
        const payload = {
            apiKey: AISENSY_API_KEY,
            campaignName,
            destination: destination.replace(/[^0-9+]/g, ''),
            userName,
            source: "DaySchedule",
            templateParams: templateParams.map(p => String(p || ''))
        };

        const response = await fetch(AISENSY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log(`[AiSensy] Campaign '${campaignName}' sent to ${destination}. Response:`, text);
        return text;
    } catch (error) {
        console.error(`[AiSensy Error] Failed to send campaign '${campaignName}':`, error);
    }
}

const ADMIN_PHONE = "+917410713350";
const TEST_NAME = "Test User";

async function testAll() {
    console.log("1. Testing Booking Confirmed Client...");
    await sendAiSensyMessage("session_confirmed_message_api_campaign", ADMIN_PHONE, TEST_NAME, [TEST_NAME, "Test Therapy Session", "Friday, May 29, 2026 at 10:00 AM IST", "https://safestories-dashboard.vercel.app/test-link"]);

    console.log("2. Testing Booking Confirmed Admin...");
    await sendAiSensyMessage("session_confirmed_host_message_pabbly", ADMIN_PHONE, "Safestories", [TEST_NAME, ADMIN_PHONE, "test@example.com", "Test Therapy Session", "Friday, May 29, 2026 at 10:00 AM IST", "Online Meet", "Test Therapist", "therapist@example.com"]);

    console.log("3. Testing Booking Rescheduled Client...");
    await sendAiSensyMessage("rescheduled_session_client", ADMIN_PHONE, "", [TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST", "https://safestories-dashboard.vercel.app/test-link"]);

    console.log("4. Testing Booking Rescheduled Therapist...");
    await sendAiSensyMessage("session_rescheduled_therapist_", ADMIN_PHONE, "", ["Saturday, May 30, 2026 at 11:00 AM IST", TEST_NAME]);

    console.log("5. Testing Booking Cancelled (Refund) Client...");
    await sendAiSensyMessage("cancelsession_refund_message_temp_n8n", ADMIN_PHONE, TEST_NAME, [TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST"]);

    console.log("6. Testing Booking Cancelled (No Refund) Client...");
    await sendAiSensyMessage("cancelsession_nonrefund_message_temp_n8n", ADMIN_PHONE, TEST_NAME, [TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST"]);

    console.log("All test messages dispatched!");
}

testAll().catch(console.error);
