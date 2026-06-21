import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabaseAdmin.js';

// Import Route Modules
import categoriesRouter from './routes/categories.js';
import productsRouter from './routes/products.js';
import designsRouter from './routes/designs.js';
import ordersRouter from './routes/orders.js';
import designersRouter from './routes/designers.js';
import manufacturersRouter from './routes/manufacturers.js';
import walletsRouter from './routes/wallets.js';
import ticketsRouter from './routes/tickets.js';
import settingsRouter from './routes/settings.js';

import printStylesRouter from './routes/print-styles.js';
import usersRouter from './routes/users.js';
import storageRouter from './routes/storage.js';
import dashboardRouter from './routes/dashboard.js';
import activityRouter from './routes/activity.js';
import currencyRouter from './routes/currency.js';

const app = express();

// Configure CORS to support requests from the client SPA
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 5000;

// Middleware to verify Supabase JWT
async function verifyAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.uid = user.id;
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware to verify Admin role
async function verifyAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('admins')
      .select('*')
      .eq('id', req.uid)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminData = data;
    next();
  } catch (err) {
    console.error('Admin check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify admin access' });
  }
}

// Nodemailer SMTP transporter helper
function getMailTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: host,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: user,
      pass: pass,
    },
  });
}

// ─── OTP RATE LIMITER ───
const otpRateLimiter = new Map();

