import { GoogleGenAI } from '@google/genai';

let cachedApiKey: string = '';

/**
 * Resolves the Gemini API key from multiple fallback sources:
 * 1. Runtime cache
 * 2. Backend `/api/gemini/config` endpoint (crucial for Render and production deployments)
 * 3. Injected `process.env.GEMINI_API_KEY` or `VITE_GEMINI_API_KEY`
 * 4. Local storage fallback
 */
export async function getOrFetchGeminiApiKey(): Promise<string> {
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

  // 2. Try fetching from runtime backend
  try {
    const res = await fetch('/api/gemini/config');
    if (res.ok) {
      const data = await res.json();
      if (data.apiKey) {
        cachedApiKey = data.apiKey;
        return cachedApiKey;
      }
    }
  } catch (err) {
    console.warn('Could not fetch Gemini API key from backend:', err);
  }

  // 3. Fallback to localStorage
  try {
    const saved = localStorage.getItem('gemini_api_key');
    if (saved) {
      cachedApiKey = saved;
      return cachedApiKey;
    }
  } catch (e) {}

  return cachedApiKey || '';
}

/**
 * Returns a configured GoogleGenAI instance.
 */
export function createGeminiClient(key?: string): GoogleGenAI {
  const finalKey = key || cachedApiKey || 
                   (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
                   (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  return new GoogleGenAI({ apiKey: finalKey || 'dummy-key-placeholder' });
}
