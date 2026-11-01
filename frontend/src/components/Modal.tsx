import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

/** 共用對話框：手機從底部滑出、桌機置中；按 Esc 或背景可關閉 */
export default function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={`bg-white w-full ${wide ? 'md:max-w-2xl' : 'md:max-w-md'} rounded-t-2xl md:rounded-2xl max-h-[90dvh] flex flex-col shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100" aria-label="關閉"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-safe">{children}</div>
      </div>
    </div>
  );
}

/** 表單欄位外框：標籤＋說明 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}
