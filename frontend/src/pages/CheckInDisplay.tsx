import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, RefreshCw, Printer } from 'lucide-react';
import api from '../api/client';

/** 櫃檯平板或印出來貼在門口：會員用手機相機掃描後，在會員網頁完成簽到 */
export default function CheckInDisplay() {
  const [info, setInfo] = useState<{ enabled: boolean; token: string; name: string; beforeMin: number } | null>(null);
  const [svg, setSvg] = useState('');
  const load = () => api.get('/studio/checkin').then((r) => setInfo(r.data));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!info) return;
    QRCode.toString(`${location.origin}/m?checkin=${info.token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1f2937', light: '#ffffff' } }).then(setSvg);
  }, [info]);
  async function rotate() {
    if (!confirm('重新產生 QR code？舊的 QR code（包含已印出的）會立即失效。')) return;
    await api.post('/studio/checkin/rotate'); load();
  }
  if (!info) return <div className="p-6 text-gray-400">載入中…</div>;
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="print:hidden fixed top-4 left-4 right-4 flex justify-between">
        <Link to="/schedule" className="btn-secondary flex items-center gap-1 text-sm"><ArrowLeft className="w-4 h-4" />返回</Link>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-1 text-sm" onClick={() => window.print()}><Printer className="w-4 h-4" />列印</button>
          <button className="btn-secondary flex items-center gap-1 text-sm" onClick={rotate}><RefreshCw className="w-4 h-4" />重新產生</button>
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-800">{info.name}</div>
      <div className="text-lg text-gray-500 mt-1">上課簽到</div>
      {!info.enabled && <div className="mt-4 text-sm bg-amber-50 text-amber-700 rounded-xl px-3 py-2">目前未開放自助簽到，請到「教室設定」開啟</div>}
      <div className="w-72 h-72 sm:w-96 sm:h-96 my-6" dangerouslySetInnerHTML={{ __html: svg }} aria-label="簽到 QR code" role="img" />
      <div className="text-gray-600">用手機相機掃描，登入會員後即完成簽到</div>
      <div className="text-sm text-gray-400 mt-1">開課前 {info.beforeMin} 分鐘開放簽到</div>
    </div>
  );
}
