-- Organization Settings (User Settings / Organization Settings split)
-- Date: 2026-08-06
--
-- NO SCHEMA CHANGE REQUIRED.
--
-- Organization settings are stored as rows in the existing admin_settings
-- key/value table, which already has PRIMARY KEY (setting_key) — so the
-- application's ON CONFLICT upsert works as-is. This file only seeds defaults
-- so the General tab is populated on first load instead of blank.
--
-- NOTE: admin_settings also holds 'active_gateway' and 'razorpay_key_id'.
-- The POST /api/org-settings endpoint writes only keys on an explicit
-- allowlist (org_*), so it cannot overwrite the payment keys.

INSERT INTO admin_settings (setting_key, setting_value, updated_at) VALUES
  ('org_name',          'SafeStories',            NOW()),
  ('org_logo_url',      '',                       NOW()),
  ('org_support_email', 'therapy@safestories.in', NOW()),
  ('org_support_phone', '',                       NOW()),
  ('org_address',       '',                       NOW()),
  ('org_website',       'https://safestories.in', NOW()),
  ('org_timezone',      'Asia/Kolkata',           NOW()),
  ('org_gstin',         '',                       NOW())
ON CONFLICT (setting_key) DO NOTHING;


-- OPTIONAL cleanup (safe to run, safe to skip).
-- Some stored media URLs still point at the retired s3.fluidjobs.ai MinIO host.
-- The frontend rewrites these on read (lib/mediaUrl.ts), so this is a tidy-up
-- rather than a fix. Run it if you want the stored data to match reality.
--
-- UPDATE therapists
-- SET profile_picture_url = REPLACE(profile_picture_url,
--       's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443')
-- WHERE profile_picture_url LIKE '%s3.fluidjobs.ai%';
--
-- UPDATE users
-- SET profile_picture_url = REPLACE(profile_picture_url,
--       's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443')
-- WHERE profile_picture_url LIKE '%s3.fluidjobs.ai%';
--
-- UPDATE therapist_details
-- SET profile_picture_url = REPLACE(profile_picture_url,
--       's3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443')
-- WHERE profile_picture_url LIKE '%s3.fluidjobs.ai%';


-- NON-SQL production step:
-- The MinIO bucket 'safestories-panel' needs an 'org-logos/' prefix with the
-- same public-read policy as 'profile-pictures/', for the logo upload in
-- Organization Settings → General.
