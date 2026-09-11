'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, ArrowUpRight, Sparkles, Database, Clock3, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadState, useWorkspace } from '@/components/workspace';

export default function AssistantPage() {
  const { user } = useWorkspace();
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search).get('q'); if (q) setQuestion(q); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [entries, busy]);
  async function ask(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true); setError('');
    try { const result = await api.ai.query(value.trim()); setEntries(prev => [...prev, { question: value.trim(), ...result.data }]); setQuestion(''); }
    catch (err: any) { setError(err.message); setQuestion(value); } finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow="WORKSPACE / INTELLIGENCE" title="Trợ lý AI" subtitle="Nắm bắt công việc. Ra quyết định có cơ sở."><button className="btn" disabled={busy || !entries.length} onClick={() => { setEntries([]); setError(''); }}><Plus size={16} />Cuộc hỏi đáp mới</button></PageHeader>
    <div className="assistant-layout"><section className="assistant-main">{!entries.length && <div className="assistant-welcome"><div className="assistant-emblem"><Sparkles size={26} /></div><h2>Hôm nay bạn cần nắm điều gì?</h2><p className="muted">Công việc, tiến độ và những trao đổi của đội ngũ.</p><div className="suggestions">{['Thống kê công việc hôm nay', 'Bao nhiêu công việc quá hạn', 'Công việc của tôi', 'Tóm tắt những quyết định gần đây'].map(text => <button className="suggestion" key={text} disabled={busy} onClick={() => ask(text)}><span>{text}</span><ArrowUpRight size={16} /></button>)}</div></div>}<div className="assistant-thread" aria-live="polite">{entries.map((entry, index) => <article key={index}><div className="question-bubble">{entry.question}</div><div className="answer"><div className="answer-body"><strong><Sparkles size={16} /> WorkAI</strong><div className="answer-text" style={{ whiteSpace: 'pre-wrap' }}>{entry.answer}</div><div className="answer-footer"><span>{entry.mode === 'database' ? 'Số liệu trực tiếp' : 'Phân tích AI'} · {new Date(entry.asOf).toLocaleTimeString('vi-VN')}</span>{entry.context?.truncated && <span>Phân tích trên trích đoạn liên quan</span>}</div>{entry.sources?.map((source: any, i: number) => <Link className="source-link" href={source.href} key={i}><ArrowUpRight size={13} />{source.label}</Link>)}</div></div></article>)}<LoadState loading={busy} error={error} /><div ref={end} /></div><form className="assistant-composer" onSubmit={e => { e.preventDefault(); void ask(question); }}><textarea aria-label="Câu hỏi cho trợ lý" placeholder="Hỏi về công việc của bạn..." value={question} onChange={e => setQuestion(e.target.value)} maxLength={5000} rows={3} disabled={busy} /><button className="send-button" title="Gửi câu hỏi" aria-label="Gửi câu hỏi" disabled={busy || !question.trim()}><ArrowUp size={20} /></button></form></section><aside><section className="side-section"><h3><Database size={16} />Nguồn thông tin</h3><div className="mini-stat"><span>Công việc</span><span className="positive">Theo quyền truy cập</span></div><div className="mini-stat"><span>Hội thoại</span><span>Phòng đã tham gia</span></div><div className="mini-stat"><span>Tài khoản</span><span>{user?.fullName}</span></div></section><section className="side-section"><h3><Clock3 size={16} />Truy cập nhanh</h3><Link className="link-action" href="/tasks">Danh sách công việc <ArrowUpRight size={15} /></Link><Link className="link-action" href="/reports">Báo cáo tiến độ <ArrowUpRight size={15} /></Link></section></aside></div>
  </>;
}
