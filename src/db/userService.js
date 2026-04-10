// src/db/userService.js — all data lives in MongoDB (Mongoose)
const UserModel = require('./models/userModel');
const Activity = require('./models/activityModel');
const Comment = require('./models/commentModel');
const { AnimeView, AppVisit, ContinueWatching } = require('./models/analyticsModels');


/**
 * User Management
 */
async function registerUser(email) {
  const normalizedEmail = email.toLowerCase();
  let user = await UserModel.findOne({ email: normalizedEmail });
  let isNew = false;

  if (!user) {
    user = await UserModel.create({ email: normalizedEmail });
    isNew = true;
    logActivity({ icon: 'person-add', color: '#22c55e', title: 'New user registered', sub: normalizedEmail });
  } else {
    user.last_seen = new Date();
    await user.save();
  }
  return { isNew, user: user.toObject() };
}

async function getAllUsers() { 
  return await UserModel.find({}).sort({ joined_at: -1 }).lean(); 
}

async function getRecentUsers(n = 20) { 
  return await UserModel.find({}).sort({ joined_at: -1 }).limit(n).lean(); 
}

async function findUser(email) { 
  return await UserModel.findOne({ email: email.toLowerCase() }).lean(); 
}

async function deleteUser(email) { 
  return await UserModel.deleteOne({ email: email.toLowerCase() }); 
}

async function updateProfile(email, profile) {
  const { name, profile_image, profile_border } = profile;
  const update = {};
  if (name           !== undefined) update.name           = name;
  if (profile_image  !== undefined) update.profile_image  = profile_image;
  if (profile_border !== undefined) update.profile_border = profile_border;
  
  const user = await UserModel.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: update },
    { returnDocument: 'after' }
  ).lean();

  if (user) {
    const commentUpdate = {};
    if (name !== undefined) commentUpdate.userName = name;
    if (profile_image !== undefined) commentUpdate.profileImage = profile_image;
    if (profile_border !== undefined) commentUpdate.profileBorder = profile_border;
    
    if (Object.keys(commentUpdate).length > 0) {
      await Comment.updateMany(
        { userEmail: email.toLowerCase() },
        { $set: commentUpdate }
      );
    }
  }

  return user;
}

async function setSubscription(email, subscription) {
  return await UserModel.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: { subscription } },
    { returnDocument: 'after' }
  ).lean();
}

/**
 * Auth & Password
 */
async function getPasswordHash(email) {
  const user = await UserModel.findOne({ email: email.toLowerCase() }, 'password_hash').lean();
  return user?.password_hash || null;
}

async function setPasswordHash(email, hash) {
  const normalizedEmail = email.toLowerCase();
  await UserModel.findOneAndUpdate(
    { email: normalizedEmail },
    { password_hash: hash, last_seen: new Date() },
    { upsert: true, returnDocument: 'after' }
  );
}

/**
 * Ban / Unban
 */
async function banUser(email) {
  const normalizedEmail = email.toLowerCase();
  await UserModel.updateOne({ email: normalizedEmail }, { is_banned: true });
  logActivity({ icon: 'ban', color: '#ef4444', title: 'User banned', sub: normalizedEmail });
}

async function unbanUser(email) {
  const normalizedEmail = email.toLowerCase();
  await UserModel.updateOne({ email: normalizedEmail }, { is_banned: false });
  logActivity({ icon: 'checkmark-circle', color: '#22c55e', title: 'User unbanned', sub: normalizedEmail });
}

async function isBanned(email) {
  const user = await UserModel.findOne({ email: email.toLowerCase() }, 'is_banned').lean();
  return user?.is_banned || false;
}

/**
 * OTP Bypass
 */
async function setOtpBypass(email, enabled) {
  const normalizedEmail = email.toLowerCase();
  await UserModel.updateOne({ email: normalizedEmail }, { otp_bypass: enabled });
  logActivity({
    icon:  enabled ? 'key' : 'key-outline',
    color: enabled ? '#22c55e' : '#9090a8',
    title: enabled ? 'OTP bypass enabled' : 'OTP bypass removed',
    sub:   normalizedEmail,
  });
}

async function isOtpBypassed(email) {
  const user = await UserModel.findOne({ email: email.toLowerCase() }, 'otp_bypass').lean();
  return user?.otp_bypass || false;
}

async function getAllBypassed() {
  const bypassed = await UserModel.find({ otp_bypass: true }, 'email').lean();
  return bypassed.map(u => u.email);
}

/**
 * Dashboard Stats
 */
