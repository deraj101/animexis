/**
 * Auth_routes.js
 *
 * Endpoints:
 *   POST /api/auth/send-otp         – sign-in: verify password then send OTP
 *   POST /api/auth/verify-otp       – verify OTP and issue JWT
 *   POST /api/auth/register         – create account: store password hash then send OTP
 *   POST /api/auth/forgot-password  – send reset OTP (user must exist)
 *   POST /api/auth/reset-password   – verify reset OTP and update password
 *   POST /api/auth/check-bypass     – check if OTP bypass is enabled
 *   POST /api/auth/bypass-login     – sign in without OTP (bypass only)
 *
 * .env required:
 *   GMAIL_USER, GMAIL_APP_PASSWORD, JWT_SECRET
 *   ADMIN_EMAILS (comma-separated)
 */

const express     = require('express');
const nodemailer  = require('nodemailer');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcrypt');
const router      = express.Router();
const userService = require('../db/userService');
const { isAdmin } = require('../controllers/adminController');
const redisClient = require('../db/redisClient');

// ─── Gmail transporter ─────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  connectionTimeout: 10000, // 10s timeout
  greetingTimeout: 5000,
  socketTimeout: 15000,
});

// In-memory fallback if Redis is down
const otpFallbackMap = new Map();

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

function issueToken(email) {
  return jwt.sign(
    { email: email.toLowerCase() },
    process.env.JWT_SECRET || 'changeme_use_env',
    { expiresIn: '30d' }
  );
}

// ─── OTP Config ───────────────────────────────────────────────────────────────
const OTP_EXPIRY_S  = 10 * 60;  // 10 minutes in seconds (for Redis TTL)
const MAX_ATTEMPTS  = 5;
const BCRYPT_ROUNDS = 10;

// ─── Redis OTP Helpers ────────────────────────────────────────────────────────
// Keys:   otp:<type>:<email>         → the OTP code (TTL = OTP_EXPIRY_S)
//         otp-attempts:<type>:<email> → attempt counter (TTL = OTP_EXPIRY_S)
// <type> is 'signin' or 'reset'

async function storeOtp(type, email, otp) {
  const codeKey    = `otp:${type}:${email}`;
  const attemptsKey = `otp-attempts:${type}:${email}`;
  
  try {
    if (redisClient.isOpen) {
      await redisClient.set(codeKey,     otp, { EX: OTP_EXPIRY_S });
      await redisClient.set(attemptsKey, '0', { EX: OTP_EXPIRY_S });
      return;
    }
  } catch (err) {
    console.warn('⚠️ Redis storeOtp failed, using memory fallback:', err.message);
  }

  // Fallback to memory
  otpFallbackMap.set(codeKey, { otp, attempts: 0, expires: Date.now() + (OTP_EXPIRY_S * 1000) });
}

async function verifyOtp(type, email, otp) {
  const codeKey     = `otp:${type}:${email}`;
  const attemptsKey = `otp-attempts:${type}:${email}`;

  try {
    if (redisClient.isOpen) {
      const stored   = await redisClient.get(codeKey);
      const attempts = parseInt(await redisClient.get(attemptsKey) || '0');

      if (!stored) return { ok: false, message: 'No code found. Please request a new one.' };
      
      if (attempts >= MAX_ATTEMPTS) {
        await redisClient.del(codeKey);
        await redisClient.del(attemptsKey);
        return { ok: false, message: 'Too many attempts. Please request a new code.' };
      }

      if (stored !== String(otp)) {
        await redisClient.incr(attemptsKey);
        return { ok: false, message: 'Incorrect code. Please try again.' };
      }

      await redisClient.del(codeKey);
      await redisClient.del(attemptsKey);
      return { ok: true };
    }
  } catch (err) {
    console.warn('⚠️ Redis verifyOtp failed, using memory fallback:', err.message);
  }

  // Fallback to memory
  const data = otpFallbackMap.get(codeKey);
  if (!data || data.expires < Date.now()) {
    otpFallbackMap.delete(codeKey);
    return { ok: false, message: 'No code found or expired. Please request a new one.' };
  }

  if (data.attempts >= MAX_ATTEMPTS) {
    otpFallbackMap.delete(codeKey);
    return { ok: false, message: 'Too many attempts. Please request a new code.' };
  }

  if (data.otp !== String(otp)) {
    data.attempts += 1;
    return { ok: false, message: 'Incorrect code. Please try again.' };
  }

  otpFallbackMap.delete(codeKey);
  return { ok: true };
}

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from:    `"Animexis" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Your Animexis sign-in code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;background:#111115;color:#eaeaea;border-radius:16px;overflow:hidden;">
        <div style="background:#DC143C;padding:24px 28px;">
          <h1 style="margin:0;font-size:22px;color:#fff;">🔥 Animexis</h1>
        </div>
        <div style="padding:28px;">
          <p style="font-size:15px;margin-top:0;">Your one-time sign-in code is:</p>
          <div style="background:#1a1a20;border:1px solid rgba(220,20,60,0.4);border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#DC143C;">${otp}</span>
          </div>
          <p style="font-size:13px;color:#9090a0;">This code expires in <strong>10 minutes</strong>.<br>If you didn't request this, ignore this email.</p>
        </div>
      </div>
    `,
  });
}

