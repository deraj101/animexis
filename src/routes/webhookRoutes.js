const express = require('express');
const router = express.Router();
const User = require('../db/models/userModel');
const userService = require('../db/userService');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

/**
 * POST /api/webhooks/stripe
 * 
 * Secure entry point for Stripe asynchronous events.
 * Listens for checkout.session.completed to upgrade users automatically.
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({
      received: false,
      error: 'Webhook not configured (missing STRIPE_SECRET_KEY).',
    });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({
      received: false,
      error: 'Webhook not configured (missing STRIPE_WEBHOOK_SECRET).',
    });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`[webhook] signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userEmail = session.metadata?.userEmail;

    if (userEmail) {
      console.log(`[webhook] payment success for ${userEmail}. Upgrading to Premium...`);
      try {
        await userService.setSubscription(userEmail, 'premium');
        // Update user model with subscription ID for future management
        await User.findOneAndUpdate(
          { email: userEmail },
          { stripeSubscriptionId: session.subscription }
        );
      } catch (dbErr) {
        console.error(`[webhook] database upgrade failed for ${userEmail}:`, dbErr.message);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
