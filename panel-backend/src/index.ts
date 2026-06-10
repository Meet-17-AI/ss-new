import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { randomUUID } from 'crypto';
import pool from './lib/db';
import { startSessionRemindersCron } from './automations/cron';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { convertToIST } from './lib/timezone';
import { startDashboardApiBookingSync } from './dashboardApiBookingSync';
import { uploadFile } from './lib/minio';
import { sendOTPEmail, sendPasswordResetOTP, sendClientBookingConfirmationEmail, sendAdminBookingConfirmationEmail } from './lib/email';
import { sendSOSAdminWhatsapp, sendSOSAdminEmail, sendAiSensyMessage } from './automations/index';
import { generateAdminOTP, verifyAdminOTP } from './otp';

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

// Secure CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5174', 'http://localhost:3004'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

// Authentication middleware
const authMiddleware = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Authorization middleware - check user role
const requireRole = (allowedRoles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Helper function for URL shortener
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createShortUrl(longUrl: string) {
  const code = generateShortCode();
  await pool.query('INSERT INTO short_urls (short_code, long_url) VALUES ($1, $2)', [code, longUrl]);
  return code;
}

// Redirect shortened URLs
app.get('/r/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query('SELECT long_url FROM short_urls WHERE short_code = $1', [code]);
    if (result.rows.length > 0) {
      res.redirect(302, result.rows[0].long_url);
    } else {
      res.status(404).send('Link not found');
    }
  } catch (err) {
    console.error('Error redirecting short URL:', err);
    res.status(500).send('Server Error');
  }
});

// ==================== GOOGLE CALENDAR OAUTH CONFIG & ENDPOINTS ====================
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '168173993649-2v0jpmi1c4mdkjg70agbret556r7uarm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://safestories-panel.onrender.com/api/auth/google/callback';

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
};

app.get('/api/auth/google', (req, res) => {
  const therapistId = (req.query.therapistId as string) || 'SafeStories';
  const adminRedirect = req.query.adminRedirect === 'true';
  const oauth2Client = getOAuth2Client();
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email'
  ];
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: JSON.stringify({ therapistId, adminRedirect })
  });
  
  res.redirect(authUrl);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  let therapistId = 'SafeStories';
  let adminRedirect = false;
  try {
    if (state) {
      const parsedState = JSON.parse(state as string);
      therapistId = parsedState.therapistId || 'SafeStories';
      adminRedirect = !!parsedState.adminRedirect;
    }
  } catch (e) {
    console.error('Error parsing OAuth state:', e);
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email || '';

    // RULE: Ensure this Google Calendar is not already connected to another therapist
    if (userEmail && therapistId !== 'SafeStories') {
      const existingCheck = await pool.query(
        `SELECT therapist_id, name FROM therapists 
         WHERE google_refresh_token IS NOT NULL 
           AND LOWER(contact_info) = LOWER($1) 
           AND therapist_id != $2 
           AND therapist_id != 'SafeStories'`,
        [userEmail, therapistId]
      );

      if (existingCheck.rows.length > 0) {
        console.error(`❌ Google Calendar ${userEmail} is already linked to therapist ${existingCheck.rows[0].name}`);
        let baseUrl = process.env.FRONTEND_URL || 'https://safestories-panel.vercel.app';
        if (baseUrl.includes('safestories-dashboard')) baseUrl = 'https://safestories-panel.vercel.app';
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        
        if (adminRedirect || therapistId === 'SafeStories') {
          return res.redirect(`${baseUrl}/admin?googleAuth=error&reason=already_linked`);
        } else {
          return res.redirect(`${baseUrl}/therapist?googleAuth=error&reason=already_linked`);
        }
      }
    }

    if (therapistId === 'SafeStories') {
      const checkTherapist = await pool.query(
        'SELECT * FROM therapists WHERE therapist_id = $1',
        ['SafeStories']
      );
      if (checkTherapist.rows.length === 0) {
        await pool.query(
          `INSERT INTO therapists (therapist_id, name, specialization, contact_info)
           VALUES ('SafeStories', 'SafeStories', 'Platform Calendar', $1)`,
          [userEmail || 'admin@safestories.in']
        );
      }
    }

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3500 * 1000);
    
    await pool.query(
      `UPDATE therapists 
       SET google_refresh_token = COALESCE($1, google_refresh_token), google_access_token = $2, google_token_expiry = $3, contact_info = COALESCE(NULLIF($4, ''), contact_info)
       WHERE therapist_id = $5`,
      [tokens.refresh_token || null, tokens.access_token, expiryDate, userEmail, therapistId]
    );

    console.log(`✓ Connected Google Calendar successfully for therapist: ${therapistId} (${userEmail})`);

    let baseUrl = process.env.FRONTEND_URL || 'https://safestories-panel.vercel.app';
    if (baseUrl.includes('safestories-dashboard')) baseUrl = 'https://safestories-panel.vercel.app';
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    if (adminRedirect || therapistId === 'SafeStories') {
      res.redirect(`${baseUrl}/admin?googleAuth=success`);
    } else {
      res.redirect(`${baseUrl}/therapist?googleAuth=success`);
    }
  } catch (error) {
    console.error('❌ Error in Google OAuth callback:', error);
    res.status(500).send('Authentication failed. Please check logs.');
  }
});

async function getAuthenticatedClient(therapist: any) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: therapist.google_refresh_token,
    access_token: therapist.google_access_token,
    expiry_date: therapist.google_token_expiry ? new Date(therapist.google_token_expiry).getTime() : undefined
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token) {
      const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3500 * 1000);
      await pool.query(
        `UPDATE therapists SET google_access_token = $1, google_token_expiry = $2 WHERE therapist_id = $3`,
        [credentials.access_token, expiryDate, therapist.therapist_id]
      );
    }
  } catch (e) {
    console.error('Failed to refresh token, using existing', e);
  }
  return oauth2Client;
}

