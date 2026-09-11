'use client';
import { useState } from 'react';
import { Bot, Check, RotateCcw, X } from 'lucide-react';
import { api } from '@/lib/api';

const statuses: Record<string, string> = { TODO: 'Chưa làm', IN_PROGRESS: 'Đang làm', WAITING: 'Đang chờ', REVIEW: 'Chờ duyệt', COMPLETED: 'Hoàn thành', PAUSED: 'Tạm dừng' };
export function ChatAction({ action, reload }: { action: any; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  let payload: any = {};
  try { payload = JSON.parse(action.patchPayload); } catch {}
  const [title, setTitle] = useState(payload.title || '');
  const pending = action.status === 'PENDING_CONFIRMATION';
  const expired = action.expiresAt && new Date(action.expiresAt) < new Date();
  const run = async (fn: () => Promise<any>) => { setBusy(true); setError(''); try { await fn(); await reload(); } catch (e: any) { setError(e.message); if (e.status === 409) await reload().catch(() => {}); } finally { setBusy(false); } };
  return <section className="chat-action" aria-label="Xác nhận thao tác"><strong className="flex gap-2 items-center"><Bot size={16} />B6 <span className="ml-auto muted small">{pending ? expired ? 'Hết hạn' : 'Chờ xác nhận' : action.status === 'CANCELLED' ? 'Đã bỏ qua' : action.status === 'UNDONE' ? 'Đã hoàn tác' : 'Đã xác nhận'}</span></strong>
    <p className="mt-2">{action.intent === 'CREATE_TASK' ? 'Tạo công việc' : action.intent === 'SET_CURRENT_WORK' ? 'Cập nhật đang làm' : 'Cập nhật công việc'}: <strong>{payload.target_title || payload.title || payload.current_work_text}</strong></p>
    {payload.assignee_name && <p>Người nhận: {payload.assignee_name}</p>}{payload.status && <p>Trạng thái mới: {statuses[payload.status] || payload.status}</p>}{payload.deadline_iso && <p>Hạn mới: {new Date(payload.deadline_iso).toLocaleString('vi-VN')}</p>}
    {pending && !expired && <>
      {action.intent === 'CREATE_TASK' && <input className="form-input mt-2 w-full" aria-label="Tên công việc đề xuất" maxLength={500} value={title} onChange={e => setTitle(e.target.value)} />}
      {!!payload.duplicates?.length && <div className="mt-3"><strong>Có thể trùng công việc đã nhận</strong>{payload.duplicates.map((task: any) => <div className="py-2 border-b" key={task.id}><a href={`/tasks?task=${encodeURIComponent(task.id)}`}>{task.title}</a><p className="muted small">{statuses[task.status] || task.status}</p><button className="btn mt-2" disabled={busy || !title.trim()} onClick={() => run(() => api.ai.confirmAction(action.id, { mode: 'update', taskId: task.id, expectedVersion: task.version, title }))}><Check size={14} />Cập nhật việc này</button></div>)}</div>}
      <div className="header-actions mt-3"><button className="btn btn-primary" disabled={busy || (action.intent === 'CREATE_TASK' && !title.trim())} onClick={() => run(() => api.ai.confirmAction(action.id, action.intent === 'CREATE_TASK' ? { mode: 'create', title } : undefined))}><Check size={15} />{payload.duplicates?.length ? 'Tạo việc riêng' : 'Xác nhận'}</button><button className="btn" disabled={busy} onClick={() => run(() => api.ai.cancelAction(action.id))}><X size={15} />Bỏ qua</button></div>
    </>}
    {action.status === 'CONFIRMED' && <p className="mt-2 text-emerald-700"><Check size={14} className="inline" /> Đã lưu thay đổi{action.targetEntityId && action.targetEntityType === 'TASK' && <> · <a href={`/tasks?task=${encodeURIComponent(action.targetEntityId)}`}>Xem công việc</a></>}</p>}
    {action.status === 'CONFIRMED' && action.intent === 'CREATE_TASK' && payload.resolution !== 'update' && <button className="btn btn-ghost mt-2" disabled={busy} onClick={() => run(() => api.ai.undoAction(action.id))}><RotateCcw size={14} />Hoàn tác tạo việc</button>}
    {error && <p role="alert" className="text-red-700 mt-2">{error}</p>}
  </section>;
}
