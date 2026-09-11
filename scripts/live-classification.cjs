// Opt-in live provider regression. Reads one authorized room context; never writes tasks/messages.
const assert = require('node:assert/strict');
const path = require('node:path');
const { aiService } = require(path.resolve('apps/api/dist/modules/ai/ai.service'));
const { parseClassification } = require(path.resolve('apps/api/dist/modules/ai/classification'));
const { db } = require(path.resolve('apps/api/dist/services/db.service'));

async function main() {
  assert.equal(process.env.TEST_LIVE_AI, 'true', 'Explicitly opt in to paid live calls');
  assert(process.env.TEST_CLASSIFICATION_MESSAGE_ID, 'Specify the source message to supply room context');
  const source = await db.message.findUniqueOrThrow({ where: { id: process.env.TEST_CLASSIFICATION_MESSAGE_ID }, include: { sender: true } });
  assert(!source.assistantReply, 'Use a plain assignment message as the context source');
  const originalCall = aiService.callVertexGemini.bind(aiService);
  const find = db.aiAction.findFirst;
  const transaction = db.$transaction;
  const captured = new Error('Read-only prompt capture');
  let input, instruction;
  // Intercept only this isolated process; prevent the analysis transaction from running.
  try {
    db.aiAction.findFirst = async () => null;
    db.$transaction = async () => { throw captured; };
    aiService.callVertexGemini = async (prompt, system) => {
      input = JSON.parse(prompt);
      instruction = system;
      throw captured;
    };
    await aiService.processIncomingMessage(source.id, source.conversationId, source.senderId, source.content, source.sender.orgId);
  } catch (error) {
    if (error !== captured) throw error;
  } finally {
    db.aiAction.findFirst = find;
    db.$transaction = transaction;
    aiService.callVertexGemini = originalCall;
  }
  assert(input && instruction, 'Capture the actual production classifier prompt');
  const assignee = input.members.find(m => m.name === 'Nguyễn Văn Sang');
  assert(assignee, 'This Vietnamese regression requires Sang in the scoped room');
  const cases = [
    { message: '@Nguyễn Văn Sang mai done task SEO cho Tuấn nhe', intent: 'CREATE_TASK', actionable: true },
    { message: 'Sang mai nay done cho Tuấn task SEO nha', intent: 'CREATE_TASK', actionable: true },
    { message: '@Nguyễn Văn Sang mai done task SEO cho Tuấn nhe haha, xong đi cà phê', intent: 'CREATE_TASK', actionable: true },
    { message: '@Nguyễn Văn Sang mai đi cà phê với Tuấn nha', intent: 'NONE', actionable: false },
    { message: '@Nguyễn Văn Sang chưa cần làm SEO cho Tuấn, đợi xác nhận đã nha', intent: 'NONE', actionable: false },
    { message: 'Task SEO cho Tuấn xong rồi nha', intent: 'UPDATE_STATUS', actionable: true, existing: true },
    { message: '@b6 task SEO cho Tuấn tới đâu rồi?', intent: 'QUERY_TASKS', actionable: false, existing: true }
  ];
  const failures = [];
  for (const test of cases) {
    try {
      const context = { ...input, message: test.message, ...(test.existing ? { tasks: [{ id: 'test-seo-reference', title: 'SEO cho Tuấn', status: 'IN_PROGRESS', version: 1, assigneeId: assignee.id }] } : {}) };
      const parsed = parseClassification(await originalCall(JSON.stringify(context), instruction));
      console.log(JSON.stringify({ message: test.message, result: parsed }));
      assert.equal(parsed.intent, test.intent);
      assert.equal(parsed.actionable, test.actionable);
      if (test.intent === 'CREATE_TASK') assert.equal(parsed.data.assignee_name, assignee.name);
      if (test.intent === 'UPDATE_STATUS') {
        assert.equal(parsed.data.task_id, 'test-seo-reference');
        assert.equal(parsed.data.status, 'COMPLETED');
      }
    } catch (error) {
      failures.push(new Error(`${test.message}: ${error.message}`));
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length}/${cases.length} live classification cases failed`);
  console.log(`LIVE CLASSIFICATION: ${cases.length} cases passed (real Vertex, no task mutations).`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
