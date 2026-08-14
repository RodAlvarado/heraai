import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { 
  Mic, MicOff, Square, Bot, Briefcase, ChevronRight, CheckCircle2, 
  Loader2, Volume2, User as UserIcon, LogOut, Zap, History, Lock, Sparkles, ShieldAlert 
} from 'lucide-react';
import { ROLES_BY_CATEGORY } from './roles';
import { VOICE_SYSTEM_PROMPT } from './systemPrompt';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { PricingModal } from './components/PricingModal';
import { InterviewHistory } from './components/InterviewHistory';
import { db } from './lib/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';

// Lazy getter for Gemini SDK to prevent startup crash if API key is missing
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  return new GoogleGenAI({ apiKey: apiKey || 'dummy-key-placeholder' });
}

function MainApp() {
  const { user, profile, logout, refreshProfile } = useAuth();
  
  const [step, setStep] = useState<'select_role' | 'interview' | 'generating_report' | 'report'>('select_role');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  
  // Modals
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const isAnsweringRef = useRef(false);
  const isCompletingRef = useRef(false);
  const pendingCompletionArgsRef = useRef<any>(null);
  const isTurnCompleteRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);

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
      console.error("Error playing audio chunk:", err);
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
      console.error("Error accessing microphone:", err);
      alert("Microphone access is required for the voice interview.");
      setStep('select_role');
    }
  };

  const handleInterviewComplete = async (args: any) => {
    setStep('generating_report');
    cleanupAudio();
    
    try {
      const prompt = `Based on the following interview summary, generate a formal Candidate Evaluation Report in Markdown format.
      
      Role: ${selectedRole}
      Score: ${args?.recommended_score || 'N/A'} / 75
      Red Flags: ${args?.red_flags || 'None'}
      
      Summary:
      ${args?.candidate_summary || JSON.stringify(args) || 'No summary provided.'}
      
      Format the report exactly as follows:
      # Candidate Evaluation Report
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
      setReportContent(markdownReport);
      setStep('report');

      // Save to Firestore if user is authenticated
      if (user) {
        try {
          await addDoc(collection(db, 'interviews'), {
            userId: user.uid,
            role: selectedRole,
            report: markdownReport,
            score: args?.recommended_score || 0,
            redFlags: args?.red_flags || 0,
            summary: args?.candidate_summary || '',
            createdAt: serverTimestamp()
          });

          // Increment interview count in user document
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            interviewsCount: increment(1)
          });

          // Refresh profile so React state updates immediately
          await refreshProfile();
        } catch (dbErr) {
          console.error("Failed to save interview record to Firestore:", dbErr);
        }
      }

    } catch (err) {
      console.error("Failed to generate report:", err);
      setReportContent("Failed to generate report. Please try again.");
      setStep('report');
    }
  };

  const startInterview = async (role: string) => {
    // Check authentication or trial limits
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    // Refresh profile from Firestore to ensure we have the absolute latest count and plan status
    await refreshProfile();

    const currentLimit = profile?.interviewsLimit ?? (profile?.subscriptionStatus === 'active' ? (profile?.subscriptionPlan === 'basic' ? 5 : profile?.subscriptionPlan === 'corp' ? 100 : 20) : 2);
    const currentCount = profile?.interviewsCount || 0;

    if (currentCount >= currentLimit) {
      setIsPricingOpen(true);
      return;
    }

    setSelectedRole(role);
    setStep('interview');
    
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
          systemInstruction: VOICE_SYSTEM_PROMPT + `\n\nThe candidate is applying for: ${role}. Start the interview now. Introduce yourself briefly and ask the first question.`,
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
                turns: `Hello, I am ready for the ${role} interview. Please introduce yourself as the HR Manager and start the interview. I will be using a push-to-talk button to answer your questions.`,
                turnComplete: true
              });
            }).catch(err => console.error("Failed to send initial message:", err));
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
            console.log("Session closed");
          },
          onerror: (err: any) => {
            console.error("Live API Error:", err);
          }
        }
      });
      
      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error("Failed to start interview:", err);
      alert("Failed to start the voice interview. Please check your microphone permissions.");
      setStep('select_role');
    }
  };

  const endInterviewEarly = () => {
    handleInterviewComplete({
      candidate_summary: "The interview was ended early by the user.",
      recommended_score: 0,
      red_flags: 0
    });
  };

  const isPro = profile?.subscriptionStatus === 'active';
  const userLimit = profile?.interviewsLimit ?? (isPro ? (profile?.subscriptionPlan === 'basic' ? 5 : profile?.subscriptionPlan === 'corp' ? 100 : 20) : 2);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-slate-50 border border-slate-100 shadow-sm">
            <img src="/logo.png" alt="HERA Logo" className="w-full h-full object-cover" onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-600"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
            }} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900 flex items-center gap-2">
              HERA <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-semibold border border-indigo-100">SaaS</span>
            </h1>
            <p className="text-[11px] text-slate-400 hidden sm:block">Human Evaluation & Recruitment AI</p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3">
          {/* Subscription Status Pill */}
          <button
            onClick={() => setIsPricingOpen(true)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full border transition-all ${
              profile?.subscriptionStatus === 'active' 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
            }`}
          >
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span>
              {profile?.subscriptionStatus === 'active' ? (
                `${profile.subscriptionPlan === 'basic' ? 'Plan Básico' : profile.subscriptionPlan === 'corp' ? 'Plan Corporativo' : 'Plan Pro'} (${profile.interviewsCount || 0}/${userLimit})`
              ) : user ? (
                `Prueba Gratis (${profile?.interviewsCount || 0}/${userLimit})`
              ) : (
                'Planes & Precios'
              )}
            </span>
          </button>

          {/* User Auth Section */}
          {user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsHistoryOpen(true)}
                className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
                title="Historial de Entrevistas"
              >
                <History className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    (user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()
                  )}
                </div>
                <button
                  onClick={logout}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  title="Cerrar Sesión"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAuthOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
            >
              <UserIcon className="w-4 h-4" />
              Iniciar Sesión
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col w-full mx-auto p-4 md:p-6 overflow-hidden">
        
        {/* Step 1: Role Selection */}
        {step === 'select_role' && (
          <div className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full py-6 overflow-y-auto">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold mb-3 border border-indigo-100">
                <Sparkles className="w-3.5 h-3.5" />
                Plataforma de Entrevistas de Voz con IA
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mb-3">
                Practica tus entrevistas con HERA, tu reclutadora de IA
              </h2>
              <p className="text-sm md:text-base text-slate-600 max-w-xl mx-auto">
                Selecciona el puesto, realiza la entrevista y te entrega un reporte completo sobre tu feedback
              </p>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 w-full max-h-[58vh] overflow-y-auto">
              <h3 className="font-bold text-slate-900 mb-6 flex items-center justify-between sticky top-0 bg-white z-10 pb-3 border-b border-slate-100">
                <span className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-indigo-600" />
                  Catálogo de Puestos Disponibles
                </span>
                <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                  30+ Roles
                </span>
              </h3>
              <div className="space-y-8">
                {Object.entries(ROLES_BY_CATEGORY).map(([category, roles]) => (
                  <div key={category}>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{category}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {roles.map(role => (
                        <button
                          key={role}
                          onClick={() => startInterview(role)}
                          className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all text-left group shadow-2xs"
                        >
                          <span className="font-semibold text-xs text-slate-800 group-hover:text-indigo-700">{role}</span>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-600 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Voice Interview */}
        {step === 'interview' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden max-w-4xl mx-auto w-full p-8">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Entrevista de Voz en Curso</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Escucha la pregunta de HERA, luego presiona <strong>"Empezar a Responder"</strong> para hablar.
                Al finalizar, presiona <strong>"Terminar Respuesta"</strong>.
              </p>
            </div>

            <div className="relative flex items-center justify-center w-48 h-48 mb-10">
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
                  <MicOff className="w-9 h-9 text-white mb-1" />
                ) : (
                  <Mic className="w-9 h-9 text-white mb-1" />
                )}
                <span className="text-white text-xs font-bold text-center leading-tight mt-1">
                  {isAnswering ? <>Terminar<br/>Respuesta</> : <>Empezar a<br/>Responder</>}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-3 text-slate-600 bg-slate-50 px-6 py-3 rounded-full border border-slate-200 mb-10 text-xs">
              {isRecording ? (
                isAnswering ? (
                  <>
                    <Volume2 className="w-4 h-4 text-red-500 animate-pulse" />
                    <span className="font-medium text-red-700">Grabando tu respuesta...</span>
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
                  <span className="font-medium">Conectando con HERA...</span>
                </>
              )}
            </div>

            <button
              onClick={endInterviewEarly}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 font-semibold text-xs rounded-xl hover:bg-red-100 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Finalizar Entrevista
            </button>
          </div>
        )}

        {/* Step 3: Generating Report */}
        {step === 'generating_report' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl shadow-sm border border-slate-200 max-w-4xl mx-auto w-full p-8">
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-6 border border-indigo-100 shadow-inner">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Generando Reporte de Evaluación</h2>
            <p className="text-xs text-slate-500 text-center max-w-md">
              HERA está analizando las respuestas, asignando puntaje técnico y guardando la evaluación en la base de datos de tu cuenta.
            </p>
          </div>
        )}

        {/* Step 4: Report View */}
        {step === 'report' && (
          <div className="flex-1 flex flex-col items-center justify-center py-6 w-full overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 w-full max-w-3xl overflow-hidden">
              <div className="bg-indigo-600 px-6 py-8 text-white text-center">
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-1">Entrevista Finalizada</h2>
                <p className="text-indigo-100 text-xs">HERA ha generado el reporte ejecutivo para esta vacante.</p>
              </div>
              
              <div className="p-6 md:p-8">
                <div className="prose prose-slate max-w-none text-xs">
                  <ReactMarkdown>{reportContent || "No se generó reporte."}</ReactMarkdown>
                </div>
                
                <div className="mt-8 flex justify-center gap-3">
                  <button
                    onClick={() => {
                      setStep('select_role');
                      setReportContent(null);
                      setSelectedRole('');
                    }}
                    className="px-6 py-2.5 bg-slate-900 text-white font-medium text-xs rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    Evaluar Otro Puesto
                  </button>
                  {user && (
                    <button
                      onClick={() => setIsHistoryOpen(true)}
                      className="px-6 py-2.5 bg-slate-100 text-slate-700 font-medium text-xs rounded-xl hover:bg-slate-200 transition-colors"
                    >
                      Ver Historial
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* SaaS Modals */}
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      <PricingModal isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />
      <InterviewHistory isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
