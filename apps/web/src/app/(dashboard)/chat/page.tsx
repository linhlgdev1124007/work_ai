'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, getSocketUrl } from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import { Markdown } from '@/components/markdown';
import { ChatAction } from '@/components/chat-action';
import { ChatGroup } from '@/components/chat-group';
import {
  Bot,
  CheckCircle2,
  Circle,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  User,
  Users,
  Wifi,
  WifiOff,
  XCircle
} from 'lucide-react';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';

function connectionLabel(state: ConnectionState) {
  if (state === 'connected') return 'Realtime đang bật';
  if (state === 'reconnecting') return 'Đang kết nối lại';
  if (state === 'error') return 'Socket cần đăng nhập lại';
  return 'Đang kết nối';
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConv, updateActiveConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputContent, setInputContent] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const setActiveConv = (room: any) => { setMentionIds([]); setInputContent(''); updateActiveConv(room); };
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [userMe, setUserMe] = useState<any>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [channelSearch, setChannelSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const refreshConversations = async () => { const res = await api.chat.getConversations(); setConversations(res.data); };

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConvRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
  };

  useEffect(() => {
    const init = async () => {
      try {
        const me = await api.auth.getMe();
        setUserMe(me.data);

        const convs = await api.chat.getConversations();
        setConversations(convs.data);
        if (convs.data.length > 0) setActiveConv(convs.data.find((c: any) => c.id === new URLSearchParams(window.location.search).get('conversation')) || convs.data[0]);
      } catch {
        setSendError('Không tải được dữ liệu chat. Vui lòng đăng nhập lại.');
      }
    };
    init();

    const token = typeof window !== 'undefined' ? localStorage.getItem('work_session_token') : null;
    const socket = io(getSocketUrl(), {
      withCredentials: true,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      if (activeConvRef.current) socket.emit('join_conversation', activeConvRef.current);
    });
    socket.on('disconnect', () => setConnectionState('offline'));
    socket.io.on('reconnect_attempt', () => setConnectionState('reconnecting'));
    socket.io.on('reconnect', () => setConnectionState('connected'));
    socket.on('connect_error', () => setConnectionState('error'));

    socket.on('message.created', (newMsg: any) => {
      if (newMsg.conversationId !== activeConvRef.current) return;
      setMessages(prev => {
        if (prev.some(msg => msg.id === newMsg.id || msg.clientMessageId === newMsg.clientMessageId)) return prev;
        return [...prev, newMsg];
      });
      scrollToBottom();
    });

    socket.on('message.classified', ({ messageId, kind }: any) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, kind } : m));
    });
    socket.on('assistant.replied', ({ messageId, content }: any) => setMessages(prev => prev.map(m => m.id === messageId ? { ...m, assistantReply: content } : m)));
    socket.on('ai.action.updated', ({ messageId, action }: any) => setMessages(prev => prev.map(m => m.id === messageId ? { ...m, aiActions: [action] } : m)));
    socket.on('conversation.read', ({ conversationId, receipts }: any) => { if (conversationId === activeConvRef.current) setReceipts(receipts); });
    socket.on('conversation.updated', () => { void refreshConversations(); });
    socket.on('ai.action.created', ({ messageId, action, summaryText, task }: any) => {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? { ...m, aiActions: [action], aiNoteSummary: summaryText, createdTask: task }
            : m
        )
      );
    });

    socket.on('user.typing', ({ userName }: any) => {
      if (!userName) return;
      setTypingUsers(prev => (prev.includes(userName) ? prev : [...prev, userName]));
      window.setTimeout(() => setTypingUsers(prev => prev.filter(name => name !== userName)), 1800);
    });

    socket.on('conversation.join_denied', () => {
      setSendError('Bạn không có quyền tham gia hội thoại này.');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    activeConvRef.current = conversationId;
    let cancelled = false;
    setMessages([]);
    setReceipts([]);
    setNextCursor(null);

    const loadMessages = async () => {
      try {
        setSendError(null);
        const res = await api.chat.getMessages(activeConv.id);
        if (cancelled) return;
        setMessages(res.data.messages);
        setNextCursor(res.data.nextCursor);
        setReceipts(res.data.receipts || []);
        scrollToBottom();

        socketRef.current?.emit('join_conversation', activeConv.id, (ack: any) => {
          if (!ack?.success) setSendError(ack?.error || 'Không thể tham gia hội thoại.');
        });
      } catch (e: any) {
        if (cancelled) return;
        setSendError(e.message || 'Không tải được tin nhắn.');
      }
    };

    loadMessages();
    return () => {
      cancelled = true;
      socketRef.current?.emit('leave_conversation', conversationId);
    };
  }, [activeConv]);

  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest || !activeConv?.id) return;
    const mark = () => { if (document.visibilityState === 'visible' && document.hasFocus()) void api.chat.markRead(activeConv.id, latest.id).then(() => setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, unreadCount: 0 } : c))).catch(() => {}); };
    const target = messagesEndRef.current;
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) mark(); }, { threshold: 1 });
    if (target) observer.observe(target);
    const visible = () => { if (target) { const rect = target.getBoundingClientRect(); if (rect.top >= 0 && rect.bottom <= window.innerHeight) mark(); } };
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
  }, [messages, activeConv?.id]);

  const reloadMessages = async () => {
    if (!activeConv) return;
    const res = await api.chat.getMessages(activeConv.id);
    if (activeConvRef.current !== activeConv.id) return;
    setMessages(res.data.messages);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputContent.trim() || !activeConv || loadingMsg) return;

    const content = inputContent.trim();
    setInputContent('');
    setLoadingMsg(true);
    setSendError(null);

    try {
      const res = await api.chat.sendMessage({
        conversationId: activeConv.id,
        content,
        mentionIds: mentionIds.filter(id => activeConv.members.some((m: any) => m.id === id && content.includes('@' + m.fullName))),
        clientMessageId: `cli_${Date.now()}_${Math.random().toString(16).slice(2)}`
      });
      if (activeConvRef.current === res.data.conversationId) {
        setMentionIds([]);
        setMessages(prev => prev.some(message => message.id === res.data.id) ? prev : [...prev, res.data]);
        scrollToBottom();
      }
    } catch (err: any) {
      setInputContent(content);
      setSendError(err.message || 'Lỗi gửi tin nhắn');
    } finally {
      setLoadingMsg(false);
    }
  };

  const handleTyping = (value: string) => {
    setInputContent(value);
    if (activeConv && socketRef.current?.connected) {
      socketRef.current.emit('typing', { conversationId: activeConv.id });
    }
  };


  return (
    <>
    <div className="h-[calc(100vh-8.5rem)] flex bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
      <aside className="hidden md:flex w-80 border-r border-zinc-200 flex-col bg-zinc-50">
        <div className="p-4 border-b border-zinc-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-zinc-900">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
              Kênh thảo luận
            </div>
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
              {conversations.length}
            </span>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              value={channelSearch}
              onChange={event => setChannelSearch(event.target.value)}
              placeholder="Tìm kênh, dự án..."
              className="w-full pl-9 pr-3 py-2 rounded-md border border-zinc-200 bg-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.filter(conv => conv.name.toLocaleLowerCase().includes(channelSearch.toLocaleLowerCase())).map(conv => {
            const selected = activeConv?.id === conv.id;
            return (
              <button
                key={conv.id}
                onClick={() => setActiveConv(conv)}
                className={`w-full text-left px-4 py-3 border-l-4 transition ${
                  selected ? 'bg-white border-emerald-600' : 'border-transparent hover:bg-white/70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    {conv.type === 'DIRECT' ? <User className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-zinc-900 text-sm truncate">{conv.name}</div>
                      {conv.unreadCount > 0 && (
                        <span className="text-[11px] font-bold bg-red-500 text-white rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400 truncate mt-0.5">
                      {conv.lastMessage?.content || 'Chưa có tin nhắn'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        <select aria-label="Hội thoại" className="md:hidden border-b p-3 bg-white w-full" value={activeConv?.id || ''} onChange={event => setActiveConv(conversations.find(conv => conv.id === event.target.value))}>
          {conversations.map(conv => <option key={conv.id} value={conv.id}>{conv.name}</option>)}
        </select>
        {nextCursor && <button disabled={loadingOlder} className="p-2 text-sm text-emerald-700 disabled:opacity-50" onClick={async () => {
          if (!activeConv || loadingOlder) return;
          const id = activeConv.id;
          setLoadingOlder(true);
          try {
            const res = await api.chat.getMessages(id, 30, nextCursor);
            if (activeConvRef.current !== id) return;
            setMessages(prev => [...res.data.messages.filter((older: any) => !prev.some(message => message.id === older.id)), ...prev]);
            setNextCursor(res.data.nextCursor);
          } catch (error: any) { setSendError(error.message); } finally { setLoadingOlder(false); }
        }}>{loadingOlder ? 'Đang tải...' : 'Tin nhắn trước'}</button>}
        <header className="h-16 border-b border-zinc-200 px-4 md:px-6 flex items-center justify-between bg-white">
          <div className="min-w-0">
            <h2 className="font-bold text-zinc-900 truncate">{activeConv?.name || 'Chọn hội thoại'}</h2>
            <p className="text-xs text-zinc-500 truncate">
              {activeConv?.teamName ? `Nhóm: ${activeConv.teamName}` : 'Không gian trao đổi nội bộ'}
            </p>
          </div>
          <button className="btn btn-ghost shrink-0" title="Nhóm và công việc" aria-label="Nhóm và công việc" disabled={!activeConv} onClick={() => setGroupOpen(true)}><Users size={18} /></button>
          <div
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${
              connectionState === 'connected' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'
            }`}
          >
            {connectionState === 'connected' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{connectionLabel(connectionState)}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-zinc-50/40">
          {messages.map((msg: any) => {
            const isMe = msg.senderId === userMe?.id;
            const aiAction = msg.aiActions?.[0];

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="text-xs text-zinc-400 mb-1 px-1">
                  {msg.sender?.fullName || 'Người dùng'} · {new Date(msg.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div
                  className={`max-w-full rounded-lg px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                    isMe
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'
                  }`}
                >
                  {msg.kind === 'TASK_REQUEST' && <div className="status status-review" style={{ marginBottom: 6 }}>{aiAction?.status === 'PENDING_CONFIRMATION' ? 'Công việc · Cần xác nhận' : 'Trao đổi công việc'}</div>}
                  {msg.kind === 'UNCLASSIFIED' && <div className="muted small">AI chưa phân loại được tin nhắn</div>}
                  <span style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{msg.content}</span>
                </div>
                {isMe && receipts.some(r => r.userId !== userMe?.id && (r.createdAt > msg.createdAt || (r.createdAt === msg.createdAt && r.messageId >= msg.id))) && <p className="text-xs text-zinc-500 mt-1">Đã đọc: {receipts.filter(r => r.userId !== userMe?.id && (r.createdAt > msg.createdAt || (r.createdAt === msg.createdAt && r.messageId >= msg.id))).map(r => r.fullName).join(', ')}</p>}

                {msg.assistantReply && <div className="chat-action"><strong className="flex items-center gap-2 mb-2"><Bot size={16} />B6</strong><Markdown>{msg.assistantReply}</Markdown></div>}
                {aiAction && <ChatAction action={aiAction} reload={reloadMessages} />}
              </div>
            );
          })}

          {typingUsers.length > 0 && (
            <div className="text-xs text-zinc-400 px-1">{typingUsers.join(', ')} đang nhập...</div>
          )}
          <div ref={messagesEndRef} style={{ height: 1 }} />
        </div>

        <div className="border-t border-zinc-200 bg-white">
          {sendError && <div className="px-4 pt-3 text-xs font-semibold text-red-600">{sendError}</div>}
          <div className="px-4 pt-3 flex flex-wrap items-center gap-2"><select aria-label="Tag thành viên" className="filter-select" value="" disabled={loadingMsg || !activeConv} onChange={event => { if (event.target.value === 'b6') { setInputContent(text => text + (text && !text.endsWith(' ') ? ' ' : '') + '@b6 '); return; } const member = activeConv?.members.find((m: any) => m.id === event.target.value); if (member) { setMentionIds(ids => Array.from(new Set([...ids, member.id]))); setInputContent(text => text + (text && !text.endsWith(' ') ? ' ' : '') + '@' + member.fullName + ' '); } }}><option value="">@ Nhắc đến</option><option value="b6">b6</option>{activeConv?.members.filter((m: any) => m.id !== userMe?.id).map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select>{mentionIds.filter(id => inputContent.includes('@' + activeConv?.members.find((m: any) => m.id === id)?.fullName)).map(id => <span key={id} className="status status-active">@{activeConv?.members.find((m: any) => m.id === id)?.fullName}</span>)}</div>
          <form onSubmit={handleSendMessage} className="p-4 flex items-center gap-3">
            <input
              type="text"
              aria-label="Nội dung tin nhắn"
              disabled={loadingMsg}
              value={inputContent}
              onChange={(e) => handleTyping(e.target.value)}
              placeholder="Nhắn tin hoặc hỏi @b6..."
              className="flex-1 min-w-0 bg-zinc-50 border border-zinc-200 rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition placeholder-zinc-400"
            />
            <button
              type="submit"
              aria-label="Gửi tin nhắn"
              disabled={loadingMsg || !inputContent.trim()}
              className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition shadow-sm shadow-emerald-100 disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </section>
    </div>
    {groupOpen && activeConv && <ChatGroup room={conversations.find(c => c.id === activeConv.id) || activeConv} user={userMe} onClose={() => setGroupOpen(false)} refresh={refreshConversations} />}
    </>
  );
}
