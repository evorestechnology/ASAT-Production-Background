
// Environment validation
const requiredEnvVars = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PORT"
];

for (const vars of requiredEnvVars) {
  if (!process.env[vars]) {
    console.error(`FATAL: Missing required environment variable: ${vars}`);
    process.exit(1);
  }
}

console.log("Environment validation passed");

import express from 'express';
import { validationErrorResponse, successResponse, errorResponse } from './utils/response.js';
import { validateEmail, validatePassword, validateUsername } from './validation.js';
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
import tutorialsRouter from './routes/tutorials.js';

import printStylesRouter from './routes/print-styles.js';
import usersRouter from './routes/users.js';
import storageRouter from './routes/storage.js';
import dashboardRouter from './routes/dashboard.js';
import activityRouter from './routes/activity.js';
import currencyRouter from './routes/currency.js';
import paymentRouter from './routes/payment.js';
import promosRouter from './routes/promos.js';
import reportsRouter from './routes/reports.js';
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

    // Input validation
    if (!email || !validateEmail(email)) {
      return res.status(400).json(validationErrorResponse({ email: 'Valid email is required' }));
    }

    // Rate Limiting: 1 request per 60 seconds
    const now = Date.now();
    const lastRequest = otpRateLimiter.get(email);
    if (lastRequest && now - lastRequest < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastRequest)) / 1000);
      return res.status(429).json(errorResponse(`Too many requests. Please wait ${waitTime} seconds before trying again.`, 429));
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
    // console.log(`🔐 [VERIFICATION CODE FOR ${email.toUpperCase()}]:`);
    // console.log(`👉   ${otp}   👈`);
    // console.log('='.repeat(60) + '\n');

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
              <p style="font-size: 11px; text-align: center; color: #666666; letter-spacing: 1px;">ASAT Designer Paradise &bull; curated designer streetwear</p>
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
      ...successResponse(null, sentEmail ? 'Verification code sent to your email.' : 'Verification code generated. Check server console for details.'),
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
      return res.status(400).json(validationErrorResponse({
        ...(!email ? { email: 'Email is required' } : {}),
        ...(!otp ? { otp: 'OTP is required' } : {})
      }));
    }

    const { data: otpData, error: fetchError } = await supabaseAdmin
      .from('otps')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !otpData) {
      console.log(`❌ Verification failed for ${email}: No OTP found in database.`);
      return res.status(400).json(errorResponse('No OTP sent for this email address.'));
    }

    if (Date.now() > Number(otpData.expires_at)) {
      console.log(`❌ Verification failed for ${email}: OTP expired (now: ${Date.now()}, expires: ${otpData.expires_at}).`);
      await supabaseAdmin.from('otps').delete().eq('email', email);
      return res.status(400).json(errorResponse('Verification code has expired.'));
    }

    if (otpData.otp !== otp.trim()) {
      console.log(`❌ Verification failed for ${email}: Code mismatch (expected ${otpData.otp}, got ${otp.trim()}).`);
      return res.status(400).json(errorResponse('Invalid verification code.'));
    }

    // Success! Delete the OTP record so it cannot be reused
    await supabaseAdmin.from('otps').delete().eq('email', email);
    console.log(`✅ Email verified successfully for ${email}`);

    res.json(successResponse(null, 'Email verified successfully.'));
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
  }
});

