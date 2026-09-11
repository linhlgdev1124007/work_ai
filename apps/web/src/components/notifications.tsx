'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, LogOut, RefreshCw } from 'lucide-react';
import { api, fetchApi } from '@/lib/api';
import { Empty, IconButton, LoadState, Modal, useRemote } from './workspace';

function applicationKey(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function registrationTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Đăng ký thông báo quá thời gian chờ. Hãy kiểm tra kết nối rồi thử lại.')), 20000); })]); }
  finally { clearTimeout(timer!); }
}

function platformHelp() {
  if (/Windows/.test(navigator.userAgent)) return 'Trên Windows, dùng Edge/Chrome/Firefox hỗ trợ Web Push. Bật quyền thông báo của trang và Settings > System > Notifications cho trình duyệt; kiểm tra Do not disturb và chế độ chạy nền của trình duyệt.';
  if (/Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints < 2) return 'Trên Mac, dùng Safari 16.1 trở lên trên macOS Ventura 13+ hoặc Chrome/Firefox hỗ trợ Web Push. Bật quyền trong Safari > Settings > Websites > Notifications và System Settings > Notifications; kiểm tra chế độ Focus. Không cần thêm web vào Màn hình chính.';
  return 'Trên iPhone/iPad (iOS 16.4+), thêm web vào Màn hình chính rồi mở từ đó. Trên máy tính, kiểm tra quyền thông báo của trang và cài đặt thông báo hệ điều hành.';
}

