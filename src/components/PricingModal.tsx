import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Check, Zap, CreditCard, Shield, X, AlertCircle, Building2, User, Sparkles } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose }) => {
  const { user, profile, refreshProfile } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/stripe/config')
        .then(res => res.json())
        .then(data => setStripeConfigured(data.isConfigured))
        .catch(() => setStripeConfigured(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPlan = profile?.subscriptionPlan;
  const isSubscribed = profile?.subscriptionStatus === 'active';

  const handleSubscribe = async (planKey: 'basic' | 'pro' | 'corp') => {
    if (!user) {
      alert('Por favor inicia sesión antes de suscribirte.');
      return;
    }

    setLoadingPlan(planKey);
    setNotice(null);

    const limits = { basic: 5, pro: 20, corp: 100 };

    try {
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          userEmail: user.email,
          planKey,
        }),
      });

      const data = await response.json();

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else if (data.demoMode) {
        // Activate demo subscription directly in Firestore
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          subscriptionStatus: 'active',
          subscriptionPlan: planKey,
          interviewsLimit: limits[planKey],
        });
        await refreshProfile();
        setNotice(`¡Plan ${planKey.toUpperCase()} activado exitosamente! (Límite: ${limits[planKey]} entrevistas/mes).`);
      }
    } catch (err: any) {
      console.error('Error starting checkout:', err);
      setNotice('Error al conectar con la pasarela de pago.');
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!profile?.stripeCustomerId) {
      alert('No se encontró un ID de cliente de Stripe asociado.');
      return;
    }

    setLoadingPlan('manage');
    try {
      const res = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: profile.stripeCustomerId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error opening Stripe portal:', err);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-5xl my-8 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-colors z-20"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Banner */}
        <div className="bg-slate-900 p-6 md:p-8 text-white text-center relative shrink-0 overflow-hidden">
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold mb-3 border border-indigo-500/30">
            <Zap className="w-3.5 h-3.5" />
            Planes de Suscripción HERA SaaS
          </div>
          <h3 className="text-2xl md:text-3xl font-extrabold tracking-tight">Elige el plan ideal para tu equipo</h3>
          <p className="text-slate-400 text-xs md:text-sm mt-1 max-w-lg mx-auto">
            Escala tu proceso de reclutamiento con evaluaciones automáticas por voz potenciadas por Inteligencia Artificial.
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1">
          {notice && (
            <div className="mb-6 p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Suscripción Actualizada</p>
                <p>{notice}</p>
              </div>
            </div>
          )}

          {/* 3 Plans Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            
            {/* PLAN BÁSICO */}
            <div className={`rounded-2xl border p-6 flex flex-col justify-between transition-all relative ${
              currentPlan === 'basic' && isSubscribed
                ? 'border-emerald-500 bg-emerald-50/20 shadow-md'
                : 'border-slate-200 hover:border-slate-300 bg-white shadow-2xs'
            }`}>
              {currentPlan === 'basic' && isSubscribed && (
                <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                  Tu Plan Actual
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 text-slate-700 font-bold text-base mb-1">
                  <User className="w-4 h-4 text-slate-500" />
                  Plan Básico
                </div>
                <p className="text-[11px] text-slate-500 mb-4">Ideal para pequeños reclutadores o startups con pocas vacantes al mes.</p>

                <div className="flex items-baseline gap-1 mb-4 pb-4 border-b border-slate-100">
                  <span className="text-3xl font-extrabold text-slate-900">$9.99</span>
                  <span className="text-slate-500 text-xs font-medium">USD / mes</span>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 text-center mb-5 border border-slate-100">
                  <span className="text-xs font-bold text-slate-800">Hasta 5 entrevistas mensuales</span>
                </div>

                <ul className="space-y-2.5 text-xs text-slate-600 mb-6">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>5 Evaluaciones de Voz / mes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Catálogo de 30+ roles técnicos</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Reportes con Score y Red Flags</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Historial en la nube</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => handleSubscribe('basic')}
                disabled={loadingPlan !== null}
                className={`w-full py-2.5 px-4 font-semibold text-xs rounded-xl transition-all shadow-xs ${
                  currentPlan === 'basic' && isSubscribed
                    ? 'bg-slate-100 text-slate-500 cursor-default'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {loadingPlan === 'basic' ? 'Procesando...' : (currentPlan === 'basic' && isSubscribed ? 'Plan Activo' : 'Seleccionar Plan Básico')}
              </button>
            </div>

            {/* PLAN PRO (DESTACADO) */}
            <div className={`rounded-2xl border-2 p-6 flex flex-col justify-between transition-all relative shadow-lg ${
              currentPlan === 'pro' && isSubscribed
                ? 'border-emerald-500 bg-emerald-50/30'
                : 'border-indigo-600 bg-gradient-to-b from-indigo-50/40 via-white to-white'
            }`}>
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-extrabold px-3.5 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {currentPlan === 'pro' && isSubscribed ? 'Tu Plan Actual' : 'Más Popular'}
              </div>

              <div>
                <div className="flex items-center gap-2 text-indigo-900 font-bold text-base mb-1">
                  <Zap className="w-4 h-4 text-indigo-600" />
                  Plan Pro
                </div>
                <p className="text-[11px] text-slate-500 mb-4">Para consultores de RRHH y agencias de selección activas.</p>

                <div className="flex items-baseline gap-1 mb-4 pb-4 border-b border-indigo-100">
                  <span className="text-4xl font-extrabold text-slate-900">$29.99</span>
                  <span className="text-slate-500 text-xs font-medium">USD / mes</span>
                </div>

                <div className="bg-indigo-100/60 rounded-xl p-3 text-center mb-5 border border-indigo-200/60">
                  <span className="text-xs font-extrabold text-indigo-900">Hasta 20 entrevistas mensuales</span>
                </div>

                <ul className="space-y-2.5 text-xs text-slate-700 mb-6">
                  <li className="flex items-center gap-2 font-medium">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>20 Evaluaciones de Voz / mes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Catálogo completo con 30+ roles</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Reportes ejecutivos con Score y Red Flags</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Historial de candidatos ilimitado</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Soporte prioritario por email</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => handleSubscribe('pro')}
                disabled={loadingPlan !== null}
                className={`w-full py-3 px-4 font-bold text-xs rounded-xl transition-all shadow-md ${
                  currentPlan === 'pro' && isSubscribed
                    ? 'bg-slate-100 text-slate-500 cursor-default'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
                }`}
              >
                {loadingPlan === 'pro' ? 'Procesando...' : (currentPlan === 'pro' && isSubscribed ? 'Plan Activo' : 'Seleccionar Plan Pro')}
              </button>
            </div>

            {/* PLAN CORPORATIVO */}
            <div className={`rounded-2xl border p-6 flex flex-col justify-between transition-all relative ${
              currentPlan === 'corp' && isSubscribed
                ? 'border-emerald-500 bg-emerald-50/20 shadow-md'
                : 'border-slate-800 bg-slate-900 text-white shadow-md'
            }`}>
              {currentPlan === 'corp' && isSubscribed ? (
                <div className="absolute -top-3 right-4 bg-emerald-600 text-white text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                  Tu Plan Actual
                </div>
              ) : (
                <div className="absolute -top-3 right-4 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                  Equipos
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 font-bold text-base mb-1 text-white">
                  <Building2 className="w-4 h-4 text-indigo-400" />
                  Plan Corporativo
                </div>
                <p className="text-[11px] text-slate-400 mb-4">Diseñado para empresas y departamentos de reclutamiento intensivo.</p>

                <div className="flex items-baseline gap-1 mb-4 pb-4 border-b border-slate-800">
                  <span className="text-3xl font-extrabold text-white">$99.99</span>
                  <span className="text-slate-400 text-xs font-medium">USD / mes</span>
                </div>

                <div className="bg-slate-800/80 rounded-xl p-3 text-center mb-5 border border-slate-700">
                  <span className="text-xs font-bold text-indigo-300">Hasta 100 entrevistas mensuales</span>
                </div>

                <ul className="space-y-2.5 text-xs text-slate-300 mb-6">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>100 Evaluaciones de Voz / mes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Acceso multi-reclutador para equipos</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Catálogo completo con 30+ roles</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Reportes ejecutivos avanzados</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span>Gestor de cuenta y soporte 24/7</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => handleSubscribe('corp')}
                disabled={loadingPlan !== null}
                className={`w-full py-2.5 px-4 font-semibold text-xs rounded-xl transition-all shadow-xs ${
                  currentPlan === 'corp' && isSubscribed
                    ? 'bg-slate-800 text-slate-400 cursor-default'
                    : 'bg-white hover:bg-slate-100 text-slate-900'
                }`}
              >
                {loadingPlan === 'corp' ? 'Procesando...' : (currentPlan === 'corp' && isSubscribed ? 'Plan Activo' : 'Seleccionar Corporativo')}
              </button>
            </div>

          </div>

          {isSubscribed && profile?.stripeCustomerId && (
            <div className="mt-8 text-center pt-4 border-t border-slate-100">
              <button
                onClick={handleManageSubscription}
                disabled={loadingPlan !== null}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-all"
              >
                <CreditCard className="w-4 h-4" />
                Administrar o Cancelar Suscripción en Stripe
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 mt-6">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              Pagos 100% seguros procesados por Stripe
            </span>
            <span>Cancela o cambia de plan cuando quieras</span>
          </div>
        </div>
      </div>
    </div>
  );
};
