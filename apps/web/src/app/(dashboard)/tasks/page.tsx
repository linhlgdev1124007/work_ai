'use client';

import { useEffect, useState } from 'react';
import { Plus, Search, List, Columns3, CheckSquare } from 'lucide-react';
import { api, getSocketUrl } from '@/lib/api';
import { io } from 'socket.io-client';
import { Avatar, Empty, LoadState, Modal, PageHeader, Status, dateLabel, priorityNames, statusNames, useRemote, useWorkspace } from '@/components/workspace';

const statuses = ['TODO', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'COMPLETED', 'PAUSED'];
type Person = { id: string; fullName: string };
type Group = { id: string; name: string; type: string; sourceConversationId: string | null; teamId: string | null; projectId: string | null; canAssign: boolean; members: Person[] };
type TaskOptions = { canAssignPersonal: boolean; personalAssignees: Person[]; groups: Group[] };

export default function TasksPage() {
  const { user, notify } = useWorkspace();
  const remote = useRemote<any[]>(() => api.tasks.getAll());
  const options = useRemote<TaskOptions>(() => api.tasks.getOptions());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [groupId, setGroupId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
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
  async function open(id: string) { try { setSelected((await api.tasks.getById(id)).data); setCreate(false); } catch (e: any) { notify(e.message, true); } }
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.has('new')) setCreate(true); const id = params.get('task'); if (id) void open(id); }, []);

  const group = options.data?.groups.find(item => item.id === groupId);
  const groupedTasks = (remote.data || []).filter(task => !group || (group.sourceConversationId ? task.sourceConversationId === group.sourceConversationId : task.teamId === group.teamId));
  const people = Array.from(new Map<string, Person>([...(group?.members || options.data?.personalAssignees || []), ...groupedTasks.flatMap(task => task.assignee ? [task.assignee as Person] : [])].map(person => [person.id, person])).values()).sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  const tasks = groupedTasks.filter(task => (!status || task.status === status) && (!assigneeId || (assigneeId === 'unassigned' ? !task.assigneeId : task.assigneeId === assigneeId)) && task.title.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  const groupName = (task: any) => options.data?.groups.find(item => item.sourceConversationId && item.sourceConversationId === task.sourceConversationId)?.name || task.project?.name || task.team?.name || 'Công việc cá nhân';
  const canEdit = selected?.canEdit === true;

  return <>
    <PageHeader eyebrow="WORKSPACE / CÔNG VIỆC" title="Công việc"><button className="btn btn-primary" onClick={() => { setSelected(null); setCreate(true); void options.reload(); }}><Plus size={16} />Tạo công việc</button></PageHeader>
    <div className="toolbar task-toolbar">
      <div className="filters">
        <label className="search-field"><Search size={16} /><input aria-label="Tìm công việc" placeholder="Tìm công việc..." value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select className="filter-select" aria-label="Lọc nhóm" value={groupId} onChange={e => { setGroupId(e.target.value); setAssigneeId(''); }}><option value="">Tất cả nhóm</option>{options.data?.groups.map(item => <option key={item.id} value={item.id}>{item.type === 'TEAM' ? 'Team' : 'Nhóm chat'} · {item.name}</option>)}</select>
        <select className="filter-select" aria-label="Lọc người phụ trách" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">Tất cả người phụ trách</option><option value="unassigned">Chưa phân công</option>{people.map(person => <option key={person.id} value={person.id}>{person.fullName}{person.id === user?.id ? ' (Tôi)' : ''}</option>)}</select>
        <select className="filter-select" aria-label="Lọc trạng thái" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tất cả trạng thái</option>{statuses.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select>
      </div>
      <div className="segment"><button title="Danh sách" aria-label="Danh sách" className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={17} /></button><button title="Bảng tiến độ" aria-label="Bảng tiến độ" className={view === 'board' ? 'selected' : ''} onClick={() => setView('board')}><Columns3 size={17} /></button></div>
    </div>
    <LoadState error={options.error} retry={options.reload} />
    <LoadState loading={remote.loading} error={remote.error} retry={remote.reload} />
    {!remote.loading && !remote.error && (tasks.length === 0 ? <Empty title="Không có công việc phù hợp" /> : view === 'list' ? <div className="table-wrap"><table><thead><tr><th>Công việc <span className="count">{tasks.length}</span></th><th>Người phụ trách</th><th>Trạng thái</th><th>Ưu tiên</th><th>Hạn hoàn thành</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id}><td><button className="title-button" onClick={() => open(task.id)}>{task.title}</button><div className="muted">{groupName(task)}</div></td><td><span className="person"><Avatar name={task.assignee?.fullName || '?'} size="tiny" />{task.assignee?.fullName || 'Chưa phân công'}</span></td><td><Status value={task.status} /></td><td><span className={'priority priority-' + task.priority.toLowerCase()}>{priorityNames[task.priority]}</span></td><td className={task.deadline && new Date(task.deadline) < new Date() && task.status !== 'COMPLETED' ? 'overdue' : ''}>{dateLabel(task.deadline)}</td></tr>)}</tbody></table></div> : <div className="board">{statuses.filter(s => tasks.some(task => task.status === s) || ['TODO', 'IN_PROGRESS', 'COMPLETED'].includes(s)).map(s => <section className="board-column" key={s}><div className="board-column-header"><Status value={s} /><span className="count">{tasks.filter(task => task.status === s).length}</span></div>{tasks.filter(task => task.status === s).map(task => <button className="task-card" key={task.id} onClick={() => open(task.id)}><span className={'priority priority-' + task.priority.toLowerCase()}>{priorityNames[task.priority]}</span><h3>{task.title}</h3><div className="task-card-footer"><span>{dateLabel(task.deadline)}</span><Avatar name={task.assignee?.fullName || '?'} size="tiny" /></div></button>)}</section>)}</div>)}
    {(create || selected) && <Modal title={selected ? 'Chi tiết công việc' : 'Tạo công việc'} drawer={!!selected} onClose={() => { if (!busy) { setCreate(false); setSelected(null); setChecklist(''); } }}>
      <TaskEditor key={selected?.id || 'new'} task={selected} options={options.data} loading={options.loading} error={options.error} retry={options.reload} busy={busy} setBusy={setBusy} onSave={async () => { setCreate(false); setSelected(null); await remote.reload(); }} />
      {selected && <section className="section"><h3><CheckSquare size={16} /> Checklist</h3>{(selected.checklistItems || selected.checklist || []).map((item: any) => <label className="check-row" key={item.id}><input type="checkbox" checked={item.isCompleted} disabled={busy || !canEdit} onChange={async e => { setBusy(true); try { await api.tasks.toggleChecklist(item.id, e.target.checked); await open(selected.id); } catch (err: any) { notify(err.message, true); } finally { setBusy(false); } }} />{item.title}</label>)}{canEdit && <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api.tasks.addChecklist(selected.id, checklist); setChecklist(''); await open(selected.id); } catch (err: any) { notify(err.message, true); } finally { setBusy(false); } }}><label className="field">Thêm mục kiểm tra<input value={checklist} onChange={e => setChecklist(e.target.value)} maxLength={500} required /></label><button className="btn btn-small" disabled={busy || !checklist.trim()}><Plus size={14} />Thêm mục</button></form>}</section>}
    </Modal>}
  </>;
}

