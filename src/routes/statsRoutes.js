/**
 * statsRoutes.js
 *
 * JWT-authenticated endpoints that replace client-side AsyncStorage for user stats.
 *
 * All routes require: Authorization: Bearer <token>
 *
 * GET  /api/stats/all              – fetch all stats for the logged-in user
 * POST /api/stats/episode          – record a watched episode
 * POST /api/stats/watchtime        – add seconds to cumulative watch time
 * POST /api/stats/rate             – save or clear a star rating
 * POST /api/stats/favorite         – toggle a favorite
 * GET  /api/stats/isfavorited      – check if an anime is favorited
 * PUT  /api/stats/settings         – save UI preferences
 * DELETE /api/stats/history        – clear watch history (episodes + time)
 * GET  /api/stats/watchlist        – fetch watchlist
 * POST /api/stats/watchlist        – update watchlist status
 */


const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const UserModel = require('../db/models/userModel');

const { requireAuth } = require('../middleware/authMiddleware');
const userService = require('../db/userService');



// ─── Helpers ─────────────────────────────────────────────────────────────────
// Returns up to 2 significant units: 34s | 1m 34s | 45m 20s | 2h 15m | 1d 3h
function formatWatchTime(totalSeconds) {
  const s = Math.floor(totalSeconds || 0);
  if (s <= 0) return '0s';

  const days    = Math.floor(s / 86400);
  const hours   = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600)  / 60);
  const seconds = s % 60;

  if (days    >= 1) return hours   > 0 ? `${days}d ${hours}h`    : `${days}d`;
  if (hours   >= 1) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes >= 1) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

// Works with plain object { animeId: rating } returned by .lean()
function calcAvgRating(ratingsObj) {
  if (!ratingsObj) return '—';
  const values = Object.values(ratingsObj);
  if (!values.length) return '—';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg.toFixed(1);
}

// ─── GET /api/stats/all ───────────────────────────────────────────────────────
router.get('/all', requireAuth, async (req, res) => {
  try {
    const user = await UserModel.findOne({ email: req.userEmail }).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Mongoose Map type does NOT serialize to JSON correctly with .lean() —
    // it comes back as a native JS Map which JSON.stringify converts to {}.
    // Convert explicitly to a plain object so ratings are returned properly.
    const ratingsObj = user.ratings instanceof Map
      ? Object.fromEntries(user.ratings)
      : (user.ratings ? Object.fromEntries(Object.entries(user.ratings)) : {});

    return res.json({
      success: true,
      stats: {
        episodes: user.watched_episodes?.length ?? 0,
        watchTime: formatWatchTime(user.watch_time_seconds ?? 0),
        watchTimeRaw: user.watch_time_seconds ?? 0,
        favCount: user.favorites?.length ?? 0,
        avgRating: calcAvgRating(ratingsObj),
        favorites: user.favorites ?? [],
        ratings: ratingsObj,
        settings: user.settings ?? {},
        username: user.name || user.email?.split('@')[0] || 'Viewer',
        profile_image: user.profile_image ?? null,
        profile_border: (user.subscription === 'premium') ? user.profile_border : null,
        watchlist: user.watchlist ?? [],
      }
    });

  } catch (err) {
    console.error('[stats/all]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
});

// ─── POST /api/stats/episode ──────────────────────────────────────────────────
router.post('/episode', requireAuth, async (req, res) => {
  const { episodeId } = req.body;
  if (!episodeId) return res.status(400).json({ success: false, message: 'episodeId required.' });

  try {
    // $addToSet ensures no duplicates
    const user = await UserModel.findOneAndUpdate(
      { email: req.userEmail },
      { $addToSet: { watched_episodes: String(episodeId) } },
      { returnDocument: 'after', upsert: false }
    ).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({ success: true, episodeCount: user.watched_episodes.length });
  } catch (err) {
    console.error('[stats/episode]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to record episode.' });
  }
});

// ─── POST /api/stats/watchtime ────────────────────────────────────────────────
router.post('/watchtime', requireAuth, async (req, res) => {
  const seconds = Math.round(Number(req.body.seconds) || 0);
  if (seconds <= 0) return res.json({ success: true }); // nothing to add

  try {
    const user = await UserModel.findOneAndUpdate(
      { email: req.userEmail },
      { $inc: { watch_time_seconds: seconds } },
      { returnDocument: 'after' }
    ).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({ success: true, total: user.watch_time_seconds });
  } catch (err) {
    console.error('[stats/watchtime]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update watch time.' });
  }
});

