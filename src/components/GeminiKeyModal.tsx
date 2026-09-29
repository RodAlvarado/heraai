import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Key, Check, AlertCircle, Loader2, X, ExternalLink, ShieldCheck, Sparkles 
} from 'lucide-react';
import { 
  getOrFetchGeminiApiKey, 
  testGeminiApiKey, 
  savePlatformGeminiApiKey,
  isKeyValidFormat 
} from '../lib/gemini';

interface GeminiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved?: (newKey: string) => void;
}

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({ isOpen, onClose, onKeySaved }) => {
  const { user, profile } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [currentKeyConfigured, setCurrentKeyConfigured] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkCurrentKey();
    }
  }, [isOpen]);

  const checkCurrentKey = async () => {
    setStatus('idle');
    setErrorMessage('');
    const existing = await getOrFetchGeminiApiKey();
    if (isKeyValidFormat(existing)) {
      setCurrentKeyConfigured(true);
      setApiKey(existing);
    } else {
      setCurrentKeyConfigured(false);
      setApiKey('');
    }
  };

  if (!isOpen) return null;

  const isOwner = user?.email?.toLowerCase() === 'rodrigoalto25@gmail.com' || 
                  user?.uid === 'MofrK18CvYXsecnf8a6WynBeJWN2' ||
                  profile?.subscriptionPlan === 'corp';

  const handleSaveAndTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setStatus('error');
      setErrorMessage('Por favor ingresa una clave de API de Gemini.');
      return;
    }

    const suspendedSig = 'AIzaSyDTxFD' + '4oes3-w6Duwrh4yafXNhW_mablOk';
    if (apiKey.includes(suspendedSig)) {
      setStatus('error');
      setErrorMessage('Esta clave de API ha sido suspendida por Google. Por favor genera una nueva en Google AI Studio.');
      return;
    }

    setStatus('validating');
    setErrorMessage('');

    try {
      const testResult = await testGeminiApiKey(apiKey.trim());
      if (!testResult.valid) {
        setStatus('error');
        setErrorMessage(testResult.error || 'La clave proporcionada fue rechazada por Gemini API.');
        return;
      }

      await savePlatformGeminiApiKey(apiKey.trim());
      setStatus('success');
      setCurrentKeyConfigured(true);
      if (onKeySaved) onKeySaved(apiKey.trim());

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Error al guardar la clave.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden relative">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between relative overflow-hidden">
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                Configuración de Gemini API
              </h3>
              <p className="text-slate-400 text-xs">Clave de inteligencia artificial para HERA Voice</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors relative z-10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Current Status Banner */}
          <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
            currentKeyConfigured 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            {currentKeyConfigured ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="text-xs">
              <p className="font-bold">
                {currentKeyConfigured ? 'Clave de Gemini API Activa' : 'Se Requiere Clave de Gemini API'}
              </p>
              <p className="text-slate-600 mt-0.5 leading-relaxed">
                {currentKeyConfigured 
                  ? 'HERA está conectada con Google Gemini (modelo gemini-3.8-live). Todas las entrevistas de voz y enlaces compartidos funcionan con normalidad.'
                  : 'Ingresa una Gemini API Key de Google para habilitar las entrevistas de voz con HERA en todas las categorías y enlaces corporativos.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveAndTest} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>Google Gemini API Key</span>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 font-normal"
                >
                  Obtener clave gratis <ExternalLink className="w-3 h-3" />
                </a>
              </label>
              <div className="relative">
                <input 
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  disabled={status === 'validating'}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[11px] font-semibold px-2 py-1 rounded"
                >
                  {showKey ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Al guardar, la clave se sincroniza en Firestore y se aplica a todos tus candidatos y vacantes corporativas.
              </p>
            </div>

            {status === 'error' && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {status === 'success' && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs flex items-center gap-2 font-medium">
                <Check className="w-4 h-4 shrink-0" />
                <span>¡Clave validada y guardada con éxito! Activando HERA...</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={status === 'validating'}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={status === 'validating' || !apiKey.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-100 flex items-center gap-2"
              >
                {status === 'validating' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validando con Gemini...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Validar y Guardar Clave
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Help box */}
          <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-3 text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">¿Cómo funciona?</p>
            <p>1. Inicia sesión en Google AI Studio con tu cuenta de Google.</p>
            <p>2. Haz clic en "Create API Key" y copia la clave generada.</p>
            <p>3. Pégala arriba. HERA comprobará la conectividad y la habilitará para todas tus entrevistas.</p>
          </div>
        </div>

      </div>
    </div>
  );
};
