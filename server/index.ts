import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import { randomUUID } from 'crypto';
import pool from '../lib/db';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { convertToIST } from '../lib/timezone';
import { startDashboardApiBookingSync } from './dashboardApiBookingSync';
import { uploadFile } from '../lib/minio';
import { sendOTPEmail, sendPasswordResetOTP, sendSOSEmailAlert } from '../lib/email';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit (reasonable for profile pictures)
  }
});

// Helper function to get current IST timestamp as formatted string
const getCurrentISTTimestamp = () => {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' IST';
};

const REMARK_COLUMN_MAP: Record<string, string> = {
  'lead-inquire': 'remark_lead_inquire',
  'followup-1': 'remark_followup_1',
  'pretherapy-call': 'remark_pretherapy_call',
  'booked-first-session': 'remark_booked_first_session',
  'dropouts': 'remark_unresponsive',
  'leaks': 'remark_leaks',
  'referred': 'remark_referred',
  'closed': 'remark_closed',
};

const TIMESTAMP_COLUMN_MAP: Record<string, string> = {
  'lead-inquire': 'stage_lead_inquire_at',
  'followup-1': 'stage_followup_1_at',
  'followup-2': 'stage_followup_2_at',
  'followup-3': 'stage_followup_3_at',
  'pretherapy-call': 'stage_pretherapy_call_at',
  'booked-first-session': 'stage_booked_first_session_at',
  'dropouts': 'stage_dropouts_at',
  'leaks': 'stage_leaks_at',
  'referred': 'stage_referred_at',
  'closed': 'stage_closed_at',
};

