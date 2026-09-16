import { GoogleGenAI } from '@google/genai';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

let cachedApiKey: string = '';

// Verified platform fallback key so candidates are never blocked
const PLATFORM_FALLBACK_KEY = 'AIzaSyDTxFD4oes3-w6Duwrh4yafXNhW_mablOk';

/**
 * Resolves the Gemini API key from multiple fallback sources:
 * 1. Runtime memory cache
 * 2. Injected environment variables (`process.env.GEMINI_API_KEY` / `VITE_GEMINI_API_KEY`)
 * 3. Backend `/api/gemini/config` endpoint
 * 4. Firestore `system_config/gemini` (platform-wide distributed key)
 * 5. Firestore `users/{companyUid}` (company specific key if configured)
 * 6. Local storage cache
 * 7. Verified platform fallback key
 */
export async function getOrFetchGeminiApiKey(companyUid?: string): Promise<string> {
  if (cachedApiKey && cachedApiKey !== 'dummy-key-placeholder') {
    return cachedApiKey;
  }

  // 1. Try environment variables
  const envKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  if (envKey && envKey !== 'dummy-key-placeholder') {
    cachedApiKey = envKey;
    return cachedApiKey;
  }

  // 2. Try fetching from runtime backend (/api/gemini/config)
  try {
    const res = await fetch('/api/gemini/config');
    if (res.ok) {
      const data = await res.json();
      if (data.apiKey && data.apiKey !== 'dummy-key-placeholder') {
        cachedApiKey = data.apiKey;
        try { localStorage.setItem('gemini_api_key', data.apiKey); } catch (e) {}
        return cachedApiKey;
      }
    }
  } catch (err) {
    // Backend endpoint might not exist on static hosting (Vercel/Netlify/Firebase Hosting)
  }

  // 3. Try reading from Firestore system_config/gemini (accessible from any domain or candidate link)
  try {
    const sysSnap = await getDoc(doc(db, 'system_config', 'gemini'));
    if (sysSnap.exists()) {
      const data = sysSnap.data();
      if (data?.apiKey && data.apiKey !== 'dummy-key-placeholder') {
        cachedApiKey = data.apiKey;
        try { localStorage.setItem('gemini_api_key', data.apiKey); } catch (e) {}
        return cachedApiKey;
      }
    }
  } catch (firestoreErr) {
    console.warn('Could not read Gemini key from system_config:', firestoreErr);
  }

  // 4. Try reading custom key from company profile if companyUid was provided or is in URL
  const targetUid = companyUid || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null);
  if (targetUid) {
    try {
      const userSnap = await getDoc(doc(db, 'users', targetUid));
      if (userSnap.exists()) {
        const uData = userSnap.data();
        if (uData?.geminiApiKey && uData.geminiApiKey !== 'dummy-key-placeholder') {
          cachedApiKey = uData.geminiApiKey;
          try { localStorage.setItem('gemini_api_key', uData.geminiApiKey); } catch (e) {}
          return cachedApiKey;
        }
      }
    } catch (userErr) {
      console.warn('Could not read company custom geminiApiKey:', userErr);
    }
  }

  // 5. Fallback to localStorage
  try {
    const saved = localStorage.getItem('gemini_api_key');
    if (saved && saved !== 'dummy-key-placeholder') {
      cachedApiKey = saved;
      return cachedApiKey;
    }
  } catch (e) {}

  // 6. Resilient platform fallback
  cachedApiKey = PLATFORM_FALLBACK_KEY;
  return cachedApiKey;
}

/**
 * Returns a configured GoogleGenAI instance.
 */
export function createGeminiClient(key?: string): GoogleGenAI {
  const finalKey = key || cachedApiKey || 
                   (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                   (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
                   PLATFORM_FALLBACK_KEY;
  return new GoogleGenAI({ apiKey: finalKey });
}

