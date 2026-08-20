import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { 
  Mic, MicOff, Square, Bot, Briefcase, CheckCircle2, Loader2, Volume2, 
  Sparkles, Building2, User, Mail, ShieldCheck, ArrowRight, AlertCircle 
} from 'lucide-react';
import { VOICE_SYSTEM_PROMPT } from '../systemPrompt';
import { ROLES_BY_CATEGORY } from '../roles';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc } from 'firebase/firestore';

interface CandidatePortalProps {
  companyUid: string;
  initialRole?: string;
  onExitToMainApp?: () => void;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
                 (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) || '';
  return new GoogleGenAI({ apiKey: apiKey || 'dummy-key-placeholder' });
}

export const CandidatePortal: React.FC<CandidatePortalProps> = ({ 
  companyUid, 
  initialRole,
  onExitToMainApp 
}) => {
  const [step, setStep] = useState<'form' | 'interview' | 'submitting' | 'success' | 'quota_exhausted' | 'not_corporate'>('form');
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState(initialRole || 'SEO Specialist');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Company metadata
  const [companyName, setCompanyName] = useState<string>('Empresa Reclutadora');
  const [loadingCompany, setLoadingCompany] = useState(true);

  // Track start time of current interview to filter out tests < 10 seconds
  const interviewStartTimeRef = useRef<number | null>(null);

  // Audio & Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  
  const isAnsweringRef = useRef(false);
  const isCompletingRef = useRef(false);
  const pendingCompletionArgsRef = useRef<any>(null);
  const isTurnCompleteRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);

  // Load company information & check quota and corporate plan status
  useEffect(() => {
    let isMounted = true;

    async function fetchCompany() {
      try {
        const companyDoc = await getDoc(doc(db, 'users', companyUid));
        if (!isMounted) return;

        if (companyDoc.exists()) {
          const data = companyDoc.data();
          setCompanyName(data.displayName || data.email?.split('@')[0] || 'Empresa Reclutadora');
          
          // Verify that company has an active corporate subscription
          const isRodrigoDev = data.email?.toLowerCase() === 'rodrigoalto25@gmail.com' || companyUid === 'MofrK18CvYXsecnf8a6WynBeJWN2';
          const isCorp = isRodrigoDev || (data.subscriptionStatus === 'active' && data.subscriptionPlan === 'corp');
          
          if (!isCorp) {
            setStep('not_corporate');
            return;
          }

          const count = data.interviewsCount || 0;
          const limit = data.interviewsLimit || (isRodrigoDev ? 100 : 20);
          
          if (count >= limit) {
            setStep('quota_exhausted');
          }
        } else {
          // If document not found in Firestore yet, check if it's the known dev account or fallback
          if (companyUid === 'MofrK18CvYXsecnf8a6WynBeJWN2') {
            setCompanyName('HERA Talent Team');
            // Allowed for testing
          } else {
            setStep('not_corporate');
          }
        }
      } catch (err) {
        console.warn('Could not read company profile from Firestore:', err);
        // If it's a known tester UID, allow testing
        if (companyUid === 'MofrK18CvYXsecnf8a6WynBeJWN2') {
          setCompanyName('HERA Talent Team');
        }
      } finally {
        if (isMounted) {
          setLoadingCompany(false);
        }
      }
    }

    fetchCompany();

    return () => {
      isMounted = false;
    };
  }, [companyUid]);

  const toggleAnswering = () => {
    if (!sessionRef.current) return;
    
    if (isAnswering) {
      setIsAnswering(false);
      isAnsweringRef.current = false;
      sessionRef.current.sendRealtimeInput({ activityEnd: {} });
    } else {
      stopAudio();
      setIsAnswering(true);
      isAnsweringRef.current = true;
      sessionRef.current.sendRealtimeInput({ activityStart: {} });
    }
  };

  const playAudio = (base64Audio: string) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      
      const startTime = Math.max(nextPlayTimeRef.current, ctx.currentTime);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
      
      activeSourcesRef.current.push(source);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      };
    } catch (err) {
      console.error("Error playing candidate audio chunk:", err);
    }
  };

  const stopAudio = () => {
    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch(e){}
    });
    activeSourcesRef.current = [];
    if (audioCtxRef.current) {
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
  };

  const cleanupAudio = () => {
    stopAudio();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsRecording(false);
  };

  const startRecording = async (sessionPromise: Promise<any>) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
      mediaStreamRef.current = stream;
      setIsRecording(true);
      
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(stream);
      
      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.buffer = new Int16Array(4096);
            this.offset = 0;
          }
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input.length > 0) {
              const channelData = input[0];
              for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.offset++] = Math.max(-1, Math.min(1, channelData[i])) * 32767;
                if (this.offset >= this.buffer.length) {
                  this.port.postMessage(this.buffer.buffer.slice(0), [this.buffer.buffer.slice(0)]);
                  this.offset = 0;
                  this.buffer = new Int16Array(4096);
                }
              }
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      
      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor');
      
      workletNode.port.onmessage = (e) => {
        if (!isAnsweringRef.current) return;
        
        const pcm16 = new Int16Array(e.data);
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        
        sessionPromise.then(session => {
          session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 } });
        }).catch(() => {});
      };
      
      source.connect(workletNode);
      workletNode.connect(ctx.destination);
    } catch (err) {
      console.error("Error accessing microphone for candidate:", err);
      alert("Se requiere acceso al micrófono para realizar la evaluación de voz.");
      setStep('form');
    }
  };

  const handleInterviewComplete = async (args: any) => {
    setStep('submitting');
    cleanupAudio();
    
    const candidateFullName = `${firstName.trim()} ${lastName.trim()}`;
    const durationSeconds = interviewStartTimeRef.current 
      ? Math.floor((Date.now() - interviewStartTimeRef.current) / 1000) 
      : 0;
    const isShortInterview = durationSeconds < 10;

    try {
      const prompt = `Based on the following interview summary, generate a formal Candidate Evaluation Report in Markdown format.
      
      Candidate Name: ${candidateFullName}
      Candidate Email: ${email.trim()}
      Role Applied: ${selectedRole}
      Score: ${args?.recommended_score || 'N/A'} / 75
      Red Flags: ${args?.red_flags || 'None'}
      
      Summary:
      ${args?.candidate_summary || JSON.stringify(args) || 'No summary provided.'}
      
      Format the report exactly as follows:
      # Candidate Evaluation Report
      **Candidate:** ${candidateFullName} (${email.trim()})
      **Role Applied:** ${selectedRole}
      **Experience Level:** [Determine based on summary]
      **Total Score:** ${args?.recommended_score || 'N/A'} / 75
      
      ### Strengths
      - [List strengths]
      
      ### Weaknesses
      - [List weaknesses]
      
      ### Red Flags
      - ${args?.red_flags || 'None'} detected. [Brief explanation if any]
      
      ### Final Recommendation
      [Proceed to second interview / Consider for junior role / Do not proceed / Reject]
      `;
      
      const response = await getGeminiClient().models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      
      const markdownReport = response.text || "Report completed.";

      // Save to Firestore under company's interviews collection
      try {
        await addDoc(collection(db, 'interviews'), {
          userId: companyUid,
          candidateName: candidateFullName,
          candidateEmail: email.trim(),
          isCandidateInvite: true,
          role: selectedRole,
          report: markdownReport,
          score: args?.recommended_score || 0,
          redFlags: args?.red_flags || 0,
          summary: args?.candidate_summary || '',
          durationSeconds,
          isShortInterview,
          createdAt: serverTimestamp()
        });

        // Increment company's interview count ONLY if interview was >= 10 seconds!
        if (!isShortInterview) {
          try {
            const companyRef = doc(db, 'users', companyUid);
            await updateDoc(companyRef, {
              interviewsCount: increment(1)
            });
          } catch (incErr) {
            console.warn("Could not increment count directly:", incErr);
          }
        }
      } catch (dbErr) {
        console.error("Failed to save interview record:", dbErr);
      }

      setStep('success');

    } catch (err) {
      console.error("Failed to generate candidate report:", err);
      setStep('success'); // Still show success to candidate so they are not stressed
    }
  };

  const handleStartInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('Por favor ingresa tu nombre y apellido.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setFormError('Por favor ingresa un correo electrónico válido.');
      return;
    }

    if (!termsAccepted) {
      setFormError('Debes aceptar las condiciones para proceder con la entrevista.');
      return;
    }

    setStep('interview');
    interviewStartTimeRef.current = Date.now();

    try {
      isCompletingRef.current = false;
      pendingCompletionArgsRef.current = null;
      isTurnCompleteRef.current = false;
      
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
      
      const sessionPromise = getGeminiClient().live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true }
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
          },
          systemInstruction: VOICE_SYSTEM_PROMPT + `\n\nYou are interviewing the candidate: ${firstName.trim()} ${lastName.trim()} for the position of: ${selectedRole}. Start the interview now by greeting them by their first name (${firstName.trim()}) and introducing yourself as HERA, then ask the first question.`,
          tools: [{
            functionDeclarations: [
              {
                name: 'complete_interview',
                description: 'Call this function ONLY when you have completed all steps of the interview to submit the final evaluation.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    candidate_summary: { type: Type.STRING, description: 'Detailed notes on everything the candidate said.' },
                    recommended_score: { type: Type.INTEGER, description: 'Recommended score out of 75.' },
                    red_flags: { type: Type.INTEGER, description: 'Number of red flags detected.' }
                  },
                  required: ['candidate_summary', 'recommended_score', 'red_flags']
                }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            startRecording(sessionPromise);
            
            sessionPromise.then(session => {
              session.sendClientContent({
                turns: `Hello, I am ${firstName.trim()} ${lastName.trim()} and I am ready for the ${selectedRole} interview. Please introduce yourself and start the interview. I will be using a push-to-talk button to answer your questions.`,
                turnComplete: true
              });
            }).catch(err => console.error("Failed to send initial candidate message:", err));
          },
          onmessage: async (message: any) => {
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                  playAudio(part.inlineData.data);
                }
              }
            }
            if (message.serverContent?.interrupted) {
              stopAudio();
            }
            if (message.serverContent?.turnComplete) {
              isTurnCompleteRef.current = true;
            }
            if (message.toolCall) {
              const call = message.toolCall.functionCalls?.find((c: any) => c.name === 'complete_interview');
              if (call) {
                pendingCompletionArgsRef.current = call.args;
              }
            }
            
            if (pendingCompletionArgsRef.current && isTurnCompleteRef.current && !isCompletingRef.current) {
              isCompletingRef.current = true;
              
              const checkAudioFinished = () => {
                const currentTime = audioCtxRef.current?.currentTime || 0;
                if (currentTime >= nextPlayTimeRef.current) {
                  handleInterviewComplete(pendingCompletionArgsRef.current);
                } else {
                  setTimeout(checkAudioFinished, 500);
                }
              };
              
              setTimeout(checkAudioFinished, 500);
            }
          },
          onclose: () => {
            console.log("Candidate session closed");
          },
          onerror: (err: any) => {
            console.error("Live API Candidate Error:", err);
          }
        }
      });
      
      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error("Failed to start candidate interview:", err);
      alert("No se pudo iniciar la llamada de voz. Por favor verifica los permisos de micrófono.");
      setStep('form');
    }
  };

  const endInterviewEarly = () => {
    const durationSeconds = interviewStartTimeRef.current 
      ? Math.floor((Date.now() - interviewStartTimeRef.current) / 1000) 
      : 0;

    if (durationSeconds < 10) {
      cleanupAudio();
      setFormError(`⚠️ La entrevista duró menos de 10 segundos (${durationSeconds}s). No se ha consumido del cupo de evaluaciones de la empresa.`);
      setStep('form');
      return;
    }

    handleInterviewComplete({
      candidate_summary: "La entrevista fue terminada anticipadamente por el candidato.",
      recommended_score: 0,
      red_flags: 0
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col justify-between">
      
      {/* Candidate Top Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-slate-50 border border-slate-100 shadow-sm">
            <img src="/logo.png" alt="HERA Logo" className="w-full h-full object-cover" onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-600"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
            }} />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-slate-900 flex items-center gap-2">
              HERA <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-semibold border border-indigo-100">Portal de Candidatos</span>
            </h1>
            <p className="text-[11px] text-slate-500">Proceso oficial de selección y evaluación técnica</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Empresa:</span> <strong>{companyName}</strong>
          </div>
        </div>
      </header>

      {/* Main Form or Voice Interview */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 max-w-2xl mx-auto w-full">
        
        {/* Loading Company State */}
        {loadingCompany && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 text-center max-w-md w-full flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
            <h3 className="text-sm font-bold text-slate-800 mb-1">Cargando evaluación...</h3>
            <p className="text-xs text-slate-500">Verificando enlace de candidato oficial</p>
          </div>
        )}

        {/* State: Not Corporate or Invalid */}
        {!loadingCompany && step === 'not_corporate' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 text-center max-w-md w-full">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-200 text-red-600">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Enlace de Evaluación No Disponible</h2>
            <p className="text-xs text-slate-600 leading-relaxed mb-6">
              Este enlace de evaluación requiere que la empresa cuente con una suscripción activa al <strong>Plan Corporativo</strong> de HERA. Si representas a la empresa, ingresa a tu cuenta y activa el Plan Corporativo para habilitar los enlaces de candidatos.
            </p>
            {onExitToMainApp && (
              <button
                onClick={onExitToMainApp}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition-colors"
              >
                Ir a Plataforma Principal
              </button>
            )}
          </div>
        )}

        {/* State: Quota Exhausted */}
        {!loadingCompany && step === 'quota_exhausted' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 text-center max-w-md w-full">
            <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-200 text-amber-600">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Límite de Evaluaciones Alcanzado</h2>
            <p className="text-xs text-slate-600 leading-relaxed mb-6">
              El cupo mensual de entrevistas para este enlace ha sido completado. Por favor ponte en contacto directamente con el equipo de recursos humanos de <strong>{companyName}</strong> para solicitar un nuevo enlace.
            </p>
            {onExitToMainApp && (
              <button
                onClick={onExitToMainApp}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Ir a Inicio
              </button>
            )}
          </div>
        )}

        {/* State: Form Registration */}
        {!loadingCompany && step === 'form' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 md:p-8 w-full">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold mb-2 border border-indigo-100">
                <Sparkles className="w-3.5 h-3.5" />
                Evaluación Técnica de Voz
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Bienvenido/a a tu Entrevista
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Invitación generada por <strong className="text-slate-700">{companyName}</strong> para evaluar tus conocimientos técnicos.
              </p>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl mb-4 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}

            <form onSubmit={handleStartInterview} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nombre *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Carlos"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Mendoza"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Correo Electrónico *
                </label>
                <input
                  type="email"
                  required
                  placeholder="carlos.mendoza@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Posición a Evaluar
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:border-indigo-500"
                >
                  {Object.entries(ROLES_BY_CATEGORY).map(([category, roles]) => (
                    <optgroup key={category} label={category}>
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Instructions Box */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs space-y-2 text-slate-600">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  Instrucciones de la llamada:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                  <li>HERA te hará <strong>3 preguntas técnicas</strong> sobre la vacante.</li>
                  <li>Debes mantener presionado o hacer clic en <strong>"Empezar a Responder"</strong> para hablar.</li>
                  <li>Asegúrate de permitir el micrófono en tu navegador.</li>
                  <li>Al terminar, tus resultados serán enviados directamente a <strong>{companyName}</strong>.</li>
                </ul>
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  id="terms"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="terms" className="text-[11px] text-slate-600 select-none cursor-pointer">
                  Confirmo que mis datos son correctos y autorizo la realización de la evaluación por voz con IA.
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 mt-4"
              >
                Comenzar Entrevista de Voz
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* State: Voice Interview */}
        {step === 'interview' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 w-full text-center flex flex-col items-center">
            <div className="mb-8">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full border border-indigo-100">
                Puesto: {selectedRole}
              </span>
              <h2 className="text-2xl font-bold text-slate-900 mt-2">Entrevista en Curso con HERA</h2>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                Hola {firstName}, escucha con atención la pregunta y presiona <strong>"Empezar a Responder"</strong> para contestar.
              </p>
            </div>

            <div className="relative flex items-center justify-center w-44 h-44 mb-8">
              {isAnswering && (
                <>
                  <div className="absolute inset-0 rounded-full bg-indigo-100 animate-ping opacity-75" style={{ animationDuration: '3s' }}></div>
                  <div className="absolute inset-4 rounded-full bg-indigo-200 animate-ping opacity-50" style={{ animationDuration: '2s' }}></div>
                </>
              )}
              <button
                onClick={toggleAnswering}
                disabled={!isRecording}
                className={`relative z-10 w-32 h-32 rounded-full flex flex-col items-center justify-center shadow-xl transition-all ${
                  !isRecording 
                    ? 'bg-slate-200 cursor-not-allowed'
                    : isAnswering 
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-200' 
                      : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                }`}
              >
                {isAnswering ? (
                  <MicOff className="w-8 h-8 text-white mb-1" />
                ) : (
                  <Mic className="w-8 h-8 text-white mb-1" />
                )}
                <span className="text-white text-[11px] font-bold text-center leading-tight mt-1">
                  {isAnswering ? <>Terminar<br/>Respuesta</> : <>Empezar a<br/>Responder</>}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2.5 text-slate-600 bg-slate-50 px-5 py-2.5 rounded-full border border-slate-200 mb-8 text-xs">
              {isRecording ? (
                isAnswering ? (
                  <>
                    <Volume2 className="w-4 h-4 text-red-500 animate-pulse" />
                    <span className="font-semibold text-red-700">Grabando tu respuesta...</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4 text-indigo-600" />
                    <span className="font-medium">HERA está hablando o procesando...</span>
                  </>
                )
              ) : (
                <>
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  <span className="font-medium">Conectando llamada con HERA...</span>
                </>
              )}
            </div>

            <button
              onClick={endInterviewEarly}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 font-semibold text-xs rounded-xl hover:bg-red-100 transition-colors"
            >
              <Square className="w-3 h-3" />
              Finalizar Entrevista
            </button>
          </div>
        )}

        {/* State: Submitting Report */}
        {step === 'submitting' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 w-full text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mb-5 border border-indigo-100">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Procesando y Guardando tu Evaluación</h2>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              HERA está compilando tus respuestas para enviar el reporte técnico directamente al equipo de reclutamiento de <strong>{companyName}</strong>.
            </p>
          </div>
        )}

        {/* State: Success */}
        {step === 'success' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 w-full text-center max-w-md">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-200 text-emerald-600 shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Evaluación Enviada con Éxito!</h2>
            <p className="text-xs text-slate-600 leading-relaxed mb-6">
              Muchas gracias <strong>{firstName} {lastName}</strong>. Tu entrevista técnica para la posición de <strong>{selectedRole}</strong> ha sido guardada en el panel de selección de <strong>{companyName}</strong>.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 text-left mb-6 space-y-1">
              <p className="font-bold text-slate-800">Siguientes pasos:</p>
              <p className="text-[11px] text-slate-500">
                El equipo de recursos humanos revisará tu reporte y se pondrá en contacto contigo a través de <strong>{email}</strong>.
              </p>
            </div>

            {onExitToMainApp && (
              <button
                onClick={onExitToMainApp}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Cerrar Portal
              </button>
            )}
          </div>
        )}
      </main>

      {/* Candidate Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 text-center text-[11px] text-slate-400">
        HERA AI Recruitment Engine • Sistema Seguro de Selección de Personal
      </footer>
    </div>
  );
};
