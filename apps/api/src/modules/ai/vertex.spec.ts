import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';
import { config } from '../../config';

const originalModel = config.vertex.model;
afterEach(() => {
  config.vertex.model = originalModel;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(responses: unknown[]) {
  const service = new AiService();
  vi.spyOn((service as any).auth, 'getClient').mockResolvedValue({ getAccessToken: async () => ({ token: 'test-token' }) });
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  return { service, fetchMock };
}

const completed = (text: string) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
const truncated = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"confidence":0' }] } }] };

describe('Vertex response completeness and token budget', () => {
  it('reserves a JSON budget without hidden Flash thinking consuming it', async () => {
    config.vertex.model = 'gemini-2.5-flash';
    const { service, fetchMock } = setup([completed('{}')]);
    expect(await service.callVertexGemini('assignment', 'Classify')).toBe('{}');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' });
  });

  it('retries truncated JSON only once with a bounded larger budget', async () => {
    const { service, fetchMock } = setup([truncated, completed('{}')]);
    expect(await service.callVertexGemini('assignment', 'Classify')).toBe('{}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig.maxOutputTokens).toBe(4096);
  });

  it('never returns truncated output after the retry is exhausted', async () => {
    const { service, fetchMock } = setup([truncated, truncated]);
    await expect(service.callVertexGemini('assignment', 'Classify')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry blocked content or accept its partial text', async () => {
    const { service, fetchMock } = setup([{ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{}' }] } }] }]);
    await expect(service.callVertexGemini('assignment')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('joins visible text parts and excludes thought parts', async () => {
    const { service } = setup([{ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private thinking' }, { text: '{' }, { text: '}' }] } }] }]);
    expect(await service.callVertexGemini('assignment', 'Classify')).toBe('{}');
  });

  it('does not disable thinking on models which do not support zero budget', async () => {
    config.vertex.model = 'gemini-2.5-pro';
    const { service, fetchMock } = setup([completed('OK')]);
    await service.callVertexGemini('hello');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.thinkingConfig).toBeUndefined();
  });

  it('references an explicit project cache when one is available', async () => {
    config.vertex.model = 'gemini-3.8-flash';
    const { service, fetchMock } = setup([completed('{}')]);
    await service.callVertexGemini('assignment', 'Classify', 'projects/test/locations/global/cachedContents/project-cache');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.cachedContent).toBe('projects/test/locations/global/cachedContents/project-cache');
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });
});
