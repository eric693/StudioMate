import { Search, X } from 'lucide-react';

/** 各模組共用的搜尋框 */
export default function SearchBox({
  value, onChange, placeholder = '搜尋', className = '',
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative flex-1 min-w-[10rem] max-w-xs ${className}`}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-xl pl-8 pr-7 py-2 outline-none focus:border-brand bg-white"
      />
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
          aria-label="清除搜尋"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** 不分大小寫，任一欄位包含關鍵字就算符合；空關鍵字一律符合 */
export function matches(keyword: string, ...fields: unknown[]) {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(k));
}
