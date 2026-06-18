import pool from './db.js';

interface WebhookApiLogInput {
  log_type: 'webhook_incoming' | 'webhook_outgoing' | 'api_outgoing';
  name: string;
  endpoint: string;
  method: string;
  status: 'success' | 'failed';
  request_payload?: any;
  response_data?: any;
  error_message?: string;
}

function maskSensitiveData(data: any): any {
  if (!data) return data;
  
  let clone;
  try {
    if (typeof data === 'string') {
      try {
        clone = JSON.parse(data);
      } catch (e) {
        return data;
      }
    } else {
      clone = JSON.parse(JSON.stringify(data));
    }
  } catch (e) {
    return data;
  }
  
  const sensitiveKeys = [
    'apikey', 'api_key', 'password', 'token', 'client_secret', 
    'secret', 'otp', 'google_client_id', 'google_client_secret',
    'google_refresh_token', 'refresh_token', 'access_token'
  ];
  
  const mask = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        mask(obj[key]);
      } else if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        obj[key] = '***';
      }
    }
  };
  
  mask(clone);
  return clone;
}

export async function logWebhookApi(data: WebhookApiLogInput) {
  try {
    const safePayload = data.request_payload ? maskSensitiveData(data.request_payload) : null;
    const safeResponse = data.response_data ? maskSensitiveData(data.response_data) : null;

    await pool.query(
      `INSERT INTO webhook_api_logs (log_type, name, endpoint, method, status, request_payload, response_data, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        data.log_type,
        data.name,
        data.endpoint,
        data.method,
        data.status,
        safePayload ? JSON.stringify(safePayload) : null,
        safeResponse ? JSON.stringify(safeResponse) : null,
        data.error_message || null
      ]
    );
  } catch (error) {
    console.error('[WebhookApiLogger] Failed to write log:', error);
  }
}
