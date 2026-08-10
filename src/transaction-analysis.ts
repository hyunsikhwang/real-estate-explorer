import { Transaction, TradeType } from './types';

export interface OverallExtremeIds {
  maxPriceId?: string;
  minPriceId?: string;
  maxDepositId?: string;
  minDepositId?: string;
  maxRentId?: string;
  minRentId?: string;
}

export interface AreaFilterOption {
  value: string;
  area: number;
  pyeong: number;
  label: string;
}

const EARLIEST_TRANSACTION_YEAR: Record<TradeType, number> = {
  [TradeType.SALE]: 2006,
  [TradeType.RENT]: 2011,
};

export const getEarliestTransactionYear = (tradeType: TradeType) =>
  EARLIEST_TRANSACTION_YEAR[tradeType];

export const getAvailableTransactionYears = (
  tradeType: TradeType,
  currentYear = new Date().getFullYear()
) => {
  const earliestYear = getEarliestTransactionYear(tradeType);
  return Array.from(
    { length: Math.max(currentYear - earliestYear + 1, 0) },
    (_, index) => currentYear - index
  );
};

export const getTransactionDateKey = (transaction: Transaction) =>
  `${transaction.dealYear}-${String(transaction.dealMonth).padStart(2, '0')}-${String(transaction.dealDay).padStart(2, '0')}`;

export const isTransactionWithinDateRange = (
  transaction: Transaction,
  dateFrom: string,
  dateTo: string
) => {
  const transactionDate = getTransactionDateKey(transaction);
  return (!dateFrom || transactionDate >= dateFrom) && (!dateTo || transactionDate <= dateTo);
};

export const matchesNumericRange = (
  value: number,
  range: readonly [number, number],
  upperUnbounded = false,
) => value >= range[0] && (upperUnbounded || value <= range[1]);

export const getAreaFilterValue = (transaction: Transaction) => String(transaction.area);

export const getAreaFilterOptions = (transactions: Transaction[]): AreaFilterOption[] => {
  const options = new Map<string, AreaFilterOption>();

  transactions.forEach((transaction) => {
    const value = getAreaFilterValue(transaction);
    if (!options.has(value)) {
      options.set(value, {
        value,
        area: transaction.area,
        pyeong: transaction.pyeong,
        label: `${transaction.area}㎡ / ${transaction.pyeong}평`,
      });
    }
  });

  return Array.from(options.values()).sort((a, b) => a.area - b.area);
};

export const getFloorFilterOptions = (transactions: Transaction[]) =>
  Array.from(new Set(transactions.map((transaction) => transaction.floor))).sort((a, b) => a - b);

const findExtremeId = (
  transactions: Transaction[],
  getValue: (transaction: Transaction) => number,
  direction: 'max' | 'min'
) => {
  if (transactions.length === 0) return undefined;

  return transactions.reduce((selected, transaction) => {
    const selectedValue = getValue(selected);
    const transactionValue = getValue(transaction);
    const shouldReplace = direction === 'max'
      ? transactionValue > selectedValue
      : transactionValue < selectedValue;

    return shouldReplace ? transaction : selected;
  }).id;
};

export const findOverallExtremeIds = (
  transactions: Transaction[],
  tradeType: TradeType
): OverallExtremeIds => {
  if (tradeType === TradeType.SALE) {
    return {
      maxPriceId: findExtremeId(transactions, (transaction) => transaction.price, 'max'),
      minPriceId: findExtremeId(transactions, (transaction) => transaction.price, 'min'),
    };
  }

  const depositTransactions = transactions.filter((transaction) => transaction.monthlyRent === 0);
  const monthlyRentTransactions = transactions.filter((transaction) => transaction.monthlyRent > 0);

  return {
    maxDepositId: findExtremeId(depositTransactions, (transaction) => transaction.price, 'max'),
    minDepositId: findExtremeId(depositTransactions, (transaction) => transaction.price, 'min'),
    maxRentId: findExtremeId(monthlyRentTransactions, (transaction) => transaction.monthlyRent, 'max'),
    minRentId: findExtremeId(monthlyRentTransactions, (transaction) => transaction.monthlyRent, 'min'),
  };
};
