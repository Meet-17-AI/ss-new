import { 
    sendBookingConfirmedClient, 
    sendBookingConfirmedAdmin,
    sendBookingRescheduledClient,
    sendBookingRescheduledTherapist,
    sendBookingCancelledRefundClient,
    sendBookingCancelledNoRefundClient
} from '../panel-backend/src/lib/aisensy';

const ADMIN_PHONE = "+917410713350";
const TEST_NAME = "Test User";

async function testAll() {
    console.log("1. Testing Booking Confirmed Client...");
    await sendBookingConfirmedClient(ADMIN_PHONE, TEST_NAME, "Test Therapy Session", "Friday, May 29, 2026 at 10:00 AM IST", "https://safestories-dashboard.vercel.app/test-link");

    console.log("2. Testing Booking Confirmed Admin...");
    await sendBookingConfirmedAdmin(ADMIN_PHONE, TEST_NAME, ADMIN_PHONE, "test@example.com", "Test Therapy Session", "Friday, May 29, 2026 at 10:00 AM IST", "Online Meet", "Test Therapist", "therapist@example.com");

    console.log("3. Testing Booking Rescheduled Client...");
    await sendBookingRescheduledClient(ADMIN_PHONE, TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST", "https://safestories-dashboard.vercel.app/test-link");

    console.log("4. Testing Booking Rescheduled Therapist...");
    await sendBookingRescheduledTherapist(ADMIN_PHONE, "Saturday, May 30, 2026 at 11:00 AM IST", TEST_NAME);

    console.log("5. Testing Booking Cancelled (Refund) Client...");
    await sendBookingCancelledRefundClient(ADMIN_PHONE, TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST");

    console.log("6. Testing Booking Cancelled (No Refund) Client...");
    await sendBookingCancelledNoRefundClient(ADMIN_PHONE, TEST_NAME, "Test Therapy Session", "Saturday, May 30, 2026 at 11:00 AM IST");

    console.log("All test messages dispatched!");
}

testAll().catch(console.error);