// ─── POST /api/auth/send-otp — sign in (user must exist) ─────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const email    = (req.body.email    || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

    // User must exist to sign in
    const existing = await userService.findUser(email);
    if (!existing)
      return res.status(404).json({ success: false, message: 'No account found with this email. Please create an account first.' });

    // Verify password
    const storedHash = await userService.getPasswordHash(email);
    if (storedHash) {
      const valid = await bcrypt.compare(password, storedHash);
      if (!valid)
        return res.status(401).json({ success: false, message: 'Incorrect password.' });
    } else {
      // Legacy account without a password — set it now (migration path)
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await userService.setPasswordHash(email, hash);
    }

    const otp = generateOtp();
    await storeOtp('signin', email, otp);
    try {
      await sendOtpEmail(email, otp);
      console.log(`[auth] sign-in OTP sent to ${email}`);
      return res.json({ success: true, message: 'OTP sent to your email.' });
    } catch (err) {
      console.error('[auth] email send failed:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to send email. Try again.' });
    }
  } catch (error) {
    console.error('[auth] send-otp crash:', error.message);
    return res.status(500).json({ success: false, message: 'An internal error occurred.' });
  }
});

// ─── POST /api/auth/register — create account (user must NOT exist) ──────────
router.post('/register', async (req, res) => {
  try {
    const email    = (req.body.email    || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    if (!password || password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

    // Reject if account already exists
    const existing = await userService.findUser(email);
    if (existing)
      return res.status(409).json({ success: false, message: 'An account with this email already exists. Please sign in instead.' });

    // Hash + store password (creates a stub user row) then send OTP
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await userService.setPasswordHash(email, hash);

    const otp = generateOtp();
    await storeOtp('signin', email, otp);
    try {
      await sendOtpEmail(email, otp);
      console.log(`[auth] register OTP sent to ${email}`);
      return res.json({ success: true, message: 'OTP sent to your email.' });
    } catch (err) {
      console.error('[auth] email send failed:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to send email. Try again.' });
    }
  } catch (error) {
    console.error('[auth] register crash:', error.message);
    return res.status(500).json({ success: false, message: 'Registration failed due to an internal error.' });
  }
});

// ─── POST /api/auth/verify-otp — shared by sign-in and register ──────────────
router.post('/verify-otp', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp   = String(req.body.otp || '');

  if (!email || !otp)
    return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

  const result = await verifyOtp('signin', email, otp);
  if (!result.ok)
    return res.status(400).json({ success: false, message: result.message });

  // Register or update last_seen
  const { isNew, user } = await userService.registerUser(email);
  if (!isNew) {
    await userService.logActivity({ icon: 'log-in', color: '#60a5fa', title: 'User signed in', sub: email });
  }

  const token = issueToken(email);
  console.log(`[auth] ${email} verified OTP (${isNew ? 'new user' : 'returning'})`);
  return res.json({ 
    success: true, 
    token, 
    email, 
    isNew, 
    isAdmin: isAdmin(email),
    name: user.name,
    profile_image: user.profile_image,
    profile_border: (user.subscription === 'premium') ? user.profile_border : null,
    subscription: user.subscription || 'free'
  });
});

// ─── POST /api/auth/forgot-password — send reset OTP (user must exist) ───────
router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success: false, message: 'Invalid email address.' });

  const existing = await userService.findUser(email);
  if (!existing)
    return res.status(404).json({ success: false, message: 'No account found with this email.' });

  const otp = generateOtp();
  await storeOtp('reset', email, otp);
  try {
    await sendOtpEmail(email, otp);
    console.log(`[auth] password reset OTP sent to ${email}`);
    return res.json({ success: true, message: 'Reset code sent to your email.' });
  } catch (err) {
    console.error('[auth] email send failed:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to send email. Try again.' });
  }
});

