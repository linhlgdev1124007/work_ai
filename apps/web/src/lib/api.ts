const configuredApiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export const API_BASE = configuredApiBase.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function getApiOrigin() {
  try {
    return new URL(API_BASE).origin;
  } catch {
    if (typeof window !== 'undefined') return window.location.origin;
    return 'http://localhost:3001';
  }
}

export function getSocketUrl() {
  return process.env.NEXT_PUBLIC_SOCKET_URL || getApiOrigin();
}

export function apiUrl(endpoint: string) {
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${normalized}`;
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const url = apiUrl(endpoint);
  
  const token = typeof window !== 'undefined' ? localStorage.getItem('work_session_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error?.message || data?.message || 'Có lỗi xảy ra khi gọi API', res.status);
  }

  return data;
}

export const api = {
  auth: {
    login: async (dto: any) => {
      const res = await fetchApi('/auth/login', { method: 'POST', body: JSON.stringify(dto) });
      if (res?.data?.token && typeof window !== 'undefined') {
        localStorage.setItem('work_session_token', res.data.token);
      }
      return res;
    },
    logout: async () => {
      try {
        await fetchApi('/auth/logout', { method: 'POST' });
      } finally {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('work_session_token');
          localStorage.removeItem('work_push_user');
          if ('serviceWorker' in navigator) {
            try { const registration = await navigator.serviceWorker.getRegistration('/'); const subscription = await registration?.pushManager.getSubscription(); await subscription?.unsubscribe(); } catch {}
          }
        }
      }
    },
    getMe: () => fetchApi('/auth/me'),
    bootstrap: () => fetchApi('/auth/me/bootstrap')
  },
  tasks: {
    getOptions: () => fetchApi('/tasks/options'),
    getToday: () => fetchApi('/tasks/today'),
    getAll: (params?: Record<string, any>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return fetchApi(`/tasks${q}`);
    },
    getById: (id: string) => fetchApi(`/tasks/${id}`),
    create: (dto: any) => fetchApi('/tasks', { method: 'POST', body: JSON.stringify(dto) }),
    update: (id: string, dto: any) => fetchApi(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    addChecklist: (id: string, title: string) => fetchApi(`/tasks/${id}/checklist`, { method: 'POST', body: JSON.stringify({ title }) }),
    toggleChecklist: (itemId: string, isCompleted: boolean) => fetchApi(`/tasks/checklist/${itemId}/toggle`, { method: 'PATCH', body: JSON.stringify({ isCompleted }) }),
    addDependency: (id: string, dependsOnTaskId: string) => fetchApi(`/tasks/${id}/dependencies`, { method: 'POST', body: JSON.stringify({ dependsOnTaskId }) })
  },
  chat: {
    getConversations: () => fetchApi('/chat/conversations'),
    getMessages: (convId: string, limit = 30, cursor?: string) => fetchApi(`/chat/conversations/${convId}/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    sendMessage: (dto: any) => fetchApi('/chat/messages', { method: 'POST', body: JSON.stringify(dto) }),
    markRead: (convId: string, messageId: string) => fetchApi(`/chat/conversations/${convId}/read`, { method: 'POST', body: JSON.stringify({ messageId }) })
  },
  attendance: {
    getStatus: () => fetchApi('/attendance/current'),
    checkIn: (note?: string) => fetchApi('/attendance/in', { method: 'POST', body: JSON.stringify({ note }) }),
    checkOut: (note?: string) => fetchApi('/attendance/out', { method: 'POST', body: JSON.stringify({ note }) }),
    requestAdjustment: (dto: any) => fetchApi('/attendance/adjustments', { method: 'POST', body: JSON.stringify(dto) }),
    reviewAdjustment: (id: string, isApproved: boolean, rejectionReason?: string) =>
      fetchApi(`/attendance/adjustments/${id}/review`, { method: 'POST', body: JSON.stringify({ isApproved, rejectionReason }) }),
    getHistory: () => fetchApi('/attendance/history')
  },
  currentWork: {
    getMe: () => fetchApi('/current-work/me'),
    setMe: (dto: any) => fetchApi('/current-work/me', { method: 'POST', body: JSON.stringify(dto) }),
    getWhoIsDoingWhat: (teamId?: string) => fetchApi(`/current-work/who-is-doing-what${teamId ? `?teamId=${teamId}` : ''}`)
  },
  ai: {
    confirmAction: (id: string, resolution?: { mode: 'create' | 'update'; taskId?: string; expectedVersion?: number; title?: string; description?: string }) => fetchApi(`/ai/actions/${id}/confirm`, { method: 'POST', body: JSON.stringify({ resolution }) }),
    cancelAction: (id: string) => fetchApi(`/ai/actions/${id}/cancel`, { method: 'POST' }),
    undoAction: (id: string) => fetchApi(`/ai/actions/${id}/undo`, { method: 'POST' }),
    query: (question: string) => fetchApi('/ai/query', { method: 'POST', body: JSON.stringify({ question }) })
  },
  search: {
    universal: (query: string) => fetchApi(`/search?q=${encodeURIComponent(query)}`)
  },
  reports: {
    getSummary: (teamId?: string) => fetchApi(`/reports/summary${teamId ? `?teamId=${teamId}` : ''}`)
  },
  admin: {
    getOverview: () => fetchApi('/admin/overview'),
    createUser: (dto: any) => fetchApi('/admin/users', { method: 'POST', body: JSON.stringify(dto) }),
    updateUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
      fetchApi(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    resetPassword: (id: string, temporaryPassword?: string) =>
      fetchApi(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ temporaryPassword }) }),
    createTeam: (dto: any) => fetchApi('/admin/teams', { method: 'POST', body: JSON.stringify(dto) }),
    createProject: (dto: any) => fetchApi('/admin/projects', { method: 'POST', body: JSON.stringify(dto) }),
    setTeamMember: (teamId: string, userId: string, role: 'LEAD' | 'MEMBER') =>
      fetchApi(`/admin/teams/${teamId}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
    removeTeamMember: (teamId: string, userId: string) =>
      fetchApi(`/admin/teams/${teamId}/members/${userId}`, { method: 'DELETE' })
  },
  users: {
    getNotes: (userId: string) => fetchApi(`/users/${userId}/notes`)
  }
};
