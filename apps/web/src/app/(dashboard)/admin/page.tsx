'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Building2, Cpu, KeyRound, Plus, RotateCw, ShieldCheck, Users } from 'lucide-react';

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('vi-VN') : '0';
}

export default function AdminPage() {
  const [overview, setOverview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({ email: '', fullName: '', systemRole: 'MEMBER' });
  const [teamName, setTeamName] = useState('');
  const [projectForm, setProjectForm] = useState({ teamId: '', name: '', code: '' });
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const loadOverview = async () => {
    try {
      const res = await api.admin.getOverview();
      setOverview(res.data);
      setProjectForm(prev => !prev.teamId && res.data.teams?.[0]?.id ? { ...prev, teamId: res.data.teams[0].id } : prev);
    } catch (e: any) {
      setError(e.message || 'Không tải được dữ liệu quản trị');
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.admin.createUser(userForm);
      setTemporaryPassword(res.data.temporaryPassword);
      setUserForm({ email: '', fullName: '', systemRole: 'MEMBER' });
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.admin.createTeam({ name: teamName });
      setTeamName('');
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.admin.createProject(projectForm);
      setProjectForm(prev => ({ ...prev, name: '', code: '' }));
      await loadOverview();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleStatus = async (user: any) => {
    const nextStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await api.admin.updateUserStatus(user.id, nextStatus);
    await loadOverview();
  };

  const resetPassword = async (user: any) => {
    const res = await api.admin.resetPassword(user.id);
    setTemporaryPassword(res.data.temporaryPassword);
    await loadOverview();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">Enterprise control center</div>
          <h1 className="text-2xl font-bold text-zinc-950 mt-1 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Quản trị hệ thống
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Quản lý nhân sự, team, dự án và quyền truy cập trong một nơi.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-white border border-zinc-200 rounded-md px-4 py-3">
            <div className="text-xl font-black text-zinc-950">{overview?.users?.length || 0}</div>
            <div className="text-xs text-zinc-500">Người dùng</div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-md px-4 py-3">
            <div className="text-xl font-black text-zinc-950">{overview?.teams?.length || 0}</div>
            <div className="text-xs text-zinc-500">Team</div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-md px-4 py-3">
            <div className="text-xl font-black text-amber-600">{overview?.pendingAdjustments || 0}</div>
            <div className="text-xs text-zinc-500">Đơn công</div>
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm font-semibold">{error}</div>}
      {temporaryPassword && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-4 py-3 text-sm font-semibold">
          Mật khẩu tạm vừa tạo: {temporaryPassword}
        </div>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between gap-3">
          <div className="font-bold text-zinc-900 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-emerald-600" />
            Thống kê token AI
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Tải lại thống kê token" title="Tải lại" onClick={loadOverview}>
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-100">
          <div className="p-4">
            <div className="text-xs font-bold uppercase text-zinc-500">Input không cache</div>
            <div className="text-2xl font-black text-zinc-950 mt-1">{formatNumber(overview?.tokenUsage?.inputTokens)}</div>
          </div>
          <div className="p-4">
            <div className="text-xs font-bold uppercase text-zinc-500">Output</div>
            <div className="text-2xl font-black text-zinc-950 mt-1">{formatNumber(overview?.tokenUsage?.outputTokens)}</div>
          </div>
          <div className="p-4">
            <div className="text-xs font-bold uppercase text-zinc-500">Input cache</div>
            <div className="text-2xl font-black text-emerald-700 mt-1">{formatNumber(overview?.tokenUsage?.cachedInputTokens)}</div>
          </div>
        </div>
        <div className="px-4 pb-4 text-xs text-zinc-500">
          {overview?.tokenUsage?.since ? `Đã ghi nhận ${formatNumber(overview.tokenUsage.requests)} lượt gọi AI từ ${new Date(overview.tokenUsage.since).toLocaleString('vi-VN')}.` : 'Chưa có dữ liệu token thực tế được ghi nhận.'}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-200 flex items-center gap-2 font-bold text-zinc-900">
            <Users className="w-5 h-5 text-emerald-600" />
            Nhân sự
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="text-left px-4 py-3">Người dùng</th>
                  <th className="text-left px-4 py-3">Vai trò</th>
                  <th className="text-left px-4 py-3">Trạng thái</th>
                  <th className="text-right px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {overview?.users?.map((u: any) => (
                  <tr key={u.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">{u.fullName}</div>
                      <div className="text-xs text-zinc-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{u.systemRole}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${u.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => resetPassword(u)} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold hover:bg-zinc-50">
                        <KeyRound className="w-3.5 h-3.5 inline mr-1" />
                        Reset
                      </button>
                      <button onClick={() => toggleStatus(u)} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-700">
                        {u.status === 'ACTIVE' ? 'Khóa' : 'Mở'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-6">
          <form onSubmit={createUser} className="bg-white border border-zinc-200 rounded-lg shadow-sm p-4 space-y-3">
            <div className="font-bold text-zinc-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-600" />
              Tạo người dùng
            </div>
            <input value={userForm.fullName} onChange={e => setUserForm({ ...userForm, fullName: e.target.value })} required placeholder="Họ tên" className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <input value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} required type="email" placeholder="email@company.vn" className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <select value={userForm.systemRole} onChange={e => setUserForm({ ...userForm, systemRole: e.target.value })} className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-md py-2 text-sm font-bold">Tạo tài khoản</button>
          </form>

          <form onSubmit={createTeam} className="bg-white border border-zinc-200 rounded-lg shadow-sm p-4 space-y-3">
            <div className="font-bold text-zinc-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              Tạo team
            </div>
            <input value={teamName} onChange={e => setTeamName(e.target.value)} required placeholder="Tên team" className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <button className="w-full bg-zinc-900 hover:bg-zinc-700 text-white rounded-md py-2 text-sm font-bold">Tạo team</button>
          </form>

          <form onSubmit={createProject} className="bg-white border border-zinc-200 rounded-lg shadow-sm p-4 space-y-3">
            <div className="font-bold text-zinc-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-600" />
              Tạo dự án
            </div>
            <select value={projectForm.teamId} onChange={e => setProjectForm({ ...projectForm, teamId: e.target.value })} className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
              {overview?.teams?.map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <input value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} required placeholder="Tên dự án" className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <input value={projectForm.code} onChange={e => setProjectForm({ ...projectForm, code: e.target.value })} required placeholder="Mã dự án" className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-md py-2 text-sm font-bold">Tạo dự án</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