function TaskEditor({ task, options, loading, error, retry, busy, setBusy, onSave }: { task: any; options: TaskOptions | null; loading: boolean; error: string; retry: () => void; busy: boolean; setBusy: (value: boolean) => void; onSave: () => Promise<void> }) {
  const { user, notify } = useWorkspace();
  const [groupId, setGroupId] = useState('');
  const [assigneeId, setAssigneeId] = useState(user?.id || '');
  const [saveError, setSaveError] = useState('');
  const group = options?.groups.find(item => item.id === groupId);
  const assignees = group ? group.members.filter(person => group.canAssign || person.id === user?.id) : options?.personalAssignees || [];
  const readOnly = !!task && !task.canEdit;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || readOnly || (!task && (!options || loading || error))) return;
    setBusy(true); setSaveError('');
    const form = new FormData(event.currentTarget);
    try {
      const base = { title: String(form.get('title')).trim(), description: String(form.get('description') || '').trim(), priority: String(form.get('priority')) };
      if (task) await api.tasks.update(task.id, { ...base, status: String(form.get('status')), expectedVersion: task.version });
      else {
        if (!assignees.some(person => person.id === assigneeId)) throw new Error('Vui lòng chọn người phụ trách hợp lệ');
        const deadline = String(form.get('deadline') || '');
        await api.tasks.create({ ...base, assigneeId, ...(group ? { teamId: group.teamId, projectId: group.projectId, sourceConversationId: group.sourceConversationId } : {}), deadline: deadline ? new Date(deadline).toISOString() : null, requiresReview: form.get('requiresReview') === 'on' });
      }
      notify(task ? 'Đã cập nhật công việc' : 'Đã tạo và giao công việc');
      await onSave();
    } catch (e: any) { setSaveError(e.message); } finally { setBusy(false); }
  }

  return <form onSubmit={save}>
    {!task && <LoadState loading={loading} error={error} retry={retry} />}
    {readOnly && <p className="muted small">Chỉ xem</p>}
    <label className="field">Tên công việc<input name="title" required maxLength={500} defaultValue={task?.title || ''} readOnly={readOnly} autoFocus /></label>
    <label className="field">Mô tả<textarea name="description" rows={3} maxLength={10000} defaultValue={task?.description || ''} readOnly={readOnly} /></label>
    {!task && <>
      <label className="field">Nhóm phụ trách<select aria-label="Nhóm phụ trách" value={groupId} disabled={loading || busy || !options} onChange={e => { setGroupId(e.target.value); const members = options?.groups.find(item => item.id === e.target.value)?.members || options?.personalAssignees || []; setAssigneeId(members.some(person => person.id === user?.id) ? user.id : ''); }}><option value="">Công việc cá nhân</option>{options?.groups.filter(item => item.canAssign).map(item => <option key={item.id} value={item.id}>{item.type === 'TEAM' ? 'Team' : 'Nhóm chat'} · {item.name}</option>)}</select></label>
      <label className="field">Người phụ trách<select aria-label="Người phụ trách" required value={assigneeId} disabled={loading || busy || !options} onChange={e => setAssigneeId(e.target.value)}><option value="" disabled>Chọn thành viên</option>{assignees.map(person => <option key={person.id} value={person.id}>{person.fullName}{person.id === user?.id ? ' (Tôi)' : ''}</option>)}</select></label>
      <label className="field">Hạn hoàn thành<input name="deadline" type="datetime-local" /></label>
    </>}
    <div className="form-row"><label className="field">Ưu tiên<select name="priority" disabled={readOnly} defaultValue={task?.priority || 'NORMAL'}>{Object.entries(priorityNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>{task && <label className="field">Trạng thái<select name="status" disabled={readOnly} defaultValue={task.status}>{statuses.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label>}</div>
    {!task && <label className="check-row"><input type="checkbox" name="requiresReview" />Cần duyệt hoàn thành</label>}
    {task && <><div className="mini-stat"><span>Người phụ trách</span><strong>{task.assignee?.fullName || 'Chưa phân công'}</strong></div><div className="mini-stat"><span>Hạn hoàn thành</span><strong>{dateLabel(task.deadline, true)}</strong></div></>}
    {saveError && <p role="alert" className="inline-error">{saveError}</p>}
    {!readOnly && <div className="form-footer"><button className="btn btn-primary" disabled={busy || (!task && (loading || !!error || !options))}>{busy ? 'Đang lưu...' : 'Lưu công việc'}</button></div>}
  </form>;
}