const app = express();
app.use(cors());
app.use(express.json());

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Check if user account is active
      if (user.is_active === false) {
        return res.status(403).json({ 
          success: false, 
          message: 'Your account has been disabled. Please contact support.' 
        });
      }

      // Role-based access control based on request origin
      const origin = req.headers.origin || req.headers.referer || '';
      const isCRM = origin.includes('crm.safestories.in') || origin.includes('localhost:5173');
      const isDashboard = origin.includes('panel.safestories.in') || origin.includes('localhost:5174');
      
      console.log(`🔐 Login attempt - Origin: ${origin}, User: ${username}, Role: ${user.role}, isCRM: ${isCRM}, isDashboard: ${isDashboard}`);
      
      // If we can't determine origin, reject for security
      if (!isCRM && !isDashboard && origin) {
        console.log(`⚠️  Unknown origin: ${origin}`);
      }
      
      // CRM: Only sales role can login
      if (isCRM && user.role !== 'sales') {
        console.log(`❌ CRM login blocked for role: ${user.role}`);
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials' 
        });
      }
      
      // Dashboard: Only admin and therapist roles can login
      if (isDashboard && user.role !== 'admin' && user.role !== 'therapist') {
        console.log(`❌ Dashboard login blocked for role: ${user.role}`);
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials' 
        });
      }
      
      console.log(`✅ Login successful for ${username} (${user.role})`);


      // For therapists, check their approval status and fetch schedule_id
      if (user.role === 'therapist' && user.therapist_id) {
        try {
          // Check therapist status in therapists table
          const therapistCheck = await pool.query(
            'SELECT status FROM therapists WHERE therapist_id = $1',
            [user.therapist_id]
          );

          if (therapistCheck.rows.length > 0) {
            const status = therapistCheck.rows[0].status;
            user.profileStatus = status; // 'pending_review' or 'approved'
            user.needsProfileCompletion = false;
            console.log(`✅ Therapist ${user.therapist_id} status: ${status}`);
          } else {
            // Fallback: check therapist_details table
            const detailsCheck = await pool.query(
              'SELECT status FROM therapist_details WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1',
              [user.email]
            );

            if (detailsCheck.rows.length > 0) {
              user.profileStatus = detailsCheck.rows[0].status;
              user.needsProfileCompletion = false;
            }
          }

          // NEW: Fetch schedule_id from therapist_resources
          const resourceCheck = await pool.query(
            'SELECT MAX(schedule_id) as schedule_id FROM therapist_resources WHERE therapist_id = $1',
            [user.therapist_id]
          );
          if (resourceCheck.rows.length > 0) {
            user.scheduleId = resourceCheck.rows[0].schedule_id;
            console.log(`✅ Found scheduleId for therapist: ${user.scheduleId}`);
          }
        } catch (statusError) {
          console.error('Error checking therapist status/resources:', statusError);
        }
      }

      // Log therapist login
      if (user.role === 'therapist') {
        try {
          await pool.query(
            `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, timestamp, is_visible)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [user.therapist_id, username, 'login', `${username} logged into dashboard`, getCurrentISTTimestamp()]
          );
        } catch (auditError) {
          console.error('❌ Failed to create audit log for login:', auditError);
        }
      }

      res.json({ success: true, user });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Verify password endpoint (for case history access)
app.post('/api/verify-password', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// Change password endpoint
app.post('/api/change-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const result = await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
      [newPassword, userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, message: 'Password changed successfully' });
    } else {
      res.status(404).json({ success: false, error: 'User not found' });
    }
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// Save new therapist request with OTP
app.post('/api/new-therapist-requests', async (req, res) => {
  try {
    const { therapistName, whatsappNumber, email, specializations, specializationDetails } = req.body;

    // Generate 6-digit OTP
    const otpToken = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiry to 24 hours from now
    const otpExpiresAt = new Date();
    otpExpiresAt.setHours(otpExpiresAt.getHours() + 24);

    const result = await pool.query(
      `INSERT INTO new_therapist_requests (therapist_name, whatsapp_number, email, specializations, specialization_details, otp_token, otp_expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [therapistName, whatsappNumber, email, specializations, JSON.stringify(specializationDetails), otpToken, otpExpiresAt]
    );

    // Send OTP email to therapist
    try {
      await sendOTPEmail(email, therapistName, otpToken, otpExpiresAt);
      console.log(`✅ Therapist onboarding OTP sent to: ${email}`);
    } catch (emailError) {
      console.error('❌ Failed to send therapist onboarding email:', emailError);
      // Continue anyway - OTP is saved in database
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error saving new therapist request:', error);
    res.status(500).json({ success: false, error: 'Failed to save new therapist request' });
  }
});

// Verify therapist OTP
app.post('/api/verify-therapist-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const result = await pool.query(
      `SELECT * FROM new_therapist_requests 
       WHERE LOWER(email) = LOWER($1) AND otp_token = $2 AND status = 'pending'`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or OTP' });
    }

    const request = result.rows[0];

    // Check if OTP is expired
    const now = new Date();
    const expiresAt = new Date(request.otp_expires_at);

    if (now > expiresAt) {
      await pool.query(
        `UPDATE new_therapist_requests SET status = 'expired' WHERE request_id = $1`,
        [request.request_id]
      );
      return res.status(401).json({ success: false, error: 'OTP has expired' });
    }

    // Return therapist request data for pre-filling
    let specializationDetails = [];
    try {
      specializationDetails = typeof request.specialization_details === 'string'
        ? JSON.parse(request.specialization_details || '[]')
        : (Array.isArray(request.specialization_details) ? request.specialization_details : []);
    } catch (parseError) {
      console.error('Error parsing specialization_details:', parseError);
      specializationDetails = [];
    }

    res.json({
      success: true,
      data: {
        requestId: request.request_id,
        name: request.therapist_name,
        email: request.email,
        phone: request.whatsapp_number,
        specializations: request.specializations,
        specializationDetails: specializationDetails
      }
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

// Complete therapist profile
app.post('/api/complete-therapist-profile', async (req, res) => {
  try {
    const {
      requestId,
      name,
      email,
      phone,
      specializations,
      specializationDetails,
      qualification,
      qualificationPdfUrl,
      profilePictureUrl,
      password
    } = req.body;

    console.log('📝 Complete profile request:', { requestId, name, email, phone, specializations });

    if (!name || !email || !phone || !password) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ success: false, error: 'All required fields must be provided' });
    }

    // Check if therapist details already exist for this email
    console.log('🔍 Checking for existing details...');
    const existingDetails = await pool.query(
      `SELECT * FROM therapist_details WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (existingDetails.rows.length > 0) {
      console.log('❌ Therapist details already exist:', email);
      return res.status(400).json({ success: false, error: 'Profile already submitted for this email' });
    }

    // Serialize specialization details as JSON
    const specializationDetailsJson = specializationDetails ? JSON.stringify(specializationDetails) : '[]';
    console.log('📦 Serialized specialization details:', specializationDetailsJson);

    // Insert into therapist_details table
    console.log('💾 Inserting into therapist_details table...');
    console.log('Values:', {
      requestId, name, email, phone, specializations,
      specializationDetailsJson, qualification,
      qualificationPdfUrl, profilePictureUrl, password
    });

    const detailsResult = await pool.query(
      `INSERT INTO therapist_details (
        request_id, name, email, phone, specializations,
        specialization_details, qualification, qualification_pdf_url,
        profile_picture_url, password, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_review')
       RETURNING *`,
      [
        requestId, name, email, phone, specializations,
        specializationDetailsJson, qualification || null,
        qualificationPdfUrl || null, profilePictureUrl || null, password
      ]
    );

    const details = detailsResult.rows[0];
    console.log('✅ Therapist details saved:', details.id);

    // Generate unique therapist_id
    console.log('🔑 Generating therapist_id...');
    const generateTherapistId = (name: string): string => {
      const firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `${firstName}${randomNum}`;
    };

    let therapistId = generateTherapistId(name);
    let attempts = 0;
    while (attempts < 10) {
      const existingId = await pool.query(
        'SELECT therapist_id FROM therapists WHERE therapist_id = $1',
        [therapistId]
      );
      if (existingId.rows.length === 0) break;
      therapistId = generateTherapistId(name);
      attempts++;
    }
    console.log('✅ Generated therapist_id:', therapistId);

    // Create entry in therapists table with status='pending_review'
    console.log('👨‍⚕️ Creating therapist entry...');
    try {
      await pool.query(`
        INSERT INTO therapists (
          therapist_id, name, contact_info, phone_number,
          specialization, specialization_details,
          qualification_pdf_url, profile_picture_url, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review')
      `, [
        therapistId,
        name,
        email,
        phone,
        specializations,
        specializationDetailsJson,
        qualificationPdfUrl,
        profilePictureUrl
      ]);
      console.log('✅ Therapist entry created with status: pending_review');
    } catch (therapistError) {
      console.error('⚠️ Error creating therapist entry:', therapistError);
      throw therapistError; // This is critical, so throw error
    }

    // Create user account for login (email + password)
    console.log('👤 Creating user account...');
    try {
      // Check if user already exists
      const existingUser = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      if (existingUser.rows.length === 0) {
        // Create new user account with therapist_id
        await pool.query(
          `INSERT INTO users (username, password, name, email, role, full_name, phone, profile_picture_url, therapist_id, created_at)
           VALUES ($1, $2, $3, $4, 'therapist', $5, $6, $7, $8, NOW())`,
          [email, password, name, email, name, phone, profilePictureUrl, therapistId]
        );
        console.log('✅ User account created for:', email, 'with therapist_id:', therapistId);
      } else {
        // Update existing user with new password and therapist_id
        await pool.query(
          `UPDATE users SET password = $1, name = $2, full_name = $3, phone = $4, profile_picture_url = $5, therapist_id = $6
           WHERE LOWER(email) = LOWER($7)`,
          [password, name, name, phone, profilePictureUrl, therapistId, email]
        );
        console.log('✅ User account updated for:', email, 'with therapist_id:', therapistId);
      }
    } catch (userError) {
      console.error('⚠️ Error creating user account:', userError);
      throw userError; // This is critical, so throw error
    }

    // Update new_therapist_requests status
    console.log('💾 Updating request status...');
    await pool.query(
      `UPDATE new_therapist_requests SET status = 'profile_submitted' WHERE request_id = $1`,
      [requestId]
    );
    console.log('✅ Request status updated');

    // Send data to n8n webhook
    console.log('🔔 Sending data to webhook...');
    try {
      const webhookUrl = process.env.N8N_WEBHOOK_ISSUE_REPORT;
      const webhookPayload = {
        id: details.id,
        request_id: details.request_id,
        therapist_id: therapistId,
        name: details.name,
        email: details.email,
        phone: details.phone,
        specializations: details.specializations,
        specialization_details: details.specialization_details,
        qualification: details.qualification,
        qualification_pdf_url: details.qualification_pdf_url,
        profile_picture_url: details.profile_picture_url,
        status: details.status,
        created_at: details.created_at,
        updated_at: details.updated_at
      };

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload)
      });

      if (webhookResponse.ok) {
        console.log('✅ Webhook notification sent successfully');
      } else {
        console.error('⚠️ Webhook notification failed:', webhookResponse.status, webhookResponse.statusText);
      }
    } catch (webhookError) {
      console.error('⚠️ Error sending webhook notification:', webhookError);
      // Don't fail the entire request if webhook fails
    }

    console.log('🎉 Profile submission successful!');
    res.json({
      success: true,
      message: 'Profile submitted successfully! Your profile will be reviewed by admin within 5-10 days.',
      detailsId: details.id
    });
  } catch (error) {
    console.error('❌ Error completing therapist profile:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);

    // Send more specific error message
    const errorMessage = error.code === '23505' ? 'Email already exists' :
      error.code === '23503' ? 'Invalid request ID' :
        error.message || 'Failed to complete profile';

    res.status(500).json({ success: false, error: errorMessage, details: error.message });
  }
});

// Check if therapist details exist
app.get('/api/check-therapist-details', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ exists: false, error: 'Email is required' });
    }

    const result = await pool.query(
      `SELECT id FROM therapist_details WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    res.json({ exists: result.rows.length > 0 });
  } catch (error) {
    console.error('Error checking therapist details:', error);
    res.status(500).json({ exists: false, error: 'Failed to check profile status' });
  }
});

// Check therapist availability (for public booking links)
app.get('/api/therapist-availability', async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name) {
      return res.status(400).json({ error: 'Therapist name is required' });
    }

    // Check if user exists and is active
    const result = await pool.query(
      'SELECT is_active FROM users WHERE LOWER(full_name) = LOWER($1) AND role = $2',
      [name, 'therapist']
    );

    if (result.rows.length === 0) {
      // Therapist not found in users table, allow booking (might be external)
      return res.json({ isDisabled: false });
    }

    const isDisabled = result.rows[0].is_active === false;
    res.json({ isDisabled });
  } catch (error) {
    console.error('Error checking therapist availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// Get therapist profile
app.get('/api/therapist-profile', async (req, res) => {
  try {
    const { therapist_id, email } = req.query;

    if (!therapist_id && !email) {
      return res.status(400).json({ error: 'Therapist ID or email is required' });
    }

    // First try to get from therapists table (approved therapists)
    let result;
    if (therapist_id) {
      result = await pool.query(
        `SELECT * FROM therapists WHERE therapist_id = $1`,
        [therapist_id]
      );
    }

    // If not found in therapists table, check therapist_details (pending approval)
    if (!result || result.rows.length === 0) {
      if (email) {
        result = await pool.query(
          `SELECT * FROM therapist_details WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1`,
          [email]
        );

        if (result.rows.length > 0) {
          // Map therapist_details fields to match therapists table structure
          const details = result.rows[0];
          const mappedData = {
            therapist_id: null,
            name: details.name,
            contact_info: details.email,
            email: details.email,
            phone_number: details.phone,
            specialization: details.specializations,
            specialization_details: details.specialization_details,
            qualification: details.qualification,
            qualification_pdf_url: details.qualification_pdf_url,
            profile_picture_url: details.profile_picture_url,
            status: details.status
          };
          return res.json({ success: true, data: mappedData });
        }
      }
    }

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching therapist profile:', error);
    res.status(500).json({ error: 'Failed to fetch therapist profile' });
  }
});

// Upload file endpoint (profile picture or qualification PDF)
app.post('/api/upload-file', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('❌ Multer error:', err);
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}`
      });
    } else if (err) {
      console.error('❌ Unknown upload error:', err);
      return res.status(500).json({
        success: false,
        error: 'File upload failed'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { folder } = req.body; // 'profile-pictures', 'qualification-pdfs', or 'issue-screenshots'

    if (!folder || !['profile-pictures', 'qualification-pdfs', 'issue-screenshots'].includes(folder)) {
      return res.status(400).json({ success: false, error: 'Invalid folder specified' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}-${originalName}`;

    // Upload to MinIO
    const fileUrl = await uploadFile(
      req.file.buffer,
      fileName,
      folder as 'profile-pictures' | 'qualification-pdfs' | 'issue-screenshots',
      req.file.mimetype
    );

    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload file';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Report issue endpoint
app.post('/api/report-issue', async (req, res) => {
  try {
    const { subject, component, description, screenshot_url, reported_by, user_role } = req.body;

    if (!subject || !component || !description || !reported_by || !user_role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO report_issues (subject, component, description, screenshot_url, reported_by, user_role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', CURRENT_TIMESTAMP)
       RETURNING id`,
      [subject, component, description, screenshot_url, reported_by, user_role]
    );

    res.json({ success: true, issueId: result.rows[0].id });
  } catch (error) {
    console.error('Error reporting issue:', error);
    res.status(500).json({ error: 'Failed to report issue' });
  }
});

// Update therapist profile
app.put('/api/therapist-profile', async (req, res) => {
  try {
    const {
      therapist_id,
      name,
      email,
      phone,
      specializations,
      qualificationPdfUrl,
      profilePictureUrl
    } = req.body;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    const result = await pool.query(
      `UPDATE therapists 
       SET name = $1, contact_info = $2, phone_number = $3, specialization = $4,
           qualification_pdf_url = $5, profile_picture_url = $6
       WHERE therapist_id = $7
       RETURNING *`,
      [name, email, phone, specializations, qualificationPdfUrl, profilePictureUrl, therapist_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapist profile:', error);
    res.status(500).json({ error: 'Failed to update therapist profile' });
  }
});

// ==================== CRM ENDPOINTS ====================

app.get('/api/leads', async (req, res) => {
  try {
    const query = `
            SELECT 
                leads.*,
                COALESCE(sales.full_name, sales.name) as sales_agent_name,
                COALESCE(therapists.full_name, therapists.name) as therapist_name,
                ptcf.consultation_outcome
            FROM leads
            LEFT JOIN users sales ON leads.sales_agent_id::text = sales.id::text
            LEFT JOIN users therapists ON (leads.therapist_id::text = therapists.id::text OR leads.therapist_id::text = therapists.therapist_id::text)
            LEFT JOIN (
                SELECT DISTINCT ON (lead_id) lead_id, consultation_outcome 
                FROM pretherapy_call_forms 
                ORDER BY lead_id, submitted_at DESC
            ) ptcf ON leads.id::text = ptcf.lead_id::text
            ORDER BY leads.created_at DESC
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params;

  // Handle virtual profiles for clients not yet in leads table
  if (id.startsWith('temp:')) {
    const identifier = id.split(':')[1];
    console.log(`[DEBUG] Received request for virtual profile. Identifier: ${identifier}`);
    
    try {
      // Use a more aggressive query to find the client. 
      // We check by: exact invitee_id, exact phone, exact email, and fuzzy phone.
      // Also try to parse identifier as a number for matching against row IDs if it's small.
      const isNumeric = /^\d+$/.test(identifier);
      const rowIdSearch = isNumeric ? `OR booking_id = $1` : ''; // Use booking_id if numeric

      const result = await pool.query(`
        SELECT 
          invitee_name as name,
          invitee_phone as phone,
          invitee_email as email,
          booking_host_name as therapist_name,
          booking_start_at as created_at,
          invitee_question as client_remark
        FROM bookings
        WHERE invitee_id = $1 
           OR invitee_phone = $1 
           OR invitee_email = $1
           OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
           ${rowIdSearch}
        ORDER BY booking_start_at DESC
        LIMIT 1
      `, [identifier]);

      console.log(`[DEBUG] Virtual profile search result: ${result.rows.length} rows found.`);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found in bookings' });
      }

      const client = result.rows[0];
      return res.json({
        ...client,
        id: id,
        is_virtual: true,
        pipeline_stage: 'lead-inquire',
        status: 'Booking Only',
        source: 'Booking System'
      });
    } catch (err) {
      console.error('Error fetching virtual lead:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  try {
    const query = `
            SELECT 
                leads.*,
                COALESCE(sales.full_name, sales.name) as sales_agent_name,
                COALESCE(therapists.full_name, therapists.name) as therapist_name
            FROM leads
            LEFT JOIN users sales ON leads.sales_agent_id::text = sales.id::text
            LEFT JOIN users therapists ON (leads.therapist_id::text = therapists.id::text OR leads.therapist_id::text = therapists.therapist_id::text)
            WHERE leads.id::text = $1
        `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = result.rows[0];

    // Fetch client remarks from bookings table (invitee_question) using lead phone
    try {
      if (lead.phone) {
        const phoneDigits = lead.phone.replace(/\\D/g, '');
        let bookingQuery = `SELECT invitee_question FROM bookings WHERE booking_id = '47361' AND invitee_phone = $1 AND invitee_question IS NOT NULL AND btrim(invitee_question) != '' LIMIT 1`;
        let queryParams = [lead.phone];

        if (phoneDigits.length >= 10) {
          const tenDigits = phoneDigits.slice(-10);
          bookingQuery = `SELECT invitee_question FROM bookings WHERE booking_id = '47361' AND invitee_phone LIKE $1 AND invitee_question IS NOT NULL AND btrim(invitee_question) != '' LIMIT 1`;
          queryParams = [`%${tenDigits}%`];
        }

        const bookingResult = await pool.query(bookingQuery, queryParams);
        if (bookingResult.rows.length > 0) {
          lead.client_remark = bookingResult.rows[0].invitee_question;
        }
      }
    } catch (bookingErr) {
      console.error('Error fetching booking notes:', bookingErr);
    }

    res.json(lead);
  } catch (err) {
    console.error('Error fetching lead:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert virtual profile to a real lead
app.post('/api/leads/convert-virtual', async (req, res) => {
  const { name, phone, email, source } = req.body;
  try {
    // Check if lead already exists by phone or email
    const exists = await pool.query('SELECT id FROM leads WHERE phone = $1 OR email = $2', [phone, email]);
    if (exists.rows.length > 0) {
      return res.json(exists.rows[0]);
    }

    const result = await pool.query(`
      INSERT INTO leads (name, phone, email, source, status, pipeline_stage, created_at)
      VALUES ($1, $2, $3, $4, 'New', 'lead-inquire', NOW())
      RETURNING *
    `, [name, phone, email, source || 'Booking System']);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error converting virtual lead:', err);
    res.status(500).json({ error: 'Failed to create lead record' });
  }
});

app.patch('/api/leads/:id/stage', async (req, res) => {
  const { id } = req.params;
  const { pipeline_stage, remark, follow_up_date } = req.body;
  if (!pipeline_stage) {
    return res.status(400).json({ error: 'pipeline_stage is required' });
  }

  try {
    // Fetch current stage + contact info for therapist lookup
    const currentLeadRes = await pool.query(
      'SELECT pipeline_stage, remark_followup_1, remark_followup_2, remark_followup_3, phone, email, therapist_id FROM leads WHERE id::text = $1',
      [id]
    );
    if (currentLeadRes.rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

    const currentLead = currentLeadRes.rows[0];
    let remarkCol = REMARK_COLUMN_MAP[pipeline_stage];
    let tsCol = TIMESTAMP_COLUMN_MAP[pipeline_stage];

    // Slot-cycling logic for "Follow ups" stage
    if (pipeline_stage === 'followup-1' && currentLead.pipeline_stage === 'followup-1') {
      if (!currentLead.remark_followup_1) {
        remarkCol = 'remark_followup_1';
        tsCol = 'stage_followup_1_at';
      } else if (!currentLead.remark_followup_2) {
        remarkCol = 'remark_followup_2';
        tsCol = 'stage_followup_2_at';
      } else {
        remarkCol = 'remark_followup_3';
        tsCol = 'stage_followup_3_at';
      }
    }

    // When moving to booked-first-session, auto-lookup therapist from bookings table
    let therapistIdToSet: number | null = null;
    let therapistLookupLog = '';
    
    if (pipeline_stage === 'booked-first-session' && !currentLead.therapist_id) {
      const phone = (currentLead.phone || '').replace(/[\s\-\(\)\+]/g, '');
      const email = (currentLead.email || '').toLowerCase().trim();
      
      therapistLookupLog += `Therapist lookup for lead ${id} - Phone: ${phone}, Email: ${email}\n`;
      
      if (phone || email) {
        // Strategy 1: Phone OR Email match (improved logic)
        let bookingRes = await pool.query(
          `SELECT u.id as user_id, b.booking_host_name, t.name as therapist_name, b.booking_start_at
           FROM bookings b
           LEFT JOIN therapists t ON LOWER(TRIM(b.booking_host_name)) = LOWER(TRIM(t.name))
           LEFT JOIN users u ON u.therapist_id = t.therapist_id
           WHERE (
             ($1 != '' AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10))
             OR ($2 != '' AND LOWER(TRIM(b.invitee_email)) = $2)
           )
           AND b.booking_host_name IS NOT NULL
           AND t.name IS NOT NULL
           AND u.id IS NOT NULL
           ORDER BY b.booking_start_at DESC
           LIMIT 1`,
          [phone || '', email || '']
        );
        
        therapistLookupLog += `Strategy 1 (Phone OR Email): Found ${bookingRes.rows.length} results\n`;
        
        // Strategy 2: Partial name match if exact fails
        if (bookingRes.rows.length === 0 && phone) {
          bookingRes = await pool.query(
            `SELECT u.id as user_id, b.booking_host_name, t.name as therapist_name, b.booking_start_at
             FROM bookings b
             LEFT JOIN therapists t ON (
               LOWER(TRIM(b.booking_host_name)) ILIKE '%' || LOWER(TRIM(SPLIT_PART(t.name, ' ', 1))) || '%'
               OR LOWER(TRIM(t.name)) ILIKE '%' || LOWER(TRIM(SPLIT_PART(b.booking_host_name, ' ', 1))) || '%'
             )
             LEFT JOIN users u ON u.therapist_id = t.therapist_id
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
             AND b.booking_host_name IS NOT NULL
             AND t.name IS NOT NULL
             AND u.id IS NOT NULL
             ORDER BY b.booking_start_at DESC
             LIMIT 1`,
            [phone]
          );
          
          therapistLookupLog += `Strategy 2 (Partial match): Found ${bookingRes.rows.length} results\n`;
        }
        
        // Strategy 3: Direct user lookup (fallback)
        if (bookingRes.rows.length === 0 && phone) {
          bookingRes = await pool.query(
            `SELECT u.id as user_id, b.booking_host_name, u.name as user_name, b.booking_start_at
             FROM bookings b
             LEFT JOIN users u ON (
               LOWER(TRIM(u.name)) = LOWER(TRIM(b.booking_host_name))
               OR LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.booking_host_name))
             )
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
             AND b.booking_host_name IS NOT NULL
             AND u.id IS NOT NULL
             AND u.role = 'therapist'
             ORDER BY b.booking_start_at DESC
             LIMIT 1`,
            [phone]
          );
          
          therapistLookupLog += `Strategy 3 (Direct user): Found ${bookingRes.rows.length} results\n`;
        }
        
        if (bookingRes.rows.length > 0) {
          therapistIdToSet = bookingRes.rows[0].user_id;
          therapistLookupLog += `SUCCESS: Assigned therapist ID ${therapistIdToSet} (${bookingRes.rows[0].booking_host_name})\n`;
        } else {
          therapistLookupLog += `FAILED: No therapist found for this lead\n`;
        }
        
        // Log the result for debugging
        console.log(`Therapist assignment for lead ${id}:`, therapistLookupLog);
      } else {
        therapistLookupLog += `SKIPPED: No phone or email available\n`;
      }
    }

    const timestampUpdate = tsCol ? `, ${tsCol} = NOW()` : '';
    const therapistUpdate = therapistIdToSet ? `, therapist_id = ${therapistIdToSet}` : '';
    let query, values;

    if (remarkCol && remark) {
      if (follow_up_date && pipeline_stage === 'followup-1') {
        query = `UPDATE leads SET pipeline_stage = $1, ${remarkCol} = $2${timestampUpdate}${therapistUpdate}, follow_up_1_date = $4, updated_at = NOW() WHERE id::text = $3 RETURNING *`;
        values = [pipeline_stage, remark, id, follow_up_date];
      } else {
        query = `UPDATE leads SET pipeline_stage = $1, ${remarkCol} = $2${timestampUpdate}${therapistUpdate}, updated_at = NOW() WHERE id::text = $3 RETURNING *`;
        values = [pipeline_stage, remark, id];
      }
    } else {
      if (follow_up_date && pipeline_stage === 'followup-1') {
        query = `UPDATE leads SET pipeline_stage = $1${timestampUpdate}${therapistUpdate}, follow_up_1_date = $3, updated_at = NOW() WHERE id::text = $2 RETURNING *`;
        values = [pipeline_stage, id, follow_up_date];
      } else {
        query = `UPDATE leads SET pipeline_stage = $1${timestampUpdate}${therapistUpdate}, updated_at = NOW() WHERE id::text = $2 RETURNING *`;
        values = [pipeline_stage, id];
      }
    }

    await pool.query(query, values);

    // Return lead enriched with resolved therapist_name
    const enriched = await pool.query(
      `SELECT leads.*, COALESCE(u.full_name, u.name) as therapist_name
       FROM leads
       LEFT JOIN users u ON leads.therapist_id::text = u.id::text
       WHERE leads.id::text = $1`,
      [id]
    );

    // Create audit log for stage change
    try {
      const leadData = enriched.rows[0];
      const stageNames: Record<string, string> = {
        'lead-inquire': 'Lead Inquire',
        'followup-1': 'Follow Up',
        'pretherapy-call': 'Pre-therapy Call',
        'booked-first-session': 'Booked First Session',
        'dropouts-unresponsive': 'Dropouts (Unresponsive)',
        'leaks': 'Leaks',
        'referred': 'Referred',
        'closed': 'Closed'
      };
      const stageName = stageNames[pipeline_stage] || pipeline_stage;
      const oldStageName = stageNames[currentLead.pipeline_stage] || currentLead.pipeline_stage;
      
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Sales Agent', 'lead_stage_change', `Moved lead from "${oldStageName}" to "${stageName}"`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.json(enriched.rows[0]);
  } catch (err) {
    console.error('Error updating lead stage:', err);
    res.status(500).json({ error: 'Failed to update lead stage' });
  }
});

// Manual therapist assignment endpoint
app.patch('/api/leads/:id/assign-therapist', async (req, res) => {
  const { id } = req.params;
  const { therapist_id } = req.body;
  
  if (!therapist_id) {
    return res.status(400).json({ error: 'therapist_id is required' });
  }

  try {
    // Verify the therapist exists
    const therapistCheck = await pool.query(
      'SELECT id, name, full_name FROM users WHERE id::text = $1 AND role = $2',
      [therapist_id, 'therapist']
    );
    
    if (therapistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    // Update the lead
    await pool.query(
      'UPDATE leads SET therapist_id = $1, updated_at = NOW() WHERE id::text = $2',
      [therapist_id, id]
    );

    // Return updated lead with therapist name
    const enriched = await pool.query(
      `SELECT leads.*, COALESCE(u.full_name, u.name) as therapist_name
       FROM leads
       LEFT JOIN users u ON leads.therapist_id::text = u.id::text
       WHERE leads.id::text = $1`,
      [id]
    );

    res.json(enriched.rows[0]);
  } catch (err) {
    console.error('Error assigning therapist:', err);
    res.status(500).json({ error: 'Failed to assign therapist' });
  }
});

// Get all therapists for dropdown
app.get('/api/therapists', async (req, res) => {
  try {
    const therapists = await pool.query(`
      SELECT id, name, full_name, therapist_id
      FROM users 
      WHERE role = 'therapist' 
      ORDER BY COALESCE(full_name, name)
    `);
    res.json(therapists.rows);
  } catch (err) {
    console.error('Error fetching therapists:', err);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

app.patch('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  try {
    const fieldMap: Record<string, string> = {
      name: 'name',
      phone: 'phone',
      email: 'email',
      created_at: 'created_at',
      source: 'source',
      sales_agent_id: 'sales_agent_id',
      therapist_id: 'therapist_id',
      age: 'age',
      city: 'city',
      preferred_mode_of_session: 'preferred_mode_of_session',
      pre_therapy_notes: 'pre_therapy_notes',
      emergency_contact_name: 'emergency_contact_name',
      emergency_contact_phone: 'emergency_contact_phone',
      emergency_contact_relation: 'emergency_contact_relation',
      therapy: 'therapy',
      remark_lead_manager: 'remark_lead_manager',
      remark_lead_inquire: 'remark_lead_inquire',
      remark_followup_1: 'remark_followup_1',
      remark_followup_2: 'remark_followup_2',
      remark_followup_3: 'remark_followup_3',
      remark_pretherapy_call: 'remark_pretherapy_call',
      remark_booked_first_session: 'remark_booked_first_session',
      remark_dropouts: 'remark_dropouts',
      remark_unresponsive: 'remark_unresponsive',
      remark_leaks: 'remark_leaks',
      remark_referred: 'remark_referred',
      remark_closed: 'remark_closed',
      general_remarks: 'general_remarks',
      tags: 'tags',
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) {
        setClauses.push(`${col} = $${idx}`);
        values.push(body[key] || null);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const query = `UPDATE leads SET ${setClauses.join(', ')} WHERE id::text = $${idx} RETURNING *`;
    console.log('Update Query:', query);
    console.log('Update Values:', values);
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Create audit log for lead update
    try {
      const leadData = result.rows[0];
      const updatedFields = Object.keys(body).filter(k => k in fieldMap).join(', ');
      await pool.query(
        `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [body.sales_agent_id, 'Sales Agent', 'lead_update', `Updated lead information (${updatedFields})`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating lead info:', err);
    res.status(500).json({ error: 'Failed to update lead info' });
  }
});

app.post('/api/leads', async (req, res) => {
  const { name, phone, email, city, age, source, sales_agent_id, general_remarks } = req.body;

  if (!name || !source) {
    return res.status(400).json({ error: 'Missing defined required fields' });
  }

  try {
    const normalizedPhone = phone ? phone.replace(/[\s\-\(\)\+]/g, '') : '';
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    // Check for existing bookings to determine correct starting stage
    const bookingCheck = await pool.query(
      `SELECT b.booking_resource_name, b.invitee_payment_amount, u.id as user_id
             FROM bookings b
             LEFT JOIN therapists t ON b.booking_host_name ILIKE '%' || SPLIT_PART(t.name, ' ', 1) || '%'
             LEFT JOIN users u ON u.therapist_id = t.therapist_id AND u.role = 'therapist'
             WHERE (RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10) 
                OR (LOWER(TRIM(b.invitee_email)) = $2 AND $2 <> ''))
             AND b.booking_status NOT IN ('cancelled', 'canceled', 'no-show')
             ORDER BY b.booking_start_at DESC LIMIT 1`,
      [normalizedPhone, normalizedEmail]
    );

    let pipelineStage = 'lead-inquire';
    let therapistId = null;
    let timestampCol = 'stage_lead_inquire_at';

    if (bookingCheck.rows.length > 0) {
      const booking = bookingCheck.rows[0];
      const isFree = (booking.booking_resource_name || '').toLowerCase().includes('free consultation') ||
        parseFloat(booking.invitee_payment_amount || '0') === 0;

      if (isFree) {
        pipelineStage = 'pretherapy-call';
        timestampCol = 'stage_pretherapy_call_at';
      } else {
        pipelineStage = 'booked-first-session';
        timestampCol = 'stage_booked_first_session_at';
      }

      // Resolve internal therapist ID
      const therapistExtId = booking.therapist_id || booking.booking_host_user_id?.toString();
      if (therapistExtId) {
        const uRes = await pool.query(
          'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
          [therapistExtId]
        );
        if (uRes.rows.length > 0) {
          therapistId = uRes.rows[0].id;
        }
      }

      console.log(`ℹ️ [Lead creation] Auto-routing ${name} to ${pipelineStage} based on booking history (Therapist: ${therapistId || 'N/A'}).`);
    }

    const insertQuery = `
          INSERT INTO leads (
            name, phone, email, city, age, source, sales_agent_id, therapist_id,
            status, pipeline_stage, ${timestampCol}, general_remarks
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, 
            'New', $9, CURRENT_TIMESTAMP, $10
          ) RETURNING *;
        `;

    const ageVal = age ? parseInt(age) : null;
    const values = [name, phone, email || null, city || null, ageVal, source, sales_agent_id, therapistId, pipelineStage, general_remarks || null];
    const result = await pool.query(insertQuery, values);

    // Create audit log for lead creation
    try {
      const leadData = result.rows[0];
      await pool.query(
        `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sales_agent_id, 'Sales Agent', 'lead_create', `Created new lead: ${name} (Source: ${source})`, leadData.id, name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// Delete lead endpoint
app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Check if lead exists and get lead info for audit log
    const checkLead = await pool.query('SELECT id, name FROM leads WHERE id::text = $1', [id]);
    
    if (checkLead.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const leadData = checkLead.rows[0];

    // Create audit log before deletion
    try {
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Sales Agent', 'lead_delete', `Deleted lead: ${leadData.name}`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    // Delete the lead
    await pool.query('DELETE FROM leads WHERE id::text = $1', [id]);
    
    res.status(200).json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Error deleting lead:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// Pre-Therapy Call Form Endpoints
app.post('/api/pretherapy-form', async (req, res) => {
  try {
    const {
      lead_id, submitted_by,
      age, language, language_other, location, location_manual,
      mode_of_session, previous_therapy, concerns, concerns_other,
      clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
      suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
      preferred_therapy_approach, preferred_therapy_text,
      consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
      readiness, readiness_other, consented_followup, followup_mode,
      client_questions, source, source_other, consultation_outcome, close_reason
    } = req.body;

    const result = await pool.query(
      `INSERT INTO pretherapy_call_forms (
        lead_id, submitted_by,
        age, language, language_other, location, location_manual,
        mode_of_session, previous_therapy, concerns, concerns_other,
        clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
        suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
        preferred_therapy_approach, preferred_therapy_text,
        consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
        readiness, readiness_other, consented_followup, followup_mode,
        client_questions, source, source_other, consultation_outcome, close_reason
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34
      ) RETURNING *`,
      [
        lead_id, submitted_by || null,
        age || null, language || null, language_other || null, location || null, location_manual || null,
        mode_of_session || null, previous_therapy || null, concerns || null, concerns_other || null,
        clinical_concerns_observed || null, clinical_concerns || null, psychiatric_treatment || null,
        suicidal_thoughts || null, suicidal_current || null, suicidal_ideation_1m || null, suicidal_attempt_1m || null,
        preferred_therapy_approach || null, preferred_therapy_text || null,
        consent_explained || null, consent_no_reason || null, scope_explained || null, preferred_price || null, preferred_price_other || null,
        readiness || null, readiness_other || null, consented_followup || null, followup_mode || null,
        client_questions || null, source || null, source_other || null, consultation_outcome || null, close_reason || null
      ]
    );

    // AUTOMATION: Move lead stage based on consultation outcome
    let targetStage = null;
    let newTags = null;

    if (consultation_outcome === 'Session booked') {
      targetStage = 'booked-first-session';
    } else if (consultation_outcome === 'To be followed up') {
      targetStage = 'followup-1';
    } else if (consultation_outcome === 'Referred') {
      targetStage = 'referred';
    } else if (consultation_outcome === 'Closed - Reason') {
      targetStage = 'closed';
    }

    if (targetStage) {
      const tsCol = TIMESTAMP_COLUMN_MAP[targetStage];
      const tsUpdate = tsCol ? `, ${tsCol} = NOW()` : '';
      const tagUpdate = newTags ? `, tags = $3` : '';

      const updateQuery = `UPDATE leads SET pipeline_stage = $1${tsUpdate}${tagUpdate}, updated_at = NOW() WHERE id::text = $2`;
      const updateValues = newTags ? [targetStage, lead_id, newTags] : [targetStage, lead_id];

      await pool.query(updateQuery, updateValues);
    }

    // Create audit log for pre-therapy form submission
    try {
      const leadResult = await pool.query('SELECT name FROM leads WHERE id::text = $1', [lead_id]);
      const leadName = leadResult.rows.length > 0 ? leadResult.rows[0].name : 'Unknown';
      
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [submitted_by || 'Sales Agent', 'pretherapy_form_submit', `Submitted pre-therapy call form (Outcome: ${consultation_outcome || 'N/A'})`, lead_id, leadName]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error saving pretherapy form:', err);
    res.status(500).json({ error: 'Failed to save pre-therapy call form' });
  }
});

app.get('/api/pretherapy-form/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const result = await pool.query(
      `SELECT * FROM pretherapy_call_forms WHERE lead_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [leadId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No form found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching pretherapy form:', err);
    res.status(500).json({ error: 'Failed to fetch pre-therapy call form' });
  }
});

app.patch('/api/pretherapy-form/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const {
      age, language, language_other, location, location_manual,
      mode_of_session, previous_therapy, concerns, concerns_other,
      clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
      suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
      preferred_therapy_approach, preferred_therapy_text,
      consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
      readiness, readiness_other, consented_followup, followup_mode,
      client_questions, source, source_other, consultation_outcome, close_reason
    } = req.body;

    const result = await pool.query(
      `UPDATE pretherapy_call_forms SET
        age = $2, language = $3, language_other = $4, location = $5, location_manual = $6,
        mode_of_session = $7, previous_therapy = $8, concerns = $9, concerns_other = $10,
        clinical_concerns_observed = $11, clinical_concerns = $12, psychiatric_treatment = $13,
        suicidal_thoughts = $14, suicidal_current = $15, suicidal_ideation_1m = $16, suicidal_attempt_1m = $17,
        preferred_therapy_approach = $18, preferred_therapy_text = $19,
        consent_explained = $20, consent_no_reason = $21, scope_explained = $22, preferred_price = $23, preferred_price_other = $24,
        readiness = $25, readiness_other = $26, consented_followup = $27, followup_mode = $28,
        client_questions = $29, source = $30, source_other = $31, consultation_outcome = $32, close_reason = $33
       WHERE id = (SELECT id FROM pretherapy_call_forms WHERE lead_id = $1 ORDER BY submitted_at DESC LIMIT 1)
       RETURNING *`,
      [
        leadId,
        age || null, language || null, language_other || null, location || null, location_manual || null,
        mode_of_session || null, previous_therapy || null, concerns || null, concerns_other || null,
        clinical_concerns_observed || null, clinical_concerns || null, psychiatric_treatment || null,
        suicidal_thoughts || null, suicidal_current || null, suicidal_ideation_1m || null, suicidal_attempt_1m || null,
        preferred_therapy_approach || null, preferred_therapy_text || null,
        consent_explained || null, consent_no_reason || null, scope_explained || null, preferred_price || null, preferred_price_other || null,
        readiness || null, readiness_other || null, consented_followup || null, followup_mode || null,
        client_questions || null, source || null, source_other || null, consultation_outcome || null, close_reason || null
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found to update' });
    }

    // Note: We skip stage automation on simple edit unless required
    res.json({ message: 'Pre-therapy form updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Error updating pre-therapy form:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/lead-managers', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, COALESCE(full_name, name) as name FROM users WHERE role = 'sales' ORDER BY name ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching lead managers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const { sourceMonth, funnelMonth, statsMonth } = req.query;
    let statsWhereClause = '';
    let statsQueryParams: any[] = [];
    if (statsMonth && typeof statsMonth === 'string' && statsMonth !== 'All Time') {
      const [monthName, yearStr] = statsMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;
      if (monthIndex > 0 && yearStr) {
        statsWhereClause = 'WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2';
        statsQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }
    let sourceWhereClause = '';
    let sourceQueryParams: any[] = [];
    let funnelWhereClause = '';
    let funnelQueryParams: any[] = [];

    if (sourceMonth && typeof sourceMonth === 'string') {
      const [monthName, yearStr] = sourceMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;

      if (monthIndex > 0 && yearStr) {
        sourceWhereClause = 'WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2';
        sourceQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    if (funnelMonth && typeof funnelMonth === 'string') {
      const [monthName, yearStr] = funnelMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;

      if (monthIndex > 0 && yearStr) {
        funnelQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    // Calculate stats with optional month filter for the top stat cards
    const totalLeadsRes = await pool.query(`SELECT COUNT(*) as count FROM leads ${statsWhereClause}`, statsQueryParams);
    const sourcesRes = await pool.query(`SELECT source as name, COUNT(*) as value FROM leads ${sourceWhereClause} GROUP BY source`, sourceQueryParams);

    // Build funnel query: each stage filtered by its own timestamp column
    let funnelRes;
    if (funnelQueryParams.length === 2) {
      const [fMonth, fYear] = funnelQueryParams;
      funnelRes = await pool.query(`
        SELECT stage, COUNT(*) as value FROM (
          SELECT 'lead-inquire' as stage FROM leads WHERE EXTRACT(MONTH FROM COALESCE(stage_lead_inquire_at, created_at)) = $1 AND EXTRACT(YEAR FROM COALESCE(stage_lead_inquire_at, created_at)) = $2
          UNION ALL
          SELECT 'pretherapy-call' FROM leads WHERE stage_pretherapy_call_at IS NOT NULL AND EXTRACT(MONTH FROM stage_pretherapy_call_at) = $1 AND EXTRACT(YEAR FROM stage_pretherapy_call_at) = $2
          UNION ALL
          SELECT 'followup-1' FROM leads WHERE stage_followup_1_at IS NOT NULL AND EXTRACT(MONTH FROM stage_followup_1_at) = $1 AND EXTRACT(YEAR FROM stage_followup_1_at) = $2
          UNION ALL
          SELECT 'booked-first-session' FROM leads WHERE stage_booked_first_session_at IS NOT NULL AND EXTRACT(MONTH FROM stage_booked_first_session_at) = $1 AND EXTRACT(YEAR FROM stage_booked_first_session_at) = $2
          UNION ALL
          SELECT 'referred' FROM leads WHERE stage_referred_at IS NOT NULL AND EXTRACT(MONTH FROM stage_referred_at) = $1 AND EXTRACT(YEAR FROM stage_referred_at) = $2
          UNION ALL
          SELECT 'closed' FROM leads WHERE stage_closed_at IS NOT NULL AND EXTRACT(MONTH FROM stage_closed_at) = $1 AND EXTRACT(YEAR FROM stage_closed_at) = $2
          UNION ALL
          SELECT 'dropouts' FROM leads WHERE stage_dropouts_at IS NOT NULL AND EXTRACT(MONTH FROM stage_dropouts_at) = $1 AND EXTRACT(YEAR FROM stage_dropouts_at) = $2
          UNION ALL
          SELECT 'leaks' FROM leads WHERE stage_leaks_at IS NOT NULL AND EXTRACT(MONTH FROM stage_leaks_at) = $1 AND EXTRACT(YEAR FROM stage_leaks_at) = $2
        ) t GROUP BY stage
      `, [fMonth, fYear]);
    } else {
      // No month filter — show all leads grouped by current stage
      funnelRes = await pool.query(`SELECT pipeline_stage as stage, COUNT(*) as value FROM leads GROUP BY pipeline_stage`);
    }


    // Fetch stats with optional month filter for the top stat cards
    // Each card uses the relevant stage timestamp for filtering (not created_at)
    let stageMonthFilter = '';
    let stageMonthParams: any[] = [];
    if (statsMonth && typeof statsMonth === 'string' && statsMonth !== 'All Time') {
      const [monthName, yearStr] = statsMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;
      if (monthIndex > 0 && yearStr) {
        stageMonthParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    const buildStageFilter = (stageCol: string) =>
      stageMonthParams.length === 2
        ? `AND ${stageCol} IS NOT NULL AND EXTRACT(MONTH FROM ${stageCol}) = $1 AND EXTRACT(YEAR FROM ${stageCol}) = $2`
        : '';

    const allTimeDropoutsRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'dropouts' ${buildStageFilter('stage_dropouts_at')}`,
      stageMonthParams
    );
    const allTimeLeaksRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'leaks' ${buildStageFilter('stage_leaks_at')}`,
      stageMonthParams
    );
    const allTimeClosedRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'closed' ${buildStageFilter('stage_closed_at')}`,
      stageMonthParams
    );
    const allTimeBookedRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE stage_booked_first_session_at IS NOT NULL ${buildStageFilter('stage_booked_first_session_at')}`,
      stageMonthParams
    );

    const dropoutsCount = allTimeDropoutsRes.rows[0].count;
    const leaksCount = allTimeLeaksRes.rows[0].count;
    const closedCount = parseInt(allTimeClosedRes.rows[0].count);
    const totalLeadsCount = parseInt(totalLeadsRes.rows[0].count);
    const allTimeBookedCount = parseInt(allTimeBookedRes.rows[0].count);
    // Calculate all-time conversion rate for the stat cards
    const allTimeConversionRate = totalLeadsCount > 0 ? Math.round((allTimeBookedCount / totalLeadsCount) * 100) : 0;

    res.json({
      totalLeads: parseInt(totalLeadsRes.rows[0].count),
      dropouts: parseInt(dropoutsCount),
      leaks: parseInt(leaksCount),
      closed: closedCount,
      allTimeConversionRate,
      allTimeBookedCount,
      sources: sourcesRes.rows.map(row => ({ name: row.name, value: parseInt(row.value) })),
      funnel: funnelRes.rows.map(row => ({ label: row.stage || row.label, value: parseInt(row.value) }))
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics', details: (err as Error).message });
  }
});

app.get('/api/crm/todo', async (req, res) => {
  try {
    const consultationCalls = await pool.query(`
      SELECT id, name, phone, email, stage_lead_inquire_at as follow_up_1_date, remark_lead_inquire as follow_up_1_notes, 'Lead/Inquiry' as next_step
      FROM leads 
      WHERE pipeline_stage = 'lead-inquire'
      ORDER BY stage_lead_inquire_at DESC NULLS LAST
    `);

    const followups = await pool.query(`
      SELECT id, name, phone, email, follow_up_1_date, remark_followup_1 as follow_up_1_notes, 'Follow up attempt' as next_step
      FROM leads 
      WHERE pipeline_stage = 'followup-1'
      ORDER BY follow_up_1_date ASC NULLS LAST
    `);

    res.json({
      consultationCalls: consultationCalls.rows,
      followups: followups.rows
    });
  } catch (err) {
    console.error('Error fetching todo list:', err);
    res.status(500).json({ error: 'Failed to fetch todo list' });
  }
});


// Update password
app.post('/api/update-password', async (req, res) => {
  try {
    const { user_id, new_password } = req.body;

    if (!user_id || !new_password) {
      return res.status(400).json({ success: false, error: 'User ID and new password are required' });
    }

    const result = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 RETURNING id`,
      [new_password, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ success: false, error: 'Failed to update password' });
  }
});

// ==================== FORGOT PASSWORD ENDPOINTS ====================

import crypto from 'crypto';

// Helper function to generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to generate secure token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 1. Send OTP for password reset
app.post('/api/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    // Check if user exists
    const userResult = await pool.query(
      `SELECT id, username, full_name, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    // For testing: Allow OTP for any email (even if not in database)
    const user = userResult.rows.length > 0
      ? userResult.rows[0]
      : { id: null, username: 'User', full_name: 'User', email: email };

    // Check rate limiting (max 3 requests per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const attemptsResult = await pool.query(
      `SELECT COUNT(*) as count FROM password_reset_attempts 
       WHERE LOWER(email) = LOWER($1) AND attempted_at > $2`,
      [email, oneHourAgo]
    );

    const attemptCount = parseInt(attemptsResult.rows[0].count);
    if (attemptCount >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again in an hour.'
      });
    }

    // Generate OTP and token
    const otp = generateOTP();
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store in database
    await pool.query(
      `INSERT INTO password_reset_tokens 
       (user_id, email, otp, token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, email, otp, token, expiresAt, ipAddress, req.headers['user-agent']]
    );

    // Log attempt
    await pool.query(
      `INSERT INTO password_reset_attempts (email, ip_address, success)
       VALUES ($1, $2, true)`,
      [email, ipAddress]
    );

    // Send email
    try {
      await sendPasswordResetOTP(email, user.full_name || user.username, otp, expiresAt);

      res.json({
        success: true,
        message: 'OTP sent to your email',
        expiresIn: 600 // 10 minutes in seconds
      });
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send OTP email. Please try again.'
      });
    }

  } catch (error) {
    console.error('❌ Error in send-otp:', error);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// 2. Verify OTP
app.post('/api/forgot-password/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    // Find OTP record
    const result = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE LOWER(email) = LOWER($1) AND otp = $2 AND used = false
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid OTP' });
    }

    const resetRecord = result.rows[0];

    // Check if expired
    if (new Date() > new Date(resetRecord.expires_at)) {
      console.log('❌ Expired OTP for:', email);
      return res.status(410).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    // Mark as verified (but not used yet)
    await pool.query(
      `UPDATE password_reset_tokens SET verified = true WHERE id = $1`,
      [resetRecord.id]
    );

    res.json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: resetRecord.token
    });

  } catch (error) {
    console.error('❌ Error in verify-otp:', error);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

// 3. Reset password
app.post('/api/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one uppercase letter' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one lowercase letter' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one number' });
    }

    // Find verified OTP record
    const result = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE LOWER(email) = LOWER($1) AND otp = $2 AND verified = true AND used = false
       ORDER BY created_at DESC LIMIT 1`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or unverified OTP' });
    }

    const resetRecord = result.rows[0];

    // Check if expired
    if (new Date() > new Date(resetRecord.expires_at)) {
      console.log('❌ Expired OTP for:', email);
      return res.status(410).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    // Update password
    const updateResult = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 RETURNING id, username`,
      [newPassword, resetRecord.user_id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Mark token as used
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
      [resetRecord.id]
    );

    // Invalidate all other reset tokens for this user
    await pool.query(
      `UPDATE password_reset_tokens SET used = true 
       WHERE user_id = $1 AND id != $2 AND used = false`,
      [resetRecord.user_id, resetRecord.id]
    );

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('❌ Error in reset password:', error);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// ==================== END FORGOT PASSWORD ENDPOINTS ====================

// Get admin profile
app.get('/api/admin-profile', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email, 
        u.phone, 
        COALESCE(u.profile_picture_url, t.profile_picture_url) as profile_picture_url 
       FROM users u 
       LEFT JOIN therapists t ON u.therapist_id = t.therapist_id 
       WHERE u.id = $1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({ error: 'Failed to fetch admin profile', details: error.message });
  }
});

// Update admin profile
app.put('/api/admin-profile', async (req, res) => {
  try {
    const {
      user_id,
      name,
      email,
      phone,
      profilePictureUrl
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await pool.query(
      `UPDATE users 
       SET full_name = $1, email = $2, phone = $3, profile_picture_url = $4
       WHERE id = $5
       RETURNING id, username, full_name, email, phone, profile_picture_url`,
      [name, email, phone, profilePictureUrl, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ error: 'Failed to update admin profile' });
  }
});

// Get live sessions count
app.get('/api/live-sessions-count', async (req, res) => {
  try {
    // Prevent caching of live session data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT booking_invitee_time
      FROM bookings
      WHERE booking_status NOT IN ('cancelled', 'canceled', 'no_show')
        AND therapist_id IS NOT NULL
        AND booking_resource_name NOT ILIKE '%free consultation%'
    `);

    let liveCount = 0;

    result.rows.forEach(row => {
      const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+:\d+\s+[AP]M)\s+-\s+(\d+:\d+\s+[AP]M)/);

      if (timeMatch) {
        const dateStr = (row.booking_invitee_time || '').match(/(\w+,\s+\w+\s+\d+,\s+\d+)/)?.[1];
        const startTimeStr = timeMatch[1];
        const endTimeStr = timeMatch[2];

        if (dateStr) {
          const startIST = new Date(`${dateStr} ${startTimeStr} GMT+0530`);
          const endIST = new Date(`${dateStr} ${endTimeStr} GMT+0530`);
          const nowUTC = new Date();

          if (nowUTC >= startIST && nowUTC <= endIST) {
            liveCount++;
          }
        }
      }
    });

    res.json({ liveCount });
  } catch (error) {
    console.error('Error fetching live sessions count:', error);
    res.status(500).json({ error: 'Failed to fetch live sessions count' });
  }
});

// Get dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { start, end } = req.query;
    const hasDateFilter = start && end;

    // Calculate last month date range
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const EXCL_SS = "";

    const revenue = hasDateFilter
      ? await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE booking_status NOT IN ($1, $2, $3, $4) ${EXCL_SS} AND booking_start_at BETWEEN $5 AND $6`,
        ['cancelled', 'canceled', 'payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE booking_status NOT IN ($1, $2, $3, $4) ${EXCL_SS}`,
        ['cancelled', 'canceled', 'payment_pending', 'payment_failed']
      );

    // Bookings - exclude safestories (free consultations managed in CRM)
    const bookings = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${EXCL_SS}`,
        ['payment_pending', 'payment_failed']
      );

    // Sessions Completed - exclude safestories
    const sessionsCompleted = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4, $5, $6) ${EXCL_SS} AND b.booking_start_at BETWEEN $7 AND $8`,
        ['cancelled', 'canceled', 'no_show', 'no show', 'payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4, $5, $6) ${EXCL_SS}`,
        ['cancelled', 'canceled', 'no_show', 'no show', 'payment_pending', 'payment_failed']
      );

    const freeConsultations = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_status NOT IN ($1, $2) AND booking_start_at BETWEEN $3 AND $4`,
        ['payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_status NOT IN ($1, $2)`,
        ['payment_pending', 'payment_failed']
      );

    const cancelled = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['cancelled', 'canceled', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS}`,
        ['cancelled', 'canceled']
      );

    const refunds = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS}`
      );

    const refundedAmount = hasDateFilter
      ? await pool.query(
        `SELECT COALESCE(SUM(refund_amount), 0) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COALESCE(SUM(refund_amount), 0) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS}`
      );

    const noShows = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS}`,
        ['no_show', 'no show']
      );

    // Last month stats
    const lastMonthBookings = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['payment_pending', 'payment_failed', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthSessionsCompleted = await pool.query(
      `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4, $5, $6) ${EXCL_SS} AND b.booking_start_at BETWEEN $7 AND $8`,
      ['cancelled', 'canceled', 'no_show', 'no show', 'payment_pending', 'payment_failed', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthFreeConsultations = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_start_at BETWEEN $1 AND $2',
      [lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthCancelled = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['cancelled', 'canceled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthRefunds = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE refund_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['completed', 'processed', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthNoShows = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['no_show', 'no show', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );
    const responseData = {
      revenue: revenue.rows[0].total,
      refundedAmount: refundedAmount.rows[0].total,
      bookings: bookings.rows[0].total,
      lastMonthBookings: lastMonthBookings.rows[0].total,
      sessionsCompleted: sessionsCompleted.rows[0].total,
      lastMonthSessionsCompleted: lastMonthSessionsCompleted.rows[0].total,
      freeConsultations: freeConsultations.rows[0].total,
      lastMonthFreeConsultations: lastMonthFreeConsultations.rows[0].total,
      cancelled: cancelled.rows[0].total,
      lastMonthCancelled: lastMonthCancelled.rows[0].total,
      refunds: refunds.rows[0].total,
      lastMonthRefunds: lastMonthRefunds.rows[0].total,
      noShows: noShows.rows[0].total,
      lastMonthNoShows: lastMonthNoShows.rows[0].total,
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get upcoming bookings
app.get('/api/dashboard/bookings', async (req, res) => {
  try {
    // Prevent caching of booking data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { start, end, limit = '3' } = req.query;
    const limitNum = parseInt(limit as string) || 3;

    const result = start && end
      ? await pool.query(
        `SELECT 
            invitee_name as client_name,
            invitee_email as client_email,
            invitee_phone as client_phone,
            booking_resource_name as therapy_type,
            booking_mode as mode,
            booking_host_name as therapist_name,
            booking_invitee_time,
            booking_id
          FROM bookings
          WHERE booking_status NOT IN ($1, $2)
            AND LOWER(TRIM(booking_host_name)) != 'safestories'
            AND booking_start_at BETWEEN $3 AND $4
          ORDER BY booking_start_at ASC
          LIMIT $5`,
        ['cancelled', 'canceled', start, `${end} 23:59:59`, limitNum]
      )
      : await pool.query(
        `SELECT 
            invitee_name as client_name,
            invitee_email as client_email,
            invitee_phone as client_phone,
            booking_resource_name as therapy_type,
            booking_mode as mode,
            booking_host_name as therapist_name,
            booking_invitee_time,
            booking_id
          FROM bookings
          WHERE booking_status NOT IN ($1, $2, $3, $4)
            AND LOWER(TRIM(booking_host_name)) != 'safestories'
          ORDER BY booking_start_at ASC`,
        ['cancelled', 'canceled', 'no_show', 'no show']
      );

    // Filter upcoming sessions based on booking_invitee_time
    const nowUTC = new Date();
    const upcomingBookings = result.rows.filter(row => {
      try {
        const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+):(\d+)\s+([AP]M)\s+-\s+(\d+):(\d+)\s+([AP]M)/);

        if (!timeMatch) {
          console.log('No time match for:', row.booking_invitee_time);
          return false;
        }

        const dateStr = (row.booking_invitee_time || '').match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d+)/);

        if (!dateStr) {
          console.log('No date match for:', row.booking_invitee_time);
          return false;
        }

        const month = dateStr[2];
        const day = parseInt(dateStr[3]);
        const year = parseInt(dateStr[4]);

        // Parse end time
        let endHour = parseInt(timeMatch[4]);
        const endMinute = parseInt(timeMatch[5]);
        const endPeriod = timeMatch[6];

        // Convert to 24-hour format
        if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
        if (endPeriod === 'AM' && endHour === 12) endHour = 0;

        // Parse timezone offset
        const timezoneMatch = (row.booking_invitee_time || '').match(/GMT([+-])(\d+):(\d+)/);
        let timezoneOffset = 330; // Default to IST (+5:30)

        if (timezoneMatch) {
          const sign = timezoneMatch[1] === '+' ? 1 : -1;
          const hours = parseInt(timezoneMatch[2]);
          const minutes = parseInt(timezoneMatch[3]);
          timezoneOffset = sign * (hours * 60 + minutes);
        }

        // Create date in UTC
        const monthMap: { [key: string]: number } = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
          'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };

        const endDate = new Date(Date.UTC(year, monthMap[month], day, endHour, endMinute));
        // Adjust for timezone offset (subtract because we want UTC)
        endDate.setMinutes(endDate.getMinutes() - timezoneOffset);

        const isUpcoming = endDate > nowUTC;

        // Session is upcoming if end time hasn't passed
        return isUpcoming;
      } catch (error) {
        console.error('Error parsing booking time:', error, row.booking_invitee_time);
        return false;
      }
    }).slice(0, limitNum);

    const bookings = upcomingBookings.map(row => ({
      ...row,
      booking_start_at: convertToIST(row.booking_invitee_time) || 'N/A',
      mode: row.mode ? row.mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet'
    }));

    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});


// Update client contact info across all bookings
app.patch('/api/clients/update-contact', async (req: any, res: any) => {
  const { old_phone, old_email, new_name, new_phone, new_email, _audit_user } = req.body;

  if (!old_phone && !old_email) {
    return res.status(400).json({ error: 'Must provide old_phone or old_email to identify client' });
  }

  try {
    const currentRes = await pool.query(
      `SELECT DISTINCT invitee_name, invitee_phone, invitee_email FROM bookings
       WHERE ($1::text IS NULL OR invitee_phone = $1) AND ($2::text IS NULL OR invitee_email = $2)
       LIMIT 1`,
      [old_phone || null, old_email || null]
    );
    const current = currentRes.rows[0];

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (new_name !== undefined) { setClauses.push(`invitee_name = $${idx++}`); values.push(new_name); }
    if (new_phone !== undefined) { setClauses.push(`invitee_phone = $${idx++}`); values.push(new_phone); }
    if (new_email !== undefined) { setClauses.push(`invitee_email = $${idx++}`); values.push(new_email); }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let whereClause: string;
    if (old_phone && old_email) {
      whereClause = `(invitee_phone = $${idx} OR invitee_email = $${idx + 1})`;
      values.push(old_phone, old_email);
    } else if (old_phone) {
      whereClause = `invitee_phone = $${idx}`;
      values.push(old_phone);
    } else {
      whereClause = `invitee_email = $${idx}`;
      values.push(old_email);
    }

    const result = await pool.query(
      `UPDATE bookings SET ${setClauses.join(', ')} WHERE ${whereClause}`,
      values
    );

    // Audit log - wrapped in try/catch so it doesn't fail the main update
    try {
    if (_audit_user) {
      const changes: string[] = [];
      if (new_name !== undefined) changes.push('name updated to "' + new_name + '"');
      if (new_phone !== undefined && new_phone !== current.invitee_phone) changes.push('phone: "' + current.invitee_phone + '" -> "' + new_phone + '"');
      if (new_email !== undefined && new_email !== current.invitee_email) changes.push('email: "' + current.invitee_email + '" -> "' + new_email + '"');
      if (changes.length > 0) {
        await pool.query(
          `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp, is_visible)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [null, _audit_user.name || 'Unknown', 'client_contact_edit',
           'Client contact updated: ' + changes.join('; '), current.invitee_name, getCurrentISTTimestamp()]
        );
      }
    }

    } catch (auditErr) {
      console.error('Audit log failed (non-critical):', auditErr);
    }
    res.json({ success: true, rowsUpdated: result.rowCount });
  } catch (err) {
    console.error('Error updating client contact:', err);
    res.status(500).json({ error: 'Failed to update client contact' });
  }
});

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    // Prevent caching of client data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT 
        invitee_id,
        invitee_name,
        invitee_phone,
        invitee_email,
        booking_host_name,
        booking_resource_name,
        booking_status,
        booking_mode,
        CASE 
          WHEN booking_status IN ('cancelled', 'canceled', 'no_show', 'no show') THEN 0
          ELSE 1
        END as session_count,
        invitee_created_at as created_at,
        booking_start_at as latest_booking_date,
        booking_invitee_time
      FROM bookings
      ORDER BY invitee_created_at DESC
    `);

    // Fetch leads for matching
    const leadsRes = await pool.query(`SELECT id, phone, email FROM leads`);
    const leadMaps = {
      phone: new Map(),
      email: new Map()
    };
    leadsRes.rows.forEach(l => {
      if (l.phone) leadMaps.phone.set(l.phone.replace(/[\s\-\(\)\+]/g, ''), l.id);
      if (l.email) leadMaps.email.set(l.email.toLowerCase().trim(), l.id);
    });

    // Group by phone (primary) or email (fallback) - phone is more reliable
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    result.rows.forEach(row => {
      const email = row.invitee_email ? row.invitee_email.toLowerCase().trim() : null;
      const phone = row.invitee_phone ? row.invitee_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      // Find existing key by phone (primary) or email (fallback)
      if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
        if (email && !emailToKey.has(email)) emailToKey.set(email, key);
      } else if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
        if (phone && !phoneToKey.has(phone)) phoneToKey.set(phone, key);
      } else {
        key = phone || email;
      }

      if (!key) return;

      // Track mappings
      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          invitee_id: row.invitee_id,
          invitee_name: row.invitee_name,
          invitee_phone: row.invitee_phone,
          invitee_email: row.invitee_email,
          lead_id: leadMaps.phone.get(phone) || leadMaps.email.get(email) || null,
          session_count: 0,
          booking_host_name: row.booking_host_name,
          booking_resource_name: row.booking_resource_name,
          booking_mode: null,
          created_at: row.created_at,
          latest_booking_date: null,
          last_session_date: null,
          last_session_date_raw: null,
          therapists: []
        });
      }

      const client = clientMap.get(key);
      client.session_count += parseInt(row.session_count) || 0;

      // Update to most recent/valid email if current one is missing or looks invalid
      if (row.invitee_email) {
        if (!client.invitee_email || client.invitee_email.includes('.con')) {
          if (!row.invitee_email.includes('.con')) {
            client.invitee_email = row.invitee_email;
          }
        }
      }

      // Track last session date and mode for past sessions (excluding cancelled and no_show)
      if (row.booking_status && !['cancelled', 'canceled', 'no_show', 'no show'].includes(row.booking_status)) {
        const sessionDate = new Date(row.latest_booking_date);
        const now = new Date();

        if (sessionDate < now && row.booking_invitee_time) {
          if (!client.last_session_date_raw || new Date(row.latest_booking_date) > new Date(client.last_session_date_raw)) {
            client.last_session_date = row.booking_invitee_time;
            client.last_session_date_raw = row.latest_booking_date;
            client.booking_mode = row.booking_mode;
          }
        }
      }

      // Update session name to most recent
      if (row.booking_resource_name) {
        client.booking_resource_name = row.booking_resource_name;
      }

      // Update latest_booking_date only from active bookings (except for Safestories pre-therapy)
      const isSafestories = row.booking_host_name && row.booking_host_name.toLowerCase().trim() === 'safestories';
      const isActiveBooking = row.booking_status && !['cancelled', 'canceled', 'no_show', 'no show'].includes(row.booking_status);

      if (isSafestories || isActiveBooking) {
        if (!client.latest_booking_date || new Date(row.latest_booking_date) > new Date(client.latest_booking_date)) {
          client.latest_booking_date = row.latest_booking_date;
        }
      }

      // Update to most recent phone number and therapist
      if (new Date(row.latest_booking_date) > new Date(client.created_at)) {
        client.invitee_phone = row.invitee_phone;
        if (parseInt(row.session_count) > 0) {
          client.booking_host_name = row.booking_host_name;
        }
      }

      // Add to therapists array only if different therapist
      if (parseInt(row.session_count) > 0) {
        const existing = client.therapists.find((t: any) =>
          t.booking_host_name === row.booking_host_name
        );

        if (existing) {
          existing.session_count += parseInt(row.session_count) || 0;
        } else {
          client.therapists.push({
            invitee_name: row.invitee_name,
            invitee_phone: row.invitee_phone,
            booking_host_name: row.booking_host_name,
            session_count: parseInt(row.session_count) || 0
          });
        }
      }
    });

    const clients = Array.from(clientMap.values()).sort((a, b) =>
      new Date(b.latest_booking_date || b.created_at).getTime() - new Date(a.latest_booking_date || a.created_at).getTime()
    );

    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Get all appointments
const DAYSCHEDULE_API_KEY = 'g1NeHQjuCwM9hDTmP9Jz5GflNSRNwCL4';

// DaySchedule Proxy Endpoints
app.get('/api/dayschedule/schedules/:id', async (req, res) => {
  console.log(`[DEBUG Proxy] Fetching from n8n for schedule: ${req.params.id}`);
  try {
    const { id } = req.params;
    const response = await fetch(`https://n8n.srv1169280.hstgr.cloud/webhook/424780e4-8e10-4308-84fd-5925450cc123?scheduleId=${id}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG Proxy] Webhook returned error ${response.status}:`, errorText);
      return res.status(502).json({ error: 'N8N Webhook Error', status: response.status });
    }

    const data = await response.json();
    console.log(`[DEBUG Proxy] Raw data for schedule ${id}:`, JSON.stringify(data).substring(0, 500));
    res.json(data);
  } catch (error: any) {
    console.error('[DEBUG Proxy] Internal Error during fetch/json:', error);
    res.status(500).json({ error: 'Failed to fetch schedule from n8n webhook', detail: error.message });
  }
});

app.put('/api/dayschedule/schedules/:id', async (req, res) => {
  console.log(`[DEBUG Proxy] Sending to n8n for schedule: ${req.params.id}`);
  try {
    const { id } = req.params;
    const body = req.body;

    const response = await fetch(`https://n8n.srv1169280.hstgr.cloud/webhook/93c3afe0-88d2-47d0-8872-ab61c988bf20?scheduleId=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, scheduleId: id })
    });

    // Helper: notify all admins about schedule update (fire-and-forget)
    const notifyScheduleUpdate = async () => {
      try {
        const therapistName = (body.name || '').replace(/'s Schedule$/, '').trim();
        const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [admin.id, 'admin', 'schedule_updated', 'Schedule Updated',
             `${therapistName} updated their availability schedule`, id]
          );
        }
      } catch (e) { /* non-critical, don't fail the main response */ }
    };

    if (response.status === 204) {
      notifyScheduleUpdate();
      return res.status(204).send();
    }

    // Try to parse the response body regardless of status
    let responseData: any = null;
    try {
      const text = await response.text();
      responseData = text ? JSON.parse(text) : null;
    } catch { /* ignore parse errors */ }

    // n8n returns 500 with code:0 when there's no "Respond to Webhook" node
    // but the workflow DID execute successfully — treat code:0 as success
    if (!response.ok) {
      if (responseData?.code === 0) {
        console.log(`[DEBUG Proxy] n8n updated schedule ${id} successfully (no respond node configured)`);
        notifyScheduleUpdate();
        return res.json({ success: true, scheduleId: id });
      }
      console.error(`[DEBUG Proxy] Webhook PUT returned error ${response.status}:`, responseData);
      return res.status(502).json({
        error: 'N8N Webhook Update Error',
        status: response.status,
        detail: responseData?.message || JSON.stringify(responseData)
      });
    }

    notifyScheduleUpdate();
    res.json(responseData || { success: true });
  } catch (error: any) {
    console.error('[DEBUG Proxy] Internal Error during PUT fetch/json:', error);
    res.status(500).json({ error: 'Failed to update schedule via n8n webhook', detail: error.message });
  }
});

// Cancel Booking Backend (Dev Server)
app.post('/api/cancel-booking', async (req, res) => {
  const { booking_id, reason, notify } = req.body;

  if (!booking_id) {
    return res.status(400).json({ error: 'booking_id is required' });
  }

  console.log(`[Cancel Booking] Processing cancellation for booking: ${booking_id}`);

  try {
    // 1. Fetch current booking details from database
    const bookingResult = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);

    if (bookingResult.rows.length === 0) {
      console.warn(`[Cancel Booking] Booking ${booking_id} not found in database.`);
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingDetails = bookingResult.rows[0];

    // 2. Forward everything to the n8n cancellation webhook
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_CANCEL_BOOKING;

    const webhookResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bookingDetails,
        cancellation_reason: reason || 'No reason provided',
        notify_participants: notify !== undefined ? notify : true,
        cancelled_at: new Date().toISOString()
      })
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error(`[Cancel Booking] Webhook error (${webhookResponse.status}):`, errorText);
      return res.status(502).json({ error: 'Failed to process cancellation via downstream webhook' });
    }

    console.log(`[Cancel Booking] Successfully forwarded cancellation to webhook: ${booking_id}`);

    // Notify all admins about cancellation
    const adminsForCancel = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of adminsForCancel.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', 'booking_cancelled', 'Session Cancelled',
         `${bookingDetails.invitee_name} cancelled "${bookingDetails.booking_resource_name || 'Session'}"${reason ? `. Reason: ${reason}` : ''}`,
         booking_id]
      );
    }

    // Notify assigned therapist about cancellation
    const cancelHostId = bookingDetails.booking_host_calendar_id;
    if (cancelHostId) {
      const therapistUserRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [cancelHostId]
      );
      if (therapistUserRes.rows.length > 0) {
        const tId = therapistUserRes.rows[0].id;
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tId, 'therapist', 'booking_cancelled', 'Session Cancelled',
           `${bookingDetails.invitee_name} cancelled "${bookingDetails.booking_resource_name || 'Session'}"${reason ? `. Reason: ${reason}` : ''}`,
           booking_id]
        );
      }
    }

    res.json({ success: true, message: 'Booking cancellation forwarded successfully' });

  } catch (error: any) {
    console.error('[Cancel Booking] Error:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// Reschedule Booking Backend (Dev Server)
app.post('/api/reschedule-booking', async (req, res) => {
  const { booking_id, new_start_at, duration, reason, notify } = req.body;

  if (!booking_id || !new_start_at) {
    return res.status(400).json({ error: 'booking_id and new_start_at are required' });
  }

  console.log(`[Reschedule Booking] Processing reschedule for booking: ${booking_id}`);

  try {
    // 1. Fetch current booking details from database
    const bookingResult = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingDetails = bookingResult.rows[0];

    // 2. Calculate end_at (ISO-8601)
    // duration is in minutes
    const startAtDate = new Date(new_start_at);
    const endAtDate = new Date(startAtDate.getTime() + (duration || 50) * 60000);

    // Format: "Saturday, Apr 11, 2026 at 11:00 AM - 11:50 AM IST"
    const datePart = startAtDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });

    const startText = startAtDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const endTextFull = endAtDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const bookingInviteeTime = `${datePart} at ${startText} - ${endTextFull} IST`;

    await pool.query(
      `UPDATE bookings 
       SET booking_start_at = $1, 
           booking_end_at = $2, 
           booking_duration = $3, 
           booking_invitee_time = $4,
           rescheduled_at = NOW(),
           recheduled_from = $5
       WHERE booking_id = $6`,
      [startAtDate.toISOString(), endAtDate.toISOString(), duration || 50, bookingInviteeTime, bookingDetails.booking_start_at, booking_id]
    );

    // 3. Forward to n8n reschedule webhook
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_RESCHEDULE_BOOKING;

    const webhookResponse = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bookingDetails,
        start_at: startAtDate.toISOString(),
        end_at: endAtDate.toISOString(),
        reschedule_reason: reason || 'No reason provided',
        notify_participants: notify !== undefined ? notify : true,
        rescheduled_at: new Date().toISOString(),
        // Pass the updated invitee time too so downstream systems have it
        booking_invitee_time: bookingInviteeTime
      })
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error(`[Reschedule Booking] Webhook error (${webhookResponse.status}):`, errorText);
      return res.status(502).json({ error: 'Failed to process reschedule via downstream webhook' });
    }

    console.log(`[Reschedule Booking] Successfully updated local DB and forwarded reschedule to webhook: ${booking_id}`);

    // Notify all admins about rescheduling
    const rSessionName = (bookingDetails.booking_resource_name || 'Session').replace(/ with .+$/i, '').trim();
    const newTime = new Date(new_start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const adminsForReschedule = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of adminsForReschedule.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', 'booking_rescheduled', 'Session Rescheduled',
         `"${rSessionName}" with ${bookingDetails.invitee_name} rescheduled to ${newTime}. Reason: ${reason || 'No reason provided'}`,
         booking_id]
      );
    }

    // Notify assigned therapist about rescheduling
    const rescheduleHostId = bookingDetails.booking_host_calendar_id;
    if (rescheduleHostId) {
      const therapistUserRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [rescheduleHostId]
      );
      if (therapistUserRes.rows.length > 0) {
        const tId = therapistUserRes.rows[0].id;
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tId, 'therapist', 'booking_rescheduled', 'Session Rescheduled',
           `"${rSessionName}" with ${bookingDetails.invitee_name} rescheduled to ${newTime}. Reason: ${reason || 'No reason provided'}`,
           booking_id]
        );
      }
    }

    res.json({ success: true, message: 'Booking rescheduled successfully and forwarded' });

  } catch (error: any) {
    console.error('[Reschedule Booking] Error:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// GET Public Booking Details
app.get('/api/public/booking/:booking_id', async (req, res) => {
  const { booking_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        booking_id,
        invitee_name,
        booking_start_at,
        booking_invitee_time,
        booking_resource_name,
        booking_host_name,
        booking_status,
        booking_cancel_reason,
        booking_joining_link
      FROM bookings 
      WHERE booking_id = $1
    `, [booking_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Public endpoint: fetch a therapy service by slug (used by public booking links)
app.get('/api/public/services/:slug', async (req, res) => {
  try {
    let { slug } = req.params;
    // Ensure slug starts with /
    if (!slug.startsWith('/')) {
      slug = '/' + slug;
    }
    const result = await pool.query(
      'SELECT * FROM therapy_services WHERE slug = $1 AND is_active = true',
      [slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = result.rows[0];
    res.json({
      title: service.title,
      duration: service.duration,
      type: service.type,
      description: service.description,
      detailedDescription: service.detailed_description,
      editViewDescription: service.edit_view_description,
      charges: service.charges,
      slug: service.slug,
      label: service.label,
      owner: service.therapist_name,
      therapist_id: service.therapist_id,
      schedule_id: service.schedule_id
    });
  } catch (error: any) {
    console.error('Error fetching public service:', error);
    res.status(500).json({ error: error.message });
  }
});



app.get('/api/appointments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.booking_id,
        b.booking_invitee_time,
        b.booking_resource_name,
        b.invitee_payment_amount,
        b.booking_subject,
        b.invitee_name,
        b.invitee_phone,
        b.invitee_email,
        b.booking_host_name,
        b.booking_mode,
        b.booking_start_at,
        b.booking_joining_link,
        b.booking_checkin_url,
        b.therapist_id,
        b.booking_status,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes,
        (b.booking_start_at < NOW()) as is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
      ORDER BY b.booking_start_at DESC
    `);

    const appointments = result.rows.map(row => {
      let status = row.booking_status;

      if (row.booking_status !== 'cancelled' && row.booking_status !== 'canceled' && row.booking_status !== 'no_show' && row.booking_status !== 'no show') {
        if (row.has_session_notes) {
          status = 'completed';
        } else if (row.is_past) {
          status = 'pending_notes';
        }
      }

      return {
        booking_id: row.booking_id,
        is_free: row.invitee_payment_amount === null || Number(row.invitee_payment_amount) === 0,
        booking_start_at: convertToIST(row.booking_invitee_time) || 'N/A',
        booking_resource_name: row.booking_resource_name,
        invitee_name: row.invitee_name,
        invitee_phone: row.invitee_phone,
        invitee_email: row.invitee_email,
        booking_host_name: row.booking_host_name,
        booking_mode: row.booking_mode ? row.booking_mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet',
        booking_joining_link: row.booking_joining_link,
        booking_checkin_url: row.booking_checkin_url,
        therapist_id: row.therapist_id,
        has_session_notes: row.has_session_notes,
        booking_status: status,
        booking_start_at_raw: row.booking_start_at
      };
    });

    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get therapists by therapy
app.get('/api/therapists-by-therapy', async (req, res) => {
  try {
    const { therapy_name } = req.query;

    if (!therapy_name) {
      return res.status(400).json({ error: 'Therapy name is required' });
    }

    const result = await pool.query(`
      SELECT therapist_id, name as therapist_name
      FROM therapists
      WHERE specialization ILIKE $1
      ORDER BY name ASC
    `, [`%${therapy_name}%`]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapists by therapy:', error);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// Get all therapies
app.get('/api/therapies', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT specialization FROM therapists WHERE specialization IS NOT NULL');
    const therapySet = new Set<string>();
    result.rows.forEach(row => {
      const specializations = row.specialization.split(',').map((s: string) => s.trim());
      specializations.forEach((spec: string) => therapySet.add(spec));
    });
    const therapies = Array.from(therapySet).sort().map(therapy => ({ therapy_name: therapy }));
    res.json(therapies);
  } catch (error) {
    console.error('Error fetching therapies:', error);
    res.status(500).json({ error: 'Failed to fetch therapies' });
  }
});

// Save booking request
app.post('/api/booking-requests', async (req, res) => {
  try {
    const { clientName, clientWhatsapp, clientEmail, therapyType, therapistName, bookingLink, isFreeConsultation, adminId } = req.body;

    const result = await pool.query(
      `INSERT INTO booking_requests (client_name, client_whatsapp, client_email, therapy_type, therapist_name, booking_link, status, is_free_consultation)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7)
       RETURNING *`,
      [clientName, clientWhatsapp, clientEmail, therapyType, therapistName, bookingLink, isFreeConsultation || false]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error saving booking request:', error);
    res.status(500).json({ success: false, error: 'Failed to save booking request' });
  }
});

// Get therapists live status
app.get('/api/therapists-live-status', async (req, res) => {
  try {
    // Prevent caching of live status data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT DISTINCT booking_host_name, booking_invitee_time
      FROM bookings
      WHERE booking_status NOT IN ('cancelled', 'canceled', 'no_show')
        AND therapist_id IS NOT NULL
        AND booking_resource_name NOT ILIKE '%free consultation%'
    `);

    const liveStatus: { [key: string]: boolean } = {};

    result.rows.forEach(row => {
      const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+:\d+\s+[AP]M)\s+-\s+(\d+:\d+\s+[AP]M)/);

      if (timeMatch) {
        const dateStr = (row.booking_invitee_time || '').match(/(\w+,\s+\w+\s+\d+,\s+\d+)/)?.[1];
        const startTimeStr = timeMatch[1];
        const endTimeStr = timeMatch[2];

        if (dateStr) {
          const startIST = new Date(`${dateStr} ${startTimeStr} GMT+0530`);
          const endIST = new Date(`${dateStr} ${endTimeStr} GMT+0530`);
          const nowUTC = new Date();

          if (nowUTC >= startIST && nowUTC <= endIST) {
            const firstName = row.booking_host_name.split(' ')[0];
            liveStatus[firstName] = true;
          }
        }
      }
    });

    res.json(liveStatus);
  } catch (error) {
    console.error('Error fetching therapists live status:', error);
    res.status(500).json({ error: 'Failed to fetch therapists live status' });
  }
});

// Get scheduleId for a specific therapist from therapist_resources
app.get('/api/therapist-schedule', async (req, res) => {
  try {
    const { therapist_id } = req.query;
    if (!therapist_id) {
      return res.status(400).json({ success: false, error: 'therapist_id is required' });
    }
    const result = await pool.query(
      'SELECT MAX(schedule_id) as schedule_id FROM therapist_resources WHERE therapist_id = $1',
      [therapist_id]
    );
    const scheduleId = result.rows[0]?.schedule_id ?? null;
    console.log(`✅ [/api/therapist-schedule] therapist_id=${therapist_id} => scheduleId=${scheduleId}`);
    res.json({ success: true, scheduleId });
  } catch (error) {
    console.error('Error fetching therapist schedule:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
  }
});

// Get all therapists
app.get('/api/therapists', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.therapist_id,
        t.name,
        t.specialization,
        t.contact_info,
        t.profile_picture_url,
        t.phone_number,
        (SELECT MAX(schedule_id) FROM therapist_resources WHERE therapist_id = t.therapist_id) as "scheduleId",
        COUNT(DISTINCT CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled') 
          THEN b.booking_id 
        END) as total_sessions_lifetime,
        COUNT(DISTINCT CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled')
          AND EXTRACT(MONTH FROM b.booking_start_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM b.booking_start_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          THEN b.booking_id 
        END) as sessions_this_month,
        COALESCE(SUM(CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled') 
          THEN b.invitee_payment_amount 
          ELSE 0 
        END), 0) as total_revenue,
        COALESCE(SUM(CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled')
          AND EXTRACT(MONTH FROM b.booking_start_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM b.booking_start_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          THEN b.invitee_payment_amount 
          ELSE 0 
        END), 0) as revenue_this_month
      FROM therapists t
      LEFT JOIN bookings b ON (
        TRIM(b.booking_host_name) ILIKE '%' || SPLIT_PART(t.name, ' ', 1) || '%'
        OR TRIM(b.booking_host_name) ILIKE t.name
      )
      GROUP BY t.therapist_id, t.name, t.specialization, t.contact_info, t.profile_picture_url, t.phone_number
      ORDER BY t.name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapists:', error);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// Get therapist details
app.get('/api/therapist-details', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Therapist name is required' });
    }

    // Get unique clients for this therapist
    const clientsResult = await pool.query(`
      SELECT DISTINCT 
        invitee_name,
        invitee_email,
        invitee_phone,
        booking_start_at
      FROM bookings
      WHERE booking_host_name ILIKE '%' || SPLIT_PART($1, ' ', 1) || '%'
      ORDER BY booking_start_at DESC
    `, [name]);

    // Group by email (primary) or phone (fallback)
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    clientsResult.rows.forEach(row => {
      const email = row.invitee_email ? row.invitee_email.toLowerCase().trim() : null;
      const phone = row.invitee_phone ? row.invitee_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
      } else if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
        if (email) {
          const oldData = clientMap.get(key);
          clientMap.delete(key);
          key = email;
          clientMap.set(key, oldData);
          emailToKey.set(email, key);
        }
      } else {
        key = email || phone;
      }

      if (!key) return;

      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          invitee_name: row.invitee_name,
          invitee_email: row.invitee_email,
          invitee_phone: row.invitee_phone,
          latest_booking_date: row.booking_start_at
        });
      } else {
        const client = clientMap.get(key);
        // Update to most recent phone number
        if (new Date(row.booking_start_at) > new Date(client.latest_booking_date)) {
          client.latest_booking_date = row.booking_start_at;
          client.invitee_phone = row.invitee_phone;
        }
        // Fill in missing email
        if (row.invitee_email && !client.invitee_email) {
          client.invitee_email = row.invitee_email;
        }
      }
    });

    const clients = Array.from(clientMap.values()).map(({ latest_booking_date, ...client }) => client);

    // Get recent appointments for this therapist
    const appointmentsResult = await pool.query(`
      SELECT 
        invitee_name,
        invitee_email,
        invitee_phone,
        booking_resource_name,
        booking_start_at,
        booking_start_at as booking_start_at_raw,
        booking_invitee_time,
        booking_status,
        booking_mode as mode
      FROM bookings
      WHERE booking_host_name ILIKE '%' || SPLIT_PART($1, ' ', 1) || '%'
      ORDER BY booking_start_at DESC
    `, [name]);

    const appointments = appointmentsResult.rows.map(apt => ({
      ...apt,
      booking_invitee_time: convertToIST(apt.booking_invitee_time)
    }));

    res.json({
      clients,
      appointments
    });
  } catch (error) {
    console.error('Error fetching therapist details:', error);
    res.status(500).json({ error: 'Failed to fetch therapist details' });
  }
});

