'use client';

export default function DashboardError({ reset }: { reset: () => void }) {
  return <div role="alert" className="p-8 space-y-4 text-center">
    <p>Không thể hiển thị trang. Vui lòng thử lại.</p>
    <button onClick={reset} className="border rounded px-4 py-2">Thử lại</button>
  </div>;
}
