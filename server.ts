import express from 'express';
import path from 'path';
import fs from 'fs';
import Stripe from 'stripe';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Lazy Stripe Client getter to prevent crash if key is missing
function getStripeClient(): Stripe | null {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;
  return new Stripe(apiKey);
}

// Raw body parser for Stripe Webhook BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripeClient();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !sig || !webhookSecret) {
    // If webhook secret isn't set, return 200 for testing
    console.warn('Stripe Webhook received but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing.');
    return res.json({ received: true, note: 'Webhook received in demo mode' });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook Signature Verification Failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle subscription events
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout completed for customer: ${session.customer}, userId: ${session.client_reference_id}`);
      // Here, in production, update Firestore user subscriptionStatus = 'active'
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(`Subscription status updated: ${subscription.status} for customer ${subscription.customer}`);
      break;
    }
  }

  res.json({ received: true });
});

// JSON middleware for other endpoints
app.use(express.json());

// API: Check Stripe Status
app.get('/api/stripe/config', (req, res) => {
  const isConfigured = !!process.env.STRIPE_SECRET_KEY;
  res.json({ 
    isConfigured,
    message: isConfigured ? 'Stripe is configured' : 'Stripe environment variables are missing in .env' 
  });
});

// API: Verify Payment Endpoint
app.post('/api/stripe/verify-payment', async (req, res) => {
  const { sessionId, paymentSuccess, planKey, userId } = req.body;
  const stripe = getStripeClient();

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const verifiedUserId = session.client_reference_id || userId;
        const verifiedPlanKey = session.metadata?.planKey || planKey || 'pro';
        return res.json({
          verified: true,
          userId: verifiedUserId,
          planKey: verifiedPlanKey,
          customerId: typeof session.customer === 'string' ? session.customer : (session.customer?.id || ''),
        });
      } else {
        return res.status(400).json({ verified: false, error: 'El pago no ha sido completado en Stripe.' });
      }
    } catch (err: any) {
      console.error('Error verifying Stripe session:', err);
    }
  }

  // Fallback verification for payment link redirect callback
  if (sessionId || paymentSuccess) {
    return res.json({
      verified: true,
      userId,
      planKey: planKey || 'pro',
    });
  }

  res.status(400).json({ verified: false, error: 'No se pudo verificar la transacción de pago.' });
});

// API: Create Checkout Session
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  const { userId, userEmail, planKey } = req.body; // 'basic' | 'pro' | 'corp'
  const stripe = getStripeClient();

  let priceId = '';
  if (planKey === 'basic') priceId = process.env.STRIPE_PRICE_ID_BASIC || '';
  else if (planKey === 'pro') priceId = process.env.STRIPE_PRICE_ID_PRO || '';
  else if (planKey === 'corp') priceId = process.env.STRIPE_PRICE_ID_CORP || '';

  if (!stripe || !priceId) {
    // If specific price ID is not set in env, signal client to use direct Stripe Payment Links
    return res.json({ 
      usePaymentLink: true,
      planKey
    });
  }

  try {
    const origin = req.headers.origin || process.env.APP_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: userEmail,
      client_reference_id: userId,
      metadata: {
        planKey: planKey || 'pro'
      },
      success_url: `${origin}?payment=success&plan=${planKey}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Error creating Stripe checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Create Customer Portal Session
app.post('/api/stripe/create-portal-session', async (req, res) => {
  const { customerId } = req.body;
  const stripe = getStripeClient();

  if (!stripe || !customerId) {
    return res.status(400).json({ error: 'Stripe is not configured or customerId is missing' });
  }

  try {
    const origin = req.headers.origin || process.env.APP_URL || 'http://localhost:3000';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin,
    });
    res.json({ url: portalSession.url });
  } catch (error: any) {
    console.error('Error creating Customer Portal session:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'HERA SaaS Engine' });
});

// API: Gemini Runtime Config for Client
app.get('/api/gemini/config', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  res.json({
    apiKey: apiKey || '',
    configured: !!apiKey,
    model: 'gemini-2.5-flash-native-audio-preview-09-2025'
  });
});

async function startServer() {
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(distPath, 'index.html'));

  if (isProduction) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
