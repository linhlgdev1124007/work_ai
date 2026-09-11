import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from '../../services/db.service';

export const aiUsageScope = new AsyncLocalStorage<{ orgId: string }>();

export async function recordUsage(model: string, metadata: any) {
  const scope = aiUsageScope.getStore();
  if (!scope || !metadata) return;
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const cachedInputTokens = Math.min(count(metadata.cachedContentTokenCount), count(metadata.promptTokenCount));
  try {
    await db.aiTokenUsage.create({ data: {
      orgId: scope.orgId, model,
      inputTokens: count(metadata.promptTokenCount) - cachedInputTokens + count(metadata.toolUsePromptTokenCount),
      cachedInputTokens,
      outputTokens: count(metadata.candidatesTokenCount) + count(metadata.thoughtsTokenCount)
    } });
  } catch (error) {
    console.error('Could not persist AI token usage', error);
  }
}
