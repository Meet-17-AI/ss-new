// ==================== GOOGLE CALENDAR OAUTH CONFIG & ENDPOINTS ====================
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '168173993649-2v0jpmi1c4mdkjg70agbret556r7uarm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3004/api/auth/google/callback';

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
};

// Helper function to get authenticated Google API client for a therapist
async function getAuthenticatedClient(therapist: any) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: therapist.google_refresh_token,
    access_token: therapist.google_access_token,
    expiry_date: therapist.google_token_expiry ? new Date(therapist.google_token_expiry).getTime() : undefined
  });

  // Force refresh to get a fresh access token and ensure it's valid
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token) {
      const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3500 * 1000);
      
      // Update database
      await pool.query(
        `UPDATE therapists 
         SET google_access_token = $1, google_token_expiry = $2 
         WHERE therapist_id = $3`,
        [credentials.access_token, expiryDate, therapist.therapist_id]
      );
      
      oauth2Client.setCredentials(credentials);
    }
  } catch (err) {
    console.error('Error refreshing Google access token:', err);
  }

  return oauth2Client;
}

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
        console.error(`âŒ Google Calendar ${userEmail} is already linked to therapist ${existingCheck.rows[0].name}`);
        // Redirect with a specific error flag so frontend can show a toast
        return res.redirect('http://localhost:3004/therapist?googleAuth=error&reason=already_linked');
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
       SET google_refresh_token = $1, google_access_token = $2, google_token_expiry = $3, contact_info = COALESCE(NULLIF($4, ''), contact_info)
       WHERE therapist_id = $5`,
      [tokens.refresh_token, tokens.access_token, expiryDate, userEmail, therapistId]
    );

    console.log(`âœ“ Connected Google Calendar successfully for therapist: ${therapistId} (${userEmail})`);

    // Redirect to the frontend app
    if (adminRedirect || therapistId === 'SafeStories') {
      res.redirect('http://localhost:3004/?googleAuth=success');
    } else {
      res.redirect('http://localhost:3004/therapist?googleAuth=success');
    }
  } catch (error) {
    console.error('âŒ Error in Google OAuth callback:', error);
    res.status(500).send('Authentication failed. Please check logs.');
  }
});

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
    console.error('âŒ Error disconnecting calendar:', error);
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
    console.error('âŒ Error checking Google connection status:', error);
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
