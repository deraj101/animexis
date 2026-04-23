const userService    = require('../db/userService');
const scraperService = require('../services/scraperService');
const cacheMiddleware = require('../middleware/cache');
const jwt            = require('jsonwebtoken');
const Feedback       = require('../db/models/feedbackModel');
const Notification   = require('../db/models/notificationModel');

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

// ─── GET /api/admin/reports (feedbacks) ───────────────────────────────────────
async function getReports(req, res, next) {
  try {
    const reports = await Feedback.find()
      .sort({ createdAt: -1 })
      .populate('user', 'email')
      .lean();
    
    // Map to frontend expected format
    const formattedReports = reports.map(r => ({
      id: r._id.toString(),
      type: r.type,
      message: r.message,
      status: r.status,
      adminReply: r.adminReply,
      email: r.user ? r.user.email : 'Guest',
      createdAt: r.createdAt
    }));

    res.json({ success: true, reports: formattedReports });
  } catch (error) {
    next(error);
  }
}

async function deleteReport(req, res, next) {
  try {
    const { id } = req.params;
    const Feedback = require('../db/models/feedbackModel');
    await Feedback.findByIdAndDelete(id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
}

// ─── POST /api/admin/reply-feedback ───────────────────────────────────────────
async function replyToFeedback(req, res, next) {
  try {
    const { feedbackId, reply } = req.body;
    if (!feedbackId || !reply) return res.status(400).json({ success: false, error: 'Feedback ID and reply are required.' });

    const feedback = await Feedback.findById(feedbackId).populate('user', 'email');
    if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found.' });

    feedback.adminReply = reply;
    feedback.status = 'resolved';
    await feedback.save();

    // Send notification if user exists
    if (feedback.user && feedback.user.email) {
      await Notification.create({
        userEmail: feedback.user.email,
        type: 'SUPPORT_REPLY',
        refId: feedback._id, // Using feedback ID as ref
        title: 'Support Response',
        message: reply
      });
    }

    res.json({ success: true, message: 'Reply sent successfully.' });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/admin/all-users ─────────────────────────────────────────────────
async function getAllUsers(req, res, next) {
  try {
    const rows  = await userService.getAllUsers();
    const users = rows.map(u => ({
      id:        u._id.toString(),
      email:     u.email,
      joinedAt:  u.joined_at,
      lastSeen:  u.last_seen,
      otpBypass: !!u.otp_bypass,
      subscription: u.subscription || 'free',
    }));
    res.json({ success: true, total: users.length, users });
  } catch (error) {
    next(error);
  }
}

// ─── Scraper & System ────────────────────────────────────────────────────────

// ─── System ────────────────────────────────────────────────────────


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
    });
    res.json({ success: true, count, since: since.toISOString() });
  } catch (error) {
    next(error);
  }
}

// ─── Custom Anime CMS ────────────────────────────────────────────────────────

const CustomAnime = require('../db/models/customAnimeModel');
const CustomEpisode = require('../db/models/customEpisodeModel');

async function createCustomAnime(req, res, next) {
  try {
    const { slug, title, description, image, releaseDate, status, genres, type } = req.body;
    if (!slug || !title) return res.status(400).json({ success: false, error: 'Slug and title required' });

    const anime = await CustomAnime.create({ slug, title, description, image, releaseDate, status, genres, type });
    res.json({ success: true, anime: { ...anime.toObject(), _id: anime._id.toString() } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, error: 'Slug already exists' });
    next(err);
  }
}

async function getCustomAnimes(req, res, next) {
  try {
    const animes = await CustomAnime.find().sort({ createdAt: -1 }).lean();
    const formatted = animes.map(a => ({ ...a, _id: a._id.toString() }));
    res.json({ success: true, animes: formatted });
  } catch (err) { next(err); }
}

async function updateCustomAnime(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const anime = await CustomAnime.findByIdAndUpdate(id, updates, { new: true }).lean();
    res.json({ success: true, anime: { ...anime, _id: anime._id.toString() } });
  } catch (err) { next(err); }
}

