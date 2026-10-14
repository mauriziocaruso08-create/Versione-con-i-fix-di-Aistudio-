import React, { useEffect, useRef } from 'react';
import { AssistantState } from '../types';
import { Mic, Sparkles } from 'lucide-react';

interface MaiaNeuralCoreProps {
  state: AssistantState;
  onCoreClick?: () => void;
  isCompact?: boolean;
}

export const MaiaNeuralCore: React.FC<MaiaNeuralCoreProps> = ({ state, onCoreClick }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0;
    let angle = 0;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2, cy = canvas.height / 2;
      angle += 0.02;
      let core = 'rgba(99,102,241,0.82)', ring = 'rgba(168,85,247,0.42)', speed = 2, particles = 12;
      if (state === 'listening') { core = 'rgba(16,185,129,0.9)'; ring = 'rgba(52,211,153,0.5)'; speed = 4; particles = 16; }
      else if (state === 'thinking') { core = 'rgba(139,92,246,0.95)'; ring = 'rgba(236,72,153,0.6)'; speed = 6; particles = 20; }
      else if (state === 'speaking') { core = 'rgba(14,165,233,0.9)'; ring = 'rgba(56,189,248,0.5)'; speed = 3.5; particles = 18; }
      const pulse = Math.sin(angle * speed) * 6;
      const radius = 38 + pulse;
      const glow = ctx.createRadialGradient(cx, cy, radius * .4, cx, cy, radius * 2.2);
      glow.addColorStop(0, core); glow.addColorStop(.5, ring); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, radius * 2.2, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const rr = radius + (i + 1) * 14 + Math.sin(angle * 1.5 + i) * 3;
        ctx.strokeStyle = ring; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * .75, angle * .4 * (i % 2 ? -1 : 1) + i * Math.PI / 3, 0, Math.PI * 2); ctx.stroke();
      }
      for (let p = 0; p < particles; p++) {
        const theta = p / particles * Math.PI * 2 + angle * (state === 'thinking' ? 1.5 : .8);
        const dist = radius + 18 + Math.cos(angle * 2 + p) * 12;
        const px = cx + Math.cos(theta) * dist, py = cy + Math.sin(theta) * dist * .85;
        ctx.strokeStyle = ring; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      const inner = ctx.createRadialGradient(cx - radius*.3, cy - radius*.3, 2, cx, cy, radius);
      inner.addColorStop(0, '#fff'); inner.addColorStop(.4, core); inner.addColorStop(1, 'rgba(15,23,42,.95)');
      ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const label = state === 'listening' ? 'In ascolto vocale... parla adesso' : state === 'thinking' ? 'Elaborazione sinapsi cognitive...' : state === 'speaking' ? 'Sintesi neurale in corso...' : 'Pronta ad assisterti. Tocca il core o scrivi un messaggio.';
  return (
    <div className="flex flex-col items-center justify-center p-3 relative select-none">
      <div onClick={onCoreClick} title="Attiva microfono / comandi vocali" className="relative cursor-pointer group transition-transform duration-300 hover:scale-105 active:scale-95">
        <canvas ref={canvasRef} width={220} height={180} className="w-[200px] h-[160px] drop-shadow-[0_0_25px_rgba(99,102,241,0.35)]" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {state === 'listening' ? <div className="w-9 h-9 rounded-full bg-emerald-500/30 backdrop-blur-md border border-emerald-400/50 flex items-center justify-center text-emerald-200 animate-pulse"><Mic className="w-4 h-4" /></div> : <div className="w-8 h-8 rounded-full bg-slate-900/60 backdrop-blur-sm border border-indigo-400/30 flex items-center justify-center text-indigo-300"><Sparkles className="w-3.5 h-3.5" /></div>}
        </div>
      </div>
      <div className="text-center mt-1">
        <h2 className="text-sm font-bold text-slate-100 tracking-wider flex items-center justify-center gap-1.5 font-mono">MAIA <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">V7 NEURAL</span></h2>
        <p className="text-[11px] text-slate-400 font-sans">{label}</p>
      </div>
    </div>
  );
};
