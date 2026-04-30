const mongoose = require('mongoose');

/**
 * Mapping schema for GogoAnime to AniList metadata.
 * Stores high-res images, colors, and scoring to avoid API overuse.
 */
const mappingSchema = new mongoose.Schema({
  gogoSlug: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  anilistId: { 
    type: Number, 
    index: true 
  },
  malId: { 
    type: Number 
  },
  title: {
    english: String,
    romaji: String,
    native: String
  },
  coverImage: {
    extraLarge: String,
    large: String,
    medium: String,
    color: String // Dominant hex color
  },
  bannerImage: String,
  averageScore: Number,
  description: String,
  genres: [String],
  status: String,
  season: String,
  seasonYear: Number,
  duration: Number,
  studios: [String],
  format: String,
  trailer: {
    id: String,
    site: String,
    thumbnail: String
  },
  lastSync: { 
    type: Date, 
    default: Date.now 
  }
});

// Cache mapping for 24 hours
mappingSchema.index({ lastSync: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Mapping', mappingSchema);