async function deleteCustomAnime(req, res, next) {
  try {
    const { id } = req.params;
    const anime = await CustomAnime.findByIdAndDelete(id);
    if (anime) await CustomEpisode.deleteMany({ animeId: anime.slug });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
}

async function addCustomEpisode(req, res, next) {
  try {
    const { animeId, number, title, videoUrl, thumbnail } = req.body;
    if (!animeId || number == null || !videoUrl) return res.status(400).json({ success: false, error: 'Missing required fields' });

    const ep = await CustomEpisode.create({ animeId, number, title, videoUrl, thumbnail });
    res.json({ success: true, episode: { ...ep.toObject(), _id: ep._id.toString() } });
  } catch (err) { 
    if (err.code === 11000) return res.status(400).json({ success: false, error: 'Episode number already exists' });
    next(err); 
  }
}

async function getCustomEpisodes(req, res, next) {
  try {
    const { animeId } = req.params;
    const episodes = await CustomEpisode.find({ animeId }).sort({ number: 1 }).lean();
    const formatted = episodes.map(e => ({ ...e, _id: e._id.toString() }));
    res.json({ success: true, episodes: formatted });
  } catch (err) { next(err); }
}

async function deleteCustomEpisode(req, res, next) {
  try {
    const { id } = req.params;
    await CustomEpisode.findByIdAndDelete(id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
}

async function updateCustomEpisode(req, res, next) {
  try {
    const { id } = req.params;
    const { number, title, videoUrl, thumbnail } = req.body;
    const ep = await CustomEpisode.findByIdAndUpdate(id, { number, title, videoUrl, thumbnail }, { new: true }).lean();
    if (!ep) return res.status(404).json({ success: false, error: 'Episode not found' });
    res.json({ success: true, episode: { ...ep, _id: ep._id.toString() } });
  } catch (err) { 
    if (err.code === 11000) return res.status(400).json({ success: false, error: 'Episode number already exists' });
    next(err); 
  }
}

// ─── User Management (Extended) ──────────────────────────────────────────────

async function updateUser(req, res, next) {
  try {
    const { email } = req.params;
    const { name, subscription } = req.body;
    
    let updateData = {};
    if (name !== undefined) updateData.name = name;
    if (subscription !== undefined) updateData.subscription = subscription;
    
    const User = require('../db/models/userModel');
    const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { $set: updateData }, { new: true }).lean();
    res.json({ success: true, user });
  } catch (err) { next(err); }
}

async function deleteUser(req, res, next) {
  try {
    const { email } = req.params;
    const User = require('../db/models/userModel');
    await User.findOneAndDelete({ email: email.toLowerCase() });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
}

// ─── Comment Moderation ──────────────────────────────────────────────────────

async function getAllComments(req, res, next) {
  try {
    const CommentList = require('../db/models/commentModel'); // Explicit local require
    const comments = await CommentList.find().sort({ ts: -1 }).limit(100).lean();
    
    const viewableComments = comments.map(c => ({
      id: c._id.toString(),
      animeId: c.animeId,
      episodeNum: c.episodeNum,
      email: c.userEmail,
      name: c.userName,
      text: c.text,
      ts: c.ts
    }));

    res.json({ success: true, comments: viewableComments });
  } catch (err) { next(err); }
}

async function deleteComment(req, res, next) {
  try {
    const { id } = req.params;
    console.log(`[AdminController] Request to delete comment ID: ${id}`);
    const CommentList = require('../db/models/commentModel');
    const result = await CommentList.findByIdAndDelete(id);
    if (!result) {
      console.log(`[AdminController] Comment not found for ID: ${id}`);
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }
    console.log(`[AdminController] Successfully deleted comment ID: ${id}`);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { 
    console.error(`[AdminController] Error deleting comment:`, err);
    next(err); 
  }
}

// ─── System Announcements ────────────────────────────────────────────────────

async function sendGlobalNotification(req, res, next) {
  try {
    const { title, message } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, error: 'Title and message required' });

    const User = require('../db/models/userModel');
    const NotificationModel = require('../db/models/notificationModel');

    const emails = await User.distinct('email');
    
    const batch = emails.map(email => ({
      userEmail: email,
      type: 'SYSTEM',
      refId: 'system_announcement',
      title,
      message,
      createdAt: new Date()
    }));

    if (batch.length > 0) {
      await NotificationModel.insertMany(batch);
    }

    res.json({ success: true, message: `Notification broadcast to ${batch.length} users.` });
  } catch (err) { next(err); }
}

module.exports = {
  isAdmin,
  requireAdmin,
  getStats,
  getRecentUsers,
  getActivity,
  getTopAnime,
  setOtpBypass,
  setSubscription,
  getReports,
  getAllUsers,
  getMonthlyVisits,
  getActiveUsers,
  replyToFeedback,
  createCustomAnime,
  getCustomAnimes,
  updateCustomAnime,
  deleteCustomAnime,
  addCustomEpisode,
  getCustomEpisodes,
  updateCustomEpisode,
  deleteCustomEpisode,
  updateUser,
  deleteUser,
  getAllComments,
  deleteComment,
  deleteReport,
  sendGlobalNotification,
};