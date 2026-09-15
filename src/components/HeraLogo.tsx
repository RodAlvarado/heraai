import React from 'react';

interface HeraLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  className?: string;
  variant?: 'mark' | 'full' | 'icon';
  showSubtitle?: boolean;
}

export const HeraLogo: React.FC<HeraLogoProps> = ({
  size = 'md',
  className = '',
  variant = 'mark',
  showSubtitle = false,
}) => {
  const sizeClasses = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
    custom: '',
  };

  const currentSize = sizeClasses[size];

  if (variant === 'full') {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        {/* Navy & Gold Hera Goddess Crest */}
        <div className="w-10 h-10 rounded-xl overflow-hidden shadow-sm shrink-0 border border-amber-500/20 bg-[#07152B] flex items-center justify-center relative">
          <svg viewBox="0 0 100 100" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="heraGoldGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FDE68A" />
                <stop offset="35%" stopColor="#EAB308" />
                <stop offset="70%" stopColor="#CA8A04" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>

            {/* Goddess Hera Profile Crest */}
            <g transform="translate(14, 8) scale(0.72)">
              {/* Laurel Wreath Crown */}
              <path d="M 42 18 C 50 15 62 16 72 24" stroke="url(#heraGoldGlow)" strokeWidth="2" strokeLinecap="round" />
              <path d="M 40 18 C 36 12 30 14 32 20 C 37 20 40 19 40 18 Z" fill="url(#heraGoldGlow)" />
              <path d="M 46 16 C 45 8 38 6 36 12 C 40 15 44 16 46 16 Z" fill="url(#heraGoldGlow)" />
              <path d="M 54 17 C 56 9 64 8 66 14 C 62 17 57 18 54 17 Z" fill="url(#heraGoldGlow)" />
              <path d="M 64 21 C 70 14 78 16 78 22 C 73 24 67 23 64 21 Z" fill="url(#heraGoldGlow)" />
              <path d="M 72 26 C 80 22 86 27 84 33 C 78 32 74 29 72 26 Z" fill="url(#heraGoldGlow)" />
              <path d="M 42 22 C 34 23 33 30 38 32 C 41 29 42 25 42 22 Z" fill="url(#heraGoldGlow)" />
              <path d="M 52 23 C 48 30 53 36 58 33 C 57 28 54 24 52 23 Z" fill="url(#heraGoldGlow)" />
              <path d="M 62 25 C 62 33 70 36 74 31 C 71 27 66 25 62 25 Z" fill="url(#heraGoldGlow)" />

              {/* Goddess Classical Profile Face Outline */}
              <path d="
                M 36 26
                C 34 32 31 38 30 44
                C 29 49 26 53 23 57
                C 22 59 23 60 25 60
                C 28 61 29 62 27 64
                C 24 66 25 68 28 68
                C 25 71 25 73 28 75
                C 31 77 35 77 38 75
                C 44 70 48 60 52 50
              " stroke="url(#heraGoldGlow)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

              {/* Eye & Brow */}
              <path d="M 31 46 C 34 44 38 44 41 46" stroke="url(#heraGoldGlow)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 33 50 C 35 48 39 49 41 52" stroke="url(#heraGoldGlow)" strokeWidth="1.5" strokeLinecap="round" />

              {/* Lips */}
              <path d="M 27 65 C 31 64 35 65 38 67" stroke="url(#heraGoldGlow)" strokeWidth="1.5" strokeLinecap="round" />

              {/* Ear */}
              <path d="M 54 53 C 58 50 62 53 60 59 C 58 64 54 66 52 64" stroke="url(#heraGoldGlow)" strokeWidth="1.8" strokeLinecap="round" />

              {/* Wavy Hair Waves */}
              <path d="M 38 27 C 46 32 55 38 60 48" stroke="url(#heraGoldGlow)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 44 32 C 50 37 58 43 62 52" stroke="url(#heraGoldGlow)" strokeWidth="1.4" strokeLinecap="round" />

              {/* Chignon / Grecian Bun at Back */}
              <path d="M 66 27 C 80 30 90 40 91 52 C 92 64 84 72 73 75 C 67 77 60 75 56 71" stroke="url(#heraGoldGlow)" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M 72 34 C 84 40 86 52 83 62 C 80 70 72 73 66 73" stroke="url(#heraGoldGlow)" strokeWidth="1.6" strokeLinecap="round" />

              {/* Neck & Classical Draped Collar */}
              <path d="M 38 76 C 42 85 48 93 54 99" stroke="url(#heraGoldGlow)" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M 60 74 C 66 84 74 93 84 99" stroke="url(#heraGoldGlow)" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M 46 95 C 58 101 72 101 84 96" stroke="url(#heraGoldGlow)" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          </svg>
        </div>

        {/* Brand Name & Typography */}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-serif font-extrabold text-lg tracking-wider text-[#07152B]">
              HERA
            </span>
            <span className="text-[11px] bg-amber-50 text-amber-900 border border-amber-200/80 px-2 py-0.5 rounded-full font-semibold">
              SaaS ATS
            </span>
          </div>
          {showSubtitle && (
            <p className="text-[10px] uppercase font-medium tracking-wider text-slate-500">
              Human Evaluation &amp; Recruitment AI
            </p>
          )}
        </div>
      </div>
    );
  }

  // Standalone Mark / Icon
  return (
    <div className={`${currentSize} rounded-xl overflow-hidden shadow-sm shrink-0 border border-amber-500/20 bg-[#07152B] flex items-center justify-center relative ${className}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full p-0.5" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="heraGoldMark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="35%" stopColor="#EAB308" />
            <stop offset="70%" stopColor="#CA8A04" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
        </defs>

        <g transform="translate(14, 8) scale(0.72)">
          {/* Laurel Wreath Crown */}
          <path d="M 42 18 C 50 15 62 16 72 24" stroke="url(#heraGoldMark)" strokeWidth="2" strokeLinecap="round" />
          <path d="M 40 18 C 36 12 30 14 32 20 C 37 20 40 19 40 18 Z" fill="url(#heraGoldMark)" />
          <path d="M 46 16 C 45 8 38 6 36 12 C 40 15 44 16 46 16 Z" fill="url(#heraGoldMark)" />
          <path d="M 54 17 C 56 9 64 8 66 14 C 62 17 57 18 54 17 Z" fill="url(#heraGoldMark)" />
          <path d="M 64 21 C 70 14 78 16 78 22 C 73 24 67 23 64 21 Z" fill="url(#heraGoldMark)" />
          <path d="M 72 26 C 80 22 86 27 84 33 C 78 32 74 29 72 26 Z" fill="url(#heraGoldMark)" />
          <path d="M 42 22 C 34 23 33 30 38 32 C 41 29 42 25 42 22 Z" fill="url(#heraGoldMark)" />
          <path d="M 52 23 C 48 30 53 36 58 33 C 57 28 54 24 52 23 Z" fill="url(#heraGoldMark)" />
          <path d="M 62 25 C 62 33 70 36 74 31 C 71 27 66 25 62 25 Z" fill="url(#heraGoldMark)" />

          {/* Classical Profile Face Outline */}
          <path d="
            M 36 26
            C 34 32 31 38 30 44
            C 29 49 26 53 23 57
            C 22 59 23 60 25 60
            C 28 61 29 62 27 64
            C 24 66 25 68 28 68
            C 25 71 25 73 28 75
            C 31 77 35 77 38 75
            C 44 70 48 60 52 50
          " stroke="url(#heraGoldMark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

          {/* Eye & Brow */}
          <path d="M 31 46 C 34 44 38 44 41 46" stroke="url(#heraGoldMark)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 33 50 C 35 48 39 49 41 52" stroke="url(#heraGoldMark)" strokeWidth="1.5" strokeLinecap="round" />

          {/* Lips */}
          <path d="M 27 65 C 31 64 35 65 38 67" stroke="url(#heraGoldMark)" strokeWidth="1.5" strokeLinecap="round" />

          {/* Ear */}
          <path d="M 54 53 C 58 50 62 53 60 59 C 58 64 54 66 52 64" stroke="url(#heraGoldMark)" strokeWidth="1.8" strokeLinecap="round" />

          {/* Wavy Hair Strands */}
          <path d="M 38 27 C 46 32 55 38 60 48" stroke="url(#heraGoldMark)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 44 32 C 50 37 58 43 62 52" stroke="url(#heraGoldMark)" strokeWidth="1.4" strokeLinecap="round" />

          {/* Chignon Bun */}
          <path d="M 66 27 C 80 30 90 40 91 52 C 92 64 84 72 73 75 C 67 77 60 75 56 71" stroke="url(#heraGoldMark)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M 72 34 C 84 40 86 52 83 62 C 80 70 72 73 66 73" stroke="url(#heraGoldMark)" strokeWidth="1.6" strokeLinecap="round" />

          {/* Neck & Classical Draped Collar */}
          <path d="M 38 76 C 42 85 48 93 54 99" stroke="url(#heraGoldMark)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M 60 74 C 66 84 74 93 84 99" stroke="url(#heraGoldMark)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M 46 95 C 58 101 72 101 84 96" stroke="url(#heraGoldMark)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
};
export default HeraLogo;
