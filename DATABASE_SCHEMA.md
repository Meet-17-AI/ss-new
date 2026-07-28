# SafeStories Therapy Platform - Database Schema

## Overview
- **Total Tables**: 20
- **Total Foreign Keys**: 20
- **Database**: PostgreSQL

---

## Tables

### 1. users
**User Management**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| username | varchar(255) | NOT NULL |
| password | varchar(255) | NOT NULL |
| name | varchar(255) | NOT NULL |
| role | varchar(50) | DEFAULT 'admin' |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| therapist_id | varchar(50) | FK → therapists.therapist_id |
| full_name | varchar(255) | |

---

### 2. therapists
**Therapists Master Data**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| therapist_id | varchar(255) | NOT NULL, UNIQUE |
| name | varchar(255) | NOT NULL |
| specialization | text | |
| contact_info | varchar(255) | |
| sessions_booked | integer | DEFAULT 0 |
| capacity | integer | DEFAULT 0 |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |

---

### 3. bookings
**Main Bookings Data**

| Column | Type | Constraints |
|--------|------|-------------|
| invitee_id | text | |
| invitee_name | text | |
| invitee_phone | text | |
| invitee_email | text | |
| invitee_question | text | |
| invitee_token | text | |
| invitee_country | text | |
| invitee_city | text | |
| invitee_timezone | text | |
| invitee_created_at | timestamp | |
| invitee_cancelled_at | timestamp | |
| invitee_cancelled_reason | text | |
| invitee_status | text | |
| invitee_payment_reference_id | text | |
| invitee_payment_gateway | text | |
| invitee_payment_name | text | |
| invitee_payment_currency | text | |
| invitee_payment_amount | numeric | |
| booking_user_id | text | |
| booking_updated_at | timestamp | |
| booking_subject | text | |
| booking_status | text | |
| booking_resource_id | text | |
| booking_resource_type | text | |
| booking_resource_name | text | |
| booking_checkin_url | text | |
| booking_mode | text | |
| booking_joining_link | text | |
| booking_invitee_time | text | |
| booking_host_user_id | text | |
| booking_host_name | text | |
| booking_host_phone | text | |
| booking_host_email | text | |
| booking_start_at | timestamp | |
| booking_end_at | timestamp | |
| booking_duration | integer | |
| booking_cancelled_by | text | |
| booking_cancel_reason | text | |
| booking_id | text | |
| booking_account_id | text | |
| refund_amount | numeric | |
| refund_status | varchar(255) | |
| refund_failed_time | timestamp | |
| rescheduled_at | timestamp | |
| rescheduled_start_at | timestamp | |
| rescheduled_end_at | timestamp | |
| recheduled_from | timestamp | |
| emergency_contact_name | varchar(255) | |
| emergency_contact_relation | varchar(100) | |
| emergency_contact_number | varchar(20) | |
| therapist_id | varchar(255) | FK → therapists.therapist_id |
| refund_id | varchar(255) | |

---

### 4. booking_cancelled
**Booking Cancellations**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| booking_id | text | FK → bookings.booking_id |
| invitee_id | text | |
| invitee_name | text | |
| invitee_number | text | |
| invitee_email | text | |
| cancelled_at | timestamp | |
| cancelled_by | text | |
| cancel_reason | text | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |

---

### 5. booking_requests
**Booking Requests**

| Column | Type | Constraints |
|--------|------|-------------|
| request_id | integer | PRIMARY KEY, AUTO INCREMENT |
| client_name | varchar(255) | NOT NULL |
| client_whatsapp | varchar(20) | NOT NULL |
| client_email | varchar(255) | |
| therapy_type | varchar(255) | NOT NULL |
| therapist_name | varchar(255) | NOT NULL |
| booking_link | text | |
| status | varchar(50) | DEFAULT 'sent' |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| is_free_consultation | boolean | DEFAULT false |

---

### 6. client_session_notes
**Session Notes** (⚠️ No FK - has orphaned data)

| Column | Type | Constraints |
|--------|------|-------------|
| note_id | integer | PRIMARY KEY, AUTO INCREMENT |
| booking_id | text | |
| client_name | text | |
| session_timing | text | |
| host_name | text | |
| session_status | text | |
| client_age | integer | |
| gender | text | |
| occupation | text | |
| marital_status | text | |
| concerns_discussed | text | |
| somatic_cues | array | |
| interventions_used | text | |
| interventions_helpful | text | |
| client_participation | text | |
| goal_progress | text | |
| client_values | text | |
| self_harm_mention | text | |
| self_harm_details | text | |
| current_risk_level | text | |
| protective_factors | text | |
| health_history | text | |
| past_diagnoses | text | |
| next_session_plan | text | |
| homework_suggested | text | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP |

