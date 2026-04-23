const mongoose = require('mongoose');

const customAnimeSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  image: {
    type: String,
    default: ''
  },
  banner: {
    type: String,
    default: ''
  },
  releaseDate: {
    type: String, // e.g. "2026" or "Fall 2026"
    default: ''
  },
  status: {
    type: String,
    default: 'Ongoing'
  },
  genres: {
    type: [String],
    default: []
  },
  type: {
    type: String,
    default: 'TV'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // adds createdAt, updatedAt
});

module.exports = mongoose.model('CustomAnime', customAnimeSchema);
