const mongoose = require('mongoose');

// --- ANIME VIEW ---
const animeViewSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  image: { type: String, default: null },
  views: { type: Number, default: 1 },
  last_updated: { type: Date, default: Date.now }
});

const AnimeView = mongoose.model('AnimeView', animeViewSchema);

// --- APP VISIT (Monthly aggregation) ---
const appVisitSchema = new mongoose.Schema({
  year_month: { type: String, required: true, unique: true },
  visits: { type: Number, default: 1 }
});

const AppVisit = mongoose.model('AppVisit', appVisitSchema);

// --- CONTINUE WATCHING ---
const continueWatchingSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true, lowercase: true },
  anime_id: { type: String, required: true },
  title: { type: String, required: true },
  image: { type: String, default: null },
  episode_url: { type: String, required: true },
  episode_number: { type: String, required: true },
  updated_at: { type: Date, default: Date.now }
});

// For performance on 1M+ users: unique multi-key index
continueWatchingSchema.index({ email: 1, anime_id: 1 }, { unique: true });
continueWatchingSchema.index({ updated_at: -1 });

const ContinueWatching = mongoose.model('ContinueWatching', continueWatchingSchema);

module.exports = { AnimeView, AppVisit, ContinueWatching };