async function getStats() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, newToday, newThisWeek, activeThisWeek, bannedCount] = await Promise.all([
    UserModel.countDocuments({ is_banned: false }),
    UserModel.countDocuments({ joined_at: { $gte: today }, is_banned: false }),
    UserModel.countDocuments({ joined_at: { $gte: lastWeek }, is_banned: false }),
    UserModel.countDocuments({ last_seen: { $gte: lastWeek }, is_banned: false }),
    UserModel.countDocuments({ is_banned: true })
  ]);

  // Daily growth for chart (last 14 days)
  const growthData = await UserModel.aggregate([
    { $match: { joined_at: { $gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) }, is_banned: false } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$joined_at" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { day: "$_id", count: 1, _id: 0 } }
  ]);

  return {
    totalUsers,
    newUsersToday: newToday,
    newUsersThisWeek: newThisWeek,
    activeThisWeek,
    bannedCount,
    dailyGrowth: growthData
  };
}

/**
 * Activity Log
 */
async function logActivity({ icon, color, title, sub = '' }) {
  await Activity.create({ icon, color, title, sub });
  // Mongoose TTL handles pruning automatically if defined in schema index
}

async function getActivityLog(limit = 8, skip = 0) {
  return await Activity.find({})
    .sort({ ts: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

/**
 * Analytics
 */
async function logAnimeView({ slug, title, image = null }) {
  await AnimeView.findOneAndUpdate(
    { slug },
    { $inc: { views: 1 }, $set: { title, image, last_updated: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
}

async function getTopAnimeViews(limit = 10) {
  return await AnimeView.find({}).sort({ views: -1 }).limit(limit).lean();
}

async function logAppVisit(identifier = 'anonymous') {
  const redisClient = require('./redisClient');
  const today = new Date().toISOString().split('T')[0];
  const lockKey = `visit:lock:${identifier}:${today}`;

  // Attempt to set a lock for this identifier for 24 hours (NX = only if not exists)
  const isNewVisit = await redisClient.set(lockKey, '1', { EX: 86400, NX: true });

  if (isNewVisit) {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    await AppVisit.findOneAndUpdate(
      { year_month: month },
      { $inc: { visits: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
  }
}

async function upsertContinueWatching(data) {
  const { email, anime_id, title, image, episode_url, episode_number } = data;
  await ContinueWatching.findOneAndUpdate(
    { email: email.toLowerCase(), anime_id },
    { $set: { title, image, episode_url, episode_number, updated_at: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
}

async function getContinueWatching(email, limit = 20) {
  return await ContinueWatching.find({ email: email.toLowerCase() })
    .sort({ updated_at: -1 })
    .limit(limit)
    .lean();
}

async function deleteContinueWatching(email, anime_id) {
  return await ContinueWatching.deleteOne({ email: email.toLowerCase(), anime_id });
}

async function getMonthlyVisits(limit = 12) {
  return await AppVisit.find({}).sort({ year_month: 1 }).limit(limit).lean();
}

async function getImageBySlug(slug) {
  const viewed = await AnimeView.findOne({ slug }, 'image').lean();
  return viewed?.image || null;
}

function relativeTime(dateValue) {
  const diff = Date.now() - new Date(dateValue).getTime();
  const s    = Math.floor(diff / 1000);
  if (s < 60)     return 'just now';
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(dateValue).toLocaleDateString();
}

async function getAnimeGlobalRating(animeId) {
  try {
    const result = await UserModel.aggregate([
      { $match: { [`ratings.${animeId}`]: { $exists: true } } },
      { $group: {
        _id: null,
        average: { $avg: `$ratings.${animeId}` },
        count: { $sum: 1 }
      }}
    ]);
    if (result.length > 0) {
      return {
        average: result[0].average.toFixed(1),
        count: result[0].count
      };
    }
    return { average: null, count: 0 };
  } catch (err) {
    console.error('[getAnimeGlobalRating] error:', err.message);
    return { average: null, count: 0 };
  }
}

module.exports = {
  updateProfile,
  setSubscription,
  registerUser,
  getAllUsers,
  getRecentUsers,
  findUser,
  deleteUser,
  getPasswordHash,
  setPasswordHash,
  banUser,
  unbanUser,
  isBanned,
  setOtpBypass,
  isOtpBypassed,
  getAllBypassed,
  getStats,
  logActivity,
  getActivityLog,
  relativeTime,
  logAnimeView,
  getTopAnimeViews,
  logAppVisit,
  getMonthlyVisits,
  getImageBySlug,
  upsertContinueWatching,
  getContinueWatching,
  deleteContinueWatching,
  getAnimeGlobalRating,
};