// ─── POST /api/stats/rate ──────────────────────────────────────────────────────
router.post('/rate', requireAuth, async (req, res) => {
  const { animeId, rating } = req.body;
  if (!animeId) return res.status(400).json({ success: false, message: 'animeId required.' });
  const r = Number(rating);
  if (r !== 0 && (r < 1 || r > 5)) return res.status(400).json({ success: false, message: 'rating must be 1-5 or 0 to clear.' });

  try {
    // Mongoose Map type uses 'field.key' dot-notation in updates
    const key = `ratings.${String(animeId)}`;
    const update = r === 0
      ? { $unset: { [key]: '' } }
      : { $set: { [key]: r } };

    const user = await UserModel.findOneAndUpdate(
      { email: req.userEmail },
      update,
      { returnDocument: 'after' }
    ).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const avg = calcAvgRating(
      user.ratings instanceof Map
        ? Object.fromEntries(user.ratings)
        : (user.ratings || {})
    );
    return res.json({ success: true, avgRating: avg });
  } catch (err) {
    console.error('[stats/rate]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save rating.' });
  }
});

// ─── POST /api/stats/favorite ─────────────────────────────────────────────────
router.post('/favorite', requireAuth, async (req, res) => {
  const { id, title, image } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'id required.' });

  try {
    // Check if already favorited
    const existing = await UserModel.findOne(
      { email: req.userEmail, 'favorites.id': String(id) }
    ).lean();

    let user;
    let isFavorited;

    if (existing) {
      // Remove it
      user = await UserModel.findOneAndUpdate(
        { email: req.userEmail },
        { $pull: { favorites: { id: String(id) } } },
        { returnDocument: 'after' }
      ).lean();
      isFavorited = false;
    } else {
      // Add it
      user = await UserModel.findOneAndUpdate(
        { email: req.userEmail },
        { $push: { favorites: { id: String(id), title: title || '', image: image || null } } },
        { returnDocument: 'after' }
      ).lean();
      isFavorited = true;
    }

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({ success: true, isFavorited, count: user.favorites.length });
  } catch (err) {
    console.error('[stats/favorite]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to toggle favorite.' });
  }
});

// ─── GET /api/stats/isfavorited ───────────────────────────────────────────────
router.get('/isfavorited', requireAuth, async (req, res) => {
  const { animeId } = req.query;
  if (!animeId) return res.status(400).json({ success: false, message: 'animeId required.' });

  try {
    const user = await UserModel.findOne(
      { email: req.userEmail, 'favorites.id': String(animeId) },
      'favorites.$'
    ).lean();

    return res.json({ success: true, isFavorited: !!user });
  } catch (err) {
    console.error('[stats/isfavorited]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to check favorite.' });
  }
});

// ─── PUT /api/stats/settings ──────────────────────────────────────────────────
router.put('/settings', requireAuth, async (req, res) => {
  const allowed = ['notifications', 'autoplay', 'hd', 'subtitles'];
  const update = {};
  for (const key of allowed) {
    if (typeof req.body[key] === 'boolean') {
      update[`settings.${key}`] = req.body[key];
    }
  }

  if (Object.keys(update).length === 0)
    return res.status(400).json({ success: false, message: 'No valid settings fields provided.' });

  try {
    const user = await UserModel.findOneAndUpdate(
      { email: req.userEmail },
      { $set: update },
      { returnDocument: 'after' }
    ).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({ success: true, settings: user.settings });
  } catch (err) {
    console.error('[stats/settings]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save settings.' });
  }
});

// ─── DELETE /api/stats/history ────────────────────────────────────────────────
router.delete('/history', requireAuth, async (req, res) => {
  try {
    await UserModel.updateOne(
      { email: req.userEmail },
      { $set: { watched_episodes: [], watch_time_seconds: 0 } }
    );
    return res.json({ success: true, message: 'Watch history cleared.' });
  } catch (err) {
    console.error('[stats/history]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to clear history.' });
  }
});

// ─── GET /api/stats/watchlist ────────────────────────────────────────────────
router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const list = await userService.getWatchlist(req.userEmail);
    return res.json({ success: true, list });
  } catch (err) {
    console.error('[stats/watchlist/get]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch watchlist.' });
  }
});

// ─── POST /api/stats/watchlist ───────────────────────────────────────────────
router.post('/watchlist', requireAuth, async (req, res) => {
  const { id, title, image, status } = req.body;
  if (!id || !status) return res.status(400).json({ success: false, message: 'id and status required.' });

  try {
    const user = await userService.updateWatchlistStatus(req.userEmail, { id, title, image, status });
    return res.json({ success: true, watchlist: user.watchlist });
  } catch (err) {
    console.error('[stats/watchlist/post]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update watchlist.' });
  }
});

// ─── POST /api/stats/push-token ─────────────────────────────────────────────
router.post('/push-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'token required.' });

  try {
    await UserModel.updateOne(
      { email: req.userEmail },
      { $set: { expo_push_token: token } }
    );
    return res.json({ success: true, message: 'Push token saved.' });
  } catch (err) {
    console.error('[stats/push-token]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save push token.' });
  }
});

module.exports = router;