// ─── POST /api/auth/send-otp ───
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    // Rate Limiting: 1 request per 60 seconds
    const now = Date.now();
    const lastRequest = otpRateLimiter.get(email);
    if (lastRequest && now - lastRequest < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastRequest)) / 1000);
      return res.status(429).json({ error: `Too many requests. Please wait ${waitTime} seconds before trying again.` });
    }
    otpRateLimiter.set(email, now);

    // Generate 6-digit random code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

    // Save/upsert to Supabase 'otps' table
    const { error } = await supabaseAdmin
      .from('otps')
      .upsert({ email, otp, expires_at: expiresAt });

    if (error) {
      throw error;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`🔐 [VERIFICATION CODE FOR ${email.toUpperCase()}]:`);
    console.log(`👉   ${otp}   👈`);
    console.log('='.repeat(60) + '\n');

    // Send email using SMTP if configured
    const transporter = getMailTransporter();
    let sentEmail = false;

    if (transporter) {
      try {
        const mailOptions = {
          from: `"ASAT Paradise" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'ASAT Designer Verification Code',
          html: `
            <div style="font-family: 'Montserrat', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #121212; color: #ffffff; border: 1px solid #C5A059; border-radius: 12px;">
              <h2 style="font-family: 'Cinzel', serif; font-size: 24px; font-weight: 700; color: #C5A059; text-align: center; margin-bottom: 24px; letter-spacing: 2px;">ASAT DESIGNER PORTAL</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #cccccc;">Hello,</p>
              <p style="font-size: 15px; line-height: 1.6; color: #cccccc;">Thank you for registering to join the ASAT Designer Paradise. To complete your signup and verify your email address, please enter the following 6-digit verification code:</p>
              
              <div style="text-align: center; margin: 36px 0;">
                <span style="font-family: 'Cinzel', serif; font-size: 38px; font-weight: 700; color: #C5A059; letter-spacing: 6px; padding: 12px 32px; background: rgba(197, 160, 89, 0.1); border: 1px dashed rgba(197, 160, 89, 0.5); border-radius: 6px;">${otp}</span>
              </div>
              
              <p style="font-size: 13px; color: #888888; line-height: 1.6;">This code is valid for the next 5 minutes. If you did not request this verification, please ignore this email.</p>
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 30px 0;">
              <p style="font-size: 11px; text-align: center; color: #666666; letter-spacing: 1px;">As Simple as That &bull; curated designer streetwear</p>
            </div>
          `,
        };

        await transporter.sendMail(mailOptions);
        sentEmail = true;
        console.log(`✉️ OTP email successfully sent to ${email}`);
      } catch (mailErr) {
        console.error('❌ Failed to send SMTP email:', mailErr);
      }
    } else {
      console.log('ℹ️ SMTP is not configured. Email sending skipped.');
    }

    res.json({
      message: sentEmail
        ? 'Verification code sent to your email.'
        : 'Verification code generated. Check server console for details.',
      // In development mode, return debugOtp
      ...(process.env.NODE_ENV !== 'production' ? { debugOtp: otp } : {}),
    });
  } catch (err) {
    console.error('Error sending OTP:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/verify-otp ───
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }

    const { data: otpData, error: fetchError } = await supabaseAdmin
      .from('otps')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !otpData) {
      console.log(`❌ Verification failed for ${email}: No OTP found in database.`);
      return res.status(400).json({ error: 'No OTP sent for this email address.' });
    }

    if (Date.now() > Number(otpData.expires_at)) {
      console.log(`❌ Verification failed for ${email}: OTP expired (now: ${Date.now()}, expires: ${otpData.expires_at}).`);
      await supabaseAdmin.from('otps').delete().eq('email', email);
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    if (otpData.otp !== otp.trim()) {
      console.log(`❌ Verification failed for ${email}: Code mismatch (expected ${otpData.otp}, got ${otp.trim()}).`);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // Success! Delete the OTP record so it cannot be reused
    await supabaseAdmin.from('otps').delete().eq('email', email);
    console.log(`✅ Email verified successfully for ${email}`);

    res.json({ success: true, message: 'Email verified successfully.' });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/register-designer ───
app.post('/api/auth/register-designer', async (req, res) => {
  try {
    const {
      email,
      password,
      otp,
      fullName,
      username,
      contact,
      countryCode,
      gender,
      dob,
      address,
      country,
    } = req.body;

    if (!email || !password || !otp || !fullName || !username) {
      return res.status(400).json({ error: 'Required fields are missing.' });
    }

    // 1. Verify OTP
    const { data: otpData, error: fetchError } = await supabaseAdmin
      .from('otps')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !otpData) {
      console.log(`❌ Registration failed for ${email}: No OTP found in database.`);
      return res.status(400).json({ error: 'No OTP sent for this email address.' });
    }

    if (Date.now() > Number(otpData.expires_at)) {
      console.log(`❌ Registration failed for ${email}: OTP expired (now: ${Date.now()}, expires: ${otpData.expires_at}).`);
      await supabaseAdmin.from('otps').delete().eq('email', email);
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    if (otpData.otp !== otp.trim()) {
      console.log(`❌ Registration failed for ${email}: Code mismatch (expected ${otpData.otp}, got ${otp.trim()}).`);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // OTP is valid! Delete it.
    await supabaseAdmin.from('otps').delete().eq('email', email);

    // 2. Create Auth User (Confirm email automatically)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
    });

    if (authError || !authData?.user) {
      throw authError || new Error('Failed to create auth user');
    }

    const uid = authData.user.id;

    // 3. Insert Designer Profile
    const { error: profileError } = await supabaseAdmin.from('designers').insert({
      id: uid,
      full_name: fullName,
      email: email.trim().toLowerCase(),
      username: username.trim(),
      contact: contact || null,
      country_code: countryCode || null,
      gender: gender || null,
      dob: dob || null,
      address: address || null,
      country: country || 'India',
      status: 'active',
      designs_count: 0,
      total_earnings: 0,
      points: 0,
    });

    if (profileError) {
      // Rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw profileError;
    }

    // 4. Initialize Wallet
    const { error: walletError } = await supabaseAdmin.from('wallets').insert({
      id: uid,
      role: 'designer',
      balance: 0,
      total_spent: 0,
      total_earnings: 0,
      total_withdrawn: 0,
    });

    if (walletError) {
      console.error('Failed to initialize wallet during registration:', walletError.message);
    }

    console.log(`✅ Designer registered successfully: ${email} (uid: ${uid})`);
    res.json({ success: true, uid });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/master/update-password ───
app.post('/api/master/update-password', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { uid, newPassword } = req.body;
    if (!uid || !newPassword) {
      return res.status(400).json({ error: 'UID and newPassword are required.' });
    }
    if (newPassword.trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      uid,
      { password: newPassword.trim() }
    );

    if (error) {
      throw error;
    }

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error updating user password:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/master/create-user ───
app.post('/api/master/create-user', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { email, password, role, fullName, username, businessName } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required.' });
    }

    // 1. Create auth user in Supabase
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
    });

    if (authError || !authData?.user) {
      throw authError || new Error('Failed to create auth user');
    }

    const newUid = authData.user.id;

    // 2. Insert role-specific profile details
    if (role === 'designer') {
      const { error: profileError } = await supabaseAdmin.from('designers').insert({
        id: newUid,
        full_name: fullName || '',
        username: username || email.split('@')[0],
        email: email.trim().toLowerCase(),
        status: 'active',
        designs_count: 0,
        total_earnings: 0,
        points: 0,
      });
      if (profileError) {
        // Rollback auth user
        await supabaseAdmin.auth.admin.deleteUser(newUid);
        throw profileError;
      }
    } else if (role === 'mfg') {
      const { error: profileError } = await supabaseAdmin.from('manufacturers').insert({
        id: newUid,
        business_name: businessName || '',
        email: email.trim().toLowerCase(),
      });
      if (profileError) {
        // Rollback auth user
        await supabaseAdmin.auth.admin.deleteUser(newUid);
        throw profileError;
      }
    }

    // 3. Initialize wallet
    const { error: walletError } = await supabaseAdmin.from('wallets').insert({
      id: newUid,
      role: role === 'mfg' ? 'mfg' : 'designer',
      balance: 0,
      total_spent: 0,
      total_earnings: 0,
      total_withdrawn: 0,
    });

    if (walletError) {
      console.error('Failed to initialize wallet during admin user creation:', walletError.message);
    }

    res.json({ success: true, uid: newUid });
  } catch (err) {
    console.error('Error creating user by admin:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/auth/resolve-role ───
app.get('/api/auth/resolve-role', verifyAuth, async (req, res) => {
  const uid = req.uid;
  const tables = ['admins', 'designers', 'manufacturers', 'users'];
  const roleMap = {
    admins:        'admin',
    designers:     'designer',
    manufacturers: 'mfg',
    users:         'user',
  };

  try {
    for (const table of tables) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .eq('id', uid)
        .maybeSingle();

      if (data && !error) {
        return res.json({ role: roleMap[table], profile: data });
      }
    }
    return res.status(404).json({ error: 'No profile found for this user.' });
  } catch (err) {
    console.error('Role resolution failed:', err.message);
    res.status(500).json({ error: 'Failed to resolve user role' });
  }
});

// Mount Routes
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/designs', designsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/designers', designersRouter);
app.use('/api/manufacturers', manufacturersRouter);
app.use('/api/wallets', walletsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/settings', settingsRouter);

app.use('/api/print-styles', printStylesRouter);
app.use('/api/users', usersRouter);
app.use('/api/storage', storageRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/activity', activityRouter);
app.use('/api/currency', currencyRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
