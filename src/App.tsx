import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { Mic, MicOff, Square, Bot, Briefcase, ChevronRight, CheckCircle2, Loader2, Volume2 } from 'lucide-react';
import { ROLES_BY_CATEGORY } from './roles';
import { VOICE_SYSTEM_PROMPT } from './systemPrompt';

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [step, setStep] = useState<'select_role' | 'interview' | 'generating_report' | 'report'>('select_role');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const isAnsweringRef = useRef(false);

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
      // Stop any AI audio currently playing when the user starts answering
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
      Score: ${args.recommended_score} / 75
      Red Flags: ${args.red_flags}
      
      Summary:
      ${args.candidate_summary}
      
      Format the report exactly as follows:
      # Candidate Evaluation Report
      **Role Applied:** ${selectedRole}
      **Experience Level:** [Determine based on summary]
      **Total Score:** ${args.recommended_score} / 75
      
      ### Strengths
      - [List strengths]
      
      ### Weaknesses
      - [List weaknesses]
      
      ### Red Flags
      - ${args.red_flags} detected. [Brief explanation if any]
      
      ### Final Recommendation
      [Proceed to second interview / Consider for junior role / Do not proceed / Reject]
      `;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt
      });
      
      setReportContent(response.text);
      setStep('report');
    } catch (err) {
      console.error("Failed to generate report:", err);
      setReportContent("Failed to generate report. Please try again.");
      setStep('report');
    }
  };

  const startInterview = async (role: string) => {
    setSelectedRole(role);
    setStep('interview');
    
    try {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
      
      const sessionPromise = ai.live.connect({
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
            
            // Trigger the AI to speak first by sending an initial text message
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
            if (message.toolCall) {
              const call = message.toolCall.functionCalls?.find((c: any) => c.name === 'complete_interview');
              if (call) {
                // Calculate how long until the current audio queue finishes
                const currentTime = audioCtxRef.current?.currentTime || 0;
                const delayMs = Math.max(0, nextPlayTimeRef.current - currentTime) * 1000;
                
                // Wait for the audio to finish before ending the interview
                setTimeout(() => {
                  handleInterviewComplete(call.args);
                }, delayMs + 500); // Add 500ms buffer
              }
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden bg-slate-50 border border-slate-100">
            <img src="/logo.png" alt="HERA Logo" className="w-full h-full object-cover" onError={(e) => {
              // Fallback to Bot icon if logo.png is not found
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-600"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
            }} />
          </div>
          <h1 className="font-semibold text-lg tracking-tight text-slate-800">HERA <span className="text-slate-400 font-normal hidden sm:inline-block">| Human Evaluation & Recruitment AI</span></h1>
        </div>
        {step !== 'select_role' && (
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
            <Briefcase className="w-4 h-4" />
            {selectedRole}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col w-full mx-auto p-4 md:p-6 overflow-hidden">
        
        {/* Step 1: Role Selection */}
        {step === 'select_role' && (
          <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full py-12 overflow-y-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 mb-4">
                Welcome to HERA
              </h2>
              <p className="text-lg text-slate-600">
                Human Evaluation & Recruitment AI. Select the role you are applying for to begin your structured AI voice interview.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 w-full max-h-[60vh] overflow-y-auto">
              <h3 className="font-medium text-slate-900 mb-6 flex items-center gap-2 sticky top-0 bg-white z-10 pb-2 border-b border-slate-100">
                <Briefcase className="w-5 h-5 text-indigo-500" />
                Available Roles
              </h3>
              <div className="space-y-8">
                {Object.entries(ROLES_BY_CATEGORY).map(([category, roles]) => (
                  <div key={category}>
                    <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{category}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {roles.map(role => (
                        <button
                          key={role}
                          onClick={() => startInterview(role)}
                          className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-left group"
                        >
                          <span className="font-medium text-slate-700 group-hover:text-indigo-700">{role}</span>
                          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
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
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden max-w-4xl mx-auto w-full p-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Voice Interview in Progress</h2>
              <p className="text-slate-500">
                Listen to the AI's question, then click <strong>"Start Answering"</strong> to speak.
                <br />
                Click <strong>"Finish Answering"</strong> when you are done.
              </p>
            </div>

            <div className="relative flex items-center justify-center w-48 h-48 mb-12">
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
                  <MicOff className="w-10 h-10 text-white mb-1" />
                ) : (
                  <Mic className="w-10 h-10 text-white mb-1" />
                )}
                <span className="text-white text-sm font-medium text-center leading-tight mt-1">
                  {isAnswering ? <>Finish<br/>Answering</> : <>Start<br/>Answering</>}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-3 text-slate-600 bg-slate-50 px-6 py-3 rounded-full border border-slate-200 mb-12">
              {isRecording ? (
                isAnswering ? (
                  <>
                    <Volume2 className="w-5 h-5 text-red-500 animate-pulse" />
                    <span className="font-medium">Recording your answer...</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-5 h-5 text-indigo-500" />
                    <span className="font-medium">AI is speaking or processing...</span>
                  </>
                )
              ) : (
                <>
                  <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                  <span className="font-medium">Connecting to HERA...</span>
                </>
              )}
            </div>

            <button
              onClick={endInterviewEarly}
              className="flex items-center gap-2 px-6 py-3 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition-colors"
            >
              <Square className="w-4 h-4" />
              End Interview Early
            </button>
          </div>
        )}

        {/* Step 3: Generating Report */}
        {step === 'generating_report' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl shadow-sm border border-slate-200 max-w-4xl mx-auto w-full p-8">
            <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Generating Evaluation Report</h2>
            <p className="text-slate-500 text-center max-w-md">
              HERA is analyzing your responses, scoring your technical expertise, and preparing the final recommendation.
            </p>
          </div>
        )}

        {/* Step 4: Report View */}
        {step === 'report' && (
          <div className="flex-1 flex flex-col items-center justify-center py-8 w-full overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-3xl overflow-hidden">
              <div className="bg-indigo-600 px-6 py-8 text-white text-center">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Interview Complete</h2>
                <p className="text-indigo-100">HERA has generated your evaluation report.</p>
              </div>
              
              <div className="p-6 md:p-8">
                <div className="prose prose-slate max-w-none">
                  <ReactMarkdown>{reportContent || "No report generated."}</ReactMarkdown>
                </div>
                
                <div className="mt-10 flex justify-center">
                  <button
                    onClick={() => {
                      setStep('select_role');
                      setReportContent(null);
                      setSelectedRole('');
                    }}
                    className="px-6 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Start New Interview
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
