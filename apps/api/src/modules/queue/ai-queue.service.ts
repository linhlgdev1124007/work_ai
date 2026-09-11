import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config';
import { aiService } from '../ai/ai.service';
import { emitTaskEvent } from '../../services/realtime.service';
import { publicData } from '../../services/public-data';
import { db } from '../../services/db.service';

type AiMessageJob = {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  orgId: string;
};

export class AiQueueService {
  private queue?: Queue<AiMessageJob>;
  private worker?: Worker<AiMessageJob>;
  private io?: any;

  constructor() {
    if (process.env.AI_ENABLED === 'false') return;
    if (!config.redisUrl) return;

    const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', error => console.error('AI Redis connection error:', error.message));
    this.queue = new Queue<AiMessageJob>('ai-message-analysis', { connection });
    this.worker = new Worker<AiMessageJob>(
      'ai-message-analysis',
      async job => this.process(job.data, this.io),
      { connection, concurrency: Number(process.env.AI_WORKER_CONCURRENCY || 2) }
    );
    this.queue.on('error', error => console.error('AI queue error:', error.message));
    this.worker.on('error', error => console.error('AI worker error:', error.message));
  }

  async enqueueIncomingMessage(data: AiMessageJob, io?: any) {
    if (process.env.AI_ENABLED === 'false') return;
    if (io) this.io = io;
    if (!this.queue) {
      windowlessDelay(() => { void this.process(data, io).catch(error => console.error('AI processing failed', error)); }, 80);
      return;
    }

    await this.queue.add('incoming-message', data, {
      jobId: data.messageId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    });

  }

  private async process(data: AiMessageJob, io?: any) {
    try {
      const aiResult = await aiService.processIncomingMessage(
        data.messageId,
        data.conversationId,
        data.senderId,
        data.content,
        data.orgId
      );

      io?.to(`conv_${data.conversationId}`).emit('message.classified', { messageId: data.messageId, kind: aiResult.kind });
      const message = await db.message.findUnique({ where: { id: data.messageId }, select: { assistantReply: true } });
      if (message?.assistantReply) io?.to(`conv_${data.conversationId}`).emit('assistant.replied', { messageId: data.messageId, content: message.assistantReply });
      if (io && aiResult.aiAction) {
        io.to(`conv_${data.conversationId}`).emit('ai.action.created', {
          messageId: data.messageId,
          action: aiResult.aiAction,
          summaryText: aiResult.summaryText,
          task: publicData(aiResult.executedTask)
        });
        if (aiResult.executedTask) {
          emitTaskEvent(io, 'task.created', aiResult.executedTask);
        }
      }
    } catch (error) {
      console.error('Lỗi khi AI xử lý tin nhắn:', error);
      throw error;
    }
  }
}

function windowlessDelay(fn: () => void, delayMs: number) {
  setTimeout(fn, delayMs);
}

export const aiQueueService = new AiQueueService();
