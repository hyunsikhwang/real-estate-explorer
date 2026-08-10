import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesNumericRange } from '../src/filterUtils';

test('숫자 범위 필터는 기본적으로 하한과 상한을 모두 적용한다', () => {
  assert.equal(matchesNumericRange(100, [100, 200]), true);
  assert.equal(matchesNumericRange(200, [100, 200]), true);
  assert.equal(matchesNumericRange(99, [100, 200]), false);
  assert.equal(matchesNumericRange(201, [100, 200]), false);
});

test('상한 없음 옵션은 하한을 유지하면서 숫자 상한을 제거한다', () => {
  assert.equal(matchesNumericRange(99, [100, 200], true), false);
  assert.equal(matchesNumericRange(200, [100, 200], true), true);
  assert.equal(matchesNumericRange(1_000_000, [100, 200], true), true);
});
