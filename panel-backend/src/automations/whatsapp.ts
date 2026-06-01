import fetch from 'node-fetch';
import { logAutomationSuccess, logAutomationFailure } from './logger';

const AISENSY_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGE1MjM4Njg5NTEwMGQ1MmYwMTBiNCIsIm5hbWUiOiJTYWZldHkgYW5kIFlvdSBXZWxsYmVpbmcgQ2VudHJlIExMUCIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2OGRhNTIzODY4OTUxMDBkNTJmMDEwYWYiLCJhY3RpdmVQbGFuIjoiRlJFRV9GT1JFVkVSIiwiaWF0IjoxNzU5MTM4MzYwfQ.PvyEtnljNQ9nTOaxciZvsGSm7kXi6F0NpHtMk3DYaAU";
const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

export async function sendAiSensyMessage(booking_id: string, campaignName: string, destination: string, userName: string, templateParams: string[]) {
    try {
        const cleanDestination = destination.replace(/[^0-9+]/g, '');
        const payload = {
            apiKey: AISENSY_API_KEY,
            campaignName,
            destination: cleanDestination,
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
        console.log(`[AiSensy Automation] Campaign '${campaignName}' sent to ${cleanDestination}. Response:`, text);
        
        let jsonRes;
        try { jsonRes = JSON.parse(text); } catch(e) { jsonRes = text; }
        
        if (response.ok) {
            await logAutomationSuccess(booking_id, `whatsapp_${campaignName}`, cleanDestination, jsonRes);
        } else {
            await logAutomationFailure(booking_id, `whatsapp_${campaignName}`, cleanDestination, `HTTP ${response.status}: ${text}`);
        }
        
        return text;
    } catch (error: any) {
        console.error(`[AiSensy Automation Error] Failed to send campaign '${campaignName}':`, error);
        await logAutomationFailure(booking_id, `whatsapp_${campaignName}`, destination, error.message || String(error));
    }
}

// 1. Booking confirmed client
export async function sendBookingConfirmedClient(booking_id: string, clientPhone: string, clientName: string, resourceName: string, inviteeTime: string, publicCheckinUrl: string) {
    return sendAiSensyMessage(
        booking_id,
        "session_confirmed_message_api_campaign",
        clientPhone,
        clientName,
        [clientName, resourceName, inviteeTime, publicCheckinUrl]
    );
}

// 2. Booking confirmed admin (Host)
export async function sendBookingConfirmedAdmin(booking_id: string, adminPhone: string, clientName: string, clientPhone: string, clientEmail: string, resourceName: string, hostTime: string, location: string, hostName: string, hostEmail: string) {
    return sendAiSensyMessage(
        booking_id,
        "session_confirmed_host_message_pabbly",
        adminPhone,
        "Safestories",
        [clientName, clientPhone, clientEmail, resourceName, hostTime, location, hostName, hostEmail]
    );
}

// 3. Booking rescheduled client
export async function sendBookingRescheduledClient(booking_id: string, clientPhone: string, clientName: string, resourceName: string, newTimeFormatted: string, shortLink: string) {
    return sendAiSensyMessage(
        booking_id,
        "rescheduled_session_client",
        clientPhone,
        "",
        [clientName, resourceName, newTimeFormatted, shortLink]
    );
}

// 4. Booking rescheduled therapist
export async function sendBookingRescheduledTherapist(booking_id: string, therapistPhone: string, newTimeFormatted: string, clientName: string) {
    return sendAiSensyMessage(
        booking_id,
        "session_rescheduled_therapist_",
        therapistPhone,
        "",
        [newTimeFormatted, clientName]
    );
}

// 5. Booking cancelled refund client
export async function sendBookingCancelledRefundClient(booking_id: string, clientPhone: string, clientName: string, subject: string, startAt: string) {
    return sendAiSensyMessage(
        booking_id,
        "cancelsession_refund_message_temp_n8n",
        clientPhone,
        clientName,
        [clientName, subject, startAt]
    );
}

// 6. Booking cancelled no refund client
export async function sendBookingCancelledNoRefundClient(booking_id: string, clientPhone: string, clientName: string, resourceName: string, inviteeTime: string) {
    return sendAiSensyMessage(
        booking_id,
        "cancelsession_nonrefund_message_temp_n8n",
        clientPhone,
        clientName,
        [clientName, resourceName, inviteeTime]
    );
}

// 7. Request Session Feedback
export async function sendSessionFeedbackRequest(booking_id: string, clientPhone: string, clientName: string, therapistName: string) {
    return sendAiSensyMessage(
        booking_id,
        "client_sessionfeedback",
        clientPhone,
        clientName,
        [clientName]
    );
}
