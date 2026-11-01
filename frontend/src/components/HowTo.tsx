import { useState, useEffect } from 'react';
import { HelpCircle, ChevronDown, AlertCircle } from 'lucide-react';
import { HOWTO } from '../content/howto';

/**
 * 模組操作說明面板。預設收合，展開狀態記在 localStorage，
 * 使用者收合過就不會每次進頁面再跳出來。
 */
export default function HowTo({ module }: { module: string }) {
  const content = HOWTO[module];
  const storageKey = `howto:${module}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) === '1');
    } catch {
      /* 無痕視窗或封鎖 storage 時維持收合 */
    }
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      /* 忽略寫入失敗 */
    }
  }

  if (!content) return null;

  return (
    <div className="mb-5 bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <HelpCircle className="w-4 h-4 text-brand flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-700">操作說明</span>
        <span className="text-xs text-gray-400 truncate hidden sm:block">{content.purpose}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 ml-auto flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-50">
          <p className="text-xs text-gray-500 leading-relaxed mb-3 sm:hidden">{content.purpose}</p>

          <ol className="space-y-2">
            {content.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-5 h-5 rounded-full bg-brand/10 text-brand text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-600 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          {content.notes && content.notes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-50 space-y-1.5">
              {content.notes.map((note, i) => (
                <div key={i} className="flex gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-gray-500 leading-relaxed">{note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
