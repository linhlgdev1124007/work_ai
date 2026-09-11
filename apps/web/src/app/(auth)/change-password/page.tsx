'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
    <form method="post" className="w-full max-w-sm space-y-5" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (form.get('newPassword') !== form.get('confirmation')) { setError('Mật khẩu xác nhận không khớp.'); return; }
      setBusy(true); setError('');
      try {
        await fetchApi('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') }) });
        localStorage.removeItem('work_session_token');
        router.replace('/login');
      } catch (error: any) { setError(error.message); } finally { setBusy(false); }
    }}>
      <h1 className="text-xl font-semibold">Đổi mật khẩu</h1>
      <p>Đặt mật khẩu riêng để tiếp tục sử dụng tài khoản.</p>
      <label className="block">Mật khẩu hiện tại<input name="currentPassword" type="password" autoComplete="current-password" required className="mt-2 border rounded p-3 w-full" /></label>
      <label className="block">Mật khẩu mới<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required className="mt-2 border rounded p-3 w-full" /></label>
      <label className="block">Xác nhận mật khẩu<input name="confirmation" type="password" autoComplete="new-password" required className="mt-2 border rounded p-3 w-full" /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button disabled={busy || !ready} className="w-full bg-emerald-700 text-white rounded p-3 disabled:opacity-50">{busy ? 'Đang lưu...' : 'Lưu mật khẩu'}</button>
    </form>
  </main>;
}
