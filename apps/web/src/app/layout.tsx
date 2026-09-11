import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Work AI - Quản lý công việc nhóm với AI trung tâm',
  description: 'Nhắn một câu để giao việc, không lo trôi việc, quản lý thông minh.',
  manifest: '/manifest.json',
  icons: { apple: '/icon-192.png', icon: '/icon-192.png' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
