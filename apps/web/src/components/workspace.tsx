'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Circle, Clock3, Inbox, Loader2, X } from 'lucide-react';

export const WorkspaceContext = createContext<{ user: any; notify: (message: string, error?: boolean) => void; refreshAttendance: () => void }>({ user: null, notify: () => {}, refreshAttendance: () => {} });
export const useWorkspace = () => useContext(WorkspaceContext);

export function useRemote<T = any>(loader: () => Promise<{ data: T }>, deps: React.DependencyList = []) {
  const latest = useRef(loader); latest.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError('');
    try { const result = await latest.current(); if (id === generation.current) setData(result.data); }
    catch (error: any) { if (id === generation.current) setError(error.message); }
    finally { if (id === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload, ...deps]);
  return { data, setData, loading, error, reload };
}

export const statusNames: Record<string, string> = { TODO: 'Chưa bắt đầu', IN_PROGRESS: 'Đang thực hiện', WAITING: 'Đang chờ', REVIEW: 'Chờ duyệt', COMPLETED: 'Hoàn thành', PAUSED: 'Tạm dừng', OPEN: 'Trong ca', CLOSED: 'Đã kết thúc', ACTIVE: 'Hoạt động', SUSPENDED: 'Tạm khóa', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' };
export const priorityNames: Record<string, string> = { LOW: 'Thấp', NORMAL: 'Bình thường', HIGH: 'Cao', URGENT: 'Khẩn cấp' };
export function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}><span className="status-dot" />{statusNames[value] || value}</span>; }
export function Avatar({ name = '?', size = '', index = 0 }: { name?: string; size?: string; index?: number }) { return <span title={name} className={`avatar avatar-${index % 5} ${size}`}>{name.trim().split(/\s+/).slice(-2).map(n => n[0]).join('').toUpperCase()}</span>; }
export const dateLabel = (value?: string | null, time = false) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value)) : 'Chưa đặt hạn';

export function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) { return <button type="button" {...props} className={`icon-button ${props.className || ''}`} aria-label={label} title={label}>{children}</button>; }
export function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: string; children?: React.ReactNode }) { return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions">{children}</div></header>; }
export function Empty({ title = 'Chưa có dữ liệu', detail, children }: { title?: string; detail?: string; children?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Inbox size={23} /></span><h3>{title}</h3>{detail && <p>{detail}</p>}{children}</div>; }
export function LoadState({ loading, error, retry }: { loading?: boolean; error?: string; retry?: () => void }) { if (error) return <div role="alert" className="inline-error"><AlertCircle size={18} /><span>{error}</span>{retry && <button className="btn btn-small" onClick={retry}>Thử lại</button>}</div>; if (loading) return <div className="loading-state" role="status"><Loader2 className="spin" size={20} /><span>Đang tải dữ liệu...</span></div>; return null; }
export function Modal({ title, children, onClose, drawer = false }: { title: string; children: React.ReactNode; onClose: () => void; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`modal ${drawer ? 'drawer' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) { const box = ref.current!.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }} aria-label={title}><div className="modal-header"><h2>{title}</h2><IconButton label="Đóng" onClick={onClose}><X size={18} /></IconButton></div><div className="modal-body">{children}</div></dialog>;
}
export function Metric({ label, value, detail, icon, tone = '' }: { label: string; value: React.ReactNode; detail?: string; icon?: React.ReactNode; tone?: string }) { return <div className={`metric ${tone}`}><div className="metric-label">{label}{icon}</div><div className="metric-value">{value}</div>{detail && <div className="metric-detail">{detail}</div>}</div>; }
export function CompletionButton({ completed, onClick, disabled }: { completed?: boolean; onClick: () => void; disabled?: boolean }) { return <IconButton label={completed ? 'Mở lại công việc' : 'Hoàn thành công việc'} onClick={onClick} disabled={disabled} className={completed ? 'is-complete' : ''}>{completed ? <Check size={17} /> : <Circle size={17} />}</IconButton>; }
