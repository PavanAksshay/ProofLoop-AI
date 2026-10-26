import React from 'react';
import { ArrowUpRight } from 'lucide-react';

interface ProofLoopHeroProps {
  onStartClick: () => void;
  onBenchmarkClick: () => void;
  activeView: 'operations' | 'benchmark';
}

export const ProofLoopHero: React.FC<ProofLoopHeroProps> = ({
  onStartClick,
  onBenchmarkClick,
  activeView,
}) => {
  return (
    <section className="relative w-full border-b border-[#DFD7C7] bg-[#F7F3EB] overflow-hidden flex flex-col items-center justify-center">
      {/* 12-Column Architectural Grid Overlay from 21st.dev demo - evenly spaced across full viewport */}
      <div className="absolute inset-0 z-0 pointer-events-none w-full h-full">
        <div className="grid w-full h-full grid-cols-6 md:grid-cols-12 divide-x divide-[#DFD7C7]/40">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`h-full ${i >= 6 ? 'hidden md:block' : ''}`} />
          ))}
        </div>
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-16 text-center flex flex-col items-center justify-center">
        {/* Hero Title - Sharp, Architectural, Evenly Spaced */}
        <h1 className="text-center font-bold text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-[#1C1917] tracking-tight leading-tight uppercase max-w-4xl mx-auto mb-4">
          POLICY-GOVERNED INCIDENT RESOLUTION
        </h1>

        {/* Hero Subtitle */}
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm sm:text-base md:text-lg text-[#575044] font-normal leading-relaxed">
          Untrusted AI proposals constrained by deterministic policy gates. Zero unauthorized actions, durable human authorization, and recovery validated through independent synthetic transaction probes.
        </p>

        {/* Signature Interactive Button with Sliding Arrow from 21st.dev demo */}
        <div className="flex items-center justify-center w-full">
          <button
            type="button"
            onClick={activeView === 'operations' ? onStartClick : onBenchmarkClick}
            className="group inline-flex items-center justify-center cursor-pointer border border-[#1C1917] bg-[#1C1917] text-[#FAF6F0] transition-colors hover:bg-[#0E7490] hover:border-[#0E7490]"
          >
            <span className="px-8 py-3.5 text-xs font-mono font-bold tracking-wider uppercase">
              {activeView === 'operations' ? 'LAUNCH SIMULATION' : 'RUN BENCHMARK SUITE'}
            </span>
            <div className="relative flex items-center justify-center overflow-hidden border-l border-stone-700/80 px-4 py-3.5 text-white transition-colors">
              <ArrowUpRight className="h-4 w-4 -translate-x-1/2 transition-all duration-300 ease-in-out group-hover:translate-x-6" />
              <ArrowUpRight className="absolute h-4 w-4 -translate-x-6 transition-all duration-300 ease-in-out group-hover:-translate-x-1/2" />
            </div>
          </button>
        </div>
      </div>
    </section>
  );
};
