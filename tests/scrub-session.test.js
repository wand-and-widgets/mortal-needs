import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrubSession } from '../scripts/ui/scrub-session.js';

test('many pointer previews yield a single committed value on release', () => {
  const scrub = new ScrubSession(30, 100);
  for (let x = 101; x <= 160; x++) scrub.move(x);
  assert.equal(scrub.finish(), 80);
  assert.equal(scrub.finish(), null);
});
test('Escape, pointer cancellation, and clicks leave the saved value alone', () => {
  const cancelled = new ScrubSession(30, 100);
  cancelled.move(180);
  assert.equal(cancelled.finish(true), null);
  assert.equal(new ScrubSession(30, 100).finish(), null);
  const small = new ScrubSession(30, 100);
  small.move(102);
  assert.equal(small.finish(), null);
});
test('scrubbing clamps to configured bounds and Shift allows finer adjustment', () => {
  const normal = new ScrubSession(50, 100, { min: 20, max: 120 });
  normal.move(-500);
  assert.equal(normal.value, 20);
  normal.move(500);
  assert.equal(normal.value, 120);
  const fine = new ScrubSession(50, 100);
  fine.move(160, true);
  assert.equal(fine.finish(), 60);
});
