'use client';

import { useEffect, useState } from 'react';
import { Plus, Search, List, Columns3, CheckSquare } from 'lucide-react';
import { api, getSocketUrl } from '@/lib/api';
import { io } from 'socket.io-client';
import { Avatar, Empty, LoadState, Modal, PageHeader, Status, dateLabel, priorityNames, statusNames, useRemote, useWorkspace } from '@/components/workspace';

const statuses = ['TODO', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'COMPLETED', 'PAUSED'];
export default function TasksPage() {
  const { notify } = useWorkspace();
  const remote = useRemote<any[]>(() => api.tasks.getAll());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState('list');
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState('');
  useEffect(() => {
    const socket = io(getSocketUrl(), { withCredentials: true, auth: { token: localStorage.getItem('work_session_token') }, transports: ['websocket', 'polling'] });
    socket.on('task.created', remote.reload);
    socket.on('task.updated', remote.reload);
    return () => { socket.disconnect(); };
  }, [remote.reload]);
  async function open(id: string) { try { setSelected((await api.tasks.getById(id)).data); } catch (e: any) { notify(e.message, true); } }
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.has('new')) setCreate(true); const id = params.get('task'); if (id) void open(id); }, []);
  const tasks = (remote.data || []).filter(t => (!status || t.status === status) && t.title.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    const dto = { title: String(form.get('title')).trim(), priority: String(form.get('priority')), ...(selected ? { status: String(form.get('status')), expectedVersion: selected.version } : {}) };
    try { if (selected) { await api.tasks.update(selected.id, dto); setSelected(null); } else { await api.tasks.create(dto); setCreate(false); } notify('Đã lưu công việc'); await remote.reload(); } catch (e: any) { notify(e.message, true); } finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow="WORKSPACE / CÔNG VIỆC" title="Công việc" subtitle="Theo dõi tiến độ và những ưu tiên của đội ngũ."><button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={16} />Tạo công việc</button></PageHeader>
    <div className="toolbar"><div className="filters"><label className="search-field"><Search size={16} /><input aria-label="Tìm công việc" placeholder="Tìm công việc..." value={search} onChange={e => setSearch(e.target.value)} /></label><select className="filter-select" aria-label="Lọc trạng thái" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả trạng thái</option>{statuses.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></div><div className="segment"><button title="Danh sách" aria-label="Danh sách" className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={17} /></button><button title="Bảng tiến độ" aria-label="Bảng tiến độ" className={view === 'board' ? 'selected' : ''} onClick={() => setView('board')}><Columns3 size={17} /></button></div></div>
    <LoadState loading={remote.loading} error={remote.error} retry={remote.reload} />
    {!remote.loading && !remote.error && (tasks.length === 0 ? <Empty title="Không có công việc phù hợp" /> : view === 'list' ? <div className="table-wrap"><table><thead><tr><th>Công việc <span className="count">{tasks.length}</span></th><th>Người phụ trách</th><th>Trạng thái</th><th>Ưu tiên</th><th>Hạn hoàn thành</th></tr></thead><tbody>{tasks.map(t => <tr key={t.id}><td><button className="title-button" onClick={() => open(t.id)}>{t.title}</button><div className="muted">{t.project?.name || t.team?.name || 'Công việc cá nhân'}</div></td><td><span className="person"><Avatar name={t.assignee?.fullName || '?'} size="tiny" />{t.assignee?.fullName || 'Chưa phân công'}</span></td><td><Status value={t.status} /></td><td><span className={'priority priority-' + t.priority.toLowerCase()}>{priorityNames[t.priority]}</span></td><td className={t.deadline && new Date(t.deadline) < new Date() && t.status !== 'COMPLETED' ? 'overdue' : ''}>{dateLabel(t.deadline)}</td></tr>)}</tbody></table></div> : <div className="board">{statuses.filter(s => tasks.some(t => t.status === s) || ['TODO','IN_PROGRESS','COMPLETED'].includes(s)).map(s => <section className="board-column" key={s}><div className="board-column-header"><Status value={s} /><span className="count">{tasks.filter(t => t.status === s).length}</span></div>{tasks.filter(t => t.status === s).map(t => <button className="task-card" key={t.id} onClick={() => open(t.id)}><span className={'priority priority-' + t.priority.toLowerCase()}>{priorityNames[t.priority]}</span><h3>{t.title}</h3><div className="task-card-footer"><span>{dateLabel(t.deadline)}</span><Avatar name={t.assignee?.fullName || '?'} size="tiny" /></div></button>)}</section>)}</div>)}
    {(create || selected) && <Modal title={selected ? 'Chi tiết công việc' : 'Tạo công việc'} drawer={!!selected} onClose={() => { if (!busy) { setCreate(false); setSelected(null); } }}><form onSubmit={save}><label className="field">Tên công việc<input name="title" required maxLength={500} defaultValue={selected?.title || ''} autoFocus /></label><div className="form-row"><label className="field">Ưu tiên<select name="priority" defaultValue={selected?.priority || 'NORMAL'}>{Object.entries(priorityNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>{selected && <label className="field">Trạng thái<select name="status" defaultValue={selected.status}>{statuses.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label>}</div>{selected && <><p className="muted">{selected.description || 'Chưa có mô tả'}</p><div className="mini-stat"><span>Người phụ trách</span><strong>{selected.assignee?.fullName || 'Chưa phân công'}</strong></div><div className="mini-stat"><span>Hạn hoàn thành</span><strong>{dateLabel(selected.deadline, true)}</strong></div></>}<div className="form-footer"><button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu công việc'}</button></div></form>{selected && <section className="section"><h3><CheckSquare size={16} /> Checklist</h3>{(selected.checklistItems || selected.checklist || []).map((item: any) => <label className="check-row" key={item.id}><input type="checkbox" checked={item.isCompleted} disabled={busy} onChange={async e => { setBusy(true); try { await api.tasks.toggleChecklist(item.id, e.target.checked); await open(selected.id); } catch (err: any) { notify(err.message, true); } finally { setBusy(false); } }} />{item.title}</label>)}<form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api.tasks.addChecklist(selected.id, checklist); setChecklist(''); await open(selected.id); } catch (err: any) { notify(err.message, true); } finally { setBusy(false); } }}><label className="field">Thêm mục kiểm tra<input value={checklist} onChange={e => setChecklist(e.target.value)} maxLength={500} required /></label><button className="btn btn-small" disabled={busy || !checklist.trim()}><Plus size={14} />Thêm mục</button></form></section>}</Modal>}
  </>;
}
