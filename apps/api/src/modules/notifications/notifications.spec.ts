import { describe, it, expect } from 'vitest';
import { validPushEndpoint, notificationHref } from './notifications.service';
import { parseClassification } from '../ai/classification';

describe('Push security and automatic classification contracts', () => {
  it.each(['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/token'])('accepts known push services: %s', url => expect(validPushEndpoint(url)).toBe(true));
  it.each(['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://evil.test/?next=https://fcm.googleapis.com', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x'])('rejects unsafe endpoints: %s', url => expect(validPushEndpoint(url)).toBe(false));
  it('builds local encoded deep links', () => expect(notificationHref({ entityType: 'TASK', entityId: 'a&next=https://evil.test' })).toBe('/tasks?task=a%26next%3Dhttps%3A%2F%2Fevil.test'));
  it('social classification never becomes an action even with task vocabulary', () => expect(parseClassification(JSON.stringify({ is_work_instruction: false, intent: 'CREATE_TASK', confidence: 0.99, data: { title: 'Làm giám đốc vũ trụ haha' } })).actionable).toBe(false));
  it('uncertain instructions are not actionable', () => expect(parseClassification(JSON.stringify({ is_work_instruction: true, intent: 'CREATE_TASK', confidence: 0.6, data: { title: 'Hay là để Sang làm nhỉ?' } })).actionable).toBe(false));
  it('accepts a clear model-classified assignment', () => expect(parseClassification(JSON.stringify({ is_work_instruction: true, intent: 'CREATE_TASK', confidence: 0.98, data: { title: 'Thiết kế banner', assignee_name: 'Sang' } })).actionable).toBe(true));
  it.each(['UPDATE_STATUS', 'UPDATE_ASSIGNEE', 'UPDATE_DEADLINE', 'SET_CURRENT_WORK'])('rejects incomplete mutation %s', intent => expect(() => parseClassification(JSON.stringify({ is_work_instruction: true, intent, confidence: 1, data: { task_id: 'task' } }))).toThrow());
  it('rejects missing classification and unknown status', () => {
    expect(() => parseClassification('{"intent":"CREATE_TASK","confidence":1,"data":{}}')).toThrow();
    expect(() => parseClassification(JSON.stringify({ is_work_instruction: true, intent: 'UPDATE_STATUS', confidence: 1, data: { task_id: 'a', status: 'DELETE' } }))).toThrow();
  });
});