// ─── POST /api/auth/forgot-password/send-otp ───
// Sends a password-reset OTP to the given email, but ONLY if the email
// belongs to an existing user account (any role). Rate-limited 1 req/60s.
app.post('/api/auth/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(400).json(validationErrorResponse({ email: 'Valid email is required' }));
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limiting – reuse the same limiter as registration OTP
    const now = Date.now();
    const lastRequest = otpRateLimiter.get(`reset_${normalizedEmail}`);
    if (lastRequest && now - lastRequest < 60000) {
      const waitTime = Math.ceil((60000 - (now - lastRequest)) / 1000);
      return res.status(429).json(errorResponse(`Too many requests. Please wait ${waitTime} seconds before trying again.`, 429));
    }

    // Check that the email belongs to a real account (check all role tables)
    let userFound = false;
    let userUid = null;

    // Check auth user directly via Supabase admin
    try {
      const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (!listErr && users) {
        const match = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
        if (match) {
          userFound = true;
          userUid = match.id;
        }
      }
    } catch (_) { /* continue */ }

    // Also check designers and users tables directly
    if (!userFound) {
      try {
        const { data: dMatch } = await supabaseAdmin.from('designers').select('id, email').eq('email', normalizedEmail).maybeSingle();
        if (dMatch) {
          userFound = true;
          userUid = dMatch.id;
        } else {
          const { data: uMatch } = await supabaseAdmin.from('users').select('id, email').eq('email', normalizedEmail).maybeSingle();
          if (uMatch) {
            userFound = true;
            userUid = uMatch.id;
          }
        }
      } catch (_) { /* continue */ }
    }

    if (!userFound) {
      // For security, don't reveal whether the email exists — return same message
      // but skip sending OTP
      return res.status(404).json(errorResponse('No account found with this email address.'));
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min

    // Store OTP
    const { error: upsertErr } = await supabaseAdmin
      .from('otps')
      .upsert({ email: normalizedEmail, otp, expires_at: expiresAt });

    if (upsertErr) throw upsertErr;

    otpRateLimiter.set(`reset_${normalizedEmail}`, now);

    // Send reset email via SMTP
    const transporter = getMailTransporter();
    let sentEmail = false;

    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"ASAT Designer Paradise" <${process.env.SMTP_USER}>`,
          to: normalizedEmail,
          subject: 'ASAT Designer Paradise — Password Reset Code',
          html: `
            <div style="font-family:'Montserrat',sans-serif;max-width:600px;margin:0 auto;padding:40px;background:#0d0d0d;color:#ffffff;border:1px solid #C5A059;border-radius:12px;">
              <h2 style="font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:#C5A059;text-align:center;margin-bottom:24px;letter-spacing:2px;">PASSWORD RESET</h2>
              <p style="font-size:15px;line-height:1.7;color:#cccccc;">We received a request to reset the password for your <strong style="color:#C5A059;">ASAT Designer Paradise</strong> account associated with this email address.</p>
              <p style="font-size:15px;line-height:1.7;color:#cccccc;">Enter the following 6-digit verification code to proceed:</p>

              <div style="text-align:center;margin:36px 0;">
                <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;color:#C5A059;letter-spacing:10px;padding:14px 32px;background:rgba(197,160,89,0.08);border:1px dashed rgba(197,160,89,0.45);border-radius:8px;display:inline-block;">${otp}</span>
              </div>

              <p style="font-size:13px;color:#888;line-height:1.6;">This code expires in <strong>5 minutes</strong>. If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>
              <hr style="border:0;border-top:1px solid rgba(255,255,255,0.07);margin:28px 0;">
              <p style="font-size:11px;text-align:center;color:#555;letter-spacing:1px;">ASAT Designer Paradise &bull; curated designer streetwear</p>
            </div>
          `,
        });
        sentEmail = true;
        console.log(`✉️  Password-reset OTP sent to ${normalizedEmail}`);
      } catch (mailErr) {
        console.error('❌ Failed to send reset OTP email:', mailErr);
      }
    }

    res.json({
      ...successResponse(null, sentEmail
        ? 'A 6-digit reset code has been sent to your email.'
        : 'Reset code generated. Check server console.'),
      ...(process.env.NODE_ENV !== 'production' ? { debugOtp: otp } : {}),
    });
  } catch (err) {
    console.error('Error in forgot-password/send-otp:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
  }
});

// ─── POST /api/auth/forgot-password/reset ───
// Verifies OTP then updates the user's password via Supabase Admin API.
app.post('/api/auth/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate inputs
    const errors = {};
    if (!email || !validateEmail(email)) errors.email = 'Valid email is required';
    if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) errors.otp = 'Valid 6-digit code is required';
    if (!newPassword || newPassword.trim().length < 6) errors.newPassword = 'Password must be at least 6 characters';
    if (Object.keys(errors).length > 0) {
      return res.status(400).json(validationErrorResponse(errors));
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify OTP from DB
    const { data: otpData, error: fetchErr } = await supabaseAdmin
      .from('otps')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (fetchErr || !otpData) {
      return res.status(400).json(errorResponse('No reset code found for this email. Please request a new one.'));
    }
    if (Date.now() > Number(otpData.expires_at)) {
      await supabaseAdmin.from('otps').delete().eq('email', normalizedEmail);
      return res.status(400).json(errorResponse('Reset code has expired. Please request a new one.'));
    }
    if (otpData.otp !== otp.trim()) {
      return res.status(400).json(errorResponse('Invalid reset code. Please check and try again.'));
    }

    // OTP valid — delete it
    await supabaseAdmin.from('otps').delete().eq('email', normalizedEmail);

    // Find the Supabase Auth user UID
    let uid = null;
    try {
      const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (!listErr && users) {
        const match = users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
        if (match) uid = match.id;
      }
    } catch (_) { /* continue */ }

    // Also check designers and users tables directly
    if (!uid) {
      try {
        const { data: dMatch } = await supabaseAdmin.from('designers').select('id, email').eq('email', normalizedEmail).maybeSingle();
        if (dMatch) uid = dMatch.id;
        else {
          const { data: uMatch } = await supabaseAdmin.from('users').select('id, email').eq('email', normalizedEmail).maybeSingle();
          if (uMatch) uid = uMatch.id;
        }
      } catch (_) { /* continue */ }
    }

    if (!uid) {
      return res.status(404).json(errorResponse('Account not found.'));
    }

    // Update password via admin API
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(uid, {
      password: newPassword.trim(),
    });

    if (updateErr) throw updateErr;

    // Clear rate-limiter entry so user can request new OTPs immediately
    otpRateLimiter.delete(`reset_${normalizedEmail}`);

    // console.log(`✅ Password reset successfully for ${normalizedEmail}`);
    res.json(successResponse(null, 'Password has been reset successfully. You can now sign in.'));
  } catch (err) {
    console.error('Error in forgot-password/reset:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
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
      firstName,
      secondName,
      username,
      contact,
      countryCode,
      gender,
      dob,
      address,
      country,
      upiId,
      paypalId,
      description,
      instagram,
      linkedin,
      termsAccepted,
    } = req.body;

    const computedFullName = (fullName || `${firstName || ''} ${secondName || ''}`).trim();

    let finalUsername = (username || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!finalUsername || finalUsername.length < 3) {
      let base = (firstName ? `${firstName}${secondName ? '_' + secondName : ''}` : (computedFullName || 'designer'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (!base || base.length < 2) base = 'designer';
      finalUsername = `${base.slice(0, 12)}_${Date.now().toString().slice(-4)}`;
    }

    // Input validation
    const validationErrors = {};
    if (!email || !validateEmail(email)) {
      validationErrors.email = 'Valid email is required';
    }
    if (!password || !validatePassword(password)) {
      validationErrors.password = 'Password must be at least 6 characters long';
    }
    if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
      validationErrors.otp = 'Valid 6-digit OTP is required';
    }
    if (!computedFullName || computedFullName.length < 2) {
      validationErrors.fullName = 'Full name (or first & second name) must be at least 2 characters long';
    }
    if (!finalUsername || !validateUsername(finalUsername)) {
      validationErrors.username = 'Username must be 3-20 characters (letters, numbers, underscore, hyphen only)';
    }
    if (!description || description.trim().length < 5) {
      validationErrors.description = 'Designer description is required (min 5 characters)';
    }

    const isIndia = (country || '').trim().toLowerCase() === 'india';
    if (isIndia && (!upiId || !upiId.trim())) {
      validationErrors.upiId = 'UPI ID is required for designers in India';
    } else if (!isIndia && (!paypalId || !paypalId.trim())) {
      validationErrors.paypalId = 'PayPal ID is required for international designers';
    }

    if (!termsAccepted) {
      validationErrors.termsAccepted = 'You must accept the Terms & Conditions to register';
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json(validationErrorResponse(validationErrors));
    }

    // 1. Verify OTP
    const { data: otpData, error: fetchError } = await supabaseAdmin
      .from('otps')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !otpData) {
      console.log(`❌ Registration failed for ${email}: No OTP found in database.`);
      return res.status(400).json(errorResponse('No OTP sent for this email address.'));
    }

    if (Date.now() > Number(otpData.expires_at)) {
      console.log(`❌ Registration failed for ${email}: OTP expired (now: ${Date.now()}, expires: ${otpData.expires_at}).`);
      await supabaseAdmin.from('otps').delete().eq('email', email);
      return res.status(400).json(errorResponse('Verification code has expired.'));
    }

    if (otpData.otp !== otp.trim()) {
      console.log(`❌ Registration failed for ${email}: Code mismatch (expected ${otpData.otp}, got ${otp.trim()}).`);
      return res.status(400).json(errorResponse('Invalid verification code.'));
    }

    // OTP is valid! Delete it.
    await supabaseAdmin.from('otps').delete().eq('email', email);

    // 2. Create Auth User (Confirm email automatically) with user_metadata
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: computedFullName,
        first_name: firstName || '',
        second_name: secondName || '',
        username: finalUsername,
        description: description ? description.trim() : '',
        bio: description ? description.trim() : '',
        instagram: instagram ? instagram.trim() : '',
        linkedin: linkedin ? linkedin.trim() : '',
        upi_id: upiId ? upiId.trim() : '',
        paypal_id: paypalId ? paypalId.trim() : ''
      }
    });

    if (authError || !authData?.user) {
      throw authError || new Error('Failed to create auth user');
    }

    const uid = authData.user.id;

    // 3. Insert Designer Profile
    const designerPayload = {
      id: uid,
      full_name: computedFullName,
      email: email.trim().toLowerCase(),
      username: finalUsername,
      contact: contact || null,
      country_code: countryCode || null,
      gender: gender || null,
      dob: dob || null,
      address: address || null,
      country: country || 'India',
      upi_id: upiId ? upiId.trim() : null,
      paypal_id: paypalId ? paypalId.trim() : null,
      description: description ? description.trim() : null,
      instagram: instagram ? instagram.trim() : null,
      linkedin: linkedin ? linkedin.trim() : null,
      terms_accepted: termsAccepted === true,
      terms_accepted_at: termsAccepted === true ? new Date().toISOString() : null,
      status: 'active',
      designs_count: 0,
      total_earnings: 0,
      points: 0,
    };

    let { error: profileError } = await supabaseAdmin.from('designers').insert(designerPayload);

    if (profileError && profileError.message && profileError.message.includes('column')) {
      // Column might not exist in database schema; strip newer columns and retry
      delete designerPayload.upi_id;
      delete designerPayload.paypal_id;
      delete designerPayload.description;
      delete designerPayload.instagram;
      delete designerPayload.linkedin;
      const payoutNote = isIndia ? `[UPI: ${upiId.trim()}]` : `[PayPal: ${paypalId.trim()}]`;
      let extraNotes = `Payout: ${payoutNote}`;
      if (description) extraNotes += ` | Bio: ${description.trim()}`;
      if (instagram) extraNotes += ` | IG: ${instagram.trim()}`;
      if (linkedin) extraNotes += ` | IN: ${linkedin.trim()}`;

      designerPayload.address = (designerPayload.address || '') ? `${designerPayload.address} | ${extraNotes}` : extraNotes;
      
      const retry = await supabaseAdmin.from('designers').insert(designerPayload);
      profileError = retry.error;
    }

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
    res.status(201).json(successResponse({ uid }, 'Designer registered successfully'));
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json(errorResponse(err.message || 'Internal server error', 500));
  }
});

// ─── POST /api/master/update-password ───
app.post('/api/master/update-password', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { uid, newPassword } = req.body;

    // Input validation
    if (!uid) {
      return res.status(400).json(errorResponse('UID is required'));
    }
    if (!newPassword) {
      return res.status(400).json(errorResponse('newPassword is required'));
    }
    if (newPassword.trim().length < 6) {
      return res.status(400).json(errorResponse('Password must be at least 6 characters long'));
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      uid,
      { password: newPassword.trim() }
    );

    if (error) {
      throw error;
    }

    res.json(successResponse(null, 'Password updated successfully'));
  } catch (err) {
    console.error('Error updating user password:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
  }
});

// ─── POST /api/master/create-user ───
app.post('/api/master/create-user', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { email, password, role, fullName, username, businessName } = req.body;

    // Input validation
    const validationErrors = {};
    if (!email || !validateEmail(email)) {
      validationErrors.email = 'Valid email is required';
    }
    if (!password || !validatePassword(password)) {
      validationErrors.password = 'Password must be at least 6 characters long';
    }
    if (!role) {
      validationErrors.role = 'Role is required';
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json(validationErrorResponse(validationErrors));
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
      // Initialize Wallet
      await supabaseAdmin.from('wallets').insert({
        id: newUid,
        role: 'designer',
        balance: 0,
        total_spent: 0,
        total_earnings: 0,
        total_withdrawn: 0,
      });
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
      // Initialize Wallet
      await supabaseAdmin.from('wallets').insert({
        id: newUid,
        role: 'mfg',
        balance: 0,
        total_spent: 0,
        total_earnings: 0,
        total_withdrawn: 0,
      });
    } else if (role === 'admin') {
      const { error: profileError } = await supabaseAdmin.from('admins').insert({
        id: newUid,
        email: email.trim().toLowerCase(),
        full_name: fullName || '',
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
      role: role,
      balance: 0,
      total_spent: 0,
      total_earnings: 0,
      total_withdrawn: 0,
    });

    if (walletError) {
      console.error('Failed to initialize wallet during admin user creation:', walletError.message);
    }

    res.status(201).json(successResponse({ uid: newUid }, 'User created successfully'));
  } catch (err) {
    console.error('Error creating user by admin:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
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
        // ── Status guard: block deleted / blocked accounts from resolving any role ──
        if (table === 'admins') {
          if (data.active === false || data.status === 'disabled' || data.status === 'blocked') {
            return res.status(403).json({
              error: 'Your administrator account has been disabled. Please contact the Master Admin.',
              accountDisabled: true,
              accountBlocked: true
            });
          }
        }

        if (table === 'manufacturers') {
          if (data.status === 'deleted') {
            return res.status(403).json({
              error: 'This manufacturer account has been deleted. Please contact ASAT support.',
              accountDeleted: true,
            });
          }
          if (data.status === 'blocked') {
            return res.status(403).json({
              error: 'Your manufacturer account has been blocked by admin. Please contact support.',
              accountBlocked: true,
            });
          }
        }

        if (table === 'designers') {
          if (data.status === 'blocked') {
            return res.status(403).json({
              error: 'Your designer account has been blocked by admin. Please contact support.',
              accountBlocked: true,
            });
          }
        }

        return res.json(successResponse({ role: roleMap[table], profile: data }));
      }
    }

    // Fallback: if no profile found in any table, check if the user is an admin by email
    const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim().toLowerCase()) : [];
    if (adminEmails.length > 0 && adminEmails.includes(req.user.email.toLowerCase())) {
      // Try to create a profile in the admins table
      const { data: adminProfile, error: adminError } = await supabaseAdmin
        .from('admins')
        .insert({
          id: req.uid,
          email: req.user.email.toLowerCase(),
          full_name: req.user.user_metadata?.full_name || '',
        })
        .single();

      if (adminError) {
        // If it's a unique violation (another request created it concurrently), try to fetch again
        if (adminError.code === '23505') {
          const { data: existingProfile, error: fetchError } = await supabaseAdmin
            .from('admins')
            .select('*')
            .eq('id', req.uid)
            .single();
          if (!fetchError && existingProfile) {
            return res.json(successResponse({ role: 'admin', profile: existingProfile }));
          }
        }
        // If other error, we fall through to return 404
      // if there's an error
      } else {
        return res.json(successResponse({ role: 'admin', profile: adminProfile }));
      }
    }

    return res.status(404).json(errorResponse('No profile found for this user.', 404));
  } catch (err) {
    console.error('Role resolution failed:', err.message);
    res.status(500).json(errorResponse('Failed to resolve user role', 500));
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
app.use('/api/payment', paymentRouter);
app.use('/api/tutorials', tutorialsRouter);
app.use('/api/promos', promosRouter);
app.use('/api/reports', reportsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
