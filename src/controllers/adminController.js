// src/controllers/adminController.js
const userService    = require('../db/userService');
const scraperService = require('../services/scraperService');
const cacheMiddleware = require('../middleware/cache');
const jwt            = require('jsonwebtoken');

// ─── Admin whitelist ─────────────────────────────────────────────────────────
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'jaredcuerbo21@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase());

function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// ─── Middleware: require admin JWT ───────────────────────────────────────────
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme_use_env');
    if (!isAdmin(payload.email)) {
      return res.status(403).json({ success: false, error: 'Admin access only.' });
    }
    req.adminEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
}

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
async function getStats(req, res, next) {
  try {
    const stats = await userService.getStats();
    res.json({
      success:          true,
      timestamp:        new Date().toISOString(),
      totalUsers:       stats.totalUsers,
      newUsersToday:    stats.newUsersToday,
      newUsersThisWeek: stats.newUsersThisWeek,
      activeThisWeek:   stats.activeThisWeek,
      bannedCount:      stats.bannedCount,
      dailyGrowth:      stats.dailyGrowth,
    });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/recent-users ─────────────────────────────────────────────
async function getRecentUsers(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows  = await userService.getRecentUsers(limit);

    const users = rows.map(u => ({
      id:        u._id, // Add id for frontend keys
      email:     u.email,
      joinedAt:  u.joined_at,
      lastSeen:  u.last_seen,
      isBanned:  !!u.is_banned,
      otpBypass: !!u.otp_bypass,
      subscription: u.subscription || 'free',
      joinedAgo: userService.relativeTime(u.joined_at),
      seenAgo:   userService.relativeTime(u.last_seen),
    }));

    res.json({ success: true, total: users.length, users });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/activity ─────────────────────────────────────────────────
async function getActivity(req, res, next) {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip     = parseInt(req.query.skip) || 0;
    const rawLog   = await userService.getActivityLog(limit, skip);

    const activity = rawLog.map(e => ({
      id:    e._id, // Match frontend expectations
      icon:  e.icon,
      color: e.color,
      title: e.title,
      sub:   e.sub,
      ts:    e.ts,
      time:  userService.relativeTime(e.ts),
    }));

    res.json({ success: true, activity });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/top-anime ─────────────────────────────────────────────────
async function getTopAnime(req, res, next) {
  try {
    const topViews = await userService.getTopAnimeViews(10);
    
    if (topViews && topViews.length > 0) {
      const results = topViews.map((a, i) => ({
        rank:  i + 1,
        title: a.title,
        image: a.image,
        slug:  a.slug,
        views: a.views,
      }));
      return res.json({ success: true, results });
    }

    // Fallback to scraper
    const data    = await scraperService.getPopularAnime(1);
    const results = (data.results || []).slice(0, 10).map((a, i) => ({
      rank:  i + 1,
      title: a.title,
      image: a.image,
      slug:  a.slug,
      views: null,
    }));
    res.json({ success: true, results });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/admin/ban-user ─────────────────────────────────────────────────
async function banUser(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required.' });
    await userService.banUser(email);
    res.json({ success: true, message: `${email} has been banned.` });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/admin/unban-user ───────────────────────────────────────────────
async function unbanUser(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required.' });
    await userService.unbanUser(email);
    res.json({ success: true, message: `${email} has been unbanned.` });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/admin/set-otp-bypass ──────────────────────────────────────────
async function setOtpBypass(req, res, next) {
  try {
    const { email, bypass } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required.' });
    await userService.setOtpBypass(email, !!bypass);
    res.json({
      success: true,
      message: bypass
        ? `OTP bypass enabled for ${email}.`
        : `OTP restored for ${email}.`,
    });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/admin/set-subscription ─────────────────────────────────────────
async function setSubscription(req, res, next) {
  try {
    const { email, subscription } = req.body;
    if (!email || !subscription) return res.status(400).json({ success: false, error: 'Email and subscription tier required.' });
    
    const validTiers = ['free', 'premium'];
    if (!validTiers.includes(subscription)) return res.status(400).json({ success: false, error: 'Invalid subscription tier.' });

    await userService.setSubscription(email, subscription);
    res.json({ success: true, message: `Subscription for ${email} set to ${subscription}.` });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/reports ───────────────────────────────────────────────────
async function getReports(req, res, next) {
  try {
    res.json({ success: true, reports: [] });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/all-users ─────────────────────────────────────────────────
async function getAllUsers(req, res, next) {
  try {
    const rows  = await userService.getAllUsers();
    const users = rows.map(u => ({
      id:        u._id,
      email:     u.email,
      joinedAt:  u.joined_at,
      lastSeen:  u.last_seen,
      isBanned:  !!u.is_banned,
      otpBypass: !!u.otp_bypass,
      subscription: u.subscription || 'free',
    }));
    res.json({ success: true, total: users.length, users });
  } catch (error) {
    next(error);
  }
}

// ─── Scraper & System ────────────────────────────────────────────────────────

async function getScraperStatus(req, res, next) {
    try {
        res.json({ 
            success: true, 
            domain: scraperService.baseUrl,
            lastRequestTime: scraperService.lastRequestTime
        });
    } catch (error) {
        next(error);
    }
}

async function findWorkingDomain(req, res, next) {
    try {
        const domain = await scraperService.findWorkingDomain();
        res.json({ success: true, domain });
    } catch (error) {
        next(error);
    }
}

async function clearAllCache(req, res, next) {
    try {
        cacheMiddleware.clearCache('.*');
        res.json({ success: true, message: 'Cache clear triggered.' });
    } catch (error) {
        next(error);
    }
}

async function getMonthlyVisits(req, res, next) {
    try {
        const visits = await userService.getMonthlyVisits(6);
        res.json({ success: true, visits: visits || [] });
    } catch (error) {
        next(error);
    }
}

// ─── GET /api/admin/active-users ───────────────────────────────────────────
async function getActiveUsers(req, res, next) {
  try {
    const User = require('../db/models/userModel');
    const since = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes
    const count = await User.countDocuments({
      last_seen: { $gte: since },
      is_banned: false,
    });
    res.json({ success: true, count, since: since.toISOString() });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  isAdmin,
  requireAdmin,
  getStats,
  getRecentUsers,
  getActivity,
  getTopAnime,
  banUser,
  unbanUser,
  setOtpBypass,
  setSubscription,
  getReports,
  getAllUsers,
  getScraperStatus,
  findWorkingDomain,
  clearAllCache,
  getMonthlyVisits,
  getActiveUsers,
};