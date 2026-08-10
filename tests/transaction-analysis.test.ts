import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findOverallExtremeIds,
  getAvailableTransactionYears,
  getAreaFilterOptions,
  getAreaFilterValue,
  getEarliestTransactionYear,
  getFloorFilterOptions,
  getTransactionDateKey,
  isTransactionWithinDateRange,
  matchesNumericRange,
} from '../src/transaction-analysis';
import { Transaction, TradeType } from '../src/types';

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  apartmentName: '테스트 아파트',
  price: 0,
  monthlyRent: 0,
  area: 84,
  floor: 10,
  dealYear: 2026,
  dealMonth: 8,
  dealDay: 7,
  buildYear: 2020,
  dong: '잠실동',
  pyeong: 25,
  id: 'base',
  ...overrides,
});

test('매매와 전월세의 공식 공개 시작 연도를 반환한다', () => {
  assert.equal(getEarliestTransactionYear(TradeType.SALE), 2006);
  assert.equal(getEarliestTransactionYear(TradeType.RENT), 2011);
});

test('거래 유형별 시작 연도부터 현재 연도까지 내림차순 선택지를 만든다', () => {
  const saleYears = getAvailableTransactionYears(TradeType.SALE, 2026);
  const rentYears = getAvailableTransactionYears(TradeType.RENT, 2026);

  assert.deepEqual(saleYears.slice(0, 3), [2026, 2025, 2024]);
  assert.equal(saleYears.at(-1), 2006);
  assert.equal(rentYears.at(-1), 2011);
});

test('면적 필터 옵션을 실제 제곱미터와 평 조합으로 중복 없이 정렬한다', () => {
  const rows = [
    transaction({ id: 'large', area: 84.97, pyeong: 26 }),
    transaction({ id: 'small', area: 59.9, pyeong: 18 }),
    transaction({ id: 'same-large', area: 84.97, pyeong: 26 }),
  ];

  assert.equal(getAreaFilterValue(rows[0]), '84.97');
  assert.deepEqual(getAreaFilterOptions(rows), [
    { value: '59.9', area: 59.9, pyeong: 18, label: '59.9㎡ / 18평' },
    { value: '84.97', area: 84.97, pyeong: 26, label: '84.97㎡ / 26평' },
  ]);
});

test('층 필터 옵션을 현재 거래 목록에서 중복 없이 정렬한다', () => {
  const rows = [
    transaction({ id: 'high', floor: 15 }),
    transaction({ id: 'low', floor: 2 }),
    transaction({ id: 'same-high', floor: 15 }),
  ];

  assert.deepEqual(getFloorFilterOptions(rows), [2, 15]);
});

test('거래일을 날짜 입력값과 비교 가능한 형식으로 만든다', () => {
  assert.equal(getTransactionDateKey(transaction({ dealMonth: 2, dealDay: 3 })), '2026-02-03');
});

test('거래일 범위 필터는 시작일과 종료일을 모두 포함한다', () => {
  const row = transaction({ dealMonth: 8, dealDay: 7 });

  assert.equal(isTransactionWithinDateRange(row, '2026-08-07', '2026-08-07'), true);
  assert.equal(isTransactionWithinDateRange(row, '2026-08-08', ''), false);
  assert.equal(isTransactionWithinDateRange(row, '', '2026-08-06'), false);
});

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

test('매매 극값은 필터 결과 전체에서 각 1건을 선택하고 동률이면 첫 거래를 유지한다', () => {
  const result = findOverallExtremeIds([
    transaction({ id: 'latest-max', price: 120000 }),
    transaction({ id: 'same-max', price: 120000 }),
    transaction({ id: 'min', price: 70000 }),
  ], TradeType.SALE);

  assert.deepEqual(result, {
    maxPriceId: 'latest-max',
    minPriceId: 'min',
  });
});

test('전월세 극값은 전세 보증금과 월세를 구분해 각 1건을 선택한다', () => {
  const result = findOverallExtremeIds([
    transaction({ id: 'deposit-max', price: 80000, monthlyRent: 0 }),
    transaction({ id: 'deposit-min', price: 30000, monthlyRent: 0 }),
    transaction({ id: 'rent-max', price: 10000, monthlyRent: 250 }),
    transaction({ id: 'rent-min', price: 5000, monthlyRent: 80 }),
  ], TradeType.RENT);

  assert.deepEqual(result, {
    maxDepositId: 'deposit-max',
    minDepositId: 'deposit-min',
    maxRentId: 'rent-max',
    minRentId: 'rent-min',
  });
});
