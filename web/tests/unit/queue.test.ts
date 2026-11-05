import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WriteQueueCore, type QueueOwner } from '../../src/lib/logic/queue.ts';

function owner(log: string[], name: string): QueueOwner {
  return { failed: () => log.push(`${name}:failed`), dropped: () => log.push(`${name}:dropped`) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('queue: one write at a time, in order', async () => {
  const log: string[] = [];
  const counts: number[] = [];
  const q = new WriteQueueCore((n) => counts.push(n));
  const o = owner(log, 'a');
  let running = 0;
  for (const i of [1, 2, 3]) {
    q.push(async () => {
      running++;
      assert.equal(running, 1);
      await tick();
      log.push(`w${i}`);
      running--;
    }, o);
  }
  await q.idle();
  assert.deepEqual(log, ['w1', 'w2', 'w3']);
  assert.equal(counts.at(-1), 0);
  assert.equal(await q.settled(0), true);
});

test('queue: a failure drops the rest and tells every owner once', async () => {
  const log: string[] = [];
  const q = new WriteQueueCore();
  const a = owner(log, 'a');
  const b = owner(log, 'b');
  const mark = q.mark();
  q.push(async () => { throw new Error('423'); }, a);
  q.push(async () => { log.push('a2'); }, a);
  q.push(async () => { log.push('b1'); }, b);
  q.push(async () => { log.push('b2'); }, b);
  await q.idle();
  assert.deepEqual(log, ['a:failed', 'b:dropped']);
  assert.equal(await q.settled(mark), false);
  // Later writes run again, and a new mark is clean.
  const again = q.mark();
  q.push(async () => { log.push('a3'); }, a);
  assert.equal(await q.settled(again), true);
  assert.equal(log.at(-1), 'a3');
});

test('queue: a failure during a confirmation counts against an earlier mark', async () => {
  const q = new WriteQueueCore();
  const mark = q.mark();
  q.push(async () => { throw new Error('timeout'); }, { failed() {}, dropped() {} });
  await tick();
  await tick();
  assert.equal(await q.settled(mark), false);
});
