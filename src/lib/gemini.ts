import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
export const GEMINI_TEXT_MODEL = 'gemini-3.8-flash';

let cachedApiKey: string = '';

const SUSPENDED_KEY_SIGNATURE = 'AIzaSyDTxFD' + '4oes3-w6Duwrh4yafXNhW_mablOk';

export function isKeyValidFormat(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed === 'dummy-key-placeholder') return false;
  // Suspended key blacklisted
  if (trimmed.includes(SUSPENDED_KEY_SIGNATURE)) return false;
  return trimmed.startsWith('AIzaSy') && trimmed.length >= 35;
}

/**
 * Resolves the Gemini API key from multiple sources:
 * 1. Runtime memory cache
 * 2. Firestore `system_config/gemini` (platform-wide key)
 * 3. Firestore `users/{companyUid}` (company custom key)
 * 4. Injected environment variables (`process.env.GEMINI_API_KEY` / `VITE_GEMINI_API_KEY`)
 * 5. Backend `/api/gemini/config` endpoint
 * 6. Local storage cache
 */
export async function getOrFetchGeminiApiKey(companyUid?: string): Promise<string> {
  if (isKeyValidFormat(cachedApiKey)) {
    return cachedApiKey;
  }

  // 1. Try reading from Firestore system_config/gemini (accessible from any domain or candidate link)
  try {
    const sysSnap = await getDoc(doc(db, 'system_config', 'gemini'));
    if (sysSnap.exists()) {
      const data = sysSnap.data();
      if (isKeyValidFormat(data?.apiKey)) {
        cachedApiKey = data.apiKey.trim();
        try { localStorage.setItem('gemini_api_key', cachedApiKey); } catch (e) {}
        return cachedApiKey;
      }
    }
  } catch (firestoreErr) {
    console.warn('Could not read Gemini key from system_config:', firestoreErr);
  }

  // 2. Try reading custom key from company profile if companyUid was provided or in URL
  const targetUid = companyUid || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null);
  if (targetUid) {
    try {
      const userSnap = await getDoc(doc(db, 'users', targetUid));
      if (userSnap.exists()) {
        const uData = userSnap.data();
        if (isKeyValidFormat(uData?.geminiApiKey)) {
          cachedApiKey = uData.geminiApiKey.trim();
          try { localStorage.setItem('gemini_api_key', cachedApiKey); } catch (e) {}
          return cachedApiKey;
        }
      }
    } catch (userErr) {
      console.warn('Could not read company custom geminiApiKey:', userErr);
    }
  }

  // 3. Try environment variables
  const envKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  if (isKeyValidFormat(envKey)) {
    cachedApiKey = envKey.trim();
    return cachedApiKey;
  }

  // 4. Try fetching from runtime backend (/api/gemini/config)
  try {
    const res = await fetch('/api/gemini/config');
    if (res.ok) {
      const data = await res.json();
      if (isKeyValidFormat(data.apiKey)) {
        cachedApiKey = data.apiKey.trim();
        try { localStorage.setItem('gemini_api_key', cachedApiKey); } catch (e) {}
        return cachedApiKey;
      }
    }
  } catch (err) {
    // Backend endpoint might not exist on static hosting
  }

  // 5. Fallback to localStorage
  try {
    const saved = localStorage.getItem('gemini_api_key');
    if (isKeyValidFormat(saved)) {
      cachedApiKey = saved!.trim();
      return cachedApiKey;
    }
  } catch (e) {}

  return '';
}

/**
 * Validates a Gemini API Key by performing a quick test request
 */
export async function testGeminiApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    if (!isKeyValidFormat(key)) {
      return { valid: false, error: 'Formato de API Key no válido.' };
    }
    const ai = new GoogleGenAI({ apiKey: key.trim() });
    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: 'Responde únicamente con la palabra OK si estás activo.'
    });
    if (response.text) {
      return { valid: true };
    }
    return { valid: false, error: 'No se recibió respuesta del modelo.' };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Error al conectar con Gemini API' };
  }
}

/**
 * Saves a new Gemini API Key to Firestore system_config so all corporate links and candidates share it
 */
export async function savePlatformGeminiApiKey(key: string): Promise<void> {
  const cleanKey = key.trim();
  cachedApiKey = cleanKey;
  try { localStorage.setItem('gemini_api_key', cleanKey); } catch (e) {}
  
  await setDoc(doc(db, 'system_config', 'gemini'), {
    apiKey: cleanKey,
    model: GEMINI_LIVE_MODEL,
    updatedAt: new Date().toISOString()
  });
}

/**
 * Returns a configured GoogleGenAI instance.
 */
export function createGeminiClient(key?: string): GoogleGenAI {
  const finalKey = key || cachedApiKey || 
                   (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                   (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  return new GoogleGenAI({ apiKey: finalKey });
}


