const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const User = require('../db/models/userModel');
const userService = require('../db/userService');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

/**
 * POST /api/payments/create-checkout-session
 * 
 * Initiates a Stripe Checkout session for the Premium plan.
 * Supports GCash, Card, and PayMaya for the Philippine market.
 */
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({
      success: false,
      error: 'Payments are not configured (missing STRIPE_SECRET_KEY).',
    });
  }

  const user = req.user;
  const { priceId } = req.body;

  if (!priceId) {
    return res.status(400).json({ success: false, error: 'Price ID is required.' });
  }

  try {
    // Create or retrieve Stripe Customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || user.email,
        metadata: { userId: user._id.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create the session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL || 'http://localhost:8081'}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:8081'}/subscription`,
      metadata: {
         userEmail: user.email.toLowerCase()
      }
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('[stripe] checkout session error:', error.message);
    res.status(500).json({ success: false, error: 'Payment gateway error. Try again later.' });
  }
});

/**
 * GET /api/payments/sync-session/:sessionId
 * 
 * Verifies a Stripe Checkout session status in real-time.
 * If paid, upgrades the user immediately to bypass webhook delays.
 */
router.get('/sync-session/:sessionId', requireAuth, async (req, res) => {
   const stripe = getStripe();
   if (!stripe) {
     return res.status(503).json({
       success: false,
       error: 'Payments are not configured (missing STRIPE_SECRET_KEY).',
     });
   }

   const { sessionId } = req.params;
   const user = req.user;

   if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
   }

   try {
      console.log(`[sync] manual sync requested for session: ${sessionId}`);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status === 'paid') {
         console.log(`[sync] session ${sessionId} is PAID. Upgrading user...`);
         
         // 1. Update subscription status in userService
         await userService.setSubscription(user.email, 'premium');

         // 2. Persist stripe subscription ID if it exists
         if (session.subscription) {
            await User.findOneAndUpdate(
               { email: user.email },
               { stripeSubscriptionId: session.subscription, subscription: 'premium' }
            );
         }

         return res.json({ 
            success: true, 
            subscription: 'premium',
            message: 'Premium activated successfully! 🛡️✨' 
         });
      }

      res.json({ 
         success: false, 
         subscription: user.subscription, 
         message: 'Payment still processing or not found.' 
      });

   } catch (error) {
      console.error('[sync] stripe retrieval error:', error.message);
      res.status(500).json({ success: false, error: 'Sync failed.' });
   }
});

module.exports = router;
