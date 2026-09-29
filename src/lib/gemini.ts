/**
 * HERA AI Recruitment Engine Client
 * 
 * All Gemini interactions are securely routed through server-side proxy endpoints (/api/interview/*, /api/gemini/*).
 * No API keys are required or exposed in the frontend.
 */

export const GEMINI_TEXT_MODEL = 'gemini-3.8-flash';
export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

export interface InterviewSessionMessage {
  role: 'user' | 'model';
  text: string;
}

export interface StartInterviewParams {
  role: string;
  candidateName?: string;
}

export interface StartInterviewResult {
  success: boolean;
  text: string;
  questionNumber: number;
  isFinished: boolean;
  error?: string;
}

export interface RespondInterviewParams {
  role: string;
  candidateName?: string;
  history: InterviewSessionMessage[];
  userResponse: string;
  questionNumber: number;
}

export interface RespondInterviewResult {
  success: boolean;
  text: string;
  questionNumber: number;
  isFinished: boolean;
  error?: string;
}

export interface EvaluateInterviewParams {
  role: string;
  candidateName?: string;
  candidateEmail?: string;
  history: InterviewSessionMessage[];
}

export interface EvaluateInterviewResult {
  success: boolean;
  score: number;
  redFlags: number;
  summary: string;
  markdownReport: string;
  error?: string;
}

/**
 * Starts a voice interview with HERA.
 * HERA introduces herself, explains the 3-question evaluation, and asks Question 1.
 */
export async function startInterviewSession(params: StartInterviewParams): Promise<StartInterviewResult> {
  const res = await fetch('/api/interview/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error del servidor al iniciar la entrevista: ${errText}`);
  }

  return await res.json();
}

/**
 * Submits the candidate's answer for the current question.
 * HERA acknowledges the response, and asks the next question (or finishes the interview).
 */
export async function sendInterviewResponse(params: RespondInterviewParams): Promise<RespondInterviewResult> {
  const res = await fetch('/api/interview/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error del servidor al procesar la respuesta: ${errText}`);
  }

  return await res.json();
}

/**
 * Generates the formal Candidate Evaluation Report and score via Gemini backend.
 */
export async function generateEvaluationReport(params: EvaluateInterviewParams): Promise<EvaluateInterviewResult> {
  const res = await fetch('/api/interview/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error del servidor al generar la evaluación: ${errText}`);
  }

  return await res.json();
}

/**
 * Generates natural speech audio via backend Gemini TTS.
 */
export async function generateSpeechAudio(text: string): Promise<{ success: boolean; audioBase64?: string; mimeType?: string }> {
  try {
    const res = await fetch('/api/interview/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('TTS request error, will fallback to browser voice:', err);
  }
  return { success: false };
}

/**
 * Generates generic content from Gemini via secure backend proxy.
 */
export async function generateGeminiContent(prompt: string, systemInstruction?: string): Promise<string> {
  const res = await fetch('/api/gemini/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemInstruction }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  const data = await res.json();
  return data.text || '';
}

/**
 * Global audio player state to control speaking & interruptions
 */
let currentAudioContext: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;

export function stopCurrentSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (currentSourceNode) {
    try {
      currentSourceNode.stop();
    } catch (e) {}
    currentSourceNode = null;
  }
}

/**
 * Plays base64 WAV audio through Web Audio API
 */
export async function playWavAudio(base64: string, onEnded?: () => void): Promise<() => void> {
  stopCurrentSpeech();

  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  currentAudioContext = audioCtx;

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  currentSourceNode = source;

  source.onended = () => {
    currentSourceNode = null;
    if (onEnded) onEnded();
  };

  source.start(0);

  return () => {
    try {
      source.stop();
    } catch (e) {}
    currentSourceNode = null;
  };
}

/**
 * Plays speech using the browser's built-in Web Speech Synthesis (Spanish female voice if available)
 */
export function speakWithBrowser(text: string, onEnded?: () => void): () => void {
  stopCurrentSpeech();

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnded) onEnded();
    return () => {};
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 1.0;
  utterance.pitch = 1.05;

  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Monica') || v.name.includes('Lucia') || v.name.includes('Elena') || v.name.includes('Female') || v.name.includes('Google español') || v.name.includes('Paulina'))) ||
                  voices.find(v => v.lang.startsWith('es'));
  if (esVoice) {
    utterance.voice = esVoice;
  }

  utterance.onend = () => {
    if (onEnded) onEnded();
  };

  utterance.onerror = () => {
    if (onEnded) onEnded();
  };

  window.speechSynthesis.speak(utterance);

  return () => {
    window.speechSynthesis.cancel();
  };
}

/**
 * Speaks HERA's response using high quality Gemini TTS with seamless browser fallback
 */
export async function speakHera(text: string, onEnded?: () => void): Promise<() => void> {
  stopCurrentSpeech();

  // Try Gemini high-fidelity TTS first
  try {
    const ttsResult = await generateSpeechAudio(text);
    if (ttsResult.success && ttsResult.audioBase64) {
      return await playWavAudio(ttsResult.audioBase64, onEnded);
    }
  } catch (err) {
    console.warn('Gemini TTS failed, falling back to browser synthesis:', err);
  }

  // Fallback to browser synthesis
  return speakWithBrowser(text, onEnded);
}
