'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command, ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setReady(true); }, []);
  return <main className="login-page">
    <header className="login-top"><div className="brand"><span className="brand-mark"><Command size={20} /></span><span>work<span>ai</span></span></div><span className="muted small">Không gian làm việc</span></header>
    <form className="login-form" method="post" onSubmit={async event => {
      event.preventDefault();
      if (!ready || busy) return;
      const form = new FormData(event.currentTarget);
      setBusy(true); setError('');
      try { await api.auth.login({ email: String(form.get('email')).trim(), password: String(form.get('password')) }); router.replace('/chat'); }
      catch (err: any) { setError(err.message || 'Đăng nhập không thành công'); setBusy(false); }
    }}>
      <div className="eyebrow">CHÀO MỪNG TRỞ LẠI</div>
      <h1>Đăng nhập workspace</h1><p>Kết nối với công việc và đội ngũ của bạn.</p>
      <fieldset disabled={!ready || busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field">Email công việc<input type="email" name="email" autoComplete="username" placeholder="ten@congty.vn" required /></label>
        <label className="field">Mật khẩu<input type="password" name="password" autoComplete="current-password" required /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6, minHeight: 42 }} disabled={!ready || busy}>{busy ? 'Đang đăng nhập...' : 'Vào không gian làm việc'}<ArrowRight size={16} /></button>
      </fieldset>
      <noscript>Bạn cần bật JavaScript để đăng nhập.</noscript>
    </form>
    <footer className="login-footer"><LockKeyhole size={13} style={{ display: 'inline', marginRight: 6 }} />WorkAI Workspace</footer>
  </main>;
}
