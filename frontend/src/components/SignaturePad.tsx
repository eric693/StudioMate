import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

/** 手寫簽名板：手指或滑鼠簽名，輸出 PNG data URL（空白時回傳 null） */
export default function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    // 依實際顯示大小與螢幕密度設定畫布，線條才不會模糊
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio; c.height = rect.height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
  }, []);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: React.PointerEvent) {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    strokes.current++;
    setEmpty(false);
    onChange(ref.current!.toDataURL('image/png'));
  }
  function clear() {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    strokes.current = 0; setEmpty(true); onChange(null);
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={ref}
          className="w-full h-40 rounded-xl border-2 border-dashed border-gray-300 bg-white touch-none"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
          aria-label="簽名區"
        />
        {empty && <span className="absolute inset-0 flex items-center justify-center text-sm text-gray-300 pointer-events-none">請在此簽名</span>}
      </div>
      <button type="button" className="mt-1 text-xs text-gray-500 flex items-center gap-1" onClick={clear}><Eraser className="w-3.5 h-3.5" />清除重簽</button>
    </div>
  );
}
