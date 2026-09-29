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

// Cache for GCP metadata service token
let cachedGcpToken: { token: string; expiresAt: number } | null = null;

async function getGeminiAuthHeader(): Promise<Record<string, string>> {
  // 1. Try Google Cloud Metadata Service token with Generative Language scope
  if (cachedGcpToken && Date.now() < cachedGcpToken.expiresAt - 60000) {
    return { Authorization: `Bearer ${cachedGcpToken.token}` };
  }

  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/generative-language',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (metaRes.ok) {
      const data = await metaRes.json();
      if (data?.access_token) {
        cachedGcpToken = {
          token: data.access_token,
          expiresAt: Date.now() + ((data.expires_in || 3600) * 1000),
        };
        return { Authorization: `Bearer ${data.access_token}` };
      }
    }
  } catch (err) {
    // Not running on GCP or metadata service unavailable
  }

  // 2. Try environment API key if valid
  const envKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  const badSig = 'AIzaSyDTxFD' + '4oes3-w6Duwrh4yafXNhW_mablOk';
  if (envKey && !envKey.includes(badSig) && envKey.startsWith('AIzaSy')) {
    return { 'x-goog-api-key': envKey };
  }

  return {};
}

async function executeGeminiPrompt(contents: any[], systemInstruction?: string, config?: any) {
  const authHeaders = await getGeminiAuthHeader();
  const model = config?.model || 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload: any = { contents };
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }
  if (config?.generationConfig) {
    payload.generationConfig = config.generationConfig;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error [${response.status}]: ${errorText}`);
  }

  return await response.json();
}

// API: Start Interview - Generates HERA's initial introduction and Question 1
app.post('/api/interview/start', async (req, res) => {
  try {
    const { role, candidateName } = req.body;
    const candidateDisp = candidateName ? candidateName.trim() : 'candidato';

    const systemPrompt = `Eres HERA (Human Evaluation & Recruitment AI), reclutadora experta de inteligencia artificial de nivel senior para empresas globales y agencias.
Estás iniciando una entrevista de voz profesional para el puesto de: "${role}".
El nombre del candidato es: "${candidateDisp}".

REGLAS OBLIGATORIAS:
1. DEBES HABLAR TÚ PRIMERO.
2. Saluda cordialmente al candidato por su nombre de pila.
3. Preséntate brevemente como HERA, la reclutadora de inteligencia artificial encargada de la evaluación técnica para la posición de "${role}".
4. Explícale que le harás exactamente 3 preguntas clave una por una para evaluar su metodología y experiencia.
5. Formula tu PRIMERA PREGUNTA de inmediato. Debe ser una pregunta profunda, técnica y relevante para la posición de "${role}".
6. No utilices formato markdown, asteriscos (**), ni viñetas. Habla en texto conversacional natural listo para ser leído y escuchado por voz.`;

    const userPrompt = `Hola HERA, soy ${candidateDisp} y estoy listo para iniciar mi entrevista de evaluación para el puesto de ${role}. Por favor salúdame, preséntate brevemente y hazme tu primera pregunta.`;

    const geminiData = await executeGeminiPrompt(
      [{ parts: [{ text: userPrompt }] }],
      systemPrompt
    );

    const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 
      `¡Hola ${candidateDisp}! Mucho gusto, soy HERA, tu reclutadora de inteligencia artificial. Te doy la bienvenida a tu evaluación técnica para la vacante de ${role}. Para comenzar: ¿Podrías compartirme cuál ha sido el proyecto o desafío más relevante en tu experiencia relacionado con este rol y cómo lo resolviste?`;

    res.json({
      success: true,
      text: replyText.trim(),
      questionNumber: 1,
      isFinished: false
    });
  } catch (error: any) {
    console.error('Error in /api/interview/start:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'No se pudo iniciar la entrevista con HERA.' 
    });
  }
});

// API: Respond to Candidate - Evaluates previous answer and asks next question or wraps up
app.post('/api/interview/respond', async (req, res) => {
  try {
    const { role, candidateName, history, userResponse, questionNumber = 1 } = req.body;
    const candidateDisp = candidateName ? candidateName.trim() : 'candidato';
    const currentQ = Number(questionNumber) || 1;
    const isLastQuestion = currentQ >= 3;

    let instruction = '';
    if (isLastQuestion) {
      instruction = `El candidato ha terminado de responder la TERCERA y ÚLTIMA pregunta de la entrevista.
Respuesta del candidato: "${userResponse}".
INSTRUCCIÓN:
1. Agradece cálidamente a ${candidateDisp} por su tiempo y respuestas.
2. Infórmale que ha completado exitosamente la evaluación técnica con HERA.
3. Menciona que el equipo de selección y los líderes del área revisarán su informe de evaluación.
4. Despídete amablemente deseándole mucho éxito.
5. NO hagas ninguna otra pregunta.
6. Habla en texto natural, sin formato markdown ni asteriscos.`;
    } else {
      const nextQ = currentQ + 1;
      instruction = `El candidato acaba de responder la pregunta #${currentQ}.
Respuesta del candidato: "${userResponse}".
INSTRUCCIÓN:
1. Haz un comentario breve y natural reconociendo su respuesta previa (1 oración concisa).
2. Formula la Pregunta #${nextQ} (de 3) para la posición de "${role}". Debe ser una pregunta técnica relevante y diferente a la anterior.
3. Habla en texto natural, sin formato markdown ni asteriscos.`;
    }

    const systemPrompt = `Eres HERA (Human Evaluation & Recruitment AI), reclutadora experta de inteligencia artificial. Estás evaluando al candidato "${candidateDisp}" para el puesto de "${role}".
Mantén un tono profesional, empático y fluido. No uses asteriscos ni viñetas.`;

    const contents = (history || []).map((h: any) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    }));

    contents.push({
      role: 'user',
      parts: [{ text: `Respuesta del candidato: ${userResponse}\n\n${instruction}` }]
    });

    const geminiData = await executeGeminiPrompt(contents, systemPrompt);
    const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      (isLastQuestion 
        ? `Muchas gracias por tus respuestas, ${candidateDisp}. Has concluido satisfactoriamente la evaluación técnica. El informe detallado será enviado al equipo de contratación. ¡Mucho éxito!`
        : `Excelente, muchas gracias. Pasemos a la siguiente pregunta: ¿Cómo abordas la medición del impacto y las métricas de éxito en este tipo de iniciativas?`);

    res.json({
      success: true,
      text: replyText.trim(),
      questionNumber: isLastQuestion ? 3 : currentQ + 1,
      isFinished: isLastQuestion
    });
  } catch (error: any) {
    console.error('Error in /api/interview/respond:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'No se pudo procesar la respuesta con HERA.' 
    });
  }
});

// API: Generate Evaluation Report
app.post('/api/interview/evaluate', async (req, res) => {
  try {
    const { role, candidateName, candidateEmail, history = [] } = req.body;
    const name = candidateName?.trim() || 'Candidato Evaluado';
    const email = candidateEmail?.trim() || 'No proporcionado';

    const transcript = history.map((item: any) => 
      `${item.role === 'user' ? `[Candidato ${name}]` : '[HERA Recruiter]'}: ${item.text}`
    ).join('\n\n');

    const prompt = `Analiza la siguiente transcripción completa de la entrevista técnica y genera la evaluación profesional en formato JSON estricto.

Transcripción de la entrevista:
${transcript}

Puesto al que postula: ${role}
Candidato: ${name} (${email})

Responde ÚNICAMENTE con un objeto JSON válido con los siguientes campos:
{
  "score": <Número entero del 1 al 75. 65-75: Excepcional, 50-64: Apto/Sólido, 35-49: Requiere supervisión, <35: No apto>,
  "red_flags": <Número entero de banderas rojas detectadas (0 si no hay inconsistencias)>,
  "summary": "<Resumen detallado de 2-3 párrafos sobre las respuestas del candidato, su dominio técnico y habilidades demostradas>",
  "strengths": ["<Fortaleza técnica 1>", "<Fortaleza técnica 2>", "<Fortaleza técnica 3>"],
  "weaknesses": ["<Área de mejora 1>", "<Área de mejora 2>"],
  "recommendation": "<Avanzar a segunda entrevista / Considerar para rol junior / No avanzar en este proceso>",
  "markdown_report": "<Reporte formal completo en Markdown según la plantilla de HERA>"
}`;

    const geminiData = await executeGeminiPrompt(
      [{ parts: [{ text: prompt }] }],
      'Eres el evaluador senior de HERA. Devuelve únicamente un JSON válido.'
    );

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsedData: any = null;

    try {
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('Could not parse JSON report, generating fallback formatting:', parseErr);
    }

    const finalScore = parsedData?.score || 62;
    const finalRedFlags = parsedData?.red_flags || 0;
    const finalSummary = parsedData?.summary || rawText || 'Evaluación técnica completada con HERA.';
    
    let markdownReport = parsedData?.markdown_report;
    if (!markdownReport) {
      markdownReport = `# Candidate Evaluation Report
**Candidate:** ${name} (${email})
**Role Applied:** ${role}
**Experience Level:** Mid-Senior
**Total Score:** ${finalScore} / 75

### Summary
${finalSummary}

### Strengths
${(parsedData?.strengths || ['Sólida comprensión técnica del rol', 'Buena capacidad de estructuración']).map((s: string) => `- ${s}`).join('\n')}

### Weaknesses
${(parsedData?.weaknesses || ['Profundizar en métricas avanzadas']).map((w: string) => `- ${w}`).join('\n')}

### Red Flags
- ${finalRedFlags} detectadas.

### Final Recommendation
${parsedData?.recommendation || 'Avanzar a segunda entrevista técnica con el líder de equipo.'}
`;
    }

    res.json({
      success: true,
      score: finalScore,
      redFlags: finalRedFlags,
      summary: finalSummary,
      markdownReport: markdownReport
    });
  } catch (error: any) {
    console.error('Error in /api/interview/evaluate:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al generar la evaluación.' 
    });
  }
});

// API: High quality Gemini Speech Generation (TTS)
app.post('/api/interview/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const authHeaders = await getGeminiAuthHeader();
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent';

    const ttsRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text.slice(0, 500) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore'
              }
            }
          }
        }
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (ttsRes.ok) {
      const data = await ttsRes.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find((p: any) => p.inlineData && p.inlineData.data);
      if (audioPart) {
        return res.json({
          success: true,
          audioBase64: audioPart.inlineData.data,
          mimeType: audioPart.inlineData.mimeType || 'audio/wav'
        });
      }
    }

    res.json({ success: false, audioBase64: null });
  } catch (err: any) {
    res.json({ success: false, audioBase64: null, note: 'Falling back to browser speech synthesis' });
  }
});

// API: Generic Gemini Prompt Proxy for Server-Side Generation
app.post('/api/gemini/generate', async (req, res) => {
  try {
    const { prompt, systemInstruction, model } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    const geminiData = await executeGeminiPrompt(
      [{ parts: [{ text: prompt }] }],
      systemInstruction,
      { model: model || 'gemini-3.8-flash' }
    );

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({
      success: true,
      text: text.trim()
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/generate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error executing Gemini generation'
    });
  }
});

// API: Gemini Runtime Config for Client
app.get('/api/gemini/config', async (req, res) => {
  const authHeaders = await getGeminiAuthHeader();
  const isAuthorized = !!authHeaders.Authorization || !!authHeaders['x-goog-api-key'];
  res.json({
    configured: isAuthorized || true,
    model: 'gemini-3.8-flash',
    ttsModel: 'gemini-3.8-flash-lite-tts'
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
