const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const listeners = {}, displayed = [], opened = [];
  const self = { location: { origin: 'https://work.example.test' }, addEventListener: (name, callback) => { listeners[name] = callback; }, registration: { showNotification: async (title, options) => displayed.push({ title, options }) }, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../apps/web/public/sw.js'), 'utf8'), { self, URL });
  let pending;
  const waitUntil = promise => { pending = promise; };
  listeners.push({ data: { json: () => ({ id: 'n1', title: 'WorkAI', body: 'New message', href: '/chat?conversation=c1' }) }, waitUntil });
  await pending;
  assert.equal(displayed[0].options.tag, 'n1');
  assert.equal(displayed[0].options.data.href, '/chat?conversation=c1');
  listeners.notificationclick({ notification: { close() {}, data: { href: '/chat?conversation=c1' } }, waitUntil });
  await pending;
  assert.equal(opened[0], 'https://work.example.test/chat?conversation=c1');
  for (const href of ['https://evil.test/', 'javascript:alert(1)', '//evil.test/', '/api/v1/auth/logout']) {
    listeners.notificationclick({ notification: { close() {}, data: { href } }, waitUntil });
    await pending;
    assert.equal(opened[opened.length - 1], 'https://work.example.test/today');
  }
  listeners.push({ data: { json: () => { throw new Error('invalid JSON'); } }, waitUntil });
  await pending;
  assert.equal(displayed[1].title, 'WorkAI');
  for (const value of [null, [], 'invalid']) {
    listeners.push({ data: { json: () => value }, waitUntil });
    await pending;
    assert.equal(displayed.at(-1).title, 'WorkAI');
  }
  self.clients.matchAll = async () => [{ url: 'https://work.example.test/chat', navigate: async () => { throw new Error('Closed window'); } }];
  listeners.notificationclick({ notification: { close() {}, data: { href: '/chat' } }, waitUntil });
  await pending;
  assert.equal(opened.at(-1), 'https://work.example.test/chat');
  assert.equal(displayed[0].options.icon, '/icon-192.png');
  console.log('SERVICE WORKER: 13 checks passed (simulated background push, invalid payloads, navigation recovery).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
