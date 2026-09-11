'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Activity, ArrowUpRight, BarChart3, Bell, Building2, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Command, LayoutDashboard, ListTodo, LogOut, Menu, MessageSquare, Plus, Search, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { Avatar, IconButton, LoadState, Modal, WorkspaceContext } from '@/components/workspace';
import { NotificationGate, NotificationBell } from '@/components/notifications';

const navigation = [
  { name:'Tin nhắn', href:'/chat', icon:MessageSquare },
  { name:'Tổng quan', href:'/today', icon:LayoutDashboard },
  { name:'Công việc', href:'/tasks', icon:ListTodo },
  { name:'Trợ lý AI', href:'/assistant', icon:Sparkles },
  { name:'Đội nhóm', href:'/team', icon:Users },
  { name:'Báo cáo', href:'/reports', icon:BarChart3 },
  { name:'Chấm công', href:'/attendance', icon:Clock3 }
];
export default function DashboardLayout({ children }: { children:React.ReactNode }) {
  const pathname=usePathname(), router=useRouter();
  const [user,setUser]=useState<any>(null), [attendance,setAttendance]=useState<any>(null);
  const [error,setError]=useState(''), [busy,setBusy]=useState(false), [menu,setMenu]=useState(false);
  const [search,setSearch]=useState(false), [query,setQuery]=useState(''), [results,setResults]=useState<any>(null);
  const [toast,setToast]=useState<{message:string;error?:boolean}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const notify=(message:string,error=false)=>{setToast({message,error});if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),4500);};
  const refreshAttendance=()=>{api.attendance.getStatus().then(r=>setAttendance(r.data)).catch(()=>{});};
  const load=async()=>{setError('');try{const me=await api.auth.getMe();setUser(me.data);if(me.data.mustChangePassword){router.replace('/change-password');return;}refreshAttendance();}catch(e){if(e instanceof ApiError && [401,403].includes(e.status))router.replace('/login');else setError('Không kết nối được máy chủ.');}};
  useEffect(()=>{void load();return()=>{if(timer.current)clearTimeout(timer.current);};},[]);
  useEffect(()=>{setMenu(false);},[pathname]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setSearch(s=>!s);}if(e.key==='Escape')setMenu(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{let active=true;const id=setTimeout(async()=>{if(!query.trim()){setResults(null);return;}try{const res=await api.search.universal(query);if(active)setResults(res.data);}catch(e:any){if(active)notify(e.message,true);}},250);return()=>{active=false;clearTimeout(id);};},[query]);
  const nav=[...navigation,...(user?.systemRole==='ADMIN'?[{name:'Quản trị',href:'/admin',icon:ShieldCheck}]:[])];
  const current=nav.find(n=>pathname.startsWith(n.href));
  const logout=async()=>{try{await api.auth.logout();router.replace('/login');}catch(e:any){notify(e.message,true);}};
  if (!user) return <main className="page-content"><LoadState loading={!error} error={error} retry={load}/></main>;
  return <WorkspaceContext.Provider value={{user,notify,refreshAttendance}}>
    <NotificationGate userId={user.id || user.userId}><div className="workspace">
      {menu&&<button className="sidebar-scrim" aria-label="Đóng menu" onClick={()=>setMenu(false)}/>}
      <aside className={'sidebar'+(menu?' open':'')}>
        <Link href="/chat" className="brand"><span className="brand-mark"><Command size={20}/></span><span>work<span>ai</span><span style={{fontSize:10,color:'#9aa4ab',marginLeft:5,fontWeight:500}}>workspace</span></span></Link>
        <div className="workspace-switch"><Avatar name={user?.organizationName||'W'} /><div style={{minWidth:0,flex:1}}><strong>{user?.organizationName||'Workspace'}</strong><small>Không gian làm việc</small></div><Building2 size={14} className="muted"/></div>
        <div className="nav-label">Không gian của bạn</div>
        <nav aria-label="Điều hướng chính">{nav.map(n=><Link key={n.href} href={n.href} className={'nav-link'+(pathname.startsWith(n.href)?' active':'')} aria-current={pathname.startsWith(n.href)?'page':undefined}><n.icon size={17}/><span>{n.name}</span>{n.href==='/assistant'&&<span className="nav-count">AI</span>}</Link>)}</nav>
        <div className="sidebar-bottom"><Link className="nav-link" href="/change-password"><Settings2 size={16}/>Tài khoản & bảo mật</Link><div className="profile"><Avatar name={user?.fullName}/><div className="profile-text"><strong>{user?.fullName||'Đang tải...'}</strong><small>{user?.systemRole==='ADMIN'?'Quản trị viên':'Thành viên'}</small></div><IconButton label="Đăng xuất" onClick={logout}><LogOut size={15}/></IconButton></div></div>
      </aside>
      <div className="workspace-main">
        <header className="topbar"><div className="breadcrumbs"><IconButton label="Mở menu" className="mobile-only" onClick={()=>setMenu(true)}><Menu size={19}/></IconButton><span>Workspace</span><ChevronRight size={12}/><strong>{current?.name||'Tài khoản'}</strong></div><div className="topbar-right"><NotificationBell/><button className="top-search" onClick={()=>setSearch(true)} aria-label="Tìm kiếm"><Search size={16}/><span>Tìm trong workspace...</span><kbd>⌘ K</kbd></button><span className="desktop-only" style={{height:20,width:1,background:'var(--line)'}}/><button className={'btn btn-small '+(attendance?.hasOpenSession?'':'btn-primary')} disabled={busy||!attendance} onClick={async()=>{setBusy(true);try{await(attendance?.hasOpenSession?api.attendance.checkOut():api.attendance.checkIn());refreshAttendance();notify(attendance?.hasOpenSession?'Đã kết thúc ca làm việc':'Đã bắt đầu ca làm việc');}catch(e:any){notify(e.message,true);}finally{setBusy(false);}}}><Clock3 size={13}/>{attendance?.hasOpenSession?'Kết thúc ca':'Vào ca'}</button><Avatar name={user?.fullName} size="tiny"/></div></header>
        <main className="page-content">{error?<LoadState error={error} retry={load}/>:user?children:<LoadState loading/>}</main>
      </div>
    </div>
    {toast&&<div className={'toast'+(toast.error?' error':'')} role="status"><Check size={16}/>{toast.message}<IconButton label="Đóng thông báo" onClick={()=>setToast(null)}><X size={14}/></IconButton></div>}
    {search&&<Modal title="Tìm kiếm workspace" onClose={()=>setSearch(false)}><div className="search-field"><Search size={16}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Công việc, tin nhắn, thành viên" style={{width:'100%'}}/></div>{results?<div style={{marginTop:18}}>{results.tasks?.map((t:any)=><Link key={t.id} className="activity-item" href={'/tasks?task='+t.id} onClick={()=>setSearch(false)}><ListTodo size={16}/><span>{t.title}<small>{t.assignee?.fullName||'Chưa phân công'}</small></span></Link>)}{results.messages?.map((m:any)=><Link key={m.id} className="activity-item" href={'/chat?conversation='+m.conversationId} onClick={()=>setSearch(false)}><MessageSquare size={16}/><span>{m.content}<small>{m.sender?.fullName}</small></span></Link>)}{!results.tasks?.length&&!results.messages?.length&&<p className="muted small" style={{padding:20}}>Không tìm thấy kết quả.</p>}</div>:<p className="muted small" style={{paddingTop:18}}>Tìm trong dữ liệu bạn có quyền truy cập.</p>}</Modal>}
  </NotificationGate></WorkspaceContext.Provider>;
}
