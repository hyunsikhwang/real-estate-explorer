/**
 * Global Constants and Types for Real Estate Explorer
 */

export enum TradeType {
  SALE = "매매",
  RENT = "전월세"
}

export interface Transaction {
  apartmentName: string;
  price: number; // For Sale: dealAmount, For Rent: deposit
  monthlyRent: number;
  area: number;
  floor: number;
  dealYear: number;
  dealMonth: number;
  dealDay: number;
  buildYear: number;
  dong: string;
  pyeong: number; // Calculated
  id: string;
  jibun?: string;
  // Rent specific fields
  contractLevel?: string; // 신규/갱신
  useRequestRenew?: string; // 갱신요구권 사용여부
  previousDeposit?: number; // 종전 보증금
  previousMonthlyRent?: number; // 종전 월세
}

export interface Region {
  code: string;
  name: string;
}
