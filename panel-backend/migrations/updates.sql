ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE TABLE IF NOT EXISTS short_urls (
    id SERIAL PRIMARY KEY,
    short_code VARCHAR(10) UNIQUE NOT NULL,
    long_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- therapy_services schema additions (added for therapy calendar feature)
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS therapy_type TEXT;
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_payment_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS requires_tnc BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'Razorpay';
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS form_questions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS schedule_id INTEGER;

-- bookings: payment tracking columns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