app.post('/api/auth/google/disconnect', async (req, res) => {
  try {
    const { therapistId } = req.body;
    if (!therapistId) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    await pool.query(
      `UPDATE therapists 
       SET google_refresh_token = NULL, google_access_token = NULL, google_token_expiry = NULL 
       WHERE therapist_id = $1`,
      [therapistId]
    );

    res.json({ success: true, message: 'Google Calendar disconnected successfully.' });
  } catch (error) {
    console.error('❌ Error disconnecting calendar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/google/status', async (req, res) => {
  try {
    const therapistId = (req.query.therapistId as string) || 'SafeStories';
    const result = await pool.query(
      'SELECT google_refresh_token, contact_info FROM therapists WHERE therapist_id = $1',
      [therapistId]
    );

    if (result.rows.length === 0) {
      return res.json({ connected: false });
    }

    const therapist = result.rows[0];
    res.json({
      connected: !!therapist.google_refresh_token,
      email: therapist.google_refresh_token ? therapist.contact_info : null
    });
  } catch (error) {
    console.error('❌ Error checking Google connection status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/native/fetch-slots', async (req, res) => {
  try {
    const { therapistId, payload } = req.body;
    let availableSlots: string[] = [];

    // Fetch availability from DB
    const availRes = await pool.query(
      'SELECT availability_rules FROM therapist_availability WHERE therapist_id = $1',
      [therapistId]
    );

    if (availRes.rows.length > 0 && availRes.rows[0].availability_rules) {
      const rules = availRes.rows[0].availability_rules;
      const dayName = new Date(payload.selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
      if (rules[dayName]) {
        for (const slotRange of rules[dayName]) {
          let current = new Date(`${payload.selectedDate}T${slotRange.start}:00`);
          const end = new Date(`${payload.selectedDate}T${slotRange.end}:00`);
          while (current < end) {
            const timeStr = current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            availableSlots.push(timeStr);
            current.setMinutes(current.getMinutes() + 60);
          }
        }
      }
    }

    if (therapistId) {
      try {
        const bookingsRes = await pool.query(
          `SELECT booking_invitee_time FROM bookings 
           WHERE therapist_id = $1 AND DATE(booking_start_at AT TIME ZONE 'Asia/Kolkata') = $2 AND booking_status != 'Canceled'`,
          [therapistId, payload.selectedDate]
        );
        
        const bookedTimes = bookingsRes.rows.map(r => r.booking_invitee_time);
        availableSlots = availableSlots.filter(slot => {
          return !bookedTimes.some(bTime => bTime && bTime.includes(slot));
        });
      } catch (err) {
        console.error('Error fetching bookings to filter slots:', err);
      }
    }

    const realNow = new Date();
    const fourHoursFromNow = new Date(realNow.getTime() + 4 * 60 * 60 * 1000);
    
    availableSlots = availableSlots.filter(slot => {
      const [time, modifier] = slot.split(' ');
      let [hours, minutes] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier === 'PM') hours = (parseInt(hours, 10) + 12).toString();
      const slotDateIST = new Date(`${payload.selectedDate}T${hours.padStart(2, '0')}:${minutes}:00+05:30`);
      return slotDateIST >= fourHoursFromNow;
    });

    res.json([{ "Available Slots": availableSlots, success: true }]);
  } catch (error) {
    console.error('❌ Error in native fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/therapists-calendars', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT therapist_id, name, contact_info, profile_picture_url, 
              google_refresh_token IS NOT NULL AS connected,
              CASE WHEN google_refresh_token IS NOT NULL THEN contact_info ELSE NULL END AS google_email
       FROM therapists
       WHERE therapist_id != 'SafeStories'
       ORDER BY name ASC`
    );
    
    const list = result.rows;
    
    // Fetch SafeStories from DB or default
    const ssResult = await pool.query(
      "SELECT google_refresh_token IS NOT NULL AS connected, contact_info FROM therapists WHERE therapist_id = 'SafeStories'"
    );
    if (ssResult.rows.length > 0) {
      list.unshift({
        therapist_id: 'SafeStories',
        name: 'SafeStories (Platform)',
        contact_info: ssResult.rows[0].contact_info || 'admin@safestories.in',
        profile_picture_url: '',
        connected: ssResult.rows[0].connected,
        google_email: ssResult.rows[0].connected ? ssResult.rows[0].contact_info : null
      });
    } else {
      list.unshift({
        therapist_id: 'SafeStories',
        name: 'SafeStories (Platform)',
        contact_info: 'admin@safestories.in',
        profile_picture_url: '',
        connected: false,
        google_email: null
      });
    }
    
    res.json(list);
  } catch (error) {
    console.error('Error fetching therapist calendar list:', error);
    res.status(500).json({ error: 'Failed to fetch therapist calendars' });
  }
});

// ==================== END GOOGLE CALENDAR OAUTH CONFIG & ENDPOINTS ====================


// Login endpoint - with proper password hashing
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    // Fetch user WITHOUT comparing password in database
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );

    if (result.rows.length === 0) {
      // Don't reveal if user exists
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Check if user account is active
    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled. Please contact support.'
      });
    }

    // Support both plain text and bcrypt passwords for backward compatibility
    let passwordMatch = false;
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else {
      passwordMatch = (password === user.password);
    }

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
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

          // Check google calendar connection
          const calendarCheck = await pool.query(
            'SELECT google_refresh_token IS NOT NULL as connected FROM therapists WHERE therapist_id = $1',
            [user.therapist_id]
          );
          if (calendarCheck.rows.length > 0) {
            user.google_calendar_connected = calendarCheck.rows[0].connected;
          } else {
            user.google_calendar_connected = false;
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
      SELECT u.id, u.name, u.full_name, u.therapist_id, t.specialization,
             false as google_calendar_connected
      FROM users u
      LEFT JOIN therapists t ON u.therapist_id = t.therapist_id
      WHERE u.role = 'therapist' AND COALESCE(t.is_active, true) = true
      ORDER BY COALESCE(u.full_name, u.name)
    `);

    const formattedTherapists = therapists.rows.map(row => ({
      ...row,
      specializations: row.specialization ? row.specialization.split(',').map((s: string) => s.trim()) : []
    }));

    res.json(formattedTherapists);
  } catch (err) {
    console.error('Error fetching therapists:', err);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// DELETE therapist
app.delete('/api/therapists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete: mark therapist as inactive and delete their therapy services
    const therapistRes = await pool.query(
      'UPDATE therapists SET is_active = false WHERE therapist_id = $1 RETURNING therapist_id',
      [id]
    );
    if (therapistRes.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }
    // Delete all therapy services for this therapist
    await pool.query('DELETE FROM therapy_services WHERE therapist_id = $1', [id]);
    res.json({ success: true, message: 'Therapist deleted' });
  } catch (error: any) {
    console.error('Error deleting therapist:', error);
    res.status(500).json({ error: error.message || 'Failed to delete therapist' });
  }
});

// PATCH deactivate therapist
app.patch('/api/therapists/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapists SET is_active = false WHERE therapist_id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }
    // Also deactivate all their therapy services
    await pool.query('UPDATE therapy_services SET is_active = false WHERE therapist_id = $1', [id]);
    res.json({ success: true, message: 'Therapist deactivated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error deactivating therapist:', error);
    res.status(500).json({ error: error.message || 'Failed to deactivate therapist' });
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
    const EXCL_SS = "AND LOWER(TRIM(booking_host_name)) != 'safestories'";

    const revenue = hasDateFilter
      ? await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['cancelled', 'canceled', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${EXCL_SS}`,
        ['cancelled', 'canceled']
      );

    // Bookings - exclude safestories (free consultations managed in CRM)
    const bookings = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE 1=1 ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE 1=1 ${EXCL_SS}`
      );

    // Sessions Completed - exclude safestories
    const sessionsCompleted = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4) ${EXCL_SS} AND b.booking_start_at BETWEEN $5 AND $6`,
        ['cancelled', 'canceled', 'no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4) ${EXCL_SS}`,
        ['cancelled', 'canceled', 'no_show', 'no show']
      );

    const freeConsultations = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_start_at BETWEEN $1 AND $2',
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL)'
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
      `SELECT COUNT(*) as total FROM bookings WHERE 1=1 ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
      [lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthSessionsCompleted = await pool.query(
      `SELECT COUNT(*) as total FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ($1, $2, $3, $4) ${EXCL_SS} AND b.booking_start_at BETWEEN $5 AND $6`,
      ['cancelled', 'canceled', 'no_show', 'no show', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
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

// Local Schedule Endpoints (Replaces DaySchedule proxy)
app.get('/api/dayschedule/schedules/:id', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const result = await pool.query('SELECT * FROM therapist_schedules WHERE schedule_id = $1', [scheduleId]);

    if (result.rows.length === 0) {
      // Return a blank default schedule
      const defaultSchedule = {
        scheduleId: scheduleId,
        name: "Therapist Schedule",
        time_zone: "Asia/Calcutta",
        availability: [
          { day: "monday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "tuesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "wednesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "thursday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "friday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "saturday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "sunday", is_available: false, times: [{ start: "09:00", end: "17:00" }] }
        ],
        date_overrides: [],
        exclusions: [],
        is_default: false
      };
      
      return res.json(defaultSchedule);
    }

    const row = result.rows[0];
    res.json({
      scheduleId: row.schedule_id,
      name: row.name,
      time_zone: row.time_zone,
      availability: row.availability,
      date_overrides: row.date_overrides,
      exclusions: row.exclusions,
      therapist_id: row.therapist_id,
      is_default: false
    });
  } catch (error) {
    console.error('[Schedule GET] Error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule from local database' });
  }
});

app.put('/api/dayschedule/schedules/:id', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const { name, time_zone, availability, date_overrides, exclusions, therapist_id } = req.body;

    await pool.query(
      `INSERT INTO therapist_schedules (schedule_id, therapist_id, name, time_zone, availability, date_overrides, exclusions)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       ON CONFLICT (schedule_id) DO UPDATE SET
         therapist_id = EXCLUDED.therapist_id,
         name = EXCLUDED.name,
         time_zone = EXCLUDED.time_zone,
         availability = EXCLUDED.availability,
         date_overrides = EXCLUDED.date_overrides,
         exclusions = EXCLUDED.exclusions,
         updated_at = CURRENT_TIMESTAMP`,
      [scheduleId, therapist_id || null, name || 'Therapist Schedule', time_zone || 'Asia/Calcutta', JSON.stringify(availability || []), JSON.stringify(date_overrides || []), JSON.stringify(exclusions || [])]
    );

    // Helper: notify all admins about schedule update (fire-and-forget)
    const notifyScheduleUpdate = async () => {
      try {
        const therapistName = (name || '').replace(/'s Schedule$/, '').trim();
        const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [admin.id, 'admin', 'schedule_updated', 'Schedule Updated',
             `${therapistName} updated their availability schedule`, scheduleId]
          );
        }
      } catch (e) { /* non-critical, don't fail the main response */ }
    };

    notifyScheduleUpdate();
    res.json({ success: true, scheduleId: scheduleId });
  } catch (error: any) {
    console.error('[Schedule PUT] Error:', error);
    res.status(500).json({ error: 'Failed to save schedule to local database', detail: error.message });
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
    // 2. Natively cancel booking in the database
    const updateResult = await pool.query(
      `UPDATE bookings SET booking_status = 'cancelled', booking_cancel_reason = $1, invitee_cancelled_at = NOW() 
       WHERE booking_id = $2 RETURNING *`,
      [reason || 'No reason provided', booking_id]
    );

    // 3. Delete from Google Calendar if event exists
    const googleEventId = bookingDetails.google_event_id;
    const cancelHostId = bookingDetails.booking_host_calendar_id || bookingDetails.therapist_id;
    
    if (googleEventId && cancelHostId) {
      try {
        const tokenRes = await pool.query('SELECT google_calendar_tokens FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1', [cancelHostId]);
        if (tokenRes.rows.length > 0 && tokenRes.rows[0].google_calendar_tokens) {
          const tokens = typeof tokenRes.rows[0].google_calendar_tokens === 'string' 
            ? JSON.parse(tokenRes.rows[0].google_calendar_tokens) 
            : tokenRes.rows[0].google_calendar_tokens;
            
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
          );
          oauth2Client.setCredentials(tokens);
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          
          await calendar.events.delete({
            calendarId: 'primary',
            eventId: googleEventId
          });
          console.log(`[Cancel Booking] Successfully deleted Google Calendar event ${googleEventId}`);
        }
      } catch (calErr) {
        console.error('[Cancel Booking] Failed to delete Google Calendar event:', calErr);
      }
    }

    // 4. Determine if session was paid (case-insensitive)
    const isPaid = Number(bookingDetails.invitee_payment_amount) > 0 ||
                   (bookingDetails.payment_status || '').toLowerCase() === 'paid';

    // Check if cancellation is within 24 hours of session start
    const sessionStartTimeStr = bookingDetails.booking_start_at || bookingDetails.booking_invitee_time;
    let isWithin24Hours = false;
    if (sessionStartTimeStr) {
      const startTime = new Date(sessionStartTimeStr).getTime();
      const now = Date.now();
      const hoursDifference = (startTime - now) / (1000 * 60 * 60);
      isWithin24Hours = hoursDifference <= 24 && hoursDifference > 0;
      // If it's already past the start time, consider it within 24 hours (no refund)
      if (hoursDifference <= 0) isWithin24Hours = true;
    }

    let isRefundInitiated = false;

    // 5. Initiate Razorpay refund if paid, not manual_bypass, and cancelled BEFORE 24 hours
    if (isPaid && bookingDetails.payment_id && bookingDetails.payment_id !== 'manual_bypass') {
      if (!isWithin24Hours) {
        try {
          const { rows: rzpRows } = await pool.query(
            'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
          );
          if (rzpRows.length > 0 && rzpRows[0].razorpay_key_id) {
            const rzpInst = new Razorpay({
              key_id: rzpRows[0].razorpay_key_id,
              key_secret: rzpRows[0].razorpay_key_secret
            });
            await (rzpInst.payments as any).refund(bookingDetails.payment_id, { speed: 'normal' });
            await pool.query(
              `UPDATE bookings SET refund_status = 'initiated', booking_updated_at = NOW() WHERE booking_id = $1`,
              [booking_id]
            );
            isRefundInitiated = true;
            console.log(`[Cancel Booking] Razorpay refund initiated for payment ${bookingDetails.payment_id}`);
          }
        } catch (refundErr: any) {
          console.error('[Cancel Booking] Razorpay refund initiation failed:', refundErr?.message || refundErr);
        }
      } else {
        console.log(`[Cancel Booking] No refund for ${booking_id} (cancelled within 24h of start)`);
      }
    }

    // 6. Send WhatsApp via AiSensy
    if (notify !== false) {
      try {
        const { sendBookingCancelledRefundClient, sendBookingCancelledNoRefundClient } = await import('./automations/index.js');

        if (isPaid && isRefundInitiated) {
          await sendBookingCancelledRefundClient(
            booking_id,
            bookingDetails.invitee_phone,
            bookingDetails.invitee_name,
            bookingDetails.booking_resource_name || 'Session',
            sessionStartTimeStr
          );
        } else if (isPaid && !isRefundInitiated) {
          await sendBookingCancelledNoRefundClient(
            booking_id,
            bookingDetails.invitee_phone,
            bookingDetails.invitee_name,
            bookingDetails.booking_resource_name || 'Session',
            sessionStartTimeStr
          );
        } else {
          console.log(`[Cancel Booking] Free session ${booking_id}, skipping cancellation WhatsApp message`);
        }
      } catch (waErr) {
        console.error('[Cancel Booking] Failed to send AiSensy cancellation:', waErr);
      }
    }

    console.log(`[Cancel Booking] Successfully cancelled booking: ${booking_id}`);

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
    const notifyHostId = bookingDetails.booking_host_calendar_id;
    if (notifyHostId) {
      const therapistUserRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [notifyHostId]
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

    // 3. Send WhatsApp via AiSensy
    if (notify !== false) {
      try {
        const { sendBookingRescheduledClient, sendBookingRescheduledTherapist } = await import('./automations/index.js');
        const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://safestories-dashboard.vercel.app';
        const shortLink = bookingDetails.public_booking_checkin_url || `${baseUrl}/booking-confirmation/${booking_id}`;
        
        await sendBookingRescheduledClient(
          booking_id,
          bookingDetails.invitee_phone,
          bookingDetails.invitee_name,
          bookingDetails.booking_resource_name || 'Session',
          bookingInviteeTime,
          shortLink
        );

        if (bookingDetails.booking_host_phone) {
          await sendBookingRescheduledTherapist(
            booking_id,
            bookingDetails.booking_host_phone,
            bookingInviteeTime,
            bookingDetails.invitee_name
          );
        }
      } catch (waErr) {
        console.error('[Reschedule Booking] Failed to send AiSensy notifications:', waErr);
      }
    }

    console.log(`[Reschedule Booking] Successfully rescheduled booking: ${booking_id}`);

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



// Request session feedback
app.post('/api/request-feedback', async (req, res) => {
  try {
    const { bookingId, clientPhone, clientName, therapistName } = req.body;
    
    if (!bookingId || !clientPhone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { sendSessionFeedbackRequest } = await import('./automations/whatsapp.js');
    await sendSessionFeedbackRequest(bookingId, clientPhone, clientName, therapistName);
    
    res.json({ success: true, message: 'Feedback request sent successfully' });
  } catch (error: any) {
    console.error('Error sending feedback request:', error);
    res.status(500).json({ error: 'Failed to send feedback request' });
  }
});

// Webhook to receive feedback rating from WhatsApp/automation
app.post('/api/webhook/feedback', async (req, res) => {
  try {
    console.log('[Feedback Webhook] Received Headers:', req.headers);
    console.log('[Feedback Webhook] Received Body:', req.body);
    
    const { name, phone, rating } = req.body || {};
    
    if (!phone || rating === undefined) {
      console.log('[Feedback Webhook Error] Missing fields. phone:', phone, 'rating:', rating);
      return res.status(400).json({ 
        error: 'Missing phone or rating', 
        receivedBody: req.body,
        hint: "Make sure you set the Header 'Content-Type: application/json' in AiSensy and the JSON keys match 'phone' and 'rating'."
      });
    }

    // Clean phone number to match database format (usually +91... or without)
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const phoneSearchPattern = `%${cleanPhone.slice(-10)}`; // Match last 10 digits

    // Find the latest completed booking for this phone number
    const bookingResult = await pool.query(
      `SELECT booking_id 
       FROM bookings 
       WHERE invitee_phone LIKE $1 
         AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show', 'payment_pending', 'payment_failed')
         AND booking_start_at < NOW()
       ORDER BY booking_start_at DESC 
       LIMIT 1`,
      [phoneSearchPattern]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'No recent completed booking found for this client' });
    }

    const targetBookingId = bookingResult.rows[0].booking_id;

    // Update the rating
    const updateResult = await pool.query(
      `UPDATE bookings SET client_rating = $1 WHERE booking_id = $2 RETURNING booking_id`,
      [rating, targetBookingId]
    );

    // You can emit a socket event here if you want the dashboard to refresh instantly
    io.emit('booking_updated');

    res.json({ success: true, message: 'Rating saved successfully', bookingId: targetBookingId });
  } catch (error: any) {
    console.error('Error saving feedback rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

app.get('/api/appointments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.booking_id,
        b.booking_invitee_time,
        b.booking_resource_name,
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
        b.client_rating,
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
        booking_start_at_raw: row.booking_start_at,
        client_rating: row.client_rating || null
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
app.get('/api/therapists-admin', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.therapist_id,
        t.name,
        t.specialization,
        t.contact_info,
        t.profile_picture_url,
        t.phone_number,
        COALESCE(t.is_active, true) as is_active,
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
        END), 0) as revenue_this_month,
        ROUND(AVG(NULLIF(CAST(NULLIF(REGEXP_REPLACE(b.client_rating::text, '[^0-9.]', '', 'g'), '') AS numeric), 0)), 1) as average_rating
      FROM therapists t
      LEFT JOIN bookings b ON (
        TRIM(b.booking_host_name) ILIKE '%' || SPLIT_PART(t.name, ' ', 1) || '%'
        OR TRIM(b.booking_host_name) ILIKE t.name
      )
      GROUP BY t.therapist_id, t.name, t.specialization, t.contact_info, t.profile_picture_url, t.phone_number, t.is_active
      ORDER BY t.name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin therapists:', error);
    res.status(500).json({ error: 'Failed to fetch admin therapists' });
  }
});

// Update therapist status (active/inactive)
app.put('/api/admin/therapists/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    const result = await pool.query(
      'UPDATE therapists SET is_active = $1 WHERE therapist_id = $2 RETURNING *',
      [is_active, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, therapist: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapist status:', error);
    res.status(500).json({ error: 'Failed to update therapist status' });
  }
});

// Get therapist details
app.get('/api/therapist-details', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Therapist name is required' });
    }

    // Get unique clients for this therapist - filter out bookings with missing phone/email
    const clientsResult = await pool.query(`
      SELECT DISTINCT
        invitee_name,
        invitee_email,
        invitee_phone,
        booking_start_at
      FROM bookings
      WHERE booking_host_name = $1
      AND (invitee_phone IS NOT NULL AND invitee_phone != '' OR invitee_email IS NOT NULL AND invitee_email != '')
      AND invitee_name IS NOT NULL AND invitee_name != ''
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

    // Get recent appointments for this therapist - filter out incomplete bookings
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
      WHERE booking_host_name = $1
      AND (invitee_phone IS NOT NULL AND invitee_phone != '' OR invitee_email IS NOT NULL AND invitee_email != '')
      AND invitee_name IS NOT NULL AND invitee_name != ''
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
        b.client_rating,
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
      const baseUrl = host.includes('localhost') ? 'http://localhost:3004' : (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://safestories-dashboard.vercel.app');
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

    // Helper to format a booking row into the payments shape
    const formatRow = (row: any, startAtField: string, endAtField: string) => {
      let formattedTimings = 'N/A';
      const startRaw = row[startAtField];
      if (startRaw) {
        const date = new Date(startRaw);
        const endDate = new Date(row[endAtField] || date.getTime() + 50 * 60 * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmt = (d: Date) => {
          const h = d.getHours(); const m = d.getMinutes();
          const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12;
          return `${h12}:${pad(m)} ${ampm}`;
        };
        const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
        const month   = date.toLocaleDateString('en-US', { month: 'short',  timeZone: 'Asia/Kolkata' });
        const day     = date.toLocaleDateString('en-US', { day: 'numeric',  timeZone: 'Asia/Kolkata' });
        const year    = date.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
        formattedTimings = `${weekday}, ${month} ${day}, ${year} at ${fmt(date)} - ${fmt(endDate)} IST`;
      }
      return {
        booking_id: row.booking_id,
        client_name: row.invitee_name,
        session_name: row.booking_resource_name,
        session_timings: formattedTimings,
        payment_status: row.payment_status,
        invitee_phone: row.invitee_phone || '',
        invitee_email: row.invitee_email || '',
        payment_amount: row.payment_amount || row.invitee_payment_amount || 0,
        razorpay_order_id: row.razorpay_order_id || null,
        payment_id: row.payment_id || null,
        created_at: row.created_at || row.invitee_created_at || row.booking_created_at,
        booking_updated_at: row.booking_updated_at || null,
        booking_joining_link: row.booking_joining_link || null,
        payment_mode: row.payment_mode || null,
        utr: row.utr || null,
        failure_reason: row.failure_reason || null,
        customer_details: row.customer_details || null
    };

    let rows: any[] = [];

    if (!status || status === 'all_payments' || status === 'completed') {
      // Completed payments: from dashboard_api_booking (legacy) AND bookings (recent Razorpay)
      const dRes = await pool.query(
        `SELECT *, invitee_name, booking_resource_name, payment_amount, payment_status, NULL as payment_mode, NULL as utr, NULL as failure_reason, NULL as customer_details
         FROM dashboard_api_booking
         WHERE payment_amount IS NOT NULL AND payment_amount > 0
           AND payment_status = 'Completed'
         ORDER BY created_at DESC`
      );
      rows.push(...dRes.rows.map(r => formatRow(r, 'start_at', 'end_at')));

      const pRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE (b.booking_status = 'confirmed' OR b.payment_status = 'Paid' OR b.payment_status = 'Completed')
           AND b.invitee_payment_amount IS NOT NULL AND b.invitee_payment_amount > 0
         ORDER BY b.booking_created_at DESC`
      );
      rows.push(...pRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'pending') {
      // Pending payments: bookings table
      const pRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE (b.booking_status = 'payment_pending' OR b.payment_status = 'Pending')
           AND b.invitee_payment_amount IS NOT NULL AND b.invitee_payment_amount > 0
         ORDER BY b.booking_created_at DESC`
      );
      rows.push(...pRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'expired') {
      // Failed payments
      const fRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE b.booking_status = 'payment_failed' OR b.payment_status = 'Failed'
         ORDER BY b.booking_created_at DESC`
      );
      rows.push(...fRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    // Sort combined results by created_at desc
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json(rows);
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
    const baseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://safestories-dashboard.vercel.app';
    const publicBookingCheckinUrl = `${baseUrl}/booking-confirmation/${booking_id}`;
    await pool.query(
      `UPDATE bookings SET public_booking_checkin_url = $1 WHERE booking_id = $2`,
      [publicBookingCheckinUrl, booking_id]
    );

    // Auto-populate client_doc_form with public session notes link
    const baseUrlForSession = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : 'https://safestories-dashboard.vercel.app';
    const publicSessionNotesUrl = `${baseUrlForSession}/session-notes/${booking_id}`;
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
               VALUES (// If it's a Free Consultation and we have a phone, create a new lead automatically
      , return res.status(400).json({ error: 'Missing required fields: clientName is required' });, $3, $4, $5, 'New', 'pretherapy-call', CURRENT_TIMESTAMP, $6)`,
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
    }
    
    // Notifications disabled by user request.
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

    try {
      let campaignName = 'free_consultation_bookinglink_n8n';

      if (therapy && therapy !== 'Free Consultation' && therapistName && therapistName !== 'Safestories') {
        const campaignResult = await pool.query(
          `SELECT campaign_name FROM aisensy_campaign_api 
           WHERE TRIM(LOWER(therapy)) = TRIM(LOWER($1)) 
           AND TRIM(LOWER(therapist_name)) ILIKE $2 LIMIT 1`,
          [therapy, `%${therapistName.split(' ')[0]}%`]
        );
        
        if (campaignResult.rows.length > 0 && campaignResult.rows[0].campaign_name) {
          campaignName = campaignResult.rows[0].campaign_name;
        } else {
          console.warn(`[send-booking-link] No custom campaign found for ${therapy} / ${therapistName}. Falling back.`);
        }
      }

      const params = campaignName === 'free_consultation_bookinglink_n8n' ? [] : [clientName];

      await sendAiSensyMessage(
        "manual_booking_link",
        campaignName,
        phone,
        clientName,
        params
      );

      res.status(200).json({ success: true, message: 'Booking link sent successfully' });

    } catch (apiError: any) {
      console.error('❌ Error sending booking link via AiSensy:', apiError);

      res.status(200).json({
        success: true,
        message: 'Request processed (AiSensy service unavailable)',
        warning: apiError.message || 'Could not reach AiSensy service'
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

    console.log('--- NATIVE FETCH SLOTS ---');

    const therapistName = payload.selectedTherapist || payload.therapistName;
    let scheduleId: number | null = null;
    let therapistId: string | null = null;

    // When the service already knows its own schedule, use it directly (most reliable path)
    if (payload.scheduleId) {
      scheduleId = Number(payload.scheduleId);
      // Still resolve therapistId for booking deconfliction (filter out existing bookings)
      if (payload.therapistId) {
        therapistId = payload.therapistId;
      } else if (therapistName && therapistName !== 'SafeStories') {
        const tRes = await pool.query(
          'SELECT therapist_id FROM therapists WHERE TRIM(LOWER(name)) = $1 LIMIT 1',
          [therapistName.trim().toLowerCase()]
        );
        if (tRes.rows.length > 0) therapistId = tRes.rows[0].therapist_id;
      }
    } else if (therapistName === 'SafeStories') {
      scheduleId = 999999;
    } else if (therapistName) {
      const therapistResult = await pool.query(
        'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
        [therapistName.trim().toLowerCase()]
      );
      if (therapistResult.rows.length > 0) {
        therapistId = therapistResult.rows[0].therapist_id;
        scheduleId = therapistResult.rows[0].schedule_id;
      }
    }

    let availabilityRules = [];
    let dateOverrides = [];
    let exclusions = [];
    if (scheduleId) {
      const schedRes = await pool.query('SELECT availability, date_overrides, exclusions FROM therapist_schedules WHERE schedule_id = $1', [scheduleId]);
      if (schedRes.rows.length > 0) {
        availabilityRules = schedRes.rows[0].availability;
        dateOverrides = schedRes.rows[0].date_overrides || [];
        exclusions = schedRes.rows[0].exclusions || [];
      }
    }
    
    if (typeof availabilityRules === 'string') {
      try { availabilityRules = JSON.parse(availabilityRules); } catch(e){}
    }
    if (typeof dateOverrides === 'string') {
      try { dateOverrides = JSON.parse(dateOverrides); } catch(e){}
    }
    if (typeof exclusions === 'string') {
      try { exclusions = JSON.parse(exclusions); } catch(e){}
    }

    let availableSlots = [];
    const targetDateStr = payload.selectedDate;
    const targetDate = new Date(`${targetDateStr}T12:00:00Z`);
    const daysToCheck = [-1, 0, 1].map(offset => {
      const d = new Date(targetDate.getTime() + offset * 86400000);
      return d.toISOString().split('T')[0];
    });

    if (Array.isArray(availabilityRules) && availabilityRules.length > 0) {
      for (const dStr of daysToCheck) {
        // 1. Check exclusions
        const isExcluded = exclusions.some((ex: any) => ex.start === dStr || ex.end === dStr || ex.date === dStr);
        if (isExcluded) continue;

        // 2. Check date overrides
        const override = dateOverrides.find((ov: any) => ov.date === dStr || ov.day === dStr);
        let dayRule: any = null;

        if (override) {
          dayRule = {
            day: dStr,
            is_available: true,
            times: override.availability || override.times || []
          };
        } else {
          // 3. Fallback to weekly schedule
          const dObj = new Date(`${dStr}T12:00:00Z`);
          const dayOfWeekIST = dObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toLowerCase();
          dayRule = availabilityRules.find((r) => r.day.toLowerCase() === dayOfWeekIST);
        }
        
        if (dayRule && dayRule.is_available && Array.isArray(dayRule.times)) {
          for (const timeBlock of dayRule.times) {
            let current = new Date(`${dStr}T${timeBlock.start}:00+05:30`);
            const end = new Date(`${dStr}T${timeBlock.end}:00+05:30`);
            
            while (current < end) {
              const slotEndCheck = new Date(current.getTime() + 50 * 60000);
              if (slotEndCheck > end) break;
              
              availableSlots.push({ 
                timestampMs: current.getTime(), 
                dateObj: new Date(current.getTime())
              });
              
              current.setMinutes(current.getMinutes() + 30);
            }
          }
        }
      }
    }

    if (therapistId) {
      try {
        const bookingsRes = await pool.query(
          `SELECT booking_start_at, booking_end_at FROM bookings 
           WHERE therapist_id = $1 AND booking_status != 'Canceled'
           AND booking_start_at >= $2::timestamp WITH TIME ZONE 
           AND booking_start_at <= $3::timestamp WITH TIME ZONE`,
          [therapistId, `${daysToCheck[0]}T00:00:00+05:30`, `${daysToCheck[2]}T23:59:59+05:30`]
        );
        
        availableSlots = availableSlots.filter(slot => {
          const slotStartMs = slot.timestampMs;
          const slotEndMs = slotStartMs + 50 * 60000;
          
          return !bookingsRes.rows.some(booking => {
            if (!booking.booking_start_at) return false;
            const bookedStartMs = new Date(booking.booking_start_at).getTime();
            const bookedEndMs = booking.booking_end_at 
              ? new Date(booking.booking_end_at).getTime()
              : bookedStartMs + 50 * 60000;
              
            return slotStartMs < bookedEndMs && slotEndMs > bookedStartMs;
          });
        });
      } catch (err) {
        console.error('Error fetching bookings to filter slots:', err);
      }
    }

    const realNow = new Date();
    const fourHoursFromNow = new Date(realNow.getTime() + 4 * 60 * 60 * 1000);
    
    availableSlots = availableSlots.filter(slot => {
      return slot.timestampMs >= fourHoursFromNow.getTime();
    });

    const formattedSlots = availableSlots
      .map(slot => {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: payload.timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23'
        });
        const parts = formatter.formatToParts(slot.dateObj);
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        const h = parts.find(p => p.type === 'hour').value;
        const min = parts.find(p => p.type === 'minute').value;
        const s = parts.find(p => p.type === 'second').value;
        
        return {
          clientDateStr: `${y}-${m}-${d}`,
          clientTimeStr: `${h}:${min}:${s}`,
          absoluteIso: slot.dateObj.toISOString()
        };
      })
      .filter(slot => slot.clientDateStr === payload.selectedDate)
      .map(slot => slot.absoluteIso);

    res.json([{ "Available Slots": formattedSlots, success: true }]);
  } catch (error) {
    console.error('Error in native fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET public service details by slug
app.delete('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM therapy_services WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Therapy service not found' });
    }
    res.json({ message: 'Therapy service deleted successfully' });
  } catch (error) {
    console.error('Error deleting therapy service:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/public/services/:slug', async (req, res) => {
  try {
    let { slug } = req.params;
    // Normalise: stored slugs always have a leading "/"
    if (!slug.startsWith('/')) slug = '/' + slug;

    const result = await pool.query(
      'SELECT * FROM therapy_services WHERE slug = $1 AND is_active = true',
      [slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const s = result.rows[0];
    res.json({
      id: s.id,
      title: s.title,
      duration: s.duration,
      type: s.type,
      therapy_type: s.therapy_type,
      description: s.description,
      // "detailedDescription" is what BookingPage renders — use the description column
      detailedDescription: s.description || '',
      charges: s.charges,
      slug: s.slug,
      owner: s.therapist_name,
      therapist_id: s.therapist_id,
      schedule_id: s.schedule_id,
      form_questions: s.form_questions || [],
      is_payment_enabled: s.is_payment_enabled ?? true,
      payment_gateway: s.payment_gateway || 'Razorpay',
      requires_tnc: s.requires_tnc ?? true,
    });
  } catch (error) {
    console.error('Error fetching public service:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET payment settings
// GET /api/payment-settings (Admin)
app.get('/api/payment-settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0) {
      return res.json({ settings: {} });
    }
    res.json({ settings: rows[0] });
  } catch (error) {
    console.error('Error fetching payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payment-settings (Admin)
app.post('/api/payment-settings', async (req, res) => {
  try {
    const { settings } = req.body;
    const check = await pool.query('SELECT COUNT(*) FROM payment_settings');
    if (parseInt(check.rows[0].count) === 0) {
      await pool.query(
        'INSERT INTO payment_settings (active_gateway, razorpay_key_id, razorpay_key_secret) VALUES ($1, $2, $3)',
        ['razorpay', settings.razorpay_key_id, settings.razorpay_key_secret]
      );
    } else {
      await pool.query(
        'UPDATE payment_settings SET active_gateway = $1, razorpay_key_id = $2, razorpay_key_secret = $3',
        ['razorpay', settings.razorpay_key_id, settings.razorpay_key_secret]
      );
    }
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// POST /api/razorpay/create-order
app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const { rows } = await pool.query('SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0 || !rows[0].razorpay_key_id || !rows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Razorpay API keys are not configured in Admin Settings.' });
    }

    const { razorpay_key_id, razorpay_key_secret } = rows[0];

    const razorpay = new Razorpay({
      key_id: razorpay_key_id,
      key_secret: razorpay_key_secret,
    });

    const options = {
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: 'receipt_' + Date.now()
    };

    const order = await razorpay.orders.create(options);

    if (!order) {
      return res.status(500).json({ error: 'Failed to create order with Razorpay' });
    }

    res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: error.message || 'Error communicating with Razorpay' });
  }
});

// Called by frontend payment.failed event to mark a pending booking as failed immediately
// (rather than waiting for the 15-min cron) when a Razorpay payment attempt fails.
app.post('/api/mark-payment-failed', async (req, res) => {
  try {
    const { bookingId, razorpayPaymentId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });
    await pool.query(
      `UPDATE bookings
       SET payment_status = 'Failed', payment_id = COALESCE($1, payment_id), booking_updated_at = NOW()
       WHERE booking_id = $2 AND booking_status = 'payment_pending'`,
      [razorpayPaymentId || null, bookingId]
    );
    await pool.query(
      `UPDATE payments
       SET failure_reason = 'Failed during frontend checkout', updated_at = NOW()
       WHERE booking_id = $1`,
      [bookingId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error marking payment failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify Razorpay HMAC signature and confirm a pending booking.
// Called by the frontend after Razorpay's success handler fires.

// Helper function to process successful payments
async function processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload, paymentInfo = null) {
  // 3. Resolve therapist (for Google Calendar)
  const therapistName = payload.therapistName || booking.booking_host_name || 'Unknown Therapist';
  let therapistId = payload.therapistId || booking.therapist_id || null;
  let therapist = null;
  if (therapistName !== 'SafeStories' && therapistName !== 'Unknown Therapist') {
    const qParam = therapistId ? therapistId : `%${therapistName.split(' ')[0]}%`;
    const qStr = therapistId
      ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
      : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
    const tRes = await pool.query(qStr, [qParam]);
    if (tRes.rows.length > 0) { therapist = tRes.rows[0]; therapistId = therapist.therapist_id; }
  }

  // 4. Build time strings from stored booking dates
  const { randomUUID } = require('crypto');
  const startAt = new Date(booking.booking_start_at);
  const endAt   = new Date(booking.booking_end_at);
  const formatTime = (d) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
  });
  const dayName   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: 'Asia/Kolkata' });
  const monthName = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: 'Asia/Kolkata' });
  const dateNum   = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: 'Asia/Kolkata' });
  const yearNum   = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: 'Asia/Kolkata' });
  const startTimeStr = formatTime(startAt);
  const endTimeStr   = formatTime(endAt);
  const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${startTimeStr} - ${endTimeStr} IST`;

  const clientTz = payload.clientTimezone || payload.timezone || 'Asia/Kolkata';
  const fmtClient = (d) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz
  });
  const cDay   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: clientTz });
  const cMonth = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: clientTz });
  const cDate  = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: clientTz });
  const cYear  = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: clientTz });
  let tzShort = 'IST';
  if (clientTz !== 'Asia/Kolkata') {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startAt);
      tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
    } catch { tzShort = clientTz; }
  }
  const inviteeTime = `${cDay}, ${cMonth} ${cDate}, ${cYear} at ${fmtClient(startAt)} - ${fmtClient(endAt)} ${tzShort}`;

  const maskedEmailRes = await pool.query(
    'SELECT masked_email FROM masked_emails WHERE id = $1', [booking.mask_id]
  );
  const maskedEmail = maskedEmailRes.rows[0]?.masked_email || booking.invitee_email;

  // 5. Create Google Calendar event (best-effort)
  let hasCalendar = false;
  let meetLink = '';
  let google_event_id = null;
  if (therapist && therapist.google_refresh_token) {
    try {
      const oauth2Client = await getAuthenticatedClient(therapist);
      const { google } = require('googleapis');
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const isOnline = (payload.sessionMode || '') === 'online' ||
                       booking.booking_mode?.toLowerCase().includes('online');
      const eventBody = {
        summary: `${payload.therapyName || booking.booking_resource_name} - ${payload.clientName || booking.invitee_name}`,
        description: `Session via SafeStories.\nClient: ${payload.clientName || booking.invitee_name}\nEmail: ${maskedEmail}\nMode: ${payload.sessionMode || 'online'}\nNotes: ${payload.notes || 'None'}`,
        start: { dateTime: startAt.toISOString(), timeZone: 'Asia/Kolkata' },
        end:   { dateTime: endAt.toISOString(),   timeZone: 'Asia/Kolkata' },
        attendees: [{ email: maskedEmail }]
      };
      if (isOnline) {
        eventBody.conferenceData = {
          createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
        };
      } else {
        eventBody.location = 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv';
      }
      const calEvent = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: isOnline ? 1 : 0,
        requestBody: eventBody
      });
      google_event_id = calEvent.data.id || null;
      if (isOnline) meetLink = calEvent.data.hangoutLink || '';
      hasCalendar = true;
    } catch (calErr) {
      console.error('[verify-payment] Google Calendar event creation failed:', calErr);
    }
  }

  // 6. Update booking: confirmed + payment info
  const joinLink = (hasCalendar && (payload.sessionMode === 'online' || booking.booking_mode?.toLowerCase().includes('online')))
    ? meetLink : (booking.booking_joining_link || null);
  await pool.query(
    `UPDATE bookings
     SET booking_status = 'confirmed', payment_status = 'Paid',
         payment_id = $1, invitee_payment_gateway = 'Razorpay', razorpay_order_id = $2,
         booking_joining_link = $3, google_event_id = $4,
         booking_invitee_time = $5, booking_host_time = $6,
         booking_updated_at = NOW()
     WHERE booking_id = $7`,
    [razorpayPaymentId, razorpayOrderId, joinLink, google_event_id || booking.google_event_id,
     inviteeTime, hostTime, bookingId]
  );

  // Update payments table with deep Razorpay info if available
  if (paymentInfo) {
    const pMode = paymentInfo.method || null;
    const utr = paymentInfo.acquirer_data?.utr || paymentInfo.acquirer_data?.rrn || null;
    const custEmail = paymentInfo.email || null;
    const custPhone = paymentInfo.contact || null;
    await pool.query(
      `UPDATE payments
       SET razorpay_payment_id = $1,
           payment_mode = $2,
           utr = $3,
           customer_details = $4,
           updated_at = NOW()
       WHERE razorpay_order_id = $5 OR booking_id = $6`,
      [
        razorpayPaymentId,
        pMode,
        utr,
        JSON.stringify({ email: custEmail, phone: custPhone, full_response: paymentInfo }),
        razorpayOrderId,
        bookingId
      ]
    );
  } else {
    // Basic update if no deep info
    await pool.query(
      `UPDATE payments SET razorpay_payment_id = $1, updated_at = NOW() WHERE razorpay_order_id = $2 OR booking_id = $3`,
      [razorpayPaymentId, razorpayOrderId, bookingId]
    );
  }

  const clientName  = payload.clientName  || booking.invitee_name;
  const clientEmail = payload.clientEmail || booking.invitee_email;
  const clientPhone = payload.clientWhatsApp || booking.invitee_phone;
  const therapyName = payload.therapyName  || booking.booking_resource_name;
  const sessionMode = payload.sessionMode  || 'online';
  const checkinUrl  = booking.public_booking_checkin_url;

  // 7. Send confirmation emails (best-effort)
  try {
    await sendClientBookingConfirmationEmail(clientEmail, {
      clientName,
      inviteeTimeStr: inviteeTime,
      sessionName: therapyName,
      dateStr: `${dayName}, ${monthName} ${dateNum}, ${yearNum}`,
      timeRangeStr: `${startTimeStr} - ${endTimeStr}`,
      duration: 50,
      joinLink: hasCalendar ? meetLink : sessionMode,
      checkinUrl,
      calendarStartRaw: startAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      calendarEndRaw:   endAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    });
    await pool.query(
      `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
      [bookingId, 'client_confirmation_email', clientEmail, 'success', JSON.stringify({ sent: true })]
    );
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@safestories.in';
    await sendAdminBookingConfirmationEmail(adminEmail, {
      clientName, clientPhone, clientEmail,
      sessionName: therapyName, sessionTiming: hostTime, sessionMode: sessionMode,
      therapistName, therapistEmail: therapist?.contact_info || 'Not available'
    });
  } catch (emailErr) {
    console.error('[verify-payment] Email send failed:', emailErr);
  }

  // 8. Send WhatsApp confirmation (best-effort)
  try {
    const { sendBookingConfirmedClient } = await import('./automations/whatsapp.js');
    await sendBookingConfirmedClient(bookingId, clientPhone, clientName, therapyName, inviteeTime, checkinUrl);
    await pool.query(
      `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
      [bookingId, 'client_confirmation_whatsapp', clientPhone, 'success', JSON.stringify({ sent: true })]
    );
  } catch (waErr) {
    console.error('[verify-payment] WhatsApp send failed:', waErr);
  }

  // 9. Internal new-booking webhook for CRM pipeline movement
  try {
    const port = process.env.PORT || 3002;
    await fetch(`http://localhost:${port}/api/webhooks/new-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId })
    });
  } catch (e) {
    console.error('[verify-payment] Internal webhook failed:', e);
  }

  console.log(`[verify-payment] ✅ Booking ${bookingId} confirmed. Payment: ${razorpayPaymentId}`);
}

app.post('/api/razorpay/verify-payment', async (req, res) => {
  const { bookingId, razorpayPaymentId, razorpayOrderId, razorpaySignature, ...payload } = req.body;
  try {
    // 1. Check booking exists and is still pending
    const bookingCheck = await pool.query(
      `SELECT * FROM bookings WHERE booking_id = $1 AND booking_status = 'payment_pending'`,
      [bookingId]
    );
    if (bookingCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Booking not found or already processed' });
    }
    const booking = bookingCheck.rows[0];

    // 2. Verify Razorpay HMAC-SHA256 signature
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }
    const crypto = require('crypto');
    const generated = crypto
      .createHmac('sha256', keyRows[0].razorpay_key_secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (generated !== razorpaySignature) {
      console.error(`[verify-payment] Signature mismatch for booking ${bookingId}`);
      return res.status(400).json({ error: 'Payment verification failed – invalid signature' });
    }

    let paymentInfo = null;
    try {
      if (keyRows[0].razorpay_key_id) {
        const razorpay = new Razorpay({
          key_id: keyRows[0].razorpay_key_id,
          key_secret: keyRows[0].razorpay_key_secret,
        });
        paymentInfo = await razorpay.payments.fetch(razorpayPaymentId);
      }
    } catch (fetchErr) {
      console.error('[verify-payment] Failed to fetch payment deep details:', fetchErr);
    }

    await processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload, paymentInfo);

    res.json({ success: true, booking_id: bookingId });
  } catch (error) {
    console.error('❌ Error in verify-payment:', error);
    res.status(500).json({ error: error.message || 'Payment verification failed' });
  }
});

// API for cron job to verify pending payments
app.post('/api/cron/verify-pending-payments', async (req, res) => {
  try {
    console.log('[CRON] Starting 15-minute Razorpay pending payment verification...');
    
    // Get razorpay keys
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }

    const razorpay = new Razorpay({
      key_id: keyRows[0].razorpay_key_id,
      key_secret: keyRows[0].razorpay_key_secret,
    });

    // Find bookings that have been pending for > 15 mins and < 60 mins
    const pendingBookings = await pool.query(`
      SELECT * FROM bookings 
      WHERE booking_status = 'payment_pending' 
      AND razorpay_order_id IS NOT NULL
      AND booking_created_at <= NOW() - INTERVAL '15 minutes'
      AND booking_created_at >= NOW() - INTERVAL '60 minutes'
    `);

    let confirmedCount = 0;
    let failedCount = 0;

    for (const booking of pendingBookings.rows) {
      try {
        const orderId = booking.razorpay_order_id;
        // Fetch payments for this order
        const payments = await razorpay.orders.fetchPayments(orderId);
        
        // Check if there is any successful payment (captured or authorized)
        const successfulPayment = payments.items.find(p => p.status === 'captured' || p.status === 'authorized');
        
        if (successfulPayment) {
          console.log(`[CRON] Found successful payment ${successfulPayment.id} for order ${orderId}`);
          await processConfirmedBooking(
            booking.booking_id, 
            successfulPayment.id, 
            orderId, 
            booking, 
            {}, // Empty payload, falls back to booking row data
            successfulPayment
          );
          confirmedCount++;
        } else {
          // No successful payment found after 15 mins -> Fail the booking and release slot
          console.log(`[CRON] Order ${orderId} has no successful payments. Marking as Failed.`);
          await pool.query(
            `UPDATE bookings
             SET booking_status = 'Failed', payment_status = 'Failed', booking_updated_at = NOW()
             WHERE booking_id = $1 AND booking_status = 'payment_pending'`,
            [booking.booking_id]
          );

          const failedPayment = payments.items.find(p => p.status === 'failed');
          let fReason = null;
          let fCustDetails = null;
          if (failedPayment) {
            fReason = failedPayment.error_description || failedPayment.error_reason || 'Payment failed';
            fCustDetails = JSON.stringify({ email: failedPayment.email, phone: failedPayment.contact, full_response: failedPayment });
          }

          await pool.query(
            `UPDATE payments
             SET failure_reason = $1, customer_details = COALESCE($2, customer_details), updated_at = NOW()
             WHERE razorpay_order_id = $3 OR booking_id = $4`,
            [fReason || 'Payment dropped or expired', fCustDetails, orderId, booking.booking_id]
          );

          failedCount++;
        }
      } catch (err) {
        console.error(`[CRON] Error verifying order ${booking.razorpay_order_id}:`, err.message);
      }
    }

    res.json({ success: true, confirmedCount, failedCount });
  } catch (error) {
    console.error('[CRON] Error in verify-pending-payments:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payment-settings/public', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT active_gateway, razorpay_key_id FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length > 0 && rows[0].active_gateway === 'razorpay' && rows[0].razorpay_key_id) {
      res.json({
        success: true,
        activeGateway: 'razorpay',
        publicKey: rows[0].razorpay_key_id,
        paymentsEnabled: true
      });
    } else {
      res.json({ paymentsEnabled: false });
    }
  } catch (error) {
    console.error('Error fetching public payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create Direct Booking natively
app.post('/api/create-booking', async (req, res) => {
  try {
    const payload = req.body;
    const { randomUUID } = require('crypto');
    const booking_id = payload.bookingId || Math.floor(100000 + Math.random() * 900000).toString();
    const invitee_id = Math.floor(100000 + Math.random() * 900000).toString();

    // 1. Generate Masked Email
    const maskInsertRes = await pool.query(
      `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
       RETURNING id, masked_email`,
      [payload.clientEmail]
    );
    const maskId = maskInsertRes.rows[0].id;
    const maskedEmail = maskInsertRes.rows[0].masked_email;

    const therapistName = payload.therapistName || 'Unknown Therapist';
    let therapistId = payload.therapistId || null;
    let therapist = null;

    if (therapistName === 'SafeStories') {
      therapistId = 'SafeStories';
    } else if (therapistName !== 'Unknown Therapist') {
      const queryParam = therapistId ? therapistId : `%${therapistName.split(' ')[0]}%`;
      const queryStr = therapistId 
        ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
        : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
      
      const therapistRes = await pool.query(queryStr, [queryParam]);
      if (therapistRes.rows.length > 0) {
        therapist = therapistRes.rows[0];
        // Check if therapist is active
        if (therapist.is_active === false) {
          return res.status(403).json({ error: 'This therapist is no longer accepting bookings' });
        }
        therapistId = therapist.therapist_id;
      }
    }

    let startAt = new Date(`${payload.date} ${payload.slot} GMT+0530`);
    if (isNaN(startAt.getTime())) {
      startAt = new Date();
    }
    const endAt = new Date(startAt.getTime() + 50 * 60000);

    const formatTime = (dateObj: Date) => {
      return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    };

    const dayName = startAt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const monthName = startAt.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
    const dateNum = startAt.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Kolkata' });
    const yearNum = startAt.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
    const startTimeStr = formatTime(startAt);
    const endTimeStr = formatTime(endAt);

    const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${startTimeStr} - ${endTimeStr} IST`;

    const clientTz = payload.timezone || 'Asia/Kolkata';
    const formatTimeClient = (dateObj: Date) => dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz });
    const clientDayName = startAt.toLocaleDateString('en-US', { weekday: 'long', timeZone: clientTz });
    const clientMonthName = startAt.toLocaleDateString('en-US', { month: 'short', timeZone: clientTz });
    const clientDateNum = startAt.toLocaleDateString('en-US', { day: 'numeric', timeZone: clientTz });
    const clientYearNum = startAt.toLocaleDateString('en-US', { year: 'numeric', timeZone: clientTz });
    
    let tzShort = 'IST';
    if (clientTz !== 'Asia/Kolkata') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startAt);
        tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
      } catch (e) {
        tzShort = clientTz;
      }
    }
    const inviteeTime = `${clientDayName}, ${clientMonthName} ${clientDateNum}, ${clientYearNum} at ${formatTimeClient(startAt)} - ${formatTimeClient(endAt)} ${tzShort}`;

    const origin = req.get('origin') || 'http://localhost:3004';
    
    let hasCalendar = false;
    let meetLink = '';
    let google_event_id: string | null = null;
    
    if (therapist && therapist.google_refresh_token) {
      console.log(`[Create Booking] Therapist ${therapist.name} has Google Calendar connected. Creating Event.`);
      try {
        const oauth2Client = await getAuthenticatedClient(therapist);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const isOnline = payload.sessionMode === 'online';

        const eventBody: any = {
          summary: `${payload.therapyName} - ${payload.clientName}`,
          description: `Therapy session booked via SafeStories.\nClient: ${payload.clientName}\nClient Email: ${maskedEmail}\nSession Mode: ${payload.sessionMode || 'online'}\nNotes: ${payload.notes || 'None'}`,
          start: {
            dateTime: startAt.toISOString(),
            timeZone: 'Asia/Kolkata'
          },
          end: {
            dateTime: endAt.toISOString(),
            timeZone: 'Asia/Kolkata'
          },
          attendees: [
            { email: maskedEmail }
          ]
        };

        if (isOnline) {
          eventBody.conferenceData = {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: {
                type: 'hangoutsMeet'
              }
            }
          };
        } else {
          // In-person: add office location with Google Maps link
          eventBody.location = 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv';
        }

        const calendarEvent = await calendar.events.insert({
          calendarId: 'primary',
          conferenceDataVersion: isOnline ? 1 : 0,
          requestBody: eventBody
        });

        google_event_id = calendarEvent.data.id || null;

        if (isOnline) {
          meetLink = calendarEvent.data.hangoutLink || '';
        }
        hasCalendar = true;
        console.log(`[Create Booking] Successfully created Google Calendar event. ${isOnline ? 'Meet Link: ' + meetLink : 'In-person with location'}`);
      } catch (calendarError) {
        console.error('❌ Failed creating booking via Google Calendar:', calendarError);
      }
    }

    const publicBookingCheckinUrl = `${origin}/booking-confirmation/${booking_id}`;

    await pool.query(
      `INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, booking_host_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, booking_joining_link, mask_id, google_event_id,
        payment_id, payment_status, invitee_payment_gateway
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        booking_id,
        invitee_id,
        'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        payload.therapyName || 'Session',
        startAt.toISOString(),
        endAt.toISOString(),
        inviteeTime,
        hostTime,
        payload.amount || payload.paymentDetails?.amount || 0,
        'INR',
        'confirmed',
        publicBookingCheckinUrl,
        therapistName,
        therapistId,
        payload.sessionMode === 'online' ? 'Online Video Call' : 'In Person (Pune)',
        hasCalendar && payload.sessionMode === 'online' ? meetLink : null,
        maskId,
        google_event_id,
        payload.payment_id || payload.razorpay_payment_id || null,
        payload.payment_id ? 'Paid' : (payload.isFreeConsultation ? 'Free' : 'Pending'),
        payload.payment_gateway || null
      ]
    );

    // Send native email confirmation
    try {
      await sendClientBookingConfirmationEmail(payload.clientEmail, {
        clientName: payload.clientName,
        inviteeTimeStr: inviteeTime,
        sessionName: payload.therapyName || 'Session',
        dateStr: `${dayName}, ${monthName} ${dateNum}, ${yearNum}`,
        timeRangeStr: `${startTimeStr} - ${endTimeStr}`,
        duration: 50,
        joinLink: hasCalendar ? meetLink : (payload.sessionMode || 'online'),
        checkinUrl: publicBookingCheckinUrl,
        calendarStartRaw: startAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
        calendarEndRaw: endAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
      });
      console.log(`[Create Booking] Sent confirmation email to ${payload.clientEmail}`);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_email', payload.clientEmail, 'success', JSON.stringify({ sent: true })]
      );

      const adminEmailTarget = process.env.ADMIN_EMAIL || 'admin@safestories.in';
      await sendAdminBookingConfirmationEmail(adminEmailTarget, {
        clientName: payload.clientName || 'Unknown Client',
        clientPhone: payload.clientWhatsApp || 'Not provided',
        clientEmail: payload.clientEmail,
        sessionName: payload.therapyName || 'Session',
        sessionTiming: hostTime, // Send admin the IST hostTime!
        sessionMode: payload.sessionMode || 'Online',
        therapistName: therapistName,
        therapistEmail: therapist?.contact_info || 'Not available'
      });
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'admin_confirmation_email', adminEmailTarget, 'success', JSON.stringify({ sent: true })]
      );
    } catch (emailErr: any) {
      console.error('[Create Booking] Failed to send confirmation email:', emailErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'confirmation_emails', payload.clientEmail, 'failed', emailErr?.message || String(emailErr)]
      );
    }

    // Send confirmation WhatsApp natively
    try {
      const { sendBookingConfirmedClient } = await import('./automations/whatsapp.js');
      await sendBookingConfirmedClient(
        booking_id,
        payload.clientWhatsApp,
        payload.clientName,
        payload.therapyName || 'Session',
        inviteeTime,
        publicBookingCheckinUrl
      );
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_whatsapp', payload.clientWhatsApp, 'success', JSON.stringify({ sent: true })]
      );
    } catch (waErr: any) {
      console.error('[Create Booking] Failed to send AiSensy client confirmation:', waErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_whatsapp', payload.clientWhatsApp, 'failed', waErr?.message || String(waErr)]
      );
    }

    try {
      const port = process.env.PORT || 3002;
      await fetch(`http://localhost:${port}/api/webhooks/new-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id })
      });
    } catch (e) {
      console.error('Failed to call internal webhook:', e);
    }

    res.status(200).json({ success: true, booking_id, id: booking_id });

  } catch (error) {
    console.error('❌ Error in create-booking endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a minimal "pending" booking record before Razorpay opens.
// Holds the slot in DB (payment_pending) for up to 15 minutes; confirmed by verify-payment.
app.post('/api/create-pending-booking', async (req, res) => {
  try {
    const payload = req.body;
    const booking_id = Math.floor(100000 + Math.random() * 900000).toString();
    const invitee_id = Math.floor(100000 + Math.random() * 900000).toString();

    const maskInsertRes = await pool.query(
      `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
       RETURNING id`,
      [payload.clientEmail]
    );
    const maskId = maskInsertRes.rows[0].id;

    let startAt = new Date(`${payload.date} ${payload.slot} GMT+0530`);
    if (isNaN(startAt.getTime())) startAt = new Date();
    const endAt = new Date(startAt.getTime() + 50 * 60000);

    const therapistName = payload.therapistName || 'Unknown Therapist';
    let therapistId = payload.therapistId || null;
    if (therapistName === 'SafeStories') {
      therapistId = 'SafeStories';
    } else if (therapistName !== 'Unknown Therapist' && !therapistId) {
      const tRes = await pool.query(
        'SELECT therapist_id FROM therapists WHERE name ILIKE $1 LIMIT 1',
        [`%${therapistName.split(' ')[0]}%`]
      );
      if (tRes.rows.length > 0) therapistId = tRes.rows[0].therapist_id;
    }

    const origin = req.get('origin') || 'http://localhost:3004';
    const publicBookingCheckinUrl = `${origin}/booking-confirmation/${booking_id}`;

    await pool.query(
      `INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        invitee_payment_amount, invitee_payment_currency,
        booking_status, payment_status, invitee_payment_gateway,
        razorpay_order_id, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, mask_id,
        booking_invitee_time, booking_host_time
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        booking_id, invitee_id, 'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        payload.therapyName || 'Session',
        startAt.toISOString(), endAt.toISOString(),
        payload.amount || 0, 'INR',
        'payment_pending', 'Pending', 'Razorpay',
        payload.razorpayOrderId,
        publicBookingCheckinUrl,
        therapistName, therapistId,
        payload.sessionMode === 'online' ? 'Online Video Call' : 'In Person (Pune)',
        maskId,
        '', ''
    );

    // Insert pending payment record
    await pool.query(
      `INSERT INTO payments (
        booking_id, invitee_name, invitee_email, amount, currency,
        payment_gateway_name, razorpay_order_id, payment_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        booking_id,
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.amount || 0,
        'INR',
        'Razorpay',
        payload.razorpayOrderId
      ]
    );

    res.json({ success: true, booking_id });
  } catch (error: any) {
    console.error('Error creating pending booking:', error);
    res.status(500).json({ error: error.message || 'Failed to create pending booking' });
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
    const { sos_assessment_id, client_email, client_phone, client_name, expires_in_days = 7 } = req.body;

    if (!sos_assessment_id) {
      return res.status(400).json({ error: 'Missing sos_assessment_id', received: req.body });
    }

    if (!client_email) {
      return res.status(400).json({ error: 'Missing client_email', received: req.body });
    }

    if (!client_phone) {
      return res.status(400).json({ error: 'Missing client_phone', received: req.body });
    }

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


// Send SOS Alert directly (replaces N8N webhook)
app.post('/api/send-sos-alert', async (req, res) => {
  try {
    const data = req.body;
    
    // Fetch emergency contact and total bookings
    let emergencyContactName = 'N/A';
    let emergencyContactNumber = 'N/A';
    let totalCompletedBookings = '0';
    
    try {
      // Get the most recent session's emergency contact info for this client
      const contactQuery = `
        SELECT emergency_contact_name, emergency_contact_number
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND emergency_contact_name IS NOT NULL
          AND emergency_contact_name != ''
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const contactRes = await pool.query(contactQuery, [data.client_email, data.client_phone]);
      if (contactRes.rows.length > 0) {
        emergencyContactName = contactRes.rows[0].emergency_contact_name;
        emergencyContactNumber = contactRes.rows[0].emergency_contact_number;
      }
      
      // Get total completed bookings
      const countQuery = `
        SELECT count(*) as total
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND booking_status = 'completed'
      `;
      const countRes = await pool.query(countQuery, [data.client_email, data.client_phone]);
      totalCompletedBookings = countRes.rows[0].total.toString();
    } catch(dbErr) {
      console.error('Error fetching extra SOS details:', dbErr);
    }
    
    // Format Risk Indicators
    let currentRiskIndicator = 'None';
    if (data.risk_assessment && data.risk_assessment.risk_indicators) {
        const indicators = data.risk_assessment.risk_indicators;
        const activeIndicators = [];
        if (indicators.emotionalDysregulation === 'Y') activeIndicators.push('Emotional Dysregulation');
        if (indicators.physicalHarmIdeas === 'Y') activeIndicators.push('Physical Harm Ideas');
        if (indicators.drugAlcoholAbuse === 'Y') activeIndicators.push('Drug/Alcohol Abuse');
        if (indicators.suicidalAttempt === 'Y') activeIndicators.push('Suicidal Attempt');
        if (indicators.selfHarm === 'Y') activeIndicators.push('Self Harm');
        if (indicators.delusionsHallucinations === 'Y') activeIndicators.push('Delusions/Hallucinations');
        if (indicators.impulsiveness === 'Y') activeIndicators.push('Impulsiveness');
        if (indicators.severeStress === 'Y') activeIndicators.push('Severe Stress');
        if (indicators.socialIsolation === 'Y') activeIndicators.push('Social Isolation');
        if (indicators.concernByOthers === 'Y') activeIndicators.push('Concern by Others');
        if (indicators.other === 'Y') activeIndicators.push('Other');
        if (activeIndicators.length > 0) {
            currentRiskIndicator = activeIndicators.join(', ');
        }
    }
    
    const details = {
        clientName: data.client_name || 'N/A',
        clientPhone: data.client_phone || 'N/A',
        therapistName: data.therapist_name || 'N/A',
        sessionTimings: data.session_timings || 'N/A',
        mode: data.mode || 'N/A',
        totalCompletedBookings: totalCompletedBookings,
        emergencyContactName: emergencyContactName,
        emergencyContactNumber: emergencyContactNumber,
        severityLevel: String(data.risk_assessment?.severity_level || 'N/A'),
        currentRiskIndicator: currentRiskIndicator,
        riskSummary: data.risk_assessment?.risk_summary || 'N/A',
        documentationLink: data.documentation_link || 'N/A'
    };
    
    // Send Whatsapp
    const adminPhone = "+917522911068";
    await sendSOSAdminWhatsapp(
        data.booking_id || '',
        adminPhone,
        details.clientName,
        details.clientPhone,
        details.therapistName,
        details.sessionTimings,
        details.mode,
        details.totalCompletedBookings,
        details.emergencyContactName,
        details.emergencyContactNumber,
        details.severityLevel,
        details.currentRiskIndicator,
        details.riskSummary,
        details.documentationLink
    );
    
    // Send Email
    const adminEmail = "admin@safestories.in";
    await sendSOSAdminEmail(adminEmail, details);
    
    res.status(200).json({ success: true, message: 'SOS Alert triggered successfully' });
  } catch (error) {
    console.error('Error in send-sos-alert:', error);
    res.status(500).json({ error: 'Failed to send SOS Alert', details: error.message });
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
  try {
    const { session_type, session_status, client_id, client_name, booking_id, case_history, progress_notes, therapy_goals, consultation_data } = req.body;

    // Map session_status from form to doc_form status value
    const docFormStatus = session_status
      ? session_status.toLowerCase().replace(' ', '_') // 'No Show' → 'no_show', 'Completed' → 'completed', 'Cancelled' → 'cancelled'
      : 'completed';

    // If Consultation - store pre-therapy call form data
    if (session_type === 'Consultation' && consultation_data) {
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
      console.log('✅ Consultation form data stored');
    }

    // If First Session - store case history
    if (session_type === 'First Session' && case_history) {
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
        client_id, client_name, booking_id,
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
    }

    // If Follow-up Session - store progress notes
    if ((session_type === 'Follow-up Session' || session_type === 'First Session') && progress_notes) {
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
        client_id, client_name, booking_id,
        progress_notes.session_number, progress_notes.session_date || null,
        progress_notes.session_duration, progress_notes.session_mode,
        progress_notes.client_report, progress_notes.direct_quotes,
        progress_notes.client_presentation, progress_notes.presentation_tags,
        progress_notes.techniques_used, progress_notes.homework_assigned,
        progress_notes.client_reaction, progress_notes.reaction_tags, progress_notes.engagement_notes,
        progress_notes.themes_patterns, progress_notes.progress_regression, progress_notes.clinical_concerns,
        progress_notes.self_harm_mention, progress_notes.self_harm_details, progress_notes.risk_level,
        progress_notes.risk_factors, progress_notes.protective_factors, progress_notes.safety_plan,
        progress_notes.future_interventions, progress_notes.session_frequency,
        progress_notes.therapist_name, progress_notes.therapist_signature, progress_notes.signature_date || null
      ]);
    }

    // Always store/update therapy goals
    if (therapy_goals) {
      await pool.query(`
        INSERT INTO client_therapy_goals (
          client_id, client_name, goal_description, current_stage, initiation_date, is_active
        ) VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (client_id, goal_description) DO UPDATE 
        SET current_stage = EXCLUDED.current_stage,
            updated_at = NOW(),
            is_active = true
      `, [
        client_id, client_name,
        therapy_goals.goal_description,
        therapy_goals.current_stage || 'Initiation',
        new Date()
      ]);
      console.log('✅ Therapy goals stored/updated');
    }

    // Update documentation form status
    await pool.query(`
      UPDATE client_doc_form 
      SET status = $1
      WHERE booking_id = $2
    `, [docFormStatus, booking_id]);

    res.json({ success: true, message: 'Session documentation stored successfully' });
  } catch (error) {
    console.error('❌ Error storing session documentation:', error);
    res.status(500).json({ success: false, error: 'Failed to store session documentation' });
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
       WHERE client_id::text = $1 
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
    const { client_id, email, phone } = req.query;

    console.log('🔍 [API] client-session-type called with client_id:', client_id, 'email:', email, 'phone:', phone);

    let queryConditions = [];
    let queryParams = [];

    if (client_id) {
      queryParams.push(client_id);
      queryConditions.push(`(invitee_phone = $${queryParams.length} OR invitee_email = $${queryParams.length})`);
    }
    
    if (email) {
      queryParams.push(email);
      queryConditions.push(`invitee_email = $${queryParams.length}`);
    }

    if (phone) {
      const phones = String(phone).split(',').map(p => p.trim()).filter(Boolean);
      const phoneConditions = phones.map(p => {
        queryParams.push(p);
        return `invitee_phone = $${queryParams.length}`;
      });
      if (phoneConditions.length > 0) {
        queryConditions.push(`(${phoneConditions.join(' OR ')})`);
      }
    }

    if (queryConditions.length === 0) {
      return res.status(400).json({ error: 'client_id, email, or phone is required' });
    }

    const whereClause = queryConditions.join(' OR ');

    // Check if client has any PAID session bookings (non-free-consultation)
    const paidBookingsResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE (${whereClause})
       AND booking_resource_name NOT ILIKE '%free consultation%'
       LIMIT 1`,
      queryParams
    );
    const hasPaidSessions = paidBookingsResult.rows.length > 0;
    console.log('💰 [API] Paid sessions found:', hasPaidSessions, '(', paidBookingsResult.rows.length, 'rows)');

    // Check if client has free consultation bookings
    const freeConsultBookingResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE (${whereClause})
       AND booking_resource_name ILIKE '%free consultation%'
       LIMIT 1`,
      queryParams
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

// ==================== PAYMENT LINK EXPIRATION APIs ====================

// 1. Generate Payment Link (Admin)
app.post('/api/admin/generate-payment-link', async (req, res) => {
  try {
    const { 
      therapistName, 
      clientName, 
      clientEmail, 
      clientPhone, 
      date, 
      time, 
      serviceType, 
      amount 
    } = req.body;

    let resolvedTherapistId = null;
    if (therapistName) {
      const therapistResult = await pool.query(
        'SELECT therapist_id FROM therapists WHERE name ILIKE $1 LIMIT 1',
        [`%${therapistName.split(' ')[0]}%`]
      );
      if (therapistResult.rows.length > 0) {
        resolvedTherapistId = therapistResult.rows[0].therapist_id;
      }
    }

    const bookingId = randomUUID();
    const startObj = new Date(`${date}T${time}:00+05:30`);
    const endObj = new Date(startObj.getTime() + 50 * 60000); // 50 mins

    await pool.query(
      `INSERT INTO bookings (
        booking_id, therapist_id, invitee_name, invitee_email, invitee_phone,
        booking_start_at, booking_end_at, booking_status, payment_status, payment_amount,
        booking_resource_name, booking_created_at, booking_updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
      [
        bookingId, resolvedTherapistId, clientName, clientEmail, clientPhone,
        startObj.toISOString(), endObj.toISOString(), 'waiting_for_payment', 'Pending', amount,
        serviceType
      ]
    );

    let baseUrl = process.env.FRONTEND_URL || 'https://safestories-panel.vercel.app';
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    
    const paymentLink = `${baseUrl}/pay/${bookingId}`;

    const formattedDate = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(startObj);

    if (clientPhone) {
      await sendAiSensyMessage(
        bookingId,
        "send_paymentlink_client_n8n",
        clientPhone,
        clientName || "Client",
        [
          clientName || "Client",
          serviceType || "Therapy Session",
          formattedDate,
          paymentLink
        ]
      );
    }

    res.json({ success: true, paymentLink, bookingId });
  } catch (err) {
    console.error('Error generating payment link:', err);
    res.status(500).json({ error: 'Failed to generate payment link' });
  }
});

// 2. Fetch checkout info for public payment page
app.get('/api/bookings/:id/checkout-info', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT b.*, t.name as therapist_name 
       FROM bookings b 
       LEFT JOIN therapists t ON b.therapist_id = t.therapist_id 
       WHERE b.booking_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    if (booking.booking_status !== 'waiting_for_payment') {
      return res.status(400).json({ error: 'This payment link has either expired or already been paid.' });
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('Error fetching checkout info:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 3. Confirm Payment and Trigger N8N Webhook
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { bookingId, razorpayPaymentId, razorpayOrderId } = req.body;
    
    // Update local DB to Scheduled
    const updateRes = await pool.query(
      `UPDATE bookings 
       SET booking_status = 'Scheduled', payment_status = 'Paid', 
           payment_id = $1, booking_updated_at = NOW()
       WHERE booking_id = $2 AND booking_status = 'waiting_for_payment'
       RETURNING *`,
      [razorpayPaymentId || razorpayOrderId || 'manual_bypass', bookingId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(400).json({ error: 'Booking not found, expired, or already processed.' });
    }

    const booking = updateRes.rows[0];

    // Trigger N8N Webhook for Google Calendar & Emails
    // Using global fetch (intercepted or real based on setup)
    const webhookUrl = 'https://fluid.live/webhook/safestories/booking';
    
    const tRes = await pool.query('SELECT email FROM therapists WHERE therapist_id = $1', [booking.therapist_id]);
    const therapistEmail = tRes.rows.length > 0 ? tRes.rows[0].email : '';

    const webhookPayload = {
      event_type: "booking_created",
      therapist_email: therapistEmail,
      client_name: booking.invitee_name,
      client_email: booking.invitee_email,
      client_phone: booking.invitee_phone,
      start_time: booking.booking_start_at,
      end_time: booking.booking_end_at,
      service_type: booking.booking_resource_name,
      amount_paid: booking.payment_amount,
      booking_id: booking.booking_id
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      console.log('✓ Triggered N8N Webhook for confirmed payment:', bookingId);
    } catch (whErr) {
      console.error('❌ Failed to trigger N8N webhook after payment:', whErr);
    }

    res.json({ success: true, message: 'Payment confirmed and booking scheduled!' });
  } catch (err) {
    console.error('Error confirming payment:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

function startPaymentLinkExpiryCron() {
  console.log('[Cron] Starting Payment Link Expiry background job...');
  setInterval(async () => {
    try {
      // Expire old-style "waiting_for_payment" links
      const result = await pool.query(
        `UPDATE bookings
         SET booking_status = 'Canceled', booking_updated_at = NOW()
         WHERE booking_status = 'waiting_for_payment'
           AND booking_created_at < NOW() - INTERVAL '15 minutes'
         RETURNING booking_id`
      );
      if (result.rows.length > 0) {
        console.log(`[Cron] Expired ${result.rows.length} waiting_for_payment links.`);
      }

      // Expire "payment_pending" bookings (created via create-pending-booking before Razorpay)
      const pending = await pool.query(
        `UPDATE bookings
         SET booking_status = 'payment_failed', payment_status = 'Failed', booking_updated_at = NOW()
         WHERE booking_status = 'payment_pending'
           AND booking_created_at < NOW() - INTERVAL '15 minutes'
         RETURNING booking_id`
      );
      if (pending.rows.length > 0) {
        console.log(`[Cron] Expired ${pending.rows.length} unpaid pending bookings (slots freed).`);
      }
    } catch (err) {
      console.error('[Cron] Error expiring payment links:', err);
    }
  }, 60000); // Check every 60 seconds
}

// Start crons
startPaymentLinkExpiryCron();
startSessionRemindersCron();

// ==================== END PAYMENT LINK EXPIRATION APIs ====================

// ==================== OTP APIs ====================
app.post('/api/otp/generate', async (req, res) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ error: 'Action is required' });
    const otpId = await generateAdminOTP(action);
    res.json({ success: true, otpId });
  } catch (error: any) {
    console.error('Error generating OTP:', error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

app.post('/api/otp/verify', async (req, res) => {
  try {
    const { otpId, otp } = req.body;
    if (!otpId || !otp) return res.status(400).json({ error: 'Missing otpId or otp' });
    const isValid = verifyAdminOTP(otpId, otp);
    if (!isValid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

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

// ==================== THERAPY SERVICES APIs ====================
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.*, (t.google_refresh_token IS NOT NULL) as google_calendar_connected, s.availability
      FROM therapy_services ts
      LEFT JOIN therapists t ON ts.therapist_id = t.therapist_id
      LEFT JOIN therapist_schedules s ON ts.schedule_id = s.schedule_id
      ORDER BY ts.therapist_name, ts.title
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapy services:', error);
    res.status(500).json({ error: 'Failed to fetch therapy services' });
  }
});

app.get('/api/therapist-schedules/:therapist_id', async (req, res) => {
  try {
    const { therapist_id } = req.params;
    const result = await pool.query(`
      SELECT schedule_id, name, availability 
      FROM therapist_schedules 
      WHERE therapist_id = $1 
      ORDER BY created_at DESC
    `, [therapist_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapist schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const {
      title, duration, type, therapy_type, description, charges, therapist_id, therapist_name,
      payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled
    } = req.body;

    if (!title || !therapist_name) {
      return res.status(400).json({ error: 'title and therapist_name are required' });
    }

    // Slug stored WITH leading "/" so it matches the /api/public/services/:slug lookup
    const safeTitle = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const safeName  = String(therapist_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slugBase  = `/${safeTitle}-${safeName}-${Math.random().toString(36).substring(2, 7)}`;

    const result = await pool.query(`
      INSERT INTO therapy_services (
        title, duration, type, therapy_type, description, charges, slug, therapist_id, therapist_name,
        payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, true)
      RETURNING *
    `, [
      title,
      duration || '50 Mins',
      type || 'Online',
      therapy_type || null,
      description || '',
      charges || '0',
      slugBase,
      therapist_id,
      therapist_name,
      payment_gateway || 'Razorpay',
      schedule_id ? Number(schedule_id) : null,
      JSON.stringify(form_questions || []),
      requires_tnc ?? true,
      is_payment_enabled ?? true
    ]);

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating therapy service:', error);
    res.status(500).json({ error: error.message || 'Failed to create therapy service' });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, type, therapy_type, description, charges, therapist_id, therapist_name,
      payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled
    } = req.body;

    const result = await pool.query(`
      UPDATE therapy_services
      SET title             = COALESCE($1,  title),
          type              = COALESCE($2,  type),
          therapy_type      = COALESCE($3,  therapy_type),
          description       = COALESCE($4,  description),
          charges           = COALESCE($5,  charges),
          therapist_id      = COALESCE($6,  therapist_id),
          therapist_name    = COALESCE($7,  therapist_name),
          payment_gateway   = COALESCE($8,  payment_gateway),
          schedule_id       = COALESCE($9,  schedule_id),
          form_questions    = COALESCE($10::jsonb, form_questions),
          requires_tnc      = COALESCE($11, requires_tnc),
          is_payment_enabled= COALESCE($12, is_payment_enabled)
      WHERE id = $13
      RETURNING *
    `, [
      title || null,
      type || null,
      therapy_type || null,
      description || null,
      charges || null,
      therapist_id || null,
      therapist_name || null,
      payment_gateway || null,
      schedule_id ? Number(schedule_id) : null,
      form_questions ? JSON.stringify(form_questions) : null,
      requires_tnc ?? null,
      is_payment_enabled ?? null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy service not found' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating therapy service:', error);
    res.status(500).json({ error: error.message || 'Failed to update therapy service' });
  }
});

// DELETE therapy calendar
app.delete('/api/therapy-calendars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM therapy_services WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar deleted' });
  } catch (error: any) {
    console.error('Error deleting therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to delete calendar' });
  }
});

// PATCH deactivate therapy calendar
app.patch('/api/therapy-calendars/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapy_services SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar deactivated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error deactivating therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to deactivate calendar' });
  }
});

// PATCH activate therapy calendar
app.patch('/api/therapy-calendars/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapy_services SET is_active = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar activated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error activating therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to activate calendar' });
  }
});

// Automation Logs API
app.get('/api/automation-logs', async (req, res) => {
  try {
    const { limit = 100, status, type } = req.query;
    
    let query = 'SELECT * FROM automation_logs';
    const params: any[] = [];
    
    if (status || type) {
      query += ' WHERE';
      if (status) {
        params.push(status);
        query += ` status = $${params.length}`;
      }
      if (type) {
        if (params.length > 0) query += ' AND';
        params.push(type);
        query += ` automation_type = $${params.length}`;
      }
    }
    
    params.push(Number(limit));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching automation logs:', error);
    res.status(500).json({ error: 'Failed to fetch automation logs' });
  }
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

async function runStartupMigrations() {
  try {
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS therapy_type TEXT`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_payment_enabled BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS requires_tnc BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'Razorpay'`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS form_questions JSONB DEFAULT '[]'::jsonb`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS schedule_id INTEGER`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS slug TEXT`);
    // Bookings: payment tracking columns
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_id TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT`);
    console.log('✅ Startup migrations complete');
  } catch (err) {
    console.error('⚠️ Startup migration warning (non-fatal):', err);
  }
}

httpServer.listen(PORT, async () => {
  console.log(`\nAPI server running on http://localhost:${PORT}`);
  await runStartupMigrations();
  startDashboardApiBookingSync();
  startPaymentLinkExpiryCron();
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') console.error('Port is in use.');
  else console.error('Server error', err);
  process.exit(1);
});