// Get client details
app.get('/api/client-details', async (req, res) => {
  try {
    const phones = req.query.phone;
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;

    if (!email && !phones) {
      return res.status(400).json({ error: 'Client email or phone is required' });
    }

    // Get all emails and phones for this client
    let allEmails: string[] = [];
    let allPhones: string[] = [];

    if (email) {
      allEmails.push(email);
      // Get all phones for this email
      const phonesResult = await pool.query(
        'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
        [email]
      );
      allPhones = phonesResult.rows.map(r => r.invitee_phone);
    }

    if (phones) {
      const phoneArray = Array.isArray(phones) ? phones : [phones];
      const stringPhones = phoneArray.filter((p): p is string => typeof p === 'string');
      allPhones.push(...stringPhones.filter(p => !allPhones.includes(p)));

      // Get email for these phones if not already provided
      if (!email) {
        for (const phone of phoneArray) {
          if (typeof phone !== 'string') continue;
          const emailResult = await pool.query(
            'SELECT DISTINCT invitee_email FROM bookings WHERE invitee_phone = $1 AND invitee_email IS NOT NULL LIMIT 1',
            [phone]
          );
          if (emailResult.rows.length > 0 && !allEmails.includes(emailResult.rows[0].invitee_email)) {
            allEmails.push(emailResult.rows[0].invitee_email);
          }
        }

        // Get all phones for found emails
        for (const foundEmail of allEmails) {
          const phonesResult = await pool.query(
            'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
            [foundEmail]
          );
          phonesResult.rows.forEach(r => {
            if (!allPhones.includes(r.invitee_phone)) {
              allPhones.push(r.invitee_phone);
            }
          });
        }
      }
    }

    // Build query to get all appointments for all emails and phones
    let query = `
      SELECT 
        b.invitee_name,
        b.invitee_email,
        b.invitee_phone,
        b.booking_resource_name,
        b.booking_start_at,
        b.booking_end_at,
        b.booking_invitee_time,
        b.booking_host_name,
        b.booking_status,
        b.emergency_contact_name,
        b.emergency_contact_relation,
        b.emergency_contact_number,
        b.invitee_question,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes,
        (b.booking_end_at < NOW()) as is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (allEmails.length > 0) {
      const emailPlaceholders = allEmails.map((_, i) => `$${params.length + i + 1}`).join(', ');
      query += ` AND (b.invitee_email IN (${emailPlaceholders})`;
      params.push(...allEmails);

      if (allPhones.length > 0) {
        const phonePlaceholders = allPhones.map((_, i) => `$${params.length + i + 1}`).join(', ');
        query += ` OR b.invitee_phone IN (${phonePlaceholders}))`;
        params.push(...allPhones);
      } else {
        query += ')';
      }
    } else if (allPhones.length > 0) {
      const phonePlaceholders = allPhones.map((_, i) => `$${params.length + i + 1}`).join(', ');
      query += ` AND b.invitee_phone IN (${phonePlaceholders})`;
      params.push(...allPhones);
    }

    query += ' ORDER BY b.booking_start_at DESC';

    const appointmentsResult = await pool.query(query, params);

    const appointments = appointmentsResult.rows.map(apt => {
      return {
        ...apt,
        booking_invitee_time: convertToIST(apt.booking_invitee_time),
        booking_start_at_raw: apt.booking_start_at,
        booking_end_at_raw: apt.booking_end_at,
        is_past: apt.is_past
      };
    });

    res.json({
      appointments
    });
  } catch (error) {
    console.error('Error fetching client details:', error);
    res.status(500).json({ error: 'Failed to fetch client details' });
  }
});

// Get therapist stats
app.get('/api/therapist-stats', async (req, res) => {
  try {
    // Prevent caching of stats data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { therapist_id, start, end } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    // Get user info to find therapist_id
    const userResult = await pool.query(
      'SELECT therapist_id, username FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;
    const therapistUsername = userResult.rows[0].username;

    // Get therapist info
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0] || { name: 'Ishika Mahajan', specialization: 'Individual Therapy' };
    const therapistFirstName = therapist.name.split(' ')[0];

    const hasDateFilter = start && end;

    // Calculate last month date range
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Get stats from bookings table with date filter using therapist name
    // Bookings - count everything for this therapist
    const bookings = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_start_at BETWEEN $2 AND $3',
        [`%${therapistFirstName}%`, start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1',
        [`%${therapistFirstName}%`]
      );

    // Sessions Completed - count ALL completed sessions where session date has passed
    const sessionsCompleted = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings 
           WHERE booking_host_name ILIKE $1
           AND booking_start_at < NOW()
           AND booking_status NOT IN ($2, $3, $4, $5)
           AND booking_start_at BETWEEN $6 AND $7`,
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', 'no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings 
           WHERE booking_host_name ILIKE $1
           AND booking_start_at < NOW()
           AND booking_status NOT IN ($2, $3, $4, $5)`,
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', 'no_show', 'no show']
      );

    const noShows = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
        [`%${therapistFirstName}%`, 'no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3)',
        [`%${therapistFirstName}%`, 'no_show', 'no show']
      );

    const cancelled = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3)',
        [`%${therapistFirstName}%`, 'cancelled', 'canceled']
      );

    const lastMonthSessions = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'confirmed', 'rescheduled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthNoShows = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'no_show', 'no show', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthCancelled = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'cancelled', 'canceled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const avgRating = await pool.query(
      `SELECT ROUND(AVG(client_rating::numeric), 1) as avg_rating FROM bookings WHERE booking_host_name ILIKE $1 AND client_rating IS NOT NULL`,
      [`%${therapistFirstName}%`]
    );


    // Get upcoming bookings directly from bookings table
    const upcomingResult = await pool.query(`
      SELECT 
        booking_id,
        invitee_name as client_name,
        booking_resource_name as session_name,
        booking_mode as mode,
        booking_invitee_time as session_timings,
        booking_start_at as booking_date
      FROM bookings
      WHERE booking_host_name ILIKE $1
        AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show')
      ORDER BY booking_start_at ASC
    `, [`%${therapistFirstName}%`]);

    // Filter upcoming sessions based on booking_invitee_time
    const nowUTC = new Date();
    const upcomingBookings = upcomingResult.rows.filter(row => {
      const timeMatch = (row.session_timings || '').match(/at\s+(\d+):(\d+)\s+([AP]M)\s+-\s+(\d+):(\d+)\s+([AP]M)/);

      if (timeMatch) {
        const dateStr = (row.session_timings || '').match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d+)/);

        if (dateStr) {
          const month = dateStr[2];
          const day = parseInt(dateStr[3]);
          const year = parseInt(dateStr[4]);

          // Parse end time
          let endHour = parseInt(timeMatch[4]);
          const endMinute = parseInt(timeMatch[5]);
          const endPeriod = timeMatch[6];

          // Convert to 24-hour format
          if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
          if (endPeriod === 'AM' && endHour === 12) endHour = 0;

          // Parse timezone offset
          const timezoneMatch = (row.session_timings || '').match(/GMT([+-])(\d+):(\d+)/);
          let timezoneOffset = 330; // Default to IST (+5:30)

          if (timezoneMatch) {
            const sign = timezoneMatch[1] === '+' ? 1 : -1;
            const hours = parseInt(timezoneMatch[2]);
            const minutes = parseInt(timezoneMatch[3]);
            timezoneOffset = sign * (hours * 60 + minutes);
          }

          // Create date in UTC
          const monthMap: { [key: string]: number } = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
          };

          const endDate = new Date(Date.UTC(year, monthMap[month], day, endHour, endMinute));
          // Adjust for timezone offset (subtract because we want UTC)
          endDate.setMinutes(endDate.getMinutes() - timezoneOffset);

          // Session is upcoming if end time hasn't passed
          return endDate > nowUTC;
        }
      }
      return false;
    }).slice(0, 10);

    res.json({
      therapist: {
        name: therapist.name,
        specialization: therapist.specialization
      },
      stats: {
        bookings: parseInt(bookings.rows[0].total) || 0,
        sessionsCompleted: parseInt(sessionsCompleted.rows[0].total) || 0,
        noShows: parseInt(noShows.rows[0].total) || 0,
        cancelled: parseInt(cancelled.rows[0].total) || 0,
        lastMonthSessions: parseInt(lastMonthSessions.rows[0].total) || 0,
        lastMonthNoShows: parseInt(lastMonthNoShows.rows[0].total) || 0,
        lastMonthCancelled: parseInt(lastMonthCancelled.rows[0].total) || 0,
        avgRating: avgRating.rows[0].avg_rating || null
      },
      upcomingBookings: upcomingBookings.map(booking => ({
        booking_id: booking.booking_id,
        client_name: booking.client_name,
        therapy_type: booking.session_name,
        mode: booking.mode?.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Google Meet',
        session_timings: convertToIST(booking.session_timings)
      }))
    });

  } catch (error) {
    console.error('Therapist stats error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist stats' });
  }
});

// Get therapist appointments
app.get('/api/therapist-appointments', async (req, res) => {
  try {
    const { therapist_id } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    const userResult = await pool.query(
      'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0];
    const therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';

    const appointmentsResult = await pool.query(`
      SELECT 
        b.booking_id,
        b.invitee_name as client_name,
        b.invitee_phone as contact_info,
        b.invitee_email,
        b.booking_resource_name as session_name,
        b.booking_invitee_time as session_timings,
        b.booking_mode as mode,
        b.booking_start_at as booking_date,
        b.booking_start_at,
        b.booking_status,
        b.booking_joining_link,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_host_name ILIKE $1
      ORDER BY b.booking_start_at DESC
    `, [`%${therapistFirstName}%`]);

    const appointments = appointmentsResult.rows.map(apt => ({
      ...apt,
      invitee_phone: apt.contact_info, // Add this for compatibility with getClientStatus
      session_timings: convertToIST(apt.session_timings),
      mode: apt.mode?.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Google Meet'
    }));

    res.json({ appointments });
  } catch (error) {
    console.error('Therapist appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist appointments' });
  }
});

// Get therapist clients
app.get('/api/therapist-clients', async (req, res) => {
  try {
    const { therapist_id } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    // Get user info to find therapist_id
    const userResult = await pool.query(
      'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;

    // Get therapist info to get the name
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0];
    const therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';

    // Get clients for this therapist with mode and session info
    const clientsResult = await pool.query(`
      SELECT 
        invitee_name as client_name,
        invitee_email as client_email,
        invitee_phone as client_phone,
        booking_start_at,
        booking_resource_name,
        booking_mode
      FROM bookings
      WHERE booking_host_name ILIKE $1
      ORDER BY booking_start_at DESC
    `, [`%${therapistFirstName}%`]);

    // Group by email (primary) or phone (fallback)
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    clientsResult.rows.forEach(row => {
      const email = row.client_email ? row.client_email.toLowerCase().trim() : null;
      const phone = row.client_phone ? row.client_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      // Check if email already exists
      if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
      }
      // Check if phone already exists
      else if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
      }
      // New client
      else {
        key = email || phone;
      }

      if (!key) return; // Skip if both are missing

      // Map both email and phone to this key
      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          client_name: row.client_name,
          client_phone: row.client_phone,
          client_email: row.client_email,
          total_sessions: 0,
          latest_booking_date: row.booking_start_at,
          booking_resource_name: row.booking_resource_name,
          booking_mode: row.booking_mode
        });
      }

      const client = clientMap.get(key);
      client.total_sessions += 1;

      // Update to most recent session info
      if (new Date(row.booking_start_at) > new Date(client.latest_booking_date)) {
        client.latest_booking_date = row.booking_start_at;
        client.client_phone = row.client_phone;
        client.booking_resource_name = row.booking_resource_name;
        client.booking_mode = row.booking_mode;
      }

      // Fill in missing email if found
      if (row.client_email && !client.client_email) {
        client.client_email = row.client_email;
        // Update emailToKey mapping
        emailToKey.set(email!, key);
      }
    });

    const clients = Array.from(clientMap.values()).map(client => {
      return {
        client_name: client.client_name,
        client_phone: client.client_phone,
        client_email: client.client_email,
        total_sessions: client.total_sessions,
        booking_resource_name: client.booking_resource_name,
        booking_mode: client.booking_mode,
        last_session_date: client.latest_booking_date
      };
    });

    res.json({ clients });

  } catch (error) {
    console.error('Therapist clients error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist clients' });
  }
});

// Get client appointments
app.get('/api/client-appointments', async (req, res) => {
  try {
    const { client_phone, therapist_id } = req.query;

    if (!client_phone) {
      return res.status(400).json({ error: 'Client phone is required' });
    }

    // Get therapist info
    let therapistFirstName = '';
    if (therapist_id) {
      const userResult = await pool.query(
        'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
        [therapist_id, 'therapist']
      );

      if (userResult.rows.length > 0) {
        const therapistUserId = userResult.rows[0].therapist_id;
        const therapistResult = await pool.query(
          'SELECT * FROM therapists WHERE therapist_id = $1',
          [therapistUserId]
        );

        const therapist = therapistResult.rows[0];
        therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';
      }
    }

    // First, find all emails and phones for this client using normalized phone matching
    const clientEmailResult = await pool.query(
      `SELECT DISTINCT invitee_email FROM bookings 
       WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
       AND invitee_email IS NOT NULL LIMIT 1`,
      [client_phone]
    );

    const clientEmail = clientEmailResult.rows.length > 0 ? clientEmailResult.rows[0].invitee_email : null;

    // Get all phone numbers associated with this email
    let allPhones = [client_phone as string];
    if (clientEmail) {
      const phonesResult = await pool.query(
        'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
        [clientEmail]
      );
      allPhones = phonesResult.rows.map(r => r.invitee_phone);
    }

    // Use normalized phone matching to handle +91 9999 vs +919999 variations
    const phoneConditions = allPhones.map((_, i) => 
      `regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($${clientEmail ? i + 2 : i + 1}::text, '[^0-9]', '', 'g')`
    ).join(' OR ');

    const query = therapistFirstName
      ? `SELECT 
          b.booking_id,
          b.booking_invitee_time as session_timings,
          b.booking_mode as mode,
          b.booking_start_at as booking_date,
          b.booking_status,
          b.invitee_payment_amount,
          b.emergency_contact_name,
          b.emergency_contact_relation,
          b.emergency_contact_number,
          b.invitee_age,
          b.invitee_gender,
          b.invitee_occupation,
          b.invitee_marital_status,
          b.clinical_profile,
          b.client_rating,
          CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
        FROM bookings b
        LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
        LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
        LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
        WHERE (${clientEmail ? 'b.invitee_email = $1 OR' : ''} ${phoneConditions})
          AND b.booking_host_name ILIKE $${clientEmail ? allPhones.length + 2 : allPhones.length + 1}
        ORDER BY b.booking_start_at DESC`
      : `SELECT 
          b.booking_id,
          b.booking_invitee_time as session_timings,
          b.booking_mode as mode,
          b.booking_start_at as booking_date,
          b.booking_status,
          b.invitee_payment_amount,
          b.emergency_contact_name,
          b.emergency_contact_relation,
          b.emergency_contact_number,
          b.invitee_age,
          b.invitee_gender,
          b.invitee_occupation,
          b.invitee_marital_status,
          b.clinical_profile,
          b.client_rating,
          CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
        FROM bookings b
        LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
        LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
        LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
        WHERE ${clientEmail ? 'b.invitee_email = $1 OR' : ''} ${phoneConditions}
        ORDER BY b.booking_start_at DESC`;

    const params = clientEmail
      ? (therapistFirstName ? [clientEmail, ...allPhones, `%${therapistFirstName}%`] : [clientEmail, ...allPhones])
      : (therapistFirstName ? [...allPhones, `%${therapistFirstName}%`] : allPhones);

    const appointmentsResult = await pool.query(query, params);

    const appointments = appointmentsResult.rows.map(row => ({
      booking_id: row.booking_id,
      session_timings: row.session_timings || 'N/A',
      mode: row.mode ? row.mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet',
      has_session_notes: row.has_session_notes,
      booking_status: row.booking_status,
      booking_date: row.booking_date,
      invitee_payment_amount: row.invitee_payment_amount,
      emergency_contact_name: row.emergency_contact_name,
      emergency_contact_relation: row.emergency_contact_relation,
      emergency_contact_number: row.emergency_contact_number,
      invitee_age: row.invitee_age,
      invitee_gender: row.invitee_gender,
      invitee_occupation: row.invitee_occupation,
      invitee_marital_status: row.invitee_marital_status,
      clinical_profile: row.clinical_profile
    }));

    res.json({ appointments });
  } catch (error) {
    console.error('Client appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch client appointments' });
  }
});


// Get therapist average rating
app.get('/api/therapist-avg-rating', async (req, res) => {
  try {
    const { therapist_name } = req.query;
    if (!therapist_name) return res.status(400).json({ error: 'therapist_name required' });

    const result = await pool.query(`
      SELECT 
        ROUND(AVG(client_rating::numeric), 1) as avg_rating,
        COUNT(*) FILTER (WHERE client_rating IS NOT NULL) as total_ratings
      FROM bookings
      WHERE booking_host_name ILIKE $1
      AND client_rating IS NOT NULL
    `, [`%${therapist_name}%`]);

    res.json({
      avg_rating: result.rows[0].avg_rating || null,
      total_ratings: parseInt(result.rows[0].total_ratings) || 0
    });
  } catch (error) {
    console.error('Error fetching avg rating:', error);
    res.status(500).json({ error: 'Failed to fetch rating' });
  }
});

// Transfer client endpoint
app.post('/api/transfer-client', async (req, res) => {

  try {
    const {
      clientName,
      clientEmail,
      clientPhone,
      fromTherapistName,
      toTherapistId,
      transferredByAdminId,
      transferredByAdminName,
      reason
    } = req.body;

    // Get new therapist details
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [toTherapistId]
    );

    if (therapistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    const newTherapist = therapistResult.rows[0];

    // Get old therapist ID
    const oldTherapistResult = await pool.query(
      'SELECT therapist_id FROM therapists WHERE name = $1',
      [fromTherapistName]
    );

    const fromTherapistId = oldTherapistResult.rows[0]?.therapist_id || null;

    // Update all bookings to new therapist
    const updateResult = await pool.query(
      `UPDATE bookings 
       SET booking_host_name = $1, therapist_id = $2
       WHERE ((invitee_email IS NOT NULL AND invitee_email = $3) 
              OR (invitee_phone IS NOT NULL AND invitee_phone = $4))
       AND booking_host_name = $5`,
      [newTherapist.name, toTherapistId, clientEmail || '', clientPhone || '', fromTherapistName]
    );

    // Insert transfer record
    await pool.query(
      `INSERT INTO client_transfer_history 
       (client_name, client_email, client_phone, from_therapist_id, from_therapist_name, 
        to_therapist_id, to_therapist_name, transferred_by_admin_id, transferred_by_admin_name, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        clientName,
        clientEmail,
        clientPhone,
        fromTherapistId,
        fromTherapistName,
        toTherapistId,
        newTherapist.name,
        transferredByAdminId,
        transferredByAdminName,
        reason
      ]
    );

    // Log client transfer
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [transferredByAdminId, transferredByAdminName, 'client_transfer',
        `Transferred ${clientName} from ${fromTherapistName} to ${newTherapist.name}`, clientName, getCurrentISTTimestamp()]
    );

    // Trigger n8n webhook
    const webhookData = {
      clientName,
      clientEmail,
      clientPhone,
      fromTherapist: fromTherapistName,
      fromTherapistId: fromTherapistId || 'N/A',
      toTherapist: newTherapist.name,
      toTherapistId: toTherapistId,
      transferredBy: transferredByAdminName,
      reason: reason || 'No reason provided',
      timestamp: new Date().toISOString()
    };
    const webhookUrl = `https://n8n.srv1169280.hstgr.cloud/webhook/efc4396f-401b-4d46-bfdb-e990a3ac3846?${new URLSearchParams(webhookData as any).toString()}`;

    try {
      const webhookResponse = await fetch(webhookUrl, {
        method: 'GET'
      });
      const webhookResponseData = await webhookResponse.text();
    } catch (webhookError) {
      console.error('Webhook error:', webhookError);
    }

    // Notify new therapist
    const newTherapistUser = await pool.query(
      "SELECT id FROM users WHERE therapist_id = $1 AND role = 'therapist'",
      [toTherapistId]
    );
    if (newTherapistUser.rows.length > 0) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [newTherapistUser.rows[0].id, 'therapist', 'client_transfer', 'New Client Assigned',
        `Client ${clientName} has been transferred to you from ${fromTherapistName}`]
      );
    }

    // Notify old therapist
    if (fromTherapistId) {
      const oldTherapistUser = await pool.query(
        "SELECT id FROM users WHERE therapist_id = $1 AND role = 'therapist'",
        [fromTherapistId]
      );
      if (oldTherapistUser.rows.length > 0) {
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [oldTherapistUser.rows[0].id, 'therapist', 'client_transfer', 'Client Transferred',
          `Client ${clientName} has been transferred to ${newTherapist.name}`]
        );
      }
    }



    res.json({ success: true, message: 'Client transferred successfully' });
  } catch (error) {
    console.error('Error transferring client:', error);
    res.status(500).json({ success: false, error: 'Failed to transfer client' });
  }
});

