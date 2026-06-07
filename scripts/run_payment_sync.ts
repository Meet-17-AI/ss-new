import fetch from 'node-fetch';

async function syncPendingPayments() {
    try {
        const port = process.env.PORT || 3002;
        const url = `http://localhost:${port}/api/cron/verify-pending-payments`;
        console.log(`[Payment Sync Script] Checking pending payments at ${url}...`);
        
        const response = await fetch(url, { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            console.log(`[Payment Sync Script] Success: Confirmed ${data.confirmedCount}, Failed ${data.failedCount}`);
        } else {
            console.error('[Payment Sync Script] Error response:', data);
        }
    } catch (error: any) {
        console.error('[Payment Sync Script] Network error:', error.message);
    }
}

// Run immediately
syncPendingPayments();

// Then run every 10 minutes (600,000 ms)
setInterval(syncPendingPayments, 10 * 60 * 1000);