---

### 7. client_additional_notes
**Additional Notes**

| Column | Type | Constraints |
|--------|------|-------------|
| note_id | integer | PRIMARY KEY, AUTO INCREMENT |
| booking_id | text | NOT NULL, FK → bookings.booking_id |
| therapist_id | varchar(255) | FK → therapists.therapist_id |
| therapist_name | varchar(255) | |
| note_text | text | NOT NULL |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP |

---

### 8. client_doc_form
**Document Forms**

| Column | Type | Constraints |
|--------|------|-------------|
| link_id | integer | PRIMARY KEY, AUTO INCREMENT |
| booking_id | varchar(50) | FK → bookings.booking_id |
| paperform_link | text | |
| status | varchar(20) | |

---

### 9. client_transfer_history
**Client Transfer History**

| Column | Type | Constraints |
|--------|------|-------------|
| transfer_id | integer | PRIMARY KEY, AUTO INCREMENT |
| client_name | varchar(255) | NOT NULL |
| client_email | varchar(255) | |
| client_phone | varchar(50) | |
| from_therapist_id | varchar(50) | FK → therapists.therapist_id |
| from_therapist_name | varchar(255) | |
| to_therapist_id | varchar(50) | NOT NULL, FK → therapists.therapist_id |
| to_therapist_name | varchar(255) | NOT NULL |
| transferred_by_admin_id | integer | |
| transferred_by_admin_name | varchar(255) | |
| transfer_date | timestamp | DEFAULT CURRENT_TIMESTAMP |
| reason | text | |
| notes | text | |

---

### 10. payments
**Payments & Refunds**

| Column | Type | Constraints |
|--------|------|-------------|
| payment_id | integer | PRIMARY KEY, AUTO INCREMENT |
| booking_id | text | FK → bookings.booking_id |
| invitee_name | text | |
| invitee_email | text | |
| payment_reference_id | text | |
| amount | numeric | |
| currency | varchar(10) | |
| payment_date | timestamp | |
| payment_gateway_name | text | |
| refund_amount | numeric | |
| refund_initiation_date | timestamp | |
| refund_status | varchar(50) | |
| refund_failed_date | timestamp | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| updated_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| refund_id | varchar(255) | |

---

### 11. refund_cancellation_table
**Refund Cancellation Table**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| client_id | varchar(255) | FK → all_clients_table.client_id |
| client_name | varchar(255) | |
| session_id | varchar(255) | FK → bookings.booking_id, FK → appointment_table.session_id |
| session_name | varchar(255) | |
| session_timings | timestamp | |
| payment_id | varchar(255) | |
| refund_status | varchar(50) | |
| refund_id | varchar(255) | |

---

### 12. therapist_dashboard_stats
**Therapist Dashboard Cache**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| therapist_id | varchar(50) | NOT NULL, UNIQUE, FK → therapists.therapist_id |
| total_sessions | integer | DEFAULT 0 |
| confirmed_sessions | integer | DEFAULT 0 |
| cancelled_sessions | integer | DEFAULT 0 |
| no_shows | integer | DEFAULT 0 |
| upcoming_bookings | integer | DEFAULT 0 |
| last_updated | timestamp | DEFAULT now() |

---

### 13. therapist_clients_summary
**Therapist Clients Summary**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| therapist_id | varchar(50) | NOT NULL, FK → therapists.therapist_id |
| client_name | varchar(255) | |
| client_email | varchar(255) | |
| client_phone | varchar(50) | |
| total_sessions | integer | DEFAULT 0 |
| last_session_date | timestamp | |
| created_at | timestamp | DEFAULT now() |

---

### 14. therapist_appointments_cache
**Therapist Appointments Cache**

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| therapist_id | varchar(50) | NOT NULL, FK → therapists.therapist_id |
| session_timings | varchar(500) | |
| session_name | varchar(500) | |
| client_name | varchar(255) | |
| contact_info | varchar(100) | |
| mode | varchar(100) | |
| booking_date | timestamp | |
| booking_status | varchar(50) | |
| created_at | timestamp | DEFAULT now() |

---

### 15. therapist_resources
**Therapist Resources** (⚠️ No FK - has orphaned data)

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | PRIMARY KEY, AUTO INCREMENT |
| resource_id | integer | NOT NULL |
| resource_name | varchar(255) | NOT NULL |
| therapist_id | varchar(255) | NOT NULL |
| therapist_name | varchar(255) | |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP |
| therapy_name | varchar(255) | |

---

### 16. all_clients_table
**Admin Management - All Clients**

