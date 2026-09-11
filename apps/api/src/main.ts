import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { db } from './services/db.service';
import { getBearerToken, hashSessionToken } from './services/security.service';
import { permissionService } from './services/permission.service';
import { publicData } from './services/public-data';

// Import các Routers
import { authRouter } from './modules/auth/auth.controller';
import { attendanceRouter } from './modules/attendance/attendance.controller';
import { tasksRouter } from './modules/tasks/tasks.controller';
import { currentWorkRouter } from './modules/current-work/current-work.controller';
import { chatRouter } from './modules/chat/chat.controller';
import { aiRouter } from './modules/ai/ai.controller';
import { searchRouter } from './modules/search/search.controller';
import { reportsRouter } from './modules/reports/reports.controller';
import { remindersService } from './modules/reminders/reminders.service';
import { adminRouter } from './modules/admin/admin.controller';
import { notificationsRouter } from './modules/notifications/notifications.controller';
import { notificationsService } from './modules/notifications/notifications.service';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const json = res.json.bind(res);
  res.json = (body: any) => json(publicData(body));
  next();
});
const server = http.createServer(app);

// 1. Cấu hình Socket.IO Realtime
const io = new SocketIOServer(server, {
  cors: {
    origin: config.corsOrigins,
    credentials: true
  }
});

app.set('socketio', io);

function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  const cookies = header.split(';').map(part => part.trim());
  const found = cookies.find(part => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

io.use(async (socket, next) => {
  try {
    const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
    const authorizationHeader = Array.isArray(socket.handshake.headers.authorization)
      ? socket.handshake.headers.authorization[0]
      : socket.handshake.headers.authorization;
    const bearerToken = getBearerToken(authorizationHeader);
    const cookieToken = readCookie(socket.handshake.headers.cookie, 'work_session');
    const token = authToken || bearerToken || cookieToken;

    if (!token) return next(new Error('UNAUTHORIZED'));

    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true }
    });

    if (!session || new Date() > session.expiresAt || session.user.status === 'SUSPENDED' || session.user.mustChangePassword) {
      return next(new Error('INVALID_SESSION'));
    }

    socket.data.user = {
      id: session.id,
      userId: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      avatarUrl: session.user.avatarUrl,
      systemRole: session.user.systemRole,
      orgId: session.user.orgId,
      mustChangePassword: session.user.mustChangePassword
    };
    socket.data.expiresAt = session.expiresAt.getTime();

    next();
  } catch (error) {
    next(new Error('SOCKET_AUTH_FAILED'));
  }
});

io.on('connection', (socket) => {
  if (socket.data.user?.userId) {
    socket.join(`user_${socket.data.user.userId}`);
    socket.join(`session_${socket.data.user.id}`);
  }
  const expiryTimer = setTimeout(() => socket.disconnect(true), Math.min(socket.data.expiresAt - Date.now(), 2147483647));
  expiryTimer.unref();
  socket.on('disconnect', () => clearTimeout(expiryTimer));
  socket.use(async (_packet, next) => {
    try {
      const session = await db.session.findUnique({ where: { id: socket.data.user.id }, include: { user: true } });
      if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE' || session.user.mustChangePassword) { socket.disconnect(true); return; }
      next();
    } catch { next(new Error('Authentication unavailable')); }
  });

  // Client tham gia vào room của hội thoại
  socket.on('join_conversation', async (conversationId: string, ack?: (result: any) => void) => {
    try {
      if (typeof conversationId !== 'string') throw new Error('Invalid conversation');
      await permissionService.assertConversationAccess(socket.data.user, conversationId);
      await socket.join(`conv_${conversationId}`);
      if (typeof ack === 'function') ack({ success: true });
    } catch (error: any) {
      if (typeof ack === 'function') ack({ success: false, error: error.message || 'Không thể tham gia hội thoại' });
      socket.emit('conversation.join_denied', { conversationId });
    }
  });

  socket.on('leave_conversation', (conversationId: string) => {
    socket.leave(`conv_${conversationId}`);
  });

  socket.on('typing', async (payload: any) => {
    try {
      const conversationId = payload?.conversationId;
      if (typeof conversationId !== 'string') return;
      await permissionService.assertConversationAccess(socket.data.user, conversationId);
      socket.to(`conv_${conversationId}`).emit('user.typing', {
        userId: socket.data.user.userId,
        userName: socket.data.user.fullName
      });
    } catch {}
  });
});

// 2. Middlewares toàn cục
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(Object.assign(new Error('Origin không được phép bởi CORS'), { status: 403 }));
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 3. Healthcheck Endpoints
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok', time: new Date() }));
app.get('/readyz', async (req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

// 4. Định tuyến API v1
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/attendance', attendanceRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/current-work', currentWorkRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = error.type === 'entity.parse.failed' ? 400 : error.status || 500;
  res.status(status).json({ success: false, error: { message: status < 500 ? 'Invalid request' : 'Internal server error' } });
});

setInterval(() => { void notificationsService.dispatch().catch(() => console.error('Push worker unavailable')); }, 15000).unref();
// 5. Cron Job Nhắc việc định kỳ (mỗi 5 phút)
setInterval(async () => {
  try {
    await remindersService.scanAndSendReminders();
  } catch (err) {
    console.error('Lỗi khi quét reminders:', err);
  }
}, 5 * 60 * 1000);

// 6. Khởi động Server
const PORT = config.port;
server.listen(PORT, () => {
  console.log('=================================================================');
  console.log(`🚀 WORK MANAGEMENT AI BACKEND IS RUNNING ON PORT: ${PORT}`);
  console.log(`🌐 Healthcheck: http://localhost:${PORT}/healthz`);
  console.log(`🤖 AI Engine Model: ${config.vertex.model} (Project: ${config.vertex.projectId})`);
  console.log('=================================================================');
});

export { app, server, io };
