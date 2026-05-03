// src/db/userService.js — all data lives in MongoDB (Mongoose)
const UserModel = require('./models/userModel');
const Activity = require('./models/activityModel');
const Comment = require('./models/commentModel');
const { AnimeView, AppVisit, ContinueWatching } = require('./models/analyticsModels');
const WatchHistory = require('./models/watchHistoryModel');
const SearchHistory = require('./models/searchHistoryModel');
const Notification = require('./models/notificationModel');
const Feedback = require('./models/feedbackModel');




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
  const normalizedEmail = email.toLowerCase();
  
  // 1. Find the user to get their ID (needed for some related models like Feedback)
  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) return { deletedCount: 0 };

  const userId = user._id;

  // 2. Delete user record (contains ratings, favorites, watchlist)
  const result = await UserModel.deleteOne({ _id: userId });
  
  // 3. Cleanup related data across other models
  await Promise.all([
    Notification.deleteMany({ userEmail: normalizedEmail }),
    ContinueWatching.deleteMany({ email: normalizedEmail }),
    WatchHistory.deleteMany({ email: normalizedEmail }),
    SearchHistory.deleteMany({ email: normalizedEmail }),
    Comment.deleteMany({ userEmail: normalizedEmail }),
    Feedback.deleteMany({ user: userId }) // Feedback uses userId ref
  ]);

  return result;
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
  const normalizedEmail = email.toLowerCase();
  
  // 1. Fetch current user to check subscription state
  const oldUser = await UserModel.findOne({ email: normalizedEmail }).lean();
  if (!oldUser) return null;

  // 2. Only log and update if there's an actual change
  if (oldUser.subscription === subscription) {
    return oldUser;
  }

  const user = await UserModel.findOneAndUpdate(
    { email: normalizedEmail },
    { $set: { subscription } },
    { returnDocument: 'after' }
  ).lean();

  if (user) {
    const isPremium = subscription === 'premium';
    logActivity({
      icon: isPremium ? 'star' : 'arrow-down',
      color: isPremium ? '#eab308' : '#9090a8', // yellow for premium, dim for downgrade
      title: isPremium ? 'Upgraded to Premium' : 'Downgraded to Free',
      sub: normalizedEmail,
    });
  }

  return user;
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
 * OTP Bypass
 */
async function setOtpBypass(email, enabled) {
  const normalizedEmail = email.toLowerCase();
  
  // 1. Check current status
  const user = await UserModel.findOne({ email: normalizedEmail }, 'otp_bypass').lean();
  if (!user) return;
  
  // 2. Skip if no change
  if (!!user.otp_bypass === !!enabled) return;

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

  const [totalUsers, newToday, newThisWeek, activeThisWeek] = await Promise.all([
    UserModel.countDocuments({}),
    UserModel.countDocuments({ joined_at: { $gte: today } }),
    UserModel.countDocuments({ joined_at: { $gte: lastWeek } }),
    UserModel.countDocuments({ last_seen: { $gte: lastWeek } })
  ]);

  // Daily growth for chart (last 14 days)
  const growthData = await UserModel.aggregate([
    { $match: { joined_at: { $gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$joined_at" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { day: "$_id", count: 1, _id: 0 } }
  ]);

  return {
    totalUsers,
    newUsersToday: newToday,
    newUsersThisWeek: newThisWeek,
    activeThisWeek,
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
  const { email, anime_id, title, image, episode_url, episode_number, progress, duration, completed } = data;
  const update = { title, image, episode_url, episode_number, updated_at: new Date() };
  if (progress !== undefined)  update.progress  = progress;
  if (duration !== undefined)  update.duration   = duration;
  if (completed !== undefined) update.completed  = completed;
  await ContinueWatching.findOneAndUpdate(
    { email: email.toLowerCase(), anime_id },
    { $set: update },
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

async function getEpisodeProgress(email, anime_id) {
  // Return the current continue-watching entry for this anime
  // Contains episode_number, progress, duration, completed
  const entry = await ContinueWatching.findOne(
    { email: email.toLowerCase(), anime_id },
    'episode_number progress duration completed episode_url'
  ).lean();
  return entry;
}

async function logWatchHistory(data) {
  const { email, anime_id, title, image, episode_url, episode_number } = data;
  
  // 1. Upsert history entry — prevents duplicates when progress syncs fire repeatedly
  const history = await WatchHistory.findOneAndUpdate(
    { email: email.toLowerCase(), anime_id, episode_number: String(episode_number) },
    { $set: { title, image, episode_url, watched_at: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );

  // 2. Update user's lifetime unique episodes count
  await UserModel.updateOne(
    { email: email.toLowerCase() },
    { $addToSet: { watched_episodes: episode_url } }
  );

  return history;
}

async function getWatchHistory(email, limit = 50) {
  return await WatchHistory.find({ email: email.toLowerCase() })
    .sort({ watched_at: -1 })
    .limit(limit)
    .lean();
}

async function clearWatchHistory(email) {
  return await WatchHistory.deleteMany({ email: email.toLowerCase() });
}

/**
 * Search History
 */
async function logSearchHistory(email, query) {
  // Prune old entries to keep it clean (e.g., keep last 20)
  await SearchHistory.create({ email: email.toLowerCase(), query });
}

async function getSearchHistory(email, limit = 10) {
  return await SearchHistory.find({ email: email.toLowerCase() })
    .sort({ searched_at: -1 })
    .limit(limit)
    .lean();
}

async function clearSearchHistory(email) {
  return await SearchHistory.deleteMany({ email: email.toLowerCase() });
}

/**
 * Watchlist / Plan to Watch
 */
async function updateWatchlistStatus(email, anime) {
  const { id, title, image, status } = anime;
  const normalizedEmail = email.toLowerCase();
  
  if (status === 'None') {
    return await UserModel.findOneAndUpdate(
      { email: normalizedEmail },
      { $pull: { watchlist: { id } } },
      { returnDocument: 'after' }
    ).lean();
  }

  // Update if exists, else push
  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) return null;

  const existingIdx = user.watchlist.findIndex(w => w.id === id);
  if (existingIdx > -1) {
    user.watchlist[existingIdx].status = status;
    user.watchlist[existingIdx].updated_at = new Date();
  } else {
    user.watchlist.push({ id, title, image, status, updated_at: new Date() });
  }
  
  await user.save();
  return user.toObject();
}

async function getWatchlist(email) {
  const user = await UserModel.findOne({ email: email.toLowerCase() }, 'watchlist').lean();
  return user?.watchlist || [];
}



async function getMonthlyVisits(limit = 12) {
  return await AppVisit.find({}).sort({ year_month: 1 }).limit(limit).lean();
}

async function getImageBySlug(slug) {
  const viewed = await AnimeView.findOne({ slug }, 'image').lean();
  return viewed?.image || null;
}

function relativeTime(dateValue) {
  if (!dateValue) return 'never';
  const now = Date.now();
  const then = new Date(dateValue).getTime();
  const diff = now - then;
  
  // If time is in the future or very close, say just now
  if (diff < 30000) return 'just now';

  const s = Math.floor(diff / 1000);
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
  getEpisodeProgress,
  getAnimeGlobalRating,
  logWatchHistory,
  getWatchHistory,
  clearWatchHistory,
  logSearchHistory,
  getSearchHistory,
  clearSearchHistory,
  updateWatchlistStatus,
  getWatchlist,
};