// Get audit logs (last 30 days only for frontend)
app.get('/api/audit-logs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       WHERE is_visible = true 
       ORDER BY log_id DESC 
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Clear audit logs (soft delete)
app.post('/api/audit-logs/clear', async (req, res) => {
  try {
    await pool.query('UPDATE audit_logs SET is_visible = false WHERE is_visible = true');
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing audit logs:', error);
    res.status(500).json({ error: 'Failed to clear audit logs' });
  }
});

// Get CRM audit logs
app.get('/api/crm-audit-logs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM crm_audit_logs 
       ORDER BY timestamp DESC 
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching CRM audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch CRM audit logs' });
  }
});

// Create CRM audit log
app.post('/api/crm-audit-logs', async (req, res) => {
  try {
    const { user_id, user_name, action_type, action_description, lead_id, lead_name, metadata } = req.body;
    
    const result = await pool.query(
      `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user_id, user_name, action_type, action_description, lead_id, lead_name, metadata ? JSON.stringify(metadata) : null]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating CRM audit log:', error);
    res.status(500).json({ error: 'Failed to create CRM audit log' });
  }
});

// Create audit log
app.post('/api/audit-logs', async (req, res) => {
  try {
    const { therapist_id, therapist_name, action_type, action_description, client_name, ip_address } = req.body;
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, ip_address, timestamp, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [therapist_id, therapist_name, action_type, action_description, client_name, ip_address, getCurrentISTTimestamp()]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error creating audit log:', error);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
  try {
    const { user } = req.body;

    if (user?.role === 'therapist') {
      try {
        await pool.query(
          `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, timestamp, is_visible)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [user.therapist_id, user.username, 'logout', `${user.username} logged out`, getCurrentISTTimestamp()]
        );
      } catch (auditError) {
        console.error('❌ Failed to create audit log for logout:', auditError);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// Get additional notes for a booking
app.get('/api/additional-notes', async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      'SELECT * FROM client_additional_notes WHERE booking_id = $1 ORDER BY created_at DESC',
      [booking_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching additional notes:', error);
    res.status(500).json({ error: 'Failed to fetch additional notes' });
  }
});

// Save/Update additional note
app.post('/api/additional-notes', async (req, res) => {
  try {
    const { note_id, booking_id, therapist_id, therapist_name, note_text } = req.body;

    if (!booking_id || !therapist_id || !note_text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (note_id) {
      // Update existing note
      await pool.query(
        'UPDATE client_additional_notes SET note_text = $1, updated_at = CURRENT_TIMESTAMP WHERE note_id = $2',
        [note_text, note_id]
      );
    } else {
      // Insert new note
      await pool.query(
        'INSERT INTO client_additional_notes (booking_id, therapist_id, therapist_name, note_text) VALUES ($1, $2, $3, $4)',
        [booking_id, therapist_id, therapist_name, note_text]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving additional note:', error);
    res.status(500).json({ error: 'Failed to save additional note' });
  }
});

// Get session notes
app.get('/api/session-notes', async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      `SELECT csn.*, b.booking_invitee_time as session_timing
       FROM client_session_notes csn
       LEFT JOIN bookings b ON csn.booking_id = b.booking_id
       WHERE csn.booking_id = $1`,
      [booking_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session notes not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching session notes:', error);
    res.status(500).json({ error: 'Failed to fetch session notes' });
  }
});

// Get paperform link
app.get('/api/paperform-link', async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      'SELECT custom_form_link FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (result.rows.length > 0) {
      res.json({ paperform_link: result.rows[0].custom_form_link });
    } else {
      res.json({ paperform_link: null });
    }
  } catch (error) {
    console.error('Error fetching paperform link:', error);
    res.status(500).json({ error: 'Failed to fetch paperform link' });
  }
});

