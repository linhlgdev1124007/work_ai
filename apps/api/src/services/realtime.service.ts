import { publicData } from './public-data';

export function emitTaskEvent(io: any, eventName: 'task.created' | 'task.updated', task: any) {
  if (!io || !task) return;

  const rooms = new Set<string>();
  if (task.assigneeId) rooms.add(`user_${task.assigneeId}`);
  if (task.creatorId) rooms.add(`user_${task.creatorId}`);
  if (task.sourceConversationId) rooms.add(`conv_${task.sourceConversationId}`);

  for (const room of rooms) {
    io.to(room).emit(eventName, publicData(task));
  }
}
