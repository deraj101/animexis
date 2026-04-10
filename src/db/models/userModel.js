const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  id:    { type: String, required: true },
  title: { type: String, default: '' },
  image: { type: String, default: null },
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  notifications: { type: Boolean, default: true },
  autoplay:      { type: Boolean, default: true },
  hd:            { type: Boolean, default: false },
  subtitles:     { type: Boolean, default: true },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password_hash: {
    type: String,
    default: null
  },
  joined_at: {
    type: Date,
    default: Date.now
  },
  last_seen: {
    type: Date,
    default: Date.now
  },
  is_banned: {
    type: Boolean,
    default: false,
    index: true
  },
  otp_bypass: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    default: null
  },
  profile_image: {
    type: String,
    default: null
  },
  profile_border: {
    type: String,
    default: null
  },
  subscription: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free',
    index: true
  },

  // ── User Stats (migrated from AsyncStorage) ──────────────────────────────
  watched_episodes: {
    type: [String],
    default: []
  },
  watch_time_seconds: {
    type: Number,
    default: 0
  },
  // animeId → 1-5 rating stored as a plain object
  ratings: {
    type: Map,
    of: Number,
    default: {}
  },
  favorites: {
    type: [favoriteSchema],
    default: []
  },
  settings: {
    type: settingsSchema,
    default: () => ({})
  },
  stripeCustomerId: {
    type: String,
    default: null
  },
  stripeSubscriptionId: {
    type: String,
    default: null
  },

}, {
  timestamps: false // We manually manage joined_at and last_seen for legacy compatibility
});

module.exports = mongoose.model('User', userSchema);
