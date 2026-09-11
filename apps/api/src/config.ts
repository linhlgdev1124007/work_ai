import path from 'path';
import dotenv from 'dotenv';

// Tải file .env từ thư mục gốc
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  webUrl: process.env.WEB_URL || 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS || process.env.WEB_URL || 'http://localhost:3000,http://localhost:8080')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
  jwtSecret: process.env.SESSION_SECRET || 'secret-jwt-key-for-work-ai-development-32chars',
  timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  uploadDir: path.resolve(__dirname, '../../../storage/uploads'),
  redisUrl: process.env.REDIS_URL || '',
  
  // Cấu hình Google Cloud Vertex AI
  vertex: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'gemini-image-benchmark',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined
  }
};