// ─── POST /api/auth/reset-password — verify reset OTP and set new password ───
router.post('/reset-password', async (req, res) => {
  const email       = (req.body.email       || '').trim().toLowerCase();
  const otp         = String(req.body.otp   || '');
  const newPassword = (req.body.newPassword || '').trim();

  if (!email || !otp || !newPassword)
    return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required.' });
  if (newPassword.length < 6)
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

  const result = await verifyOtp('reset', email, otp);
  if (!result.ok)
    return res.status(400).json({ success: false, message: result.message });

  // Update password hash
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userService.setPasswordHash(email, hash);

  // Update last_seen / register if somehow missing
  await userService.registerUser(email);
  await userService.logActivity({ icon: 'key', color: '#f59e0b', title: 'Password reset', sub: email });

  const token = issueToken(email);
  console.log(`[auth] ${email} reset password`);
  return res.json({ success: true, token, email, isAdmin: isAdmin(email) });
});

// ─── POST /api/auth/check-bypass ─────────────────────────────────────────────
router.post('/check-bypass', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  const bypassed = await userService.isOtpBypassed(email);
  return res.json({ success: true, bypassed });
});

// ─── POST /api/auth/bypass-login ─────────────────────────────────────────────
router.post('/bypass-login', async (req, res) => {
  const email    = (req.body.email    || '').trim().toLowerCase();
  const password = (req.body.password || '').trim();

  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  if (!password) return res.status(400).json({ success: false, message: 'Password required.' });
  
  if (!(await userService.isOtpBypassed(email)))
    return res.status(403).json({ success: false, message: 'OTP bypass not enabled for this account.' });

  // MUST verify password even for bypass
  const storedHash = await userService.getPasswordHash(email);
  if (storedHash) {
    const valid = await bcrypt.compare(password, storedHash);
    if (!valid) return res.status(401).json({ success: false, message: 'Incorrect password.' });
  } else {
    return res.status(404).json({ success: false, message: 'Account must have a password.' });
  }

  const { user } = await userService.registerUser(email);
  await userService.logActivity({ icon: 'key', color: '#22c55e', title: 'Bypass login', sub: email });
  const token = issueToken(email);
  console.log(`[auth] ${email} signed in via bypass`);
  return res.json({ 
    success: true, 
    token, 
    email, 
    isAdmin: isAdmin(email),
    name: user.name,
    profile_image: user.profile_image,
    profile_border: (user.subscription === 'premium') ? user.profile_border : null,
    subscription: user.subscription || 'free'
  });
});

// ─── Auth guard (reused from statsRoutes pattern) ────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    req.userEmail = payload.email.toLowerCase();
    
    // Refresh last_seen here too if needed, but since we usually use the 
    // global middleware for main routes, this is a fallback.
    // To stay consistent, let's at least update last_seen if we have a User model here.
    const User = require('../db/models/userModel');
    const user = await User.findOne({ email: req.userEmail });
    if (user) {
      const now = new Date();
      if (!user.last_seen || user.last_seen < new Date(now.getTime() - 2 * 60 * 1000)) {
        user.last_seen = now;
        await user.save();
      }
      req.user = user;
    }

    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// ─── GET /api/auth/heartbeat ─────────────────────────────────────────────────
// Simple endpoint for frontend to stay "active"
router.get('/heartbeat', requireAuth, (req, res) => {
  res.json({ success: true, timestamp: new Date().toISOString() });
});

// ─── POST /api/auth/update-profile ───────────────────────────────────────────
router.post('/update-profile', requireAuth, async (req, res) => {
  // Email is taken from the verified JWT — never trust req.body.email
  const email = req.userEmail;
  let { name, profile_image, profile_border } = req.body;

  // Prevent free users from equipping or keeping premium borders
  if (req.user && req.user.subscription !== 'premium') {
    profile_border = null;
  }

  try {
    const user = await userService.updateProfile(email, { name, profile_image, profile_border });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({ success: true, user: { 
      name: user.name, 
      profile_image: user.profile_image,
      profile_border: user.subscription === 'premium' ? user.profile_border : null
    } });
  } catch (error) {
    console.error('[auth] profile update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

// ─── GET /api/auth/usage-status ───────────────────────────────────────────────
router.get('/usage-status', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    const email = payload.email.toLowerCase();
    
    const user = await userService.findUser(email);
    if (!user) return res.status(404).json({ success: false });

    const redisClient = require('../db/redisClient');
    const today = new Date().toISOString().split('T')[0];
    const setKey = `usage:episodes:set:${email}:${today}`;
    
    let count = await redisClient.sCard(setKey);
    count = count ? parseInt(count) : 0;

    return res.json({
      success: true,
      subscription: user.subscription || 'free',
      profile_image: user.profile_image || null,
      profile_border: (user.subscription === 'premium') ? user.profile_border : null,
      count: count,
      limit: 20
    });
  } catch (err) {
    return res.status(401).json({ success: false });
  }
});

module.exports = router;