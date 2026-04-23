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
  const { priceId, successUrl, cancelUrl } = req.body;

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
      success_url: `${process.env.CLIENT_URL || 'http://10.230.214.17:3000'}/api/payments/success?session_id={CHECKOUT_SESSION_ID}&client_success_url=${encodeURIComponent(successUrl || 'https://animexisv1.vercel.app/subscription-success')}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://10.230.214.17:3000'}/api/payments/cancel?client_cancel_url=${encodeURIComponent(cancelUrl || 'https://animexisv1.vercel.app/')}`,
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

/**
 * GET /api/payments/success
 * Renders an HTML page that redirects back to the mobile app
 */
router.get('/success', (req, res) => {
  const sessionId = req.query.session_id || '';
  const clientSuccessUrl = req.query.client_success_url || 'https://animexisv1.vercel.app/subscription-success';
  
  // Create final destination URL
  // If it already has a query string, append with &, else with ?
  const separator = clientSuccessUrl.includes('?') ? '&' : '?';
  const finalUrl = `${clientSuccessUrl}${separator}session_id=${sessionId}`;

  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Successful</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #080b10; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px;}
          h1 { color: #22d3a0; margin-bottom: 10px; }
          .btn { background: #DC143C; color: white; padding: 14px 28px; border-radius: 30px; text-decoration: none; font-weight: bold; margin-top: 30px; display: inline-block; box-shadow: 0 4px 15px rgba(220, 20, 60, 0.4); }
        </style>
      </head>
      <body>
        <h1>🎉 Premium Activated!</h1>
        <p style="color: #94a3b8; max-width: 300px;">Your payment was successful!</p>
        
        <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 30px;">
           <a href="${finalUrl}" class="btn" style="margin-top: 0;">Open App</a>
        </div>
        
        <script>
           setTimeout(() => {
              window.location.href = '${finalUrl}'; 
           }, 500);
        </script>
      </body>
    </html>
  `);
});

/**
 * GET /api/payments/cancel
 * Renders an HTML page that redirects back to the mobile app
 */
router.get('/cancel', (req, res) => {
  const clientCancelUrl = req.query.client_cancel_url || 'https://animexisv1.vercel.app/';
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Cancelled</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #080b10; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px;}
          h1 { color: #f87171; margin-bottom: 10px; }
          .btn { background: #334155; color: white; padding: 14px 28px; border-radius: 30px; text-decoration: none; font-weight: bold; margin-top: 30px; display: inline-block; }
        </style>
      </head>
      <body>
        <h1>❌ Payment Cancelled</h1>
        <p style="color: #94a3b8; max-width: 300px;">You have not been charged.</p>
        
        <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 30px;">
           <a href="${clientCancelUrl}" class="btn" style="margin-top: 0;">Open App</a>
        </div>

        <script>
           setTimeout(() => {
             window.location.href = '${clientCancelUrl}';
           }, 500);
        </script>
      </body>
    </html>
  `);
});

module.exports = router;
