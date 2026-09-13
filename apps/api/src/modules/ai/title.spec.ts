import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

afterEach(() => { vi.restoreAllMocks(); });
const context = { room: { name: 'Web', team: { name: 'Web' }, project: { name: 'Jeminise' } }, recentMessages: 'Tuấn: Phần SEO của website Jeminise cần hoàn thành.', activeTasks: [{ title: 'Chuẩn bị nội dung Jeminise', status: 'IN_PROGRESS' }] } as any;

describe('Context-aware task title editing', () => {
  it('uses extracted information and scoped context in a separate call', async () => {
    const service = new AiService();
    const call = vi.spyOn(service, 'callVertexGemini').mockResolvedValue(JSON.stringify({ title: 'Hoàn thành công việc SEO cho Tuấn', description: 'Nội dung test' }));
    const result = await service.refineTaskTitle({ title: 'SEO cho Tuấn', assignee_name: 'Nguyễn Văn Sang' }, 'Sang mai done SEO cho Tuấn nha', context);
    expect(result).toEqual({ title: 'Hoàn thành công việc SEO cho Tuấn', description: 'Nội dung test', status: 'REFINED' });
    const input = JSON.parse(call.mock.calls[0][0]);
    expect(input.extracted.title).toBe('SEO cho Tuấn');
    expect(input.room.project.name).toBe('Jeminise');
    expect(input.tasks).toEqual(context.activeTasks);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each(['{}', '{"title":""}', JSON.stringify({ title: 'a'.repeat(161) }), JSON.stringify({ title: 'Valid title', assignee_id: 'injected' }), JSON.stringify({ title: 'Line one\nLine two' })])('preserves extracted title on invalid editor output: %s', async raw => {
    const service = new AiService();
    vi.spyOn(service, 'callVertexGemini').mockResolvedValue(raw);
    expect(await service.refineTaskTitle({ title: 'SEO cho Tuấn' }, 'source', context)).toEqual({ title: 'SEO cho Tuấn', description: 'source', status: 'FALLBACK' });
  });

  it('keeps a validated task proposal usable during editor outages', async () => {
    const service = new AiService();
    vi.spyOn(service, 'callVertexGemini').mockRejectedValue(new Error('Unavailable'));
    expect(await service.refineTaskTitle({ title: 'SEO cho Tuấn' }, 'source', context)).toEqual({ title: 'SEO cho Tuấn', description: 'source', status: 'FALLBACK' });
  });
});