| Column | Type | Constraints |
|--------|------|-------------|
| client_id | varchar(255) | PRIMARY KEY, NOT NULL |
| client_name | varchar(255) | |
| phone_number | varchar(50) | |
| email_id | varchar(255) | |
| no_of_sessions | integer | DEFAULT 0 |
| therapist_id | varchar(255) | FK → therapists.therapist_id |
| assigned_therapist | varchar(255) | |

---

### 17. appointment_table
**Admin Management - Appointments**

| Column | Type | Constraints |
|--------|------|-------------|
| session_id | varchar(255) | PRIMARY KEY, NOT NULL |
| session_timings | timestamp | |
| session_name | varchar(255) | |
| session_mode | varchar(50) | |
| client_id | varchar(255) | FK → all_clients_table.client_id |
| client_name | varchar(255) | |
| contact_info | text | |
| therapist_id | varchar(255) | FK → therapists.therapist_id |
| therapist_name | varchar(255) | |

---

### 18. audit_logs
**Audit Logs**

| Column | Type | Constraints |
|--------|------|-------------|
| log_id | integer | PRIMARY KEY, AUTO INCREMENT |
| therapist_id | varchar(50) | FK → therapists.therapist_id |
| therapist_name | varchar(255) | |
| action_type | varchar(100) | NOT NULL |
| action_description | text | NOT NULL |
| client_name | varchar(255) | |
| ip_address | varchar(50) | |
| is_visible | boolean | DEFAULT true |
| timestamp | varchar(255) | DEFAULT get_ist_timestamp() |

---

### 19. notifications
**Notifications**

| Column | Type | Constraints |
|--------|------|-------------|
| notification_id | integer | PRIMARY KEY, AUTO INCREMENT |
| user_id | integer | FK → users.id |
| user_role | varchar(20) | NOT NULL |
| notification_type | varchar(100) | NOT NULL |
| title | varchar(255) | NOT NULL |
| message | text | NOT NULL |
| related_id | varchar(50) | |
| is_read | boolean | DEFAULT false |
| created_at | timestamp | DEFAULT CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata' |

---

### 20. aisensy_campaign_api
**Marketing Integration**

| Column | Type | Constraints |
|--------|------|-------------|
| campaign_name | varchar(255) | |
| therapy | varchar(255) | |
| therapist_name | varchar(255) | |

---

## Relationships (Foreign Keys)

### Therapist Relationships (11)
1. `users.therapist_id` → `therapists.therapist_id`
2. `bookings.therapist_id` → `therapists.therapist_id`
3. `therapist_dashboard_stats.therapist_id` → `therapists.therapist_id`
4. `therapist_clients_summary.therapist_id` → `therapists.therapist_id`
5. `therapist_appointments_cache.therapist_id` → `therapists.therapist_id`
6. `all_clients_table.therapist_id` → `therapists.therapist_id`
7. `appointment_table.therapist_id` → `therapists.therapist_id`
8. `client_transfer_history.from_therapist_id` → `therapists.therapist_id`
9. `client_transfer_history.to_therapist_id` → `therapists.therapist_id`
10. `client_additional_notes.therapist_id` → `therapists.therapist_id`
11. `audit_logs.therapist_id` → `therapists.therapist_id`

### Booking Relationships (5)
12. `client_additional_notes.booking_id` → `bookings.booking_id`
13. `payments.booking_id` → `bookings.booking_id`
14. `refund_cancellation_table.session_id` → `bookings.booking_id`
15. `booking_cancelled.booking_id` → `bookings.booking_id`
16. `client_doc_form.booking_id` → `bookings.booking_id`

### User Relationships (1)
17. `notifications.user_id` → `users.id`

### Client Relationships (2)
18. `appointment_table.client_id` → `all_clients_table.client_id`
19. `refund_cancellation_table.client_id` → `all_clients_table.client_id`

### Additional Relationships (1)
20. `refund_cancellation_table.session_id` → `appointment_table.session_id`

---

## Tables Without Foreign Keys

### Standalone Tables (2)
- **aisensy_campaign_api** - Uses therapist names instead of IDs
- **booking_requests** - Pre-booking tracking, intentionally not linked

### Tables with Orphaned Data (2)
- **client_session_notes** - Has orphaned `booking_id: 56430` (Pooja Jain session)
- **therapist_resources** - Has orphaned `therapist_id: 58605` (SafeStories system resources)

### Parent Table (1)
- **therapists** - Parent table with no foreign keys

---

## Summary

- **Total Tables**: 20
- **Total Foreign Keys**: 20
- **Parent Tables**: 5 (therapists, bookings, users, all_clients_table, appointment_table)
- **Tables with FKs**: 15
- **Standalone Tables**: 5

---

**Last Updated**: January 2026
**Database**: PostgreSQL (safestories_db)
**Host**: <DB-HOST>:5432
