const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  type: {
    type: String,
    enum: ['bug', 'feature', 'other'],
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved'],
    default: 'pending'
  },
  adminReply: {
    type: String,
    default: null
  }
}, {
  timestamps: true // adds createdAt and updatedAt
});

module.exports = mongoose.model('Feedback', feedbackSchema);
