# Database Comparison Report (`safestories_db` vs `safestories_v2`)

Comparing **Database 1** (`safestories_db`) to **Database 2** (`safestories_v2`).

## 1. Missing Tables

### Tables missing in Database 1 (`safestories_db`):
- lead_sync_log
- form_field_values
- therapist_schedules
- duplicate_alerts
- therapy_services
- booking_to_lead_mapping
- interaction_log
- form_submissions
- form_draft_storage
- automation_logs
- admin_settings
- payment_settings
- autosave_activity
- migration_history
- webhook_api_logs
- short_urls


## 2. Missing Columns in Existing Tables

### Table: leads
- **Missing in DB 1:** pretherapy_completed_at, duplicate_of_lead_id, aisensy_interaction_type, source_aisensy, active_form_type, sync_status, is_duplicate, pretherapy_completed, last_interaction_type, last_autosave_at, booking_id, auto_progression_enabled, last_interaction_at

### Table: bookings
- **Missing in DB 1:** payment_id, refund_initiated_at, payment_status, google_event_id, booking_host_time, client_type, razorpay_order_id

### Table: payments
- **Missing in DB 1:** payment_screenshot, customer_details, payment_mode, failure_reason, razorpay_order_id, razorpay_payment_id, utr

### Table: therapists
- **Missing in DB 1:** google_access_token, google_refresh_token, is_active, google_token_expiry, availability

### Table: all_clients_table
- **Missing in DB 1:** client_type

## 3. Data Row Count Comparison

| Table Name | DB 1 (`safestories_db`) | DB 2 (`safestories_v2`) | Difference |
|---|---|---|---|
| admin_settings | N/A | 0 | N/A |
| aisensy_campaign_api | 13 | 13 | 0 |
| aisensy_leads | 84 | 84 | 0 |
| all_clients_table | 440 | 440 | 0 |
| appointment_table | 27 | 27 | 0 |
| audit_logs | 788 | 788 | 0 |
| automation_logs | N/A | 0 | N/A |
| autosave_activity | N/A | 0 | N/A |
| booking_cancelled | 1 | 0 | -1 |
| booking_lead_movement_log | 0 | 0 | 0 |
| booking_requests | 38 | 38 | 0 |
| booking_to_lead_mapping | N/A | 0 | N/A |
| bookings | 908 | 0 | -908 |
| client_additional_notes | 0 | 0 | 0 |
| client_case_history | 1 | 1 | 0 |
| client_doc_form | 372 | 0 | -372 |
| client_logs | 0 | 0 | 0 |
| client_progress_notes | 25 | 0 | -25 |
| client_session_notes | 16 | 0 | -16 |
| client_therapy_goals | 27 | 27 | 0 |
| client_transfer_history | 1 | 0 | -1 |
| crm_audit_logs | 3809 | 3809 | 0 |
| dashboard_api_booking | 49 | 49 | 0 |
| duplicate_alerts | N/A | 0 | N/A |
| form_draft_storage | N/A | 0 | N/A |
| form_field_values | N/A | 0 | N/A |
| form_submissions | N/A | 0 | N/A |
| free_consultation_pretherapy_notes | 0 | 0 | 0 |
| interaction_log | N/A | 0 | N/A |
| lead_notes | 0 | 0 | 0 |
| lead_sync_log | N/A | 0 | N/A |
| leads | 752 | 752 | 0 |
| masked_emails | 255 | 255 | 0 |
| migration_history | N/A | 0 | N/A |
| new_therapist_requests | 3 | 3 | 0 |
| notifications | 2657 | 2649 | -8 |
| password_reset_attempts | 6 | 6 | 0 |
| password_reset_tokens | 6 | 6 | 0 |
| payment_settings | N/A | 0 | N/A |
| payments | 22 | 0 | -22 |
| pretherapy_call_forms | 260 | 260 | 0 |
| refund_cancellation_table | 13 | 0 | -13 |
| report_issues | 1 | 1 | 0 |
| short_urls | N/A | 0 | N/A |
| sos_access_tokens | 5 | 5 | 0 |
| sos_risk_assessments | 5 | 5 | 0 |
| therapist_appointments_cache | 4 | 4 | 0 |
| therapist_clients_summary | 3 | 3 | 0 |
| therapist_dashboard_stats | 1 | 1 | 0 |
| therapist_details | 1 | 1 | 0 |
| therapist_resources | 16 | 16 | 0 |
| therapist_schedules | N/A | 0 | N/A |
| therapists | 7 | 7 | 0 |
| therapy_services | N/A | 0 | N/A |
| users | 9 | 9 | 0 |
| webhook_api_logs | N/A | 0 | N/A |
