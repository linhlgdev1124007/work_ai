import { z } from 'zod';
const classification = z.object({
  is_work_instruction: z.boolean(),
  intent: z.enum(['NONE', 'CREATE_TASK', 'UPDATE_ASSIGNEE', 'UPDATE_DEADLINE', 'UPDATE_STATUS', 'SET_CURRENT_WORK', 'QUERY_TASKS', 'SUMMARIZE']),
  confidence: z.number().min(0).max(1),
  evidence: z.string().optional(),
  reply_markdown: z.string().max(12000).optional(),
  duplicate_task_ids: z.array(z.string()).max(5).optional(),
  data: z.object({ description: z.string().max(5000).optional(), confirmation_message_id: z.string().optional(), title: z.string().max(500).optional(), assignee_name: z.string().optional(), task_id: z.string().optional(), deadline_iso: z.string().datetime({ offset: true }).nullable().optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), status: z.enum(['TODO', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'COMPLETED', 'PAUSED']).optional(), current_work_text: z.string().optional() })
});

export function parseClassification(raw: string) {
  const result = classification.parse(JSON.parse(raw));
  const actionable = result.is_work_instruction && result.confidence >= 0.85 && !['NONE', 'QUERY_TASKS', 'SUMMARIZE'].includes(result.intent);
  if (actionable && result.intent === 'CREATE_TASK' && !result.data.title?.trim()) throw new Error('Missing task title');
  if (actionable && result.intent.startsWith('UPDATE_') && !result.data.task_id) throw new Error('Missing target task');
  if (actionable && result.intent === 'UPDATE_STATUS' && !result.data.status) throw new Error('Missing status');
  if (actionable && result.intent === 'UPDATE_ASSIGNEE' && !result.data.assignee_name?.trim()) throw new Error('Missing assignee');
  if (actionable && result.intent === 'UPDATE_DEADLINE' && result.data.deadline_iso === undefined) throw new Error('Missing deadline');
  if (actionable && result.intent === 'SET_CURRENT_WORK' && !result.data.current_work_text?.trim()) throw new Error('Missing current work');
  return { ...result, actionable };
}
