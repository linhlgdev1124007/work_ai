import { describe, it, expect } from 'vitest';
import { searchService } from '../search/search.service';
import { tasksService } from '../tasks/tasks.service';
import { db } from '../../services/db.service';

describe('Kiểm Thử Hiệu Năng & Tải (Phase 4 Load & Performance Benchmark)', () => {
  it('Benchmark: Universal Search đáp ứng p95 < 2000ms với tiếng Việt không dấu', async () => {
    const admin = await db.user.findFirst({ where: { systemRole: 'ADMIN' } });
    const org = await db.organization.findFirst();

    const iterations = 50;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await searchService.universalSearch('kiem tra banner', {
        userId: admin!.id,
        orgId: org!.id,
        systemRole: admin!.systemRole
      });
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(`📊 Benchmark Search p95 Latency: ${p95.toFixed(2)}ms (Tiêu chuẩn: < 2000ms)`);
    expect(p95).toBeLessThan(2000);
  });

  it('Benchmark: Truy vấn Task Today đáp ứng p95 < 1000ms', async () => {
    const sang = await db.user.findFirst({ where: { email: 'sang@techcorp.vn' } });

    const iterations = 50;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await tasksService.getTodayTasks(sang!.id);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(`📊 Benchmark Today Query p95 Latency: ${p95.toFixed(2)}ms (Tiêu chuẩn: < 1000ms)`);
    expect(p95).toBeLessThan(1000);
  });
});
