const mongoose = require('mongoose');

const customEpisodeSchema = new mongoose.Schema({
  animeId: {
    type: String, // linking to CustomAnime.slug
    required: true,
    index: true
  },
  number: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  videoUrl: {
    type: String, // Currently a direct string (mp4, m3u8, iframe)
    required: true
  },
  thumbnail: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // adds createdAt, updatedAt
});

// Enforce unique episode numbers for a specific custom anime globally
customEpisodeSchema.index({ animeId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('CustomEpisode', customEpisodeSchema);
