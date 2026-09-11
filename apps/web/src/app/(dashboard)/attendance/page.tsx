'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Clock, Plus, CheckCircle2, XCircle, FileText, Calendar } from 'lucide-react';

export default function AttendancePage() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [checkInVal, setCheckInVal] = useState('');
  const [checkOutVal, setCheckOutVal] = useState('');
  const [reason, setReason] = useState('');

  const loadHistory = async () => {
    try {
      const res = await api.attendance.getHistory();
      setHistory(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleRequestAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkInVal || !checkOutVal || !reason) {
      alert('Vui lòng điền đầy đủ thông tin');
      return;
    }

    try {
      await api.attendance.requestAdjustment({
        requestedCheckIn: new Date(checkInVal).toISOString(),
        requestedCheckOut: new Date(checkOutVal).toISOString(),
        reason
      });
      alert('Đã gửi đơn yêu cầu điều chỉnh công thành công!');
      setModalOpen(false);
      setReason('');
    } catch (err: any) {
      alert(err.message || 'Lỗi gửi đơn');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center space-x-2">
            <Clock className="w-6 h-6 text-emerald-600" />
            <span>Điểm danh & Chấm công</span>
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Ghi nhận thời gian làm việc chuẩn xác theo giờ máy chủ, hỗ trợ yêu cầu điều chỉnh.
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-md shadow transition flex items-center space-x-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Xin điều chỉnh công</span>
        </button>
      </div>

      {/* LỊCH SỬ CHẤM CÔNG */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 bg-zinc-50 font-bold text-zinc-800 text-sm">
          Lịch sử các phiên làm việc của bạn
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50/50 text-zinc-400 font-semibold text-xs uppercase tracking-wider border-b border-zinc-100">
              <tr>
                <th className="px-6 py-3">Giờ Check-in</th>
                <th className="px-6 py-3">Giờ Check-out</th>
                <th className="px-6 py-3">Thời lượng</th>
                <th className="px-6 py-3">Trạng thái</th>
                <th className="px-6 py-3">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {history.map((s) => {
                let duration = 'Đang làm';
                if (s.checkInTime && s.checkOutTime) {
                  const diffMin = Math.round(
                    (new Date(s.checkOutTime).getTime() - new Date(s.checkInTime).getTime()) / (1000 * 60)
                  );
                  const h = Math.floor(diffMin / 60);
                  const m = diffMin % 60;
                  duration = `${h}h ${m}m`;
                }

                return (
                  <tr key={s.id} className="hover:bg-zinc-50/60 transition">
                    <td className="px-6 py-3.5 font-medium text-zinc-900">
                      {new Date(s.checkInTime).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-6 py-3.5 text-zinc-600">
                      {s.checkOutTime ? new Date(s.checkOutTime).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td className="px-6 py-3.5 font-semibold text-emerald-700">{duration}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          s.status === 'OPEN'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {s.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-zinc-400">{s.note || '—'}</td>
                  </tr>
                );
              })}
              {history.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-400 text-sm">
                    Chưa có lịch sử điểm danh nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL GỬI ĐƠN ĐIỀU CHỈNH */}
      {modalOpen && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md border border-zinc-200 p-6 space-y-4">
            <h3 className="text-lg font-bold text-zinc-900">Yêu cầu điều chỉnh điểm danh</h3>
            <p className="text-xs text-zinc-500">
              Gửi yêu cầu bổ sung hoặc sửa giờ vào/ra khi quên chấm công để Quản lý phê duyệt.
            </p>

            <form onSubmit={handleRequestAdjustment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Giờ vào yêu cầu</label>
                <input
                  type="datetime-local"
                  required
                  value={checkInVal}
                  onChange={(e) => setCheckInVal(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Giờ ra yêu cầu</label>
                <input
                  type="datetime-local"
                  required
                  value={checkOutVal}
                  onChange={(e) => setCheckOutVal(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Lý do điều chỉnh</label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Vui lòng nêu rõ lý do..."
                  className="w-full text-sm border border-zinc-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-md transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition"
                >
                  Gửi đơn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