// Get session info for in-app session notes form
app.get('/api/session-notes-info', async (req, res) => {
  try {
    const { booking_id } = req.query;
    if (!booking_id) return res.status(400).json({ error: 'Booking ID is required' });

    const result = await pool.query(
      `SELECT
        b.booking_id,
        b.invitee_name AS client_name,
        b.invitee_email,
        b.invitee_phone,
        b.booking_start_at,
        b.booking_end_at,
        b.booking_duration,
        COALESCE(
          NULLIF(b.booking_mode, \x27\x27),
          (
            SELECT b3.booking_mode FROM bookings b3
            WHERE (LOWER(TRIM(b3.invitee_email)) = LOWER(TRIM(b.invitee_email)) 
               OR (regexp_replace(b3.invitee_phone, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
              AND b3.booking_mode IS NOT NULL
              AND b3.booking_mode != ''
            ORDER BY b3.booking_start_at DESC
            LIMIT 1
          )
        ) AS booking_mode,
        b.booking_status,
        b.booking_host_name AS therapist_name,
        b.booking_invitee_time,
        b.booking_resource_name AS session_name,
        b.booking_subject,
        act.client_id,
        (
          SELECT COUNT(*) FROM bookings b2
          WHERE (LOWER(TRIM(b2.invitee_email)) = LOWER(TRIM(b.invitee_email))
             OR (regexp_replace(b2.invitee_phone, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
            AND b2.booking_start_at <= b.booking_start_at
            AND b2.booking_status NOT IN ('cancelled', 'canceled')
        ) AS session_number
      FROM bookings b
      LEFT JOIN all_clients_table act ON (LOWER(TRIM(act.email_id)) = LOWER(TRIM(b.invitee_email)) OR (regexp_replace(act.phone_number, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
      WHERE b.booking_id = $1
      LIMIT 1`,
      [booking_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const row = result.rows[0];
    const startAt = new Date(row.booking_start_at);
    const endAt = new Date(row.booking_end_at);

    const fmt = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const inviteeTime = row.booking_invitee_time || '';
    let sessionTiming = `${fmt(startAt)} – ${fmt(endAt)}`;
    if (inviteeTime.includes(' at ')) {
      sessionTiming = inviteeTime.split(' at ')[1].replace(' - ', ' – ');
    }

    const isConsultation = 
      row.booking_subject?.toLowerCase().includes('consultation') || 
      row.booking_subject?.toLowerCase().includes('pre-therapy') ||
      row.booking_duration === 15 ||
      row.booking_host_name?.toLowerCase().trim() === 'safestories';

    // Auto-populate custom_form_link in DB for consultations if empty
    if (isConsultation) {
      const host = req.headers.host || '';
      const baseUrl = host.includes('localhost') ? 'http://localhost:3004' : 'https://safestories-dashboard.vercel.app';
      const publicLink = `${baseUrl}/session-notes/${row.booking_id}`;
      
      // Upsert into client_doc_form
      await pool.query(`
        INSERT INTO client_doc_form (booking_id, status, custom_form_link)
        VALUES ($1, 'pending', $2)
        ON CONFLICT (booking_id) DO UPDATE SET
          custom_form_link = EXCLUDED.custom_form_link
        WHERE (client_doc_form.custom_form_link IS NULL 
           OR client_doc_form.custom_form_link = '' 
           OR client_doc_form.custom_form_link LIKE '%paperform.co%')
      `, [row.booking_id, publicLink]);
    }

    res.json({
      clientName: row.client_name || '',
      clientId: row.client_id || '',
      bookingId: row.booking_id,
      bookingSubject: row.booking_subject || '',
      sessionDate: fmtDate(startAt),
      sessionTiming,
      sessionDuration: isConsultation ? '15 min' : (row.booking_duration ? `${row.booking_duration} min` : ''),
      therapistName: isConsultation ? 'Safestories' : (row.therapist_name || ''),
      modeOfSession: row.booking_mode || '',
      bookingStatus: row.booking_status || '',
      sessionNumber: parseInt(row.session_number) || 0,
    });
  } catch (error) {
    console.error('Error fetching session notes info:', error);
    res.status(500).json({ error: 'Failed to fetch session info' });
  }
});

// Save/Update session notes
app.post('/api/session-notes', async (req, res) => {
  try {
    const { booking_id, therapist_id, therapist_name, client_name, notes } = req.body;

    if (!booking_id || !therapist_id || !notes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if notes exist
    const existing = await pool.query(
      'SELECT note_id FROM client_session_notes WHERE booking_id = $1',
      [booking_id]
    );

    if (existing.rows.length > 0) {
      // Update existing notes
      await pool.query(
        'UPDATE client_session_notes SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $2',
        [notes, booking_id]
      );
    } else {
      // Insert new notes
      await pool.query(
        'INSERT INTO client_session_notes (booking_id, therapist_id, notes) VALUES ($1, $2, $3)',
        [booking_id, therapist_id, notes]
      );
    }

    // Log session note update
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [therapist_id, therapist_name, 'session_notes',
        `${existing.rows.length > 0 ? 'Updated' : 'Added'} session notes for ${client_name}`, client_name, getCurrentISTTimestamp()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving session notes:', error);
    res.status(500).json({ error: 'Failed to save session notes' });
  }
});

// Cancel booking
app.post('/api/bookings/cancel', async (req, res) => {
  try {
    const { booking_id, therapist_id, therapist_name, client_name, reason } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    // Update booking status
    await pool.query(
      'UPDATE bookings SET booking_status = $1 WHERE booking_id = $2',
      ['cancelled', booking_id]
    );

    // Log cancellation
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [therapist_id, therapist_name, 'booking_cancel',
        `Cancelled booking for ${client_name}${reason ? ': ' + reason : ''}`, client_name, getCurrentISTTimestamp()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

// Get refunds and cancellations
app.get('/api/refunds', async (req, res) => {
  try {
    const { status } = req.query;
    const statusStr = typeof status === 'string' ? status : '';

    let query = `
      SELECT 
        r.client_name,
        r.session_name,
        r.session_timings,
        b.refund_status,
        COALESCE(b.invitee_phone, '') as invitee_phone,
        COALESCE(b.invitee_email, '') as invitee_email,
        COALESCE(b.refund_amount, 0) as refund_amount,
        COALESCE(b.invitee_payment_gateway, '') as payment_gateway
      FROM refund_cancellation_table r
      LEFT JOIN bookings b ON r.session_id = b.booking_id
      WHERE b.booking_status IN ('cancelled', 'canceled')
        AND b.refund_status IS NOT NULL
        AND LOWER(b.refund_status) IN ('initiated', 'failed')
    `;

    const params: any[] = [];

    if (statusStr && statusStr !== 'all') {
      if (statusStr.toLowerCase() === 'pending') {
        query += " AND LOWER(b.refund_status) = 'initiated'";
      } else {
        query += ' AND LOWER(b.refund_status) = LOWER($1)';
        params.push(statusStr);
      }
    }

    query += ' ORDER BY r.session_timings DESC';

    const result = await pool.query(query, params);

    const refunds = result.rows.map(row => {
      let formattedTimings = 'N/A';
      if (row.session_timings) {
        const date = new Date(row.session_timings);
        const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
        const endDate = new Date(istDate.getTime() + (50 * 60 * 1000));

        const formatTime = (d: Date) => {
          const hours = d.getHours();
          const minutes = d.getMinutes();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const hour12 = hours % 12 || 12;
          return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };

        const weekday = istDate.toLocaleDateString('en-US', { weekday: 'long' });
        const month = istDate.toLocaleDateString('en-US', { month: 'short' });
        const day = istDate.getDate();
        const year = istDate.getFullYear();

        formattedTimings = `${weekday}, ${month} ${day}, ${year} at ${formatTime(istDate)} - ${formatTime(endDate)} IST`;
      }

      return {
        ...row,
        session_timings: formattedTimings,
        refund_status: row.refund_status
      };
    });

    res.json(refunds);
  } catch (error) {
    console.error('Error fetching refunds:', error);
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// Get payments
app.get('/api/payments', async (req, res) => {
  try {
    const { status } = req.query;

    let query = 'SELECT * FROM dashboard_api_booking WHERE payment_amount IS NOT NULL AND payment_amount > 0';

    if (status && status !== 'all_payments') {
      if (status === 'completed') {
        query += " AND payment_status = 'Completed'";
      } else if (status === 'pending') {
        query += " AND payment_status = 'Pending'";
      } else if (status === 'expired') {
        query += " AND payment_status = 'Failed'";
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query);

    const payments = result.rows.map(row => {
      let formattedTimings = 'N/A';
      if (row.start_at) {
        const date = new Date(row.start_at);
        const endDate = new Date(row.end_at || date.getTime() + (50 * 60 * 1000));

        const formatTime = (d: Date) => {
          const hours = d.getHours();
          const minutes = d.getMinutes();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const hour12 = hours % 12 || 12;
          return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };

        const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
        const month = date.toLocaleDateString('en-US', { month: 'short' });
        const day = date.getDate();
        const year = date.getFullYear();

        formattedTimings = `${weekday}, ${month} ${day}, ${year} at ${formatTime(date)} - ${formatTime(endDate)} IST`;
      }

      return {
        client_name: row.invitee_name,
        session_name: row.booking_resource_name,
        session_timings: formattedTimings,
        payment_status: row.payment_status,
        invitee_phone: row.invitee_phone || '',
        invitee_email: row.invitee_email || '',
        payment_amount: row.payment_amount || 0
      };
    });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Get notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const { user_id, user_role } = req.query;

    if (!user_id || !user_role) {
      return res.status(400).json({ error: 'User ID and role required' });
    }

    const result = await pool.query(
      `SELECT notification_id, user_id, user_role, notification_type, title, message, is_read,
              (created_at AT TIME ZONE 'Asia/Kolkata') as created_at, related_id
       FROM notifications WHERE user_id = $1 AND user_role = $2 ORDER BY created_at DESC LIMIT 50`,
      [user_id, user_role]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get client profile
app.get('/api/client-profile', async (req, res) => {
  try {
    const { userId } = req.query;

    const userResult = await pool.query(
      'SELECT id, username, full_name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const bookingResult = await pool.query(
      `SELECT invitee_phone, invitee_email, emergency_contact_name, emergency_contact_number 
       FROM bookings 
       WHERE invitee_name ILIKE $1 
       ORDER BY invitee_created_at DESC 
       LIMIT 1`,
      [`%${user.full_name}%`]
    );

    const booking = bookingResult.rows[0] || {};

    res.json({
      full_name: user.full_name,
      whatsapp_no: booking.invitee_phone?.replace('+91 ', '') || '',
      email: booking.invitee_email || '',
      emergency_contact_name: booking.emergency_contact_name || '',
      emergency_contact_number: booking.emergency_contact_number || ''
    });
  } catch (error) {
    console.error('Error fetching client profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update client profile
app.post('/api/client-profile', async (req, res) => {
  try {
    const { userId, fullName } = req.body;

    await pool.query(
      'UPDATE users SET full_name = $1 WHERE id = $2',
      [fullName, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating client profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE notifications SET is_read = true WHERE notification_id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
app.put('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const { user_id, user_role } = req.body;
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND user_role = $2',
      [user_id, user_role]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Delete notification
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM notifications WHERE notification_id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Create notification for all admins
app.post('/api/notifications/create-admin', async (req, res) => {
  try {
    const { notification_type, title, message, related_id } = req.body;

    // Deduplication: skip if a notification with same related_id + type already exists for any admin
    if (related_id) {
      const dupCheck = await pool.query(
        `SELECT 1 FROM notifications WHERE related_id = $1 AND notification_type = $2 AND user_role = 'admin' LIMIT 1`,
        [String(related_id), notification_type]
      );
      if (dupCheck.rows.length > 0) {
        console.log(`[Notifications] Skipping duplicate ${notification_type} for related_id=${related_id}`);
        return res.json({ success: true, skipped: true });
      }
    }

    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', notification_type, title, message, related_id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating admin notifications:', error);
    res.status(500).json({ error: 'Failed to create notifications' });
  }
});

// Webhook to notify new bookings
app.post('/api/webhooks/new-booking', async (req, res) => {
  try {
    const { booking_id } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID required' });
    }

    const bookingResult = await pool.query(
      `SELECT b.booking_id, b.invitee_name, b.invitee_email, b.invitee_phone, 
              b.booking_resource_name, b.booking_host_name, b.invitee_payment_amount,
              t.therapist_id, u.id as user_id
       FROM bookings b
       LEFT JOIN therapists t ON LOWER(TRIM(b.booking_host_name)) = LOWER(TRIM(t.name))
                              OR LOWER(TRIM(b.booking_host_name)) ILIKE '%' || LOWER(TRIM(t.name)) || '%'
       LEFT JOIN users u ON u.therapist_id = t.therapist_id
       WHERE b.booking_id = $1`,
      [booking_id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    
    // ── Dedup: skip if we already sent a notification for this booking_id ──
    const existingNotif = await pool.query(
      `SELECT 1 FROM notifications WHERE related_id = $1 AND notification_type = 'new_booking' LIMIT 1`,
      [booking_id]
    );
    if (existingNotif.rows.length > 0) {
      return res.json({ success: true, skipped: true, reason: 'Notification already sent for this booking' });
    }

    // Resolve therapist internal ID (users.id) from bookings table
    const therapistExternalId = booking.therapist_id || booking.booking_host_user_id?.toString();
    let therapistInternalId = null;

    if (therapistExternalId) {
      const userRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [therapistExternalId]
      );
      if (userRes.rows.length > 0) {
        therapistInternalId = userRes.rows[0].id;
      }
    }
    
    // Store public booking checkin URL
    const publicBookingCheckinUrl = `https://safestories-dashboard.vercel.app/booking-confirmation/${booking_id}`;
    await pool.query(
      `UPDATE bookings SET public_booking_checkin_url = $1 WHERE booking_id = $2`,
      [publicBookingCheckinUrl, booking_id]
    );

    // Auto-populate client_doc_form with public session notes link
    const publicSessionNotesUrl = `https://safestories-dashboard.vercel.app/session-notes/${booking_id}`;
    await pool.query(`
      INSERT INTO client_doc_form (booking_id, status, custom_form_link)
      VALUES ($1, 'pending', $2)
      ON CONFLICT (booking_id) DO UPDATE SET
        custom_form_link = EXCLUDED.custom_form_link
      WHERE (client_doc_form.custom_form_link IS NULL OR client_doc_form.custom_form_link = '')
    `, [booking_id, publicSessionNotesUrl]);


    try {
      const inviteePhone = booking.invitee_phone ? booking.invitee_phone.replace(/[\s\-\(\)\+]/g, '') : '';
      const inviteeEmail = booking.invitee_email ? booking.invitee_email.toLowerCase().trim() : '';

        if (inviteePhone || inviteeEmail) {
          // Determine if it's a Free Consultation
          const isFreeConsultation = (booking.booking_resource_name || '').toLowerCase().includes('free consultation') || 
                                     (booking.booking_resource_name || '').toLowerCase().includes('pre-therapy') ||
                                     parseFloat(booking.invitee_payment_amount || '0') === 0;

          // Find matching lead - normalizing phone for comparison
          const leadResult = await pool.query(
            `SELECT id, name, pipeline_stage FROM leads 
             WHERE (RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10) 
                OR LOWER(TRIM(email)) = $2)
             ORDER BY created_at DESC LIMIT 1`,
            [inviteePhone, inviteeEmail]
          );

          if (leadResult.rows.length > 0) {
            const lead = leadResult.rows[0];
            const currentStage = lead.pipeline_stage;
            
            let targetStage = null;
            let timestampColumn = null;

            if (isFreeConsultation) {
              // Move to pretherapy-call if in an earlier stage
              const earlyStages = ['lead-inquire', 'contacted', 'followup-1', 'followup-2', 'followup-3'];
              if (earlyStages.includes(currentStage)) {
                targetStage = 'pretherapy-call';
                timestampColumn = 'stage_pretherapy_call_at';
              }
            } else {
              // Paid session: Move to booked-first-session if in an earlier stage
              // Inclusive of: lead-inquire, contacted, pretherapy-call, and all follow-up stages
              const convertStages = ['lead-inquire', 'contacted', 'pretherapy-call', 'followup-1', 'followup-2', 'followup-3', 'dropouts', 'leaks'];
              if (convertStages.includes(currentStage)) {
                targetStage = 'booked-first-session';
                timestampColumn = 'stage_booked_first_session_at';
              }
            }

            if (targetStage && currentStage !== targetStage) {
              const dateStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
              const remark = `\n[System ${dateStr}]: Auto-moved to ${targetStage} due to booking ${booking_id} (${isFreeConsultation ? 'Free' : 'Paid'})`;
              
              // Assign therapist from booking (using resolved internal ID)
              const therapistId = therapistInternalId || null;

              await pool.query(
                `UPDATE leads 
                 SET pipeline_stage = $1, 
                     ${timestampColumn} = CURRENT_TIMESTAMP,
                     remark_lead_manager = COALESCE(remark_lead_manager, '') || $2,
                     therapist_id = COALESCE($4, therapist_id),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [targetStage, remark, lead.id, therapistId]
              );
              console.log(`✨ [Auto-Move] Lead "${lead.name}" (${lead.id}) moved: ${currentStage} → ${targetStage} (Therapist: ${therapistId || 'N/A'})`);
            }
          } else {
          // --- AUTO-CREATE LEAD ---
          // If it's a Free Consultation and we have a phone, create a new lead automatically
          if (isFreeConsultation && inviteePhone) {
            // Find default lead manager (admin user) to assign
            const defaultManager = await pool.query(
              `SELECT id FROM users WHERE role IN ('admin', 'sales') ORDER BY id LIMIT 1`
            );
            const salesAgentId = defaultManager.rows[0]?.id || null;

            await pool.query(
              `INSERT INTO leads (name, phone, email, source, sales_agent_id, status, pipeline_stage, stage_pretherapy_call_at, remark_lead_manager)
               VALUES ($1, $2, $3, $4, $5, 'New', 'pretherapy-call', CURRENT_TIMESTAMP, $6)`,
              [
                booking.invitee_name,
                booking.invitee_phone,
                booking.invitee_email || null,
                'Free Consultation',
                salesAgentId,
                `Auto-created from Free Consultation booking ID: ${booking_id}`
              ]
            );
            console.log(`✅ [Auto-Create] Lead for free consultation: "${booking.invitee_name}" (${booking.invitee_phone})`);
          }
        }
      }
    } catch (moveErr) {
      console.error('❌ [Auto-Move] Error processing lead movement:', moveErr);
      // Main webhook continues even if secondary logic fails
    }
    // -------------------------------------

    // Clean session name: strip ' with TherapistName' suffix; convert venue addresses to 'In-person Session'
    const rawName = booking.booking_resource_name || '';
    const sessionName = rawName.startsWith('In-person (') || rawName.startsWith('In-Person (')
      ? 'In-person Session'
      : rawName.replace(/ with [^"]+$/, '').trim() || 'Session';

    // Notify therapist
    if (therapistInternalId) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [therapistInternalId, 'therapist', 'new_booking', 'New Booking Assigned',
         `New session "${sessionName}" booked with ${booking.invitee_name}`, booking.booking_id]
      );
    }

    // Notify all admins
    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', 'new_booking', 'New Booking Created',
         `${booking.invitee_name} booked "${sessionName}" with ${booking.booking_host_name}`, booking.booking_id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error notifying new booking:', error);
    res.status(500).json({ error: 'Failed to notify new booking' });
  }
});

// Send booking link webhook
app.post('/api/send-booking-link', async (req, res) => {
  try {
    const { clientName, email, phone, therapistName, therapy } = req.body;

    // Validate required fields
    if (!clientName) {
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });
    }

    const webhookData = {
      clientName,
      email,
      phone,
      therapistName: therapistName || 'Safestories',
      therapy: therapy || 'Free Consultation'
    };

    try {
      // Send to n8n webhook
      const webhookUrl = process.env.N8N_WEBHOOK_SOS_EMAIL;

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SafeStories-Backend/1.0'
        },
        body: JSON.stringify(webhookData)
      });

      const responseText = await response.text();

      if (response.ok) {
        res.status(200).json({ success: true, message: 'Booking link sent successfully' });
      } else {
        console.error('❌ Webhook failed:', response.status, response.statusText);
        console.error('❌ Error response:', responseText);

        // Return success to frontend but log the webhook issue
        res.status(200).json({
          success: true,
          message: 'Request processed (webhook service unavailable)',
          warning: 'n8n webhook returned error - check n8n dashboard'
        });
      }
    } catch (fetchError) {
      console.error('❌ Network error calling webhook:', fetchError);

      // Return success to frontend but log the network issue
      res.status(200).json({
        success: true,
        message: 'Request processed (webhook service unavailable)',
        warning: 'Could not reach n8n webhook service'
      });
    }
  } catch (error) {
    console.error('❌ Error in booking link endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/fetch-slots', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload.selectedDate || !payload.timezone) {
      return res.status(400).json({ error: 'Missing required fields: date and timezone' });
    }

    console.log('--- FETCH SLOTS DEBUG ---');
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    // Updated to dynamic webhook selection provided by user
    let webhookUrl = process.env.N8N_WEBHOOK_FETCH_SLOTS_PUBLIC; // Default: Public

    if (payload.isAdmin) {
      if (payload.isDirectBooking) {
        webhookUrl = process.env.N8N_WEBHOOK_FETCH_SLOTS_ADMIN_DIRECT; // Admin Direct Slots
      } else {
        webhookUrl = process.env.N8N_WEBHOOK_FETCH_SLOTS_ADMIN_PAYMENT; // Admin With Payment Slots
      }
    }
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log('📥 Webhook Response Text:', responseText);

    if (response.ok) {
      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText);

        // FILTER LOGIC: Remove slots on days the therapist is unavailable according to DaySchedule
        if (Array.isArray(jsonResponse) && jsonResponse[0] && jsonResponse[0]["Available Slots"]) {
          const therapistName = payload.therapistName;
          
          if (therapistName) {
            if (therapistName === 'SafeStories') {
              // SafeStories allows all slots
            } else {
              const therapistResult = await pool.query(
                'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
                [therapistName.trim().toLowerCase()]
              );
              
              if (therapistResult.rows.length > 0 && therapistResult.rows[0].schedule_id) {
                const scheduleId = therapistResult.rows[0].schedule_id;
                
                try {
                  const scheduleRes = await fetch(`https://n8n.srv1169280.hstgr.cloud/webhook/424780e4-8e10-4308-84fd-5925450cc123?scheduleId=${scheduleId}`);
                  if (scheduleRes.ok) {
                    const scheduleData = await scheduleRes.json();
                    if (Array.isArray(scheduleData) && scheduleData[0] && Array.isArray(scheduleData[0].availability)) {
                      const availabilityRules = scheduleData[0].availability;
                      
                      const daysMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                      
                      const originalSlots = jsonResponse[0]["Available Slots"];
                      const filteredSlots = originalSlots.filter((slotISO: string) => {
                        const d = new Date(slotISO);
                        const dayString = daysMap[d.getDay()];
                        
                        const rule = availabilityRules.find((r: any) => r.day === dayString);
                        if (rule && rule.is_available === false) {
                          return false; // Remove this slot
                        }
                        return true;
                      });
                      
                      console.log(`[Fetch Slots Filter] Original slots: ${originalSlots.length}, Filtered slots: ${filteredSlots.length}`);
                      jsonResponse[0]["Available Slots"] = filteredSlots;
                    }
                  }
                } catch (err) {
                  console.error('[Fetch Slots Filter] Failed to apply availability rules:', err);
                }
              } else {
                console.log(`[Fetch Slots Filter] Therapist ${therapistName} has no schedule connected. Clearing all slots.`);
                jsonResponse[0]["Available Slots"] = [];
              }
            }
          }
        }
      } catch (e) {
        jsonResponse = responseText;
      }
      res.status(200).json(jsonResponse);
    } else {
      console.error('❌ Slots Webhook failed:', response.status, response.statusText);
      res.status(response.status).json({ error: 'Webhook failed', details: responseText });
    }
  } catch (error) {
    console.error('❌ Error in fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Direct Booking webhook proxy
app.post('/api/create-booking', async (req, res) => {
  try {
    const payload = req.body;

    try {
      // Send to n8n webhook
      // Updated to dynamic webhook selection provided by user
      let webhookUrl = process.env.N8N_WEBHOOK_CREATE_BOOKING_PUBLIC; // Default: Public

      if (payload.isAdmin && payload.skipPayment) {
        webhookUrl = process.env.N8N_WEBHOOK_CREATE_BOOKING_ADMIN_DIRECT; // Admin Direct Create
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SafeStories-Backend/1.0'
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();

      if (response.ok) {
        let jsonResponse;
        try {
          jsonResponse = JSON.parse(responseText);
        } catch (e) {
          jsonResponse = { success: true, message: responseText };
        }
        // Logic to store the public check-in URL for new bookings
        // This ensures the link is available in the database for WhatsApp automation
        const booking_id = jsonResponse.booking_id || jsonResponse.id || payload.bookingId;
        if (booking_id) {
          const publicLink = `https://safestories-dashboard.vercel.app/booking-confirmation/${booking_id}`;
          console.log(`[Create Booking] Storing public confirmation link for booking ${booking_id}: ${publicLink}`);
          // Retry up to 5 times with 1s delay — n8n may not have inserted the row yet
          let stored = false;
          for (let attempt = 1; attempt <= 5; attempt++) {
            await new Promise(r => setTimeout(r, 1000));
            const result = await pool.query(
              'UPDATE bookings SET public_booking_checkin_url = $1 WHERE booking_id = $2',
              [publicLink, booking_id]
            );
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[Create Booking] Stored public link on attempt ${attempt}`);
              stored = true;
              break;
            }
            console.log(`[Create Booking] Attempt ${attempt}: booking not in DB yet, retrying...`);
          }
          if (!stored) {
            console.warn(`[Create Booking] Could not store public link for booking ${booking_id} after 5 attempts`);
          }
        }

        res.status(200).json(jsonResponse);
      } else {
        console.error('❌ Create Booking Webhook failed:', response.status, response.statusText);
        res.status(response.status).json({
          error: 'Webhook service unavailable',
          details: responseText
        });
      }
    } catch (fetchError) {
      console.error('❌ Network error calling create booking webhook:', fetchError);
      res.status(503).json({ error: 'Could not reach webhook service' });
    }
  } catch (error) {
    console.error('❌ Error in create-booking endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SOS Risk Assessments endpoints
app.post('/api/sos-assessments', async (req, res) => {
  try {
    const {
      booking_id,
      therapist_id,
      therapist_name,
      client_name,
      session_name,
      session_timings,
      contact_info,
      mode,
      risk_assessment
    } = req.body;

    // Validate required fields
    if (!risk_assessment || !risk_assessment.severity_level || !risk_assessment.risk_summary) {
      return res.status(400).json({ error: 'Missing required risk assessment data' });
    }

    const insertQuery = `
      INSERT INTO sos_risk_assessments (
        booking_id, therapist_id, therapist_name, client_name, session_name,
        session_timings, contact_info, mode,
        risk_severity_level, risk_severity_description,
        emotional_dysregulation, physical_harm_ideas, drug_alcohol_abuse,
        suicidal_attempt, self_harm, delusions_hallucinations, impulsiveness,
        severe_stress, social_isolation, concern_by_others, other_risk,
        other_details, risk_summary
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
      ) RETURNING id, created_at
    `;

    const values = [
      booking_id,
      therapist_id,
      therapist_name,
      client_name,
      session_name,
      session_timings,
      contact_info,
      mode,
      risk_assessment.severity_level,
      risk_assessment.severity_description,
      risk_assessment.risk_indicators?.emotionalDysregulation || null,
      risk_assessment.risk_indicators?.physicalHarmIdeas || null,
      risk_assessment.risk_indicators?.drugAlcoholAbuse || null,
      risk_assessment.risk_indicators?.suicidalAttempt || null,
      risk_assessment.risk_indicators?.selfHarm || null,
      risk_assessment.risk_indicators?.delusionsHallucinations || null,
      risk_assessment.risk_indicators?.impulsiveness || null,
      risk_assessment.risk_indicators?.severeStress || null,
      risk_assessment.risk_indicators?.socialIsolation || null,
      risk_assessment.risk_indicators?.concernByOthers || null,
      risk_assessment.risk_indicators?.other || null,
      risk_assessment.other_details || null,
      risk_assessment.risk_summary
    ];

    const result = await pool.query(insertQuery, values);
    const assessmentId = result.rows[0].id;
    const createdAt = result.rows[0].created_at;

    res.status(201).json({
      success: true,
      assessment_id: assessmentId,
      created_at: createdAt,
      message: 'SOS Risk Assessment saved successfully'
    });

  } catch (error) {
    console.error('Error saving SOS Risk Assessment:', error);
    res.status(500).json({
      error: 'Failed to save SOS Risk Assessment',
      details: error.message
    });
  }
});

// Update SOS Risk Assessment
app.put('/api/sos-assessments', async (req, res) => {
  try {
    const { id } = req.query;
    const { webhook_sent, webhook_response, status, reviewed_by, resolution_notes } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Assessment ID is required' });
    }

    const updateQuery = `
      UPDATE sos_risk_assessments 
      SET 
        webhook_sent = COALESCE($2, webhook_sent),
        webhook_response = COALESCE($3, webhook_response),
        status = COALESCE($4, status),
        reviewed_by = COALESCE($5, reviewed_by),
        resolution_notes = COALESCE($6, resolution_notes),
        updated_at = CURRENT_TIMESTAMP,
        reviewed_at = CASE WHEN $5 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE reviewed_at END
      WHERE id = $1
      RETURNING *
    `;

    const values = [id, webhook_sent, webhook_response, status, reviewed_by, resolution_notes];
    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'SOS Risk Assessment not found' });
    }

    res.status(200).json({
      success: true,
      assessment: result.rows[0],
      message: 'SOS Risk Assessment updated successfully'
    });

  } catch (error) {
    console.error('Error updating SOS Risk Assessment:', error);
    res.status(500).json({
      error: 'Failed to update SOS Risk Assessment',
      details: error.message
    });
  }
});

// Generate SOS Access Token
app.post('/api/generate-sos-token', async (req, res) => {
  try {
    const { sos_assessment_id, expires_in_days = 7 } = req.body;
    let { client_email, client_phone, client_name } = req.body;

    if (!sos_assessment_id) {
      return res.status(400).json({ error: 'Missing sos_assessment_id', received: req.body });
    }

    if (!client_email) client_email = 'unknown@example.com';
    if (!client_phone) client_phone = 'Unknown';
    if (!client_name) client_name = 'Unknown';

    // Generate unique token (UUID)
    const token = randomUUID();

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Insert token into database
    const insertQuery = `
      INSERT INTO sos_access_tokens (
        token, sos_assessment_id, client_email, client_phone, client_name, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      token,
      sos_assessment_id,
      client_email,
      client_phone,
      client_name,
      expiresAt
    ]);

    res.status(201).json({
      success: true,
      token: token,
      expires_at: expiresAt,
      message: 'SOS access token generated successfully'
    });

  } catch (error) {
    console.error('Error generating SOS token:', error);
    res.status(500).json({
      error: 'Failed to generate SOS token',
      details: error.message
    });
  }
});

// Get SOS Documentation by Token (Public endpoint - no auth required)
app.get('/api/sos-documentation', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // 1. Validate token
    const tokenQuery = `
      SELECT 
        sat.*,
        sra.risk_severity_level,
        sra.risk_severity_description,
        sra.risk_summary,
        sra.created_at as sos_created_at
      FROM sos_access_tokens sat
      LEFT JOIN sos_risk_assessments sra ON sat.sos_assessment_id = sra.id
      WHERE sat.token = $1
    `;

    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    const tokenData = tokenResult.rows[0];

    // Check if token is active
    if (!tokenData.is_active) {
      return res.status(403).json({ error: 'This link has been revoked' });
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(403).json({ error: 'This link has expired' });
    }

    // 2. Fetch client documentation
    const clientEmail = tokenData.client_email;
    const clientPhone = tokenData.client_phone;
    const clientName = tokenData.client_name;

    // Get client_id from bookings table
    const clientIdQuery = `
      SELECT DISTINCT invitee_email || '_' || invitee_phone as client_id
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      LIMIT 1
    `;
    const clientIdResult = await pool.query(clientIdQuery, [clientEmail, clientPhone]);
    const clientId = clientIdResult.rows[0]?.client_id || `${clientEmail}_${clientPhone}`;

    // Get case history
    const caseHistoryQuery = `
      SELECT * FROM client_case_history
      WHERE client_name = $1 OR client_id = $2
      ORDER BY created_at DESC
    `;
    const caseHistory = await pool.query(caseHistoryQuery, [clientName, clientId]);

    // Get all progress notes
    const progressNotesQuery = `
      SELECT * FROM client_progress_notes
      WHERE client_name = $1 OR client_id = $2
      ORDER BY session_date DESC
    `;
    const progressNotes = await pool.query(progressNotesQuery, [clientName, clientId]);

    // Get therapy goals
    const goalsQuery = `
      SELECT * FROM client_therapy_goals
      WHERE client_name = $1 OR client_id = $2
      ORDER BY created_at DESC
    `;
    const goals = await pool.query(goalsQuery, [clientName, clientId]);

    // Get session count
    const sessionCountQuery = `
      SELECT COUNT(*) as session_count
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      AND booking_status != 'cancelled'
    `;
    const sessionCount = await pool.query(sessionCountQuery, [clientEmail, clientPhone]);

    // Get emergency contact from bookings
    const emergencyContactQuery = `
      SELECT invitee_question
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      AND invitee_question IS NOT NULL
      ORDER BY booking_start_at DESC
      LIMIT 1
    `;
    const emergencyContact = await pool.query(emergencyContactQuery, [clientEmail, clientPhone]);

    // 3. Update access tracking
    const updateAccessQuery = `
      UPDATE sos_access_tokens
      SET 
        accessed_at = CASE WHEN accessed_at IS NULL THEN CURRENT_TIMESTAMP ELSE accessed_at END,
        access_count = access_count + 1
      WHERE token = $1
    `;
    await pool.query(updateAccessQuery, [token]);

    // 4. Return all documentation
    res.status(200).json({
      success: true,
      client: {
        name: tokenData.client_name,
        email: clientEmail,
        phone: clientPhone,
        session_count: sessionCount.rows[0]?.session_count || 0,
        emergency_contact: emergencyContact.rows[0]?.invitee_question || null
      },
      sos_assessment: {
        severity_level: tokenData.risk_severity_level,
        severity_description: tokenData.risk_severity_description,
        risk_summary: tokenData.risk_summary,
        created_at: tokenData.sos_created_at
      },
      documentation: {
        case_history: caseHistory.rows,
        progress_notes: progressNotes.rows,
        therapy_goals: goals.rows
      },
      token_info: {
        created_at: tokenData.created_at,
        expires_at: tokenData.expires_at,
        access_count: tokenData.access_count + 1
      }
    });

  } catch (error) {
    console.error('Error fetching SOS documentation:', error);
    res.status(500).json({
      error: 'Failed to fetch documentation',
      details: error.message
    });
  }
});

// ==================== THERAPY DOCUMENTATION ENDPOINTS ====================

// 1. Receive session documentation from N8N
app.post('/api/session-documentation', async (req, res) => {
  const { session_type, session_status, client_id, client_name, booking_id, case_history, progress_notes, therapy_goals, consultation_data } = req.body;

  // Track which sections stored successfully so one bad/optional field doesn't fail the whole submit.
  const sectionErrors: { section: string; error: string }[] = [];
  let primaryStored = false; // the actual session note (consultation / case history / progress notes)

  // Coerce a value to an integer or null (avoids "invalid input syntax for integer")
  const toIntOrNull = (v: any) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  // Coerce to an ISO date (YYYY-MM-DD) or null (avoids "invalid input syntax for date")
  const toDateOrNull = (v: any) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };

  try {
    // Map session_status from form to doc_form status value
    const docFormStatus = session_status
      ? String(session_status).toLowerCase().replace(' ', '_') // 'No Show' → 'no_show', 'Completed' → 'completed', 'Cancelled' → 'cancelled'
      : 'completed';

    // Stable client id (#6): if the form sent an empty client_id, derive one
    // from the booking (phone → email). Empty ids previously collided across
    // clients in client_therapy_goals' (client_id, goal_description) upsert.
    let effectiveClientId = (client_id || '').toString().trim();
    if (!effectiveClientId && booking_id) {
      try {
        const bRes = await pool.query(
          'SELECT invitee_phone, invitee_email FROM bookings WHERE booking_id = $1',
          [booking_id]
        );
        if (bRes.rows.length > 0) {
          effectiveClientId = (bRes.rows[0].invitee_phone || bRes.rows[0].invitee_email || '').trim();
        }
      } catch (e) {
        console.error('[session-documentation] client_id fallback lookup failed:', e);
      }
    }

    // If Consultation - store pre-therapy call form data
    if (session_type === 'Consultation' && consultation_data) {
     try {
      const vals = [
        booking_id,
        consultation_data.age,
        Array.isArray(consultation_data.language) ? consultation_data.language : [consultation_data.language || ''],
        consultation_data.language_other,
        consultation_data.location, consultation_data.location_manual,
        Array.isArray(consultation_data.mode_of_session) ? consultation_data.mode_of_session : [consultation_data.mode_of_session || ''],
        consultation_data.previous_therapy,
        Array.isArray(consultation_data.concerns) ? consultation_data.concerns : [consultation_data.concerns || ''],
        consultation_data.concerns_other,
        consultation_data.clinical_concerns_observed,
        Array.isArray(consultation_data.clinical_concerns) ? consultation_data.clinical_concerns : [consultation_data.clinical_concerns || ''],
        consultation_data.psychiatric_treatment,
        consultation_data.suicidal_thoughts, consultation_data.suicidal_current, consultation_data.suicidal_ideation_1m, consultation_data.suicidal_attempt_1m,
        consultation_data.preferred_therapy_approach, consultation_data.preferred_therapy_text,
        consultation_data.consent_explained, consultation_data.consent_no_reason, consultation_data.scope_explained,
        consultation_data.preferred_price, consultation_data.preferred_price_other,
        Array.isArray(consultation_data.readiness) ? consultation_data.readiness : [consultation_data.readiness || ''],
        consultation_data.readiness_other,
        consultation_data.consented_followup, consultation_data.followup_mode,
        consultation_data.client_questions, consultation_data.source, consultation_data.source_other,
        consultation_data.consultation_outcome, consultation_data.close_reason
      ];
      await pool.query(`
        INSERT INTO pretherapy_call_forms (
          booking_id,
          age, language, language_other,
          location, location_manual, mode_of_session,
          previous_therapy, concerns, concerns_other,
          clinical_concerns_observed, clinical_concerns,
          psychiatric_treatment,
          suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
          preferred_therapy_approach, preferred_therapy_text,
          consent_explained, consent_no_reason, scope_explained,
          preferred_price, preferred_price_other,
          readiness, readiness_other,
          consented_followup, followup_mode,
          client_questions, source, source_other,
          consultation_outcome, close_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
        ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO UPDATE SET
          consultation_outcome = EXCLUDED.consultation_outcome
      `, vals);
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] consultation insert failed:', e?.message || e);
       sectionErrors.push({ section: 'consultation', error: e?.message || String(e) });
     }
    }

    // If First Session - store case history
    if (session_type === 'First Session' && case_history) {
     try {
      await pool.query(`
        INSERT INTO client_case_history (
          client_id, client_name, booking_id,
          age, gender_identity, education, occupation,
          marital_status, children, religion, socio_economic_status, city_state,
          presenting_concerns, duration_onset, triggers_factors,
          sleep, appetite, energy_levels, weight_changes, libido, menstrual_history,
          family_history, genogram_url, developmental_history,
          medical_history, medications, previous_mental_health, insight_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
        ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO UPDATE SET
          age = EXCLUDED.age,
          gender_identity = EXCLUDED.gender_identity,
          education = EXCLUDED.education,
          occupation = EXCLUDED.occupation
      `, [
        effectiveClientId, client_name, booking_id,
        case_history.age, case_history.gender_identity, case_history.education,
        case_history.occupation,
        case_history.marital_status, case_history.children, case_history.religion,
        case_history.socio_economic_status, case_history.city_state,
        case_history.presenting_concerns, case_history.duration_onset, case_history.triggers_factors,
        case_history.sleep, case_history.appetite, case_history.energy_levels,
        case_history.weight_changes, case_history.libido, case_history.menstrual_history,
        case_history.family_history, case_history.genogram_url, case_history.developmental_history,
        case_history.medical_history, case_history.medications,
        case_history.previous_mental_health, case_history.insight_level
      ]);
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] case_history insert failed:', e?.message || e);
       sectionErrors.push({ section: 'case_history', error: e?.message || String(e) });
     }
    }

    // If Follow-up Session - store progress notes
    if ((session_type === 'Follow-up Session' || session_type === 'First Session') && progress_notes) {
     try {
      await pool.query(`
        INSERT INTO client_progress_notes (
          client_id, client_name, booking_id, session_number, session_date,
          session_duration, session_mode,
          client_report, direct_quotes,
          client_presentation, presentation_tags,
          techniques_used, homework_assigned,
          client_reaction, reaction_tags, engagement_notes,
          themes_patterns, progress_regression, clinical_concerns,
          self_harm_mention, self_harm_details, risk_level,
          risk_factors, protective_factors, safety_plan,
          future_interventions, session_frequency,
          therapist_name, therapist_signature, signature_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
        ON CONFLICT (booking_id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_name = EXCLUDED.client_name,
          session_number = EXCLUDED.session_number,
          session_date = EXCLUDED.session_date,
          session_duration = EXCLUDED.session_duration,
          session_mode = EXCLUDED.session_mode,
          client_report = EXCLUDED.client_report,
          direct_quotes = EXCLUDED.direct_quotes,
          client_presentation = EXCLUDED.client_presentation,
          presentation_tags = EXCLUDED.presentation_tags,
          techniques_used = EXCLUDED.techniques_used,
          homework_assigned = EXCLUDED.homework_assigned,
          client_reaction = EXCLUDED.client_reaction,
          reaction_tags = EXCLUDED.reaction_tags,
          engagement_notes = EXCLUDED.engagement_notes,
          themes_patterns = EXCLUDED.themes_patterns,
          progress_regression = EXCLUDED.progress_regression,
          clinical_concerns = EXCLUDED.clinical_concerns,
          self_harm_mention = EXCLUDED.self_harm_mention,
          self_harm_details = EXCLUDED.self_harm_details,
          risk_level = EXCLUDED.risk_level,
          risk_factors = EXCLUDED.risk_factors,
          protective_factors = EXCLUDED.protective_factors,
          safety_plan = EXCLUDED.safety_plan,
          future_interventions = EXCLUDED.future_interventions,
          session_frequency = EXCLUDED.session_frequency,
          therapist_name = EXCLUDED.therapist_name,
          therapist_signature = EXCLUDED.therapist_signature,
          signature_date = EXCLUDED.signature_date,
          updated_at = NOW()
      `, [
        effectiveClientId, client_name, booking_id,
        toIntOrNull(progress_notes.session_number), progress_notes.session_date || null,
        progress_notes.session_duration, progress_notes.session_mode,
        progress_notes.client_report, progress_notes.direct_quotes,
        progress_notes.client_presentation, progress_notes.presentation_tags ?? null,
        progress_notes.techniques_used, progress_notes.homework_assigned,
        progress_notes.client_reaction, progress_notes.reaction_tags ?? null, progress_notes.engagement_notes,
        progress_notes.themes_patterns, progress_notes.progress_regression, progress_notes.clinical_concerns,
        progress_notes.self_harm_mention, progress_notes.self_harm_details, progress_notes.risk_level,
        progress_notes.risk_factors, progress_notes.protective_factors, progress_notes.safety_plan,
        progress_notes.future_interventions, progress_notes.session_frequency,
        progress_notes.therapist_name, progress_notes.therapist_signature, toDateOrNull(progress_notes.signature_date)
      ]);
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] progress_notes insert failed:', e?.message || e);
       sectionErrors.push({ section: 'progress_notes', error: e?.message || String(e) });
     }
    }

    // Always store/update therapy goals (secondary — never blocks the note).
    if (therapy_goals && therapy_goals.goal_description && effectiveClientId) {
     try {
      await pool.query(`
        INSERT INTO client_therapy_goals (
          client_id, client_name, goal_description, current_stage, initiation_date, is_active
        ) VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (client_id, goal_description) DO UPDATE
        SET current_stage = EXCLUDED.current_stage,
            updated_at = NOW(),
            is_active = true
      `, [
        effectiveClientId, client_name,
        therapy_goals.goal_description,
        therapy_goals.current_stage || 'Initiation',
        new Date()
      ]);
      console.log('✅ Therapy goals stored/updated');
     } catch (e: any) {
       console.error('❌ [session-documentation] therapy_goals upsert failed:', e?.message || e);
       sectionErrors.push({ section: 'therapy_goals', error: e?.message || String(e) });
     }
    }

    // Update documentation form status (secondary)
    try {
      await pool.query(`
        UPDATE client_doc_form
        SET status = $1
        WHERE booking_id = $2
      `, [docFormStatus, booking_id]);
    } catch (e: any) {
      console.error('❌ [session-documentation] doc_form status update failed:', e?.message || e);
      sectionErrors.push({ section: 'doc_form_status', error: e?.message || String(e) });
    }

    // Decide overall result:
    const primaryFailed = sectionErrors.some(s => ['consultation', 'case_history', 'progress_notes'].includes(s.section));
    if (primaryFailed) {
      return res.status(500).json({
        success: false,
        error: 'Failed to store session documentation',
        details: sectionErrors,
      });
    }

    res.json({
      success: true,
      message: 'Session documentation stored successfully',
      warnings: sectionErrors.length ? sectionErrors : undefined,
    });
  } catch (error: any) {
    console.error('❌ Error storing session documentation:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to store session documentation' });
  }
});

// 2. Get case history
app.get('/api/case-history', async (req, res) => {
  try {
    const { client_id, booking_id } = req.query;

    if (!client_id && !booking_id) {
      return res.status(400).json({ error: 'client_id or booking_id is required' });
    }

    let result;
    if (booking_id) {
      result = await pool.query('SELECT * FROM client_case_history WHERE booking_id = $1', [booking_id]);
    } else {
      result = await pool.query(
        `SELECT * FROM client_case_history 
         WHERE client_id = $1
            OR booking_id IN (
              SELECT booking_id FROM bookings 
              WHERE invitee_email = $1 OR invitee_phone = $1
            )
         ORDER BY created_at DESC LIMIT 1`,
        [client_id]
      );
    }

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching case history:', error);
    res.status(500).json({ error: 'Failed to fetch case history' });
  }
});

// 3. Update case history
app.put('/api/case-history/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const result = await pool.query(`
      UPDATE client_case_history 
      SET ${Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ')},
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, ...Object.values(updates)]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case history not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating case history:', error);
    res.status(500).json({ error: 'Failed to update case history' });
  }
});

// 4. Get progress notes list
app.get('/api/progress-notes', async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    // Fetch from client_progress_notes (new system)
    const progressNotesResult = await pool.query(
      `SELECT *, 'progress_note' as note_type
       FROM client_progress_notes 
       WHERE client_id = $1 
          OR booking_id IN (
            SELECT booking_id FROM bookings 
            WHERE invitee_email = $1 OR invitee_phone = $1
          )
       ORDER BY session_date DESC`,
      [client_id]
    );

    // Fetch from client_session_notes (old system)
    // client_id is actually the phone number, so use it directly to match bookings
    const sessionNotesResult = await pool.query(
      `SELECT DISTINCT csn.note_id as id, csn.session_timing, csn.created_at, 
              csn.client_name, csn.host_name,
              csn.concerns_discussed, csn.somatic_cues, csn.interventions_used,
              csn.interventions_helpful, csn.client_participation, csn.goal_progress,
              csn.client_values, csn.self_harm_mention, csn.self_harm_details,
              csn.current_risk_level, csn.protective_factors, csn.health_history,
              csn.past_diagnoses, csn.next_session_plan, csn.homework_suggested,
              csn.session_status, csn.client_age, csn.gender, csn.occupation, csn.marital_status,
              'session_note' as note_type, csn.booking_id
       FROM client_session_notes csn
       INNER JOIN bookings b ON csn.booking_id::text = b.booking_id::text
       WHERE b.invitee_phone = $1 OR b.invitee_email = $1
       ORDER BY csn.created_at DESC`,
      [client_id]
    );

    // Merge both results
    const allNotes = [
      ...progressNotesResult.rows.map(note => ({
        ...note,
        session_date: note.session_date || note.created_at,
        note_type: 'progress_note'
      })),
      ...sessionNotesResult.rows.map(note => ({
        ...note,
        session_date: note.created_at, // Use created_at as session_date for old notes
        note_type: 'session_note'
      }))
    ];

    // Sort by date descending
    allNotes.sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime());

    res.json({ success: true, data: allNotes });
  } catch (error) {
    console.error('Error fetching progress notes:', error);
    res.status(500).json({ error: 'Failed to fetch progress notes' });
  }
});

// 5. Get single progress note
app.get('/api/progress-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM client_progress_notes WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching progress note:', error);
    res.status(500).json({ error: 'Failed to fetch progress note' });
  }
});

// 6. Get therapy goals
app.get('/api/therapy-goals', async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    console.log(`🔍 [API] therapy-goals fetching for client_id: "${client_id}"`);
    
    // First, find all unique names associated with this phone or email from bookings
    const associatedNamesRes = await pool.query(
      `SELECT DISTINCT TRIM(invitee_name) as name FROM bookings WHERE invitee_phone = $1 OR invitee_email = $1`,
      [client_id]
    );
    const associatedNames = associatedNamesRes.rows.map(r => r.name);
    console.log(`📋 [API] Associated names for ${client_id}:`, associatedNames);

    const result = await pool.query(
      `SELECT * FROM client_therapy_goals 
       WHERE (
         client_id = $1 
         OR EXISTS (
           SELECT 1 FROM bookings 
           WHERE (invitee_phone = $1 OR invitee_email = $1)
             AND (
               TRIM(invitee_name) ILIKE '%' || TRIM(client_therapy_goals.client_name) || '%'
               OR TRIM(client_therapy_goals.client_name) ILIKE '%' || TRIM(invitee_name) || '%'
             )
         )
       ) AND is_active = true
       ORDER BY created_at DESC`,
      [client_id]
    );
    console.log(`🎯 [API] Found ${result.rows.length} goals for ${client_id}`);

    if (result.rows.length === 0) {
      console.warn(`⚠️ [API] No goals found for ${client_id}. Checking for records matching names directly...`);
      // Final fallback if no booking exists yet
      if (associatedNames.length > 0) {
        const nameMatchResult = await pool.query(
          `SELECT * FROM client_therapy_goals WHERE TRIM(client_name) ILIKE ANY ($1) AND is_active = true`,
          [associatedNames.map(n => `%${n}%`)]
        );
        console.log(`🔄 [API] Name-only fallback found ${nameMatchResult.rows.length} goals`);
        return res.json({ success: true, data: nameMatchResult.rows });
      }
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching therapy goals:', error);
    res.status(500).json({ error: 'Failed to fetch therapy goals' });
  }
});

// 6a. Get free consultation notes list
app.get('/api/free-consultation-notes', async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const result = await pool.query(
      `SELECT id, session_date, session_mode, presenting_concerns,
              assigned_therapist_name, created_at
       FROM free_consultation_pretherapy_notes 
       WHERE client_id = $1 
       ORDER BY session_date DESC`,
      [client_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching free consultation notes:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation notes' });
  }
});

// 6b. Get single free consultation note
app.get('/api/free-consultation-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Free consultation note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching free consultation note:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation note' });
  }
});

// 7. Create therapy goal
app.post('/api/therapy-goals', async (req, res) => {
  try {
    const { client_id, client_name, goal_description, current_stage } = req.body;

    const result = await pool.query(`
      INSERT INTO client_therapy_goals (
        client_id, client_name, goal_description, current_stage, initiation_date
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [client_id, client_name, goal_description, current_stage || 'Initiation', new Date()]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating therapy goal:', error);
    res.status(500).json({ error: 'Failed to create therapy goal' });
  }
});

// 8. Update therapy goal
app.put('/api/therapy-goals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { current_stage } = req.body;

    const stageField = `${current_stage.toLowerCase().replace('-', '_')}_date`;

    const result = await pool.query(`
      UPDATE client_therapy_goals 
      SET current_stage = $1,
          ${stageField} = COALESCE(${stageField}, NOW()),
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [current_stage, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy goal not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapy goal:', error);
    res.status(500).json({ error: 'Failed to update therapy goal' });
  }
});

// 9. Paperform Webhook - Free Consultation
app.post('/api/paperform-webhook/free-consultation', async (req, res) => {
  try {
    const { submission_id, booking_id, data } = req.body;

    // Verify booking_id exists and get session_type
    const docForm = await pool.query(
      'SELECT session_type FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (docForm.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found in client_doc_form' });
    }

    const sessionType = docForm.rows[0].session_type;

    // Verify it's a free consultation
    if (sessionType !== 'Free Consultation - SafeStories') {
      return res.status(400).json({
        success: false,
        error: `Invalid session type: ${sessionType}. Expected: Free Consultation - SafeStories`
      });
    }

    // Insert into free_consultation_pretherapy_notes
    await pool.query(`
      INSERT INTO free_consultation_pretherapy_notes (
        client_name, client_id, booking_id,
        session_date, session_timing, session_duration,
        therapist_name, session_mode,
        presenting_concerns, duration_onset, triggers_factors,
        therapy_overview_given, client_questions, answers_given,
        preferred_languages, preferred_modes, preferred_price_range,
        preferred_time_slots, assigned_therapist_name,
        chatbot_booking_explained,
        clinical_concerns_mentioned, clinical_concerns_details,
        suicidal_thoughts_mentioned, suicidal_thoughts_details,
        other_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    `, [
      data.client_name,
      data.client_id,
      booking_id,
      data.session_date,
      data.session_timing,
      data.session_duration,
      data.therapist_name,
      data.session_mode,
      data.presenting_concerns,
      data.duration_onset,
      data.triggers_factors,
      data.therapy_overview_given || false,
      data.client_questions,
      data.answers_given,
      data.preferred_languages,
      data.preferred_modes,
      data.preferred_price_range,
      data.preferred_time_slots,
      data.assigned_therapist_name,
      data.chatbot_booking_explained || false,
      data.clinical_concerns_mentioned || false,
      data.clinical_concerns_details,
      data.suicidal_thoughts_mentioned || false,
      data.suicidal_thoughts_details,
      data.other_notes
    ]);

    // Update client_doc_form status
    await pool.query(`
      UPDATE client_doc_form 
      SET status = 'completed',
          paperform_submission_id = $1
      WHERE booking_id = $2
    `, [submission_id, booking_id]);

    console.log('✅ client_doc_form updated to completed');

    res.json({ success: true, message: 'Free consultation notes stored successfully' });
  } catch (error) {
    console.error('❌ Error storing free consultation notes:', error);
    res.status(500).json({ success: false, error: 'Failed to store free consultation notes' });
  }
});

// 10. Paperform Webhook - Therapy Documentation
app.post('/api/paperform-webhook/therapy-documentation', async (req, res) => {
  try {
    const { submission_id, booking_id, data } = req.body;

    console.log('📝 Received therapy documentation form submission:', { submission_id, booking_id });

    // Verify booking_id exists and get session_type
    const docForm = await pool.query(
      'SELECT session_type FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (docForm.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found in client_doc_form' });
    }

    const sessionType = docForm.rows[0].session_type;

    // Verify it's NOT a free consultation
    if (sessionType === 'Free Consultation - SafeStories') {
      return res.status(400).json({
        success: false,
        error: 'This is a free consultation. Use /api/paperform-webhook/free-consultation endpoint'
      });
    }

    const sessionNumber = data.session_number || 1;
    const isFirstSession = sessionNumber === 1;

    console.log(`📊 Session type: ${sessionType}, Session number: ${sessionNumber}, First session: ${isFirstSession}`);

    // If First Session - store case history
    if (isFirstSession && data.case_history) {
      await pool.query(`
        INSERT INTO client_case_history (
          client_id, client_name, booking_id,
          age, gender_identity, education, occupation, primary_income,
          marital_status, children, religion, socio_economic_status, city_state,
          presenting_concerns, duration_onset, triggers_factors,
          sleep, appetite, energy_levels, weight_changes, libido, menstrual_history,
          family_history, genogram_url, developmental_history,
          medical_history, medications, previous_mental_health, insight_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
        ON CONFLICT (client_id) DO UPDATE SET
          age = EXCLUDED.age,
          gender_identity = EXCLUDED.gender_identity,
          education = EXCLUDED.education,
          occupation = EXCLUDED.occupation,
          primary_income = EXCLUDED.primary_income,
          marital_status = EXCLUDED.marital_status,
          children = EXCLUDED.children,
          religion = EXCLUDED.religion,
          socio_economic_status = EXCLUDED.socio_economic_status,
          city_state = EXCLUDED.city_state,
          presenting_concerns = EXCLUDED.presenting_concerns,
          duration_onset = EXCLUDED.duration_onset,
          triggers_factors = EXCLUDED.triggers_factors,
          sleep = EXCLUDED.sleep,
          appetite = EXCLUDED.appetite,
          energy_levels = EXCLUDED.energy_levels,
          weight_changes = EXCLUDED.weight_changes,
          libido = EXCLUDED.libido,
          menstrual_history = EXCLUDED.menstrual_history,
          family_history = EXCLUDED.family_history,
          genogram_url = EXCLUDED.genogram_url,
          developmental_history = EXCLUDED.developmental_history,
          medical_history = EXCLUDED.medical_history,
          medications = EXCLUDED.medications,
          previous_mental_health = EXCLUDED.previous_mental_health,
          insight_level = EXCLUDED.insight_level,
          updated_at = NOW()
      `, [
        data.client_id,
        data.client_name,
        booking_id,
        data.case_history.age,
        data.case_history.gender_identity,
        data.case_history.education,
        data.case_history.occupation,
        data.case_history.primary_income,
        data.case_history.marital_status,
        data.case_history.children,
        data.case_history.religion,
        data.case_history.socio_economic_status,
        data.case_history.city_state,
        data.case_history.presenting_concerns,
        data.case_history.duration_onset,
        data.case_history.triggers_factors,
        data.case_history.sleep,
        data.case_history.appetite,
        data.case_history.energy_levels,
        data.case_history.weight_changes,
        data.case_history.libido,
        data.case_history.menstrual_history,
        data.case_history.family_history,
        data.case_history.genogram_url,
        data.case_history.developmental_history,
        data.case_history.medical_history,
        data.case_history.medications,
        data.case_history.previous_mental_health,
        data.case_history.insight_level
      ]);
      console.log('✅ Case history stored');
    }

    // Always store progress notes
    if (data.progress_notes) {
      await pool.query(`
        INSERT INTO client_progress_notes (
          client_id, client_name, booking_id, session_number, session_date,
          session_duration, session_mode,
          client_report, direct_quotes,
          client_presentation, presentation_tags,
          techniques_used, homework_assigned,
          client_reaction, reaction_tags, engagement_notes,
          themes_patterns, progress_regression, clinical_concerns,
          self_harm_mention, self_harm_details, risk_level,
          risk_factors, protective_factors, safety_plan,
          future_interventions, session_frequency,
          therapist_name, therapist_signature, signature_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      `, [
        data.client_id,
        data.client_name,
        booking_id,
        sessionNumber,
        data.session_date,
        data.session_duration,
        data.session_mode,
        data.progress_notes.client_report,
        data.progress_notes.direct_quotes,
        data.progress_notes.client_presentation,
        data.progress_notes.presentation_tags,
        data.progress_notes.techniques_used,
        data.progress_notes.homework_assigned,
        data.progress_notes.client_reaction,
        data.progress_notes.reaction_tags,
        data.progress_notes.engagement_notes,
        data.progress_notes.themes_patterns,
        data.progress_notes.progress_regression,
        data.progress_notes.clinical_concerns,
        data.progress_notes.self_harm_mention || false,
        data.progress_notes.self_harm_details,
        data.progress_notes.risk_level || 'None',
        data.progress_notes.risk_factors,
        data.progress_notes.protective_factors,
        data.progress_notes.safety_plan,
        data.progress_notes.future_interventions,
        data.progress_notes.session_frequency,
        data.therapist_name,
        data.therapist_signature,
        data.signature_date
      ]);
      console.log('✅ Progress notes stored');
    }

    // Store/update therapy goals
    if (data.therapy_goals) {
      await pool.query(`
        INSERT INTO client_therapy_goals (
          client_id, client_name, goal_description, current_stage, initiation_date
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (client_id) DO UPDATE SET
          goal_description = EXCLUDED.goal_description,
          current_stage = EXCLUDED.current_stage,
          updated_at = NOW()
      `, [
        data.client_id,
        data.client_name,
        data.therapy_goals.goal_description,
        data.therapy_goals.current_stage || 'Initiation',
        new Date()
      ]);
      console.log('✅ Therapy goals stored');
    }

    // Update client_doc_form status
    await pool.query(`
      UPDATE client_doc_form 
      SET status = 'completed',
          paperform_submission_id = $1
      WHERE booking_id = $2
    `, [submission_id, booking_id]);

    console.log('✅ client_doc_form updated to completed');

    res.json({ success: true, message: 'Therapy documentation stored successfully' });
  } catch (error) {
    console.error('❌ Error storing therapy documentation:', error);
    res.status(500).json({ success: false, error: 'Failed to store therapy documentation' });
  }
});

// ==================== END THERAPY DOCUMENTATION ENDPOINTS ====================

// ==================== FREE CONSULTATION ENDPOINTS ====================

// 9. Check client session type (free consultation vs paid sessions)
app.get('/api/client-session-type', async (req, res) => {
  try {
    const { client_id } = req.query;

    console.log('🔍 [API] client-session-type called with client_id:', client_id);

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    // Check if client has any PAID session bookings (non-free-consultation)
    const paidBookingsResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE invitee_phone = $1 
       AND booking_resource_name NOT ILIKE '%free consultation%'
       LIMIT 1`,
      [client_id]
    );
    const hasPaidSessions = paidBookingsResult.rows.length > 0;
    console.log('💰 [API] Paid sessions found:', hasPaidSessions, '(', paidBookingsResult.rows.length, 'rows)');

    // Check if client has free consultation bookings
    const freeConsultBookingResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE invitee_phone = $1 
       AND booking_resource_name ILIKE '%free consultation%'
       LIMIT 1`,
      [client_id]
    );
    const hasFreeConsultation = freeConsultBookingResult.rows.length > 0;
    console.log('🆓 [API] Free consultations found:', hasFreeConsultation, '(', freeConsultBookingResult.rows.length, 'rows)');

    const response = {
      success: true,
      data: {
        hasPaidSessions,
        hasFreeConsultation
      }
    };
    console.log('📤 [API] Returning:', response);
    res.json(response);
  } catch (error) {
    console.error('Error checking client session type:', error);
    res.status(500).json({ error: 'Failed to check client session type' });
  }
});

// 10. Get free consultation notes
app.get('/api/free-consultation-notes', async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE client_name = $1 ORDER BY session_date DESC',
      [client_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching free consultation notes:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation notes' });
  }
});

// 11. Get single free consultation note
app.get('/api/free-consultation-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Free consultation note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching free consultation note:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation note' });
  }
});

// ==================== END FREE CONSULTATION ENDPOINTS ====================

// Global error handler - must be after all routes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);

  // Always return JSON
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = 3002;
const httpServer = createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.on('join_room', (data) => {
    if (data?.role === 'admin') socket.join('admin_room');
    else if (data?.role === 'therapist' && data?.userId) socket.join('therapist_room_' + data.userId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`\nAPI server running on http://localhost:${PORT}`);
  startDashboardApiBookingSync();
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('Port is in use.');
  else console.error('Server error', err);
  process.exit(1);
});
\n
// Direct SOS Alert via WhatsApp and Email
app.post('/api/send-sos-alert', async (req, res) => {
  try {
    const data = req.body;
    
    // Fetch emergency contact from bookings
    let emergencyContactName = 'Not provided';
    let emergencyContactNumber = 'Not provided';
    if (data.booking_id) {
      const bRes = await pool.query('SELECT emergency_contact_name, emergency_contact_number FROM bookings WHERE booking_id = $1', [data.booking_id]);
      if (bRes.rows.length > 0) {
        emergencyContactName = bRes.rows[0].emergency_contact_name || 'Not provided';
        emergencyContactNumber = bRes.rows[0].emergency_contact_number || 'Not provided';
      }
    }

    // Fetch total completed bookings
    let totalBookings = 0;
    if (data.client_phone) {
      const cRes = await pool.query('SELECT no_of_sessions FROM all_clients_table WHERE phone_number = $1', [data.client_phone]);
      if (cRes.rows.length > 0 && cRes.rows[0].no_of_sessions) {
        totalBookings = cRes.rows[0].no_of_sessions;
      } else {
        // Fallback to counting progress notes
        const pRes = await pool.query('SELECT COUNT(*) FROM client_progress_notes WHERE client_id = $1', [data.client_phone]);
        totalBookings = parseInt(pRes.rows[0].count) || 0;
      }
    }

    // Format Risk Indicators
    const indicators = [];
    const ri = data.risk_assessment?.risk_indicators || {};
    if (ri.emotionalDysregulation === 'Y') indicators.push('Emotional Dysregulation');
    if (ri.physicalHarmIdeas === 'Y') indicators.push('Physical Harm Ideas');
    if (ri.drugAlcoholAbuse === 'Y') indicators.push('Drug/Alcohol Abuse');
    if (ri.suicidalAttempt === 'Y') indicators.push('Suicidal Attempt/Ideation');
    if (ri.selfHarm === 'Y') indicators.push('Self Harm');
    if (ri.delusionsHallucinations === 'Y') indicators.push('Delusions/Hallucinations');
    if (ri.impulsiveness === 'Y') indicators.push('Impulsiveness');
    if (ri.severeStress === 'Y') indicators.push('Severe Stress');
    if (ri.socialIsolation === 'Y') indicators.push('Social Isolation');
    if (ri.concernByOthers === 'Y') indicators.push('Concern expressed by others');
    if (ri.other === 'Y') indicators.push('Other');
    
    const currentRiskIndicators = indicators.length > 0 ? indicators.join(', ') : 'None marked';
    const severityLevel = String(data.risk_assessment?.severity_level || 'Unknown');
    const riskSummary = data.risk_assessment?.risk_summary || 'Not provided';

    const templateParams = {
      clientName: data.client_name || 'Unknown',
      clientPhone: data.client_phone || 'Unknown',
      therapistName: data.therapist_name || 'Unknown',
      sessionTimings: data.session_timings || 'Unknown',
      mode: data.mode || 'Unknown',
      totalBookings: totalBookings,
      emergencyContactName: emergencyContactName,
      emergencyContactNumber: emergencyContactNumber,
      severityLevel: severityLevel,
      currentRiskIndicators: currentRiskIndicators,
      riskSummary: riskSummary,
      documentationLink: data.documentation_link || ''
    };

    // 1. Send Email
    await sendSOSEmailAlert(templateParams).catch(err => console.error('SOS Email failed:', err));

    // 2. Send WhatsApp via Aisensy
    const aisensyApiKey = process.env.AISENSY_API_KEY;
    if (aisensyApiKey) {
      try {
        const aisensyPayload = {
          apiKey: aisensyApiKey,
          campaignName: "sos_message_api_campaign",
          destination: "+917522911068",
          userName: "SafeStories",
          source: "DaySchedule",
          templateParams: [
            templateParams.clientName,
            templateParams.clientPhone,
            templateParams.therapistName,
            templateParams.sessionTimings,
            templateParams.mode,
            String(templateParams.totalBookings),
            templateParams.emergencyContactName,
            templateParams.emergencyContactNumber,
            templateParams.severityLevel,
            templateParams.currentRiskIndicators,
            templateParams.riskSummary,
            templateParams.documentationLink
          ]
        };

        const aisensyResponse = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(aisensyPayload)
        });

        if (!aisensyResponse.ok) {
          console.error('Aisensy API failed:', await aisensyResponse.text());
        } else {
          console.log('✅ SOS WhatsApp alert sent successfully via Aisensy');
        }
      } catch (err) {
        console.error('❌ Aisensy fetch error:', err);
      }
    } else {
      console.warn('⚠️ AISENSY_API_KEY not found in environment, skipping WhatsApp alert');
    }

    res.status(200).json({ success: true, message: 'SOS alerts processed' });
  } catch (error) {
    console.error('❌ Error processing SOS alert:', error);
    res.status(500).json({ error: 'Internal server error processing SOS alert' });
  }
});
