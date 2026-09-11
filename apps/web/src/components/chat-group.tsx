'use client';
import { useState } from 'react';
import { api, fetchApi } from '@/lib/api';
import { Modal, LoadState, useRemote, Status, Empty } from './workspace';

export function ChatGroup({ room, user, onClose, refresh }: { room: any; user: any; onClose: () => void; refresh: () => Promise<void> }) {
  const remote = useRemote<any>(() => fetchApi(`/chat/conversations/${room.id}/tasks`), [room.id]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [lead, setLead] = useState(room.members.find((m: any) => m.role === 'LEAD')?.id || '');
  const [group, setGroup] = useState('status');
  const [creating, setCreating] = useState(false), [title, setTitle] = useState(''), [assigneeId, setAssigneeId] = useState(''), [taskSaved, setTaskSaved] = useState('');
  const canAssign = user?.systemRole === 'ADMIN' || room.members.some((m: any) => m.id === user?.id && m.role === 'LEAD');
  const tasks: any[] = remote.data?.tasks || [];
  const groups = Array.from(new Set(tasks.map(t => group === 'status' ? t.status : t.assignee?.fullName || 'Chưa phân công')));
  return <Modal title={room.name} drawer onClose={onClose}><LoadState loading={remote.loading} error={error || remote.error} retry={remote.reload} />
    <h3>Lead nhóm chat</h3>
    {user?.systemRole === 'ADMIN' && room.type !== 'DIRECT' ? <div className="mt-3 mb-4"><select aria-label="Lead nhóm chat" className="filter-select room-select" value={lead} onChange={e => { setLead(e.target.value); setSaved(false); }}><option value="">Chưa chỉ định</option>{room.members.map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select><button className="btn btn-primary mt-2" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await fetchApi(`/chat/conversations/${room.id}/lead`, { method: 'PATCH', body: JSON.stringify({ userId: lead || null }) }); setSaved(true); await refresh(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Lưu lead</button>{saved && <p role="status" className="mt-2 text-emerald-700">Đã cập nhật lead nhóm chat</p>}</div> : <p className="mt-2 mb-4">{room.members.find((m: any) => m.role === 'LEAD')?.fullName || 'Chưa chỉ định'}</p>}
    <h3>Công việc trong nhóm · {remote.data?.total || 0}</h3><div className="flex flex-wrap gap-2 my-3">{remote.data?.counts.map((c: any) => <span key={c.status}><Status value={c.status} /> <strong>{c._count}</strong></span>)}</div>
    {canAssign && <button className="btn mb-3" onClick={() => { setCreating(v => !v); setTaskSaved(''); }}>{creating ? 'Đóng tạo việc' : 'Phân công mới'}</button>}
    {creating && <form className="py-3 border-t mb-3" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); setTaskSaved(''); try { const res = await api.tasks.create({ title, assigneeId: assigneeId || null, sourceConversationId: room.id }); setTaskSaved(res.data.title); setTitle(''); setCreating(false); await remote.reload(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}><label className="block mb-2">Công việc<input className="form-input w-full" required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label><label className="block mb-2">Người phụ trách<select className="filter-select room-select" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">Chưa phân công</option>{room.members.map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select></label><button className="btn btn-primary" disabled={busy || !title.trim()}>Xác nhận tạo việc</button></form>}
    {taskSaved && <p role="status" className="text-emerald-700 mb-3">Đã tạo công việc: {taskSaved}</p>}
    <select aria-label="Gom nhóm công việc" className="filter-select mb-3" value={group} onChange={e => setGroup(e.target.value)}><option value="status">Theo trạng thái</option><option value="assignee">Theo người làm</option></select>
    {groups.map(key => <section className="py-3 border-t" key={key}><h4>{group === 'status' ? <Status value={key} /> : key}</h4>{tasks.filter(t => (group === 'status' ? t.status : t.assignee?.fullName || 'Chưa phân công') === key).map(t => <a className="activity-item" key={t.id} href={`/tasks?task=${encodeURIComponent(t.id)}`}><span><strong>{t.title}</strong><p className="muted small">{t.assignee?.fullName || 'Chưa phân công'}{t.deadline ? ` · ${new Date(t.deadline).toLocaleDateString('vi-VN')}` : ''}</p></span></a>)}</section>)}
    {!remote.loading && !tasks.length && <Empty title="Chưa có công việc trong nhóm" />}{remote.data?.total > tasks.length && <p className="muted">Đang hiển thị {tasks.length}/{remote.data.total} công việc.</p>}
  </Modal>;
}
