const mongoose = require('mongoose');

const subscriptionRequestSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  plan: {
    type: String,
    default: 'premium'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  paymentMethod: {
    type: String,
    required: true, // e.g., 'GCash', 'Bank Transfer', 'Maya'
  },
  referenceNumber: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true
  },
  adminNote: {
    type: String,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SubscriptionRequest', subscriptionRequestSchema);