export function NotificationGate({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [config, setConfig] = useState<{ publicKey: string; required: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = () => window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const register = useCallback(async (key: string) => {
    await registrationTimeout(navigator.serviceWorker.register('/sw.js', { scope: '/' }));
    const registration = await registrationTimeout(navigator.serviceWorker.ready);
    let subscription = await registration.pushManager.getSubscription();
    const owner = localStorage.getItem('work_push_user');
    const previousKey = subscription?.options.applicationServerKey;
    const changedKey = previousKey && Array.from(new Uint8Array(previousKey)).join(',') !== Array.from(applicationKey(key)).join(',');
    if (subscription && ((owner && owner !== userId) || changedKey)) { await subscription.unsubscribe(); subscription = null; }
    if (!subscription) subscription = await registrationTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(key) }));
    try { await fetchApi('/notifications/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) }); }
    catch (e: any) { if (e.status === 409) await subscription.unsubscribe(); throw e; }
    localStorage.setItem('work_push_user', userId);
    setReady(true);
  }, [userId]);
  useEffect(() => {
    let active = true;
    let required = true;
    let loadedConfig: { publicKey: string; required: boolean } | null = null;
    let checking = false;
    let lastCheck = 0;
    setReady(false);
    fetchApi('/notifications/config').then(async response => {
      if (!active) return;
      setConfig(response.data);
      loadedConfig = response.data;
      required = response.data.required;
      if (!response.data.required) { setReady(true); return; }
      if (!supported()) { setError('Web Push cần HTTPS và trình duyệt được hỗ trợ. ' + platformHelp()); return; }
      if (Notification.permission === 'granted') { setBusy(true); try { await register(response.data.publicKey); } finally { if (active) setBusy(false); } }
      else if (Notification.permission === 'denied') setError('Thông báo đang bị chặn. ' + platformHelp());
    }).catch(e => { if (active) { setBusy(false); setError(e.message); } });
    const check = async (event?: Event) => {
      if (!active || !required || !loadedConfig) return;
      if (!supported() || Notification.permission !== 'granted') { setReady(false); setError('Thông báo cần được bật lại. ' + platformHelp()); return; }
      if (checking || (event?.type !== 'online' && Date.now() - lastCheck < 60000)) return;
      checking = true; lastCheck = Date.now();
      try { await register(loadedConfig.publicKey); if (active) setError(''); }
      catch (e: any) { if (active) { setReady(false); setError(e.message || 'Không khôi phục được đăng ký thông báo.'); } }
      finally { checking = false; }
    };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    const timer = setInterval(check, 10000);
    return () => { active = false; window.removeEventListener('focus', check); window.removeEventListener('online', check); clearInterval(timer); };
  }, [register]);
  if (ready) return <>{children}</>;
  return <section style={{ maxWidth: 520, width: 'calc(100% - 32px)', margin: '60px auto' }}><BellRing size={32} color="var(--green)" /><h1 style={{ marginTop: 18 }}>Bật thông báo để tiếp tục</h1><p className="muted" style={{ margin: '14px 0 24px' }}>Nhận tin nhắn, lượt nhắc tên và thời hạn công việc ngay cả khi đóng tab.</p><LoadState error={error} loading={!config && !error} /><div className="header-actions"><button className="btn btn-primary" disabled={busy || !config} onClick={async () => {
    if (!supported()) { setError('Web Push cần HTTPS và trình duyệt được hỗ trợ. ' + platformHelp()); return; }
    setBusy(true); setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Bạn cần cho phép thông báo để sử dụng workspace. Nếu đã chặn, hãy sửa quyền của trang trong trình duyệt.');
      await register(config!.publicKey);
    } catch (e: any) { setError(e.message || 'Không thể đăng ký thông báo. Hãy kiểm tra kết nối rồi thử lại.'); }
    finally { setBusy(false); }
  }}><Bell size={16} />{busy ? 'Đang đăng ký...' : 'Cho phép thông báo'}</button><button className="btn" onClick={() => window.location.reload()}><RefreshCw size={15} />Kiểm tra lại</button><button className="btn btn-ghost" onClick={async () => { await api.auth.logout(); window.location.assign('/login'); }}><LogOut size={15} />Đăng xuất</button></div></section>;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [testBusy, setTestBusy] = useState(false), [testResult, setTestResult] = useState('');
  const remote = useRemote<any[]>(() => fetchApi('/notifications'));
  useEffect(() => { const timer = setInterval(remote.reload, 30000); return () => clearInterval(timer); }, [remote.reload]);
  const unread = remote.data?.filter(item => !item.isRead).length || 0;
  return <><div style={{ position: 'relative' }}><IconButton label="Thông báo" onClick={() => { setOpen(true); void remote.reload(); }}><Bell size={18} /></IconButton>{unread > 0 && <span style={{ position: 'absolute', top: -4, right: -5, background: '#bd4d53', color: 'white', borderRadius: 8, padding: '0 4px', fontSize: 9, pointerEvents: 'none' }}>{unread > 99 ? '99+' : unread}</span>}</div>{open && <Modal title="Thông báo" drawer onClose={() => setOpen(false)}><div className="mb-4"><button className="btn" disabled={testBusy} onClick={async () => { setTestBusy(true); setTestResult(''); try { await fetchApi('/notifications/test', { method: 'POST' }); setTestResult('Đã xếp hàng gửi. Hãy kiểm tra thông báo hệ điều hành trên từng thiết bị; trạng thái này chưa xác nhận thiết bị đã nhận.'); await remote.reload(); } catch (e: any) { setTestResult(e.message); } finally { setTestBusy(false); } }}><BellRing size={16} />Gửi thông báo thử</button>{testResult && <p role="status" className="muted small mt-2">{testResult}</p>}</div><LoadState loading={remote.loading} error={remote.error} retry={remote.reload} />{!remote.loading && !remote.data?.length && !remote.error && <Empty title="Chưa có thông báo" />}{remote.data?.map(item => <a className="activity-item" href={item.href} key={item.id} style={{ opacity: item.isRead ? 0.65 : 1 }} onClick={event => { event.preventDefault(); void fetchApi(`/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => {}).finally(() => window.location.assign(item.href)); }}><Bell size={16} /><span><strong>{item.title}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</p><small>{new Date(item.createdAt).toLocaleString('vi-VN')}</small></span></a>)}</Modal>}</>;
}
