'use client';
import { useState } from 'react';
import { Search, RefreshCw, Users, Clock3, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { Avatar, Empty, LoadState, PageHeader, Metric, dateLabel, useRemote, Modal, IconButton } from '@/components/workspace';

function UserNotesModal({ user, onClose }: { user: any, onClose: () => void }) {
  const remote = useRemote<any[]>(() => api.users.getNotes(user.userId), [user.userId]);
  return (
    <Modal title={`Ghi chú: ${user.fullName}`} onClose={onClose} drawer>
      <LoadState loading={remote.loading} error={remote.error} retry={remote.reload} />
      {remote.data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {remote.data.length === 0 && <Empty title="Chưa có ghi chú nào" />}
          {remote.data.map(note => (
            <div key={note.id} style={{ padding: '12px', border: '1px solid var(--line)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Avatar name={note.creator?.fullName || 'Người dùng'} size="small" />
                <strong style={{ fontSize: '13px' }}>{note.creator?.fullName}</strong>
                <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: 'auto' }}>
                  {new Date(note.createdAt).toLocaleString('vi-VN')}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap' }}>{note.content}</p>
              {note.sourceMessage && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--line)', fontSize: '12px', color: 'var(--muted)' }}>
                  <em>"{note.sourceMessage.content}"</em>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function TeamPage() {
 const remote = useRemote<any[]>(() => api.currentWork.getWhoIsDoingWhat());
 const [search, setSearch] = useState('');
 const [selectedUser, setSelectedUser] = useState<any>(null);
 const members = (remote.data || []).filter(m => m.fullName.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeader eyebrow="WORKSPACE / CON NGƯỜI" title="Đội nhóm" subtitle="Nắm bắt tình hình nhân sự và khối lượng công việc."><button className="btn" onClick={remote.reload} disabled={remote.loading}><RefreshCw size={15} />Làm mới</button></PageHeader><LoadState loading={remote.loading} error={remote.error} retry={remote.reload} />{remote.data && <><div className="metrics"><Metric label="Thành viên" value={remote.data.length} icon={<Users size={17} />} /><Metric label="Đang trong ca" value={remote.data.filter(m => m.isCheckedIn).length} tone="positive" /><Metric label="Đang cập nhật công việc" value={remote.data.filter(m => m.currentWork?.statusText).length} icon={<Clock3 size={17} />} /><Metric label="Có công việc quá hạn" value={remote.data.filter(m => m.overdueTasksCount > 0).length} tone="danger" /></div><div className="toolbar"><label className="search-field"><Search size={16} /><input aria-label="Tìm thành viên" placeholder="Tìm thành viên..." value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="team-grid">{members.map((m,i) => <article className="member-card" key={m.userId}><div className="member-head"><Avatar name={m.fullName} size="large" index={i} /><div><h3>{m.fullName}</h3><p className="muted">{m.email}</p></div><IconButton label="Xem ghi chú" style={{ marginLeft: 'auto' }} onClick={() => setSelectedUser(m)}><MessageSquare size={16} /></IconButton></div><span className={'status ' + (m.isCheckedIn ? 'status-active' : 'status-paused')}><span className="status-dot" />{m.isCheckedIn ? 'Đang trong ca' : 'Ngoài ca'}</span><div className="member-work"><div className="eyebrow">CÔNG VIỆC HIỆN TẠI</div><p>{m.currentWork?.statusText || 'Chưa cập nhật'}</p></div><div className="member-footer"><span><strong>{m.remainingTasksCount}</strong> việc còn lại</span><span className={m.overdueTasksCount ? 'overdue' : 'muted'}>{m.overdueTasksCount} quá hạn</span></div><div className="mini-stat"><span>Hạn gần nhất</span><span>{dateLabel(m.nearestDeadline)}</span></div></article>)}</div>{!members.length && <Empty title="Không tìm thấy thành viên" />}</>}
 {selectedUser && <UserNotesModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
 </>;
}
