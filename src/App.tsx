import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Autocomplete,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
  LinearProgress,
  Alert,
  Chip,
  IconButton,
  Drawer,
  AppBar,
  Toolbar,
  useTheme,
  useMediaQuery,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Slider,
  InputAdornment,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
} from '@mui/material';
import {
  Search,
  Building2,
  Calendar,
  Home,
  Menu as MenuIcon,
  RotateCcw,
} from 'lucide-react';
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';
import axios from 'axios';
import { format, subMonths } from 'date-fns';
import {
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts';
import { Transaction, TradeType, Region } from './types';
import confetti from 'canvas-confetti';

// --- Utility Functions ---
const parsePrice = (val: any) => {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === 'number') return val;
  return parseInt(String(val).replace(/,/g, ''), 10) || 0;
};

const calcPyeong = (m2: number) => Math.round(m2 / 3.305);

const DRAWER_WIDTH = 320;

const darkTheme = createTheme({
  typography: {
    fontFamily: '"Inter", "Pretendard", sans-serif',
    fontSize: 13, // Slightly smaller base size
    h1: { fontSize: '2.5rem', fontWeight: 900 },
    h2: { fontSize: '2rem', fontWeight: 800 },
    h3: { fontSize: '1.75rem', fontWeight: 800 },
    h4: { fontSize: '1.5rem', fontWeight: 800 },
    h5: { fontSize: '1.25rem', fontWeight: 700 },
    h6: { fontSize: '1rem', fontWeight: 700 },
    body1: { fontSize: '0.925rem' },
    body2: { fontSize: '0.825rem' },
    caption: { fontSize: '0.75rem' },
  },
  palette: {
    primary: { main: '#2563eb' },
    secondary: { main: '#6366f1' },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '8px 12px',
          fontSize: '0.825rem',
        }
      }
    }
  }
});

export default function App() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastSearchPeriod, setLastSearchPeriod] = useState<string | null>(null);

  // States
  const [loading, setLoading] = useState(false);
  const [tradeType, setTradeType] = useState<TradeType>(TradeType.SALE);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>({ code: "11710", name: "서울특별시 송파구" });
  const [regionInput, setRegionInput] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const uniqueFloors = useMemo(() => {
    const floors = allTransactions.map(t => t.floor);
    const unique = Array.from(new Set(floors)).sort((a, b) => a - b);
    return unique;
  }, [allTransactions]);
  const uniquePyeongs = useMemo(() => {
    const pyeongs = allTransactions.map(t => t.pyeong);
    const unique = Array.from(new Set(pyeongs)).sort((a, b) => a - b);
    return unique;
  }, [allTransactions]);
  const [chartMode, setChartMode] = useState<'individual' | 'converted'>('individual');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Filtering States
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500000]);
  const [areaRange, setAreaRange] = useState<[number, number]>([0, 200]);

  // Period States
  const [startYear, setStartYear] = useState(new Date().getFullYear() - 1);
  const [startMonth, setStartMonth] = useState(new Date().getMonth() + 1);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const [endMonth, setEndMonth] = useState(new Date().getMonth() + 1);

  // Table Column Filters DRAFT (for keyboard entry)
  const [tableFiltersDraft, setTableFiltersDraft] = useState({
    contractLevel: '',
    useRequestRenew: '',
    floor: [] as string[],
    dong: '',
    priceMin: '',
    priceMax: '',
    rentMin: '',
    rentMax: '',
    areaCategory: [] as string[]
  });

  // Committed Table Column Filters (applied on Enter)
  const [tableFilters, setTableFilters] = useState({
    contractLevel: '',
    useRequestRenew: '',
    floor: [] as string[],
    dong: '',
    priceMin: '',
    priceMax: '',
    rentMin: '',
    rentMax: '',
    areaCategory: [] as string[]
  });

  const [lastWorkingFilters, setLastWorkingFilters] = useState<{
    keywordDraft: string;
    keyword: string;
    priceRange: [number, number];
    areaRange: [number, number];
    tableFiltersDraft: typeof tableFiltersDraft;
    tableFilters: typeof tableFilters;
  } | null>(null);

  const [config, setConfig] = useState<{ hasServiceKey: boolean }>({ hasServiceKey: false });

  // Fetch Config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await axios.get('/api/config');
        setConfig(res.data);
      } catch (e) {
        console.error("Config fetch failed", e);
      }
    };
    fetchConfig();
  }, []);

  // Fetch Regions
  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const res = await axios.get('/api/regions');
        setRegions(res.data);
      } catch (e) {
        console.error("Failed to load regions", e);
      }
    };
    fetchRegions();
  }, []);

  const handleSearch = useCallback(async () => {
    if (!selectedRegion || loading) return;
    setLoading(true);
    setAllTransactions([]); // Clear previous results
    
    // Synchronize the search keyword with the current draft input
    setKeyword(keywordDraft);
    const apiKeyword = keywordDraft;
    
    try {
      const months: string[] = [];
      let currentYear = startYear;
      let currentMonth = startMonth;

      while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
        months.push(`${currentYear}${String(currentMonth).padStart(2, '0')}`);
        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
      }
      
      let combined: Transaction[] = [];
      const searchPeriod = `${startYear}.${String(startMonth).padStart(2, '0')} ~ ${endYear}.${String(endMonth).padStart(2, '0')}`;
      let lastError: any = null;
      let successCount = 0;
      
      for (const month of months) {
        try {
          const res = await axios.get('/api/transactions', {
            params: { 
              sigunguCode: selectedRegion.code, 
              dealMonth: month, 
              tradeType,
              keyword: apiKeyword
            }
          });

          console.log(`[DEBUG] Month: ${month}, Status: ${res.status}`);
          
          // The response might be under diferentes names depending on the specific API version successful in server.ts
          const data = res.data;
          const body = data?.response?.body;
          let rawItems = body?.items?.item || body?.items || data?.items || [];
          
          if (!rawItems && data?.response?.body?.totalCount > 0) {
            console.warn(`[DEBUG] Data has totalCount ${data.response.body.totalCount} but items are missing. Check structure:`, Object.keys(data.response.body));
          }

          // Ensure rawItems is an array
          if (rawItems && !Array.isArray(rawItems)) {
            rawItems = [rawItems];
          }

          successCount++;
          
          if (!rawItems || rawItems.length === 0) {
            console.log(`[DEBUG] No items found for month ${month}`);
            continue;
          }

          const normalized = rawItems.filter((i: any) => i).map((item: any, idx: number) => {
            // Robust mapping using multiple possible keys for each field
            const apartmentName = (
              item.aptNm || 
              item.아파트 || 
              item.건물명 || 
              item.단지 || 
              item.aptName || 
              item.apartmentName ||
              "알 수 없음"
            ).trim();
            
            const rawArea = item.excluUseAr || item.exclArea || item.excluArea || item.area || item.exclusiveArea || item.전용면적 || "0";
            const area = parseFloat(String(rawArea).replace(/,/g, ''));

            const price = parsePrice(
              item.dealAmount || 
              item.deposit || 
              item.거래금액 || 
              item.보증금액 || 
              item.보증금 || 
              item.price ||
              "0"
            );
            
            const monthlyRent = parsePrice(
              item.monthlyRent || 
              item.월세액 || 
              item.월세 || 
              item.월세금액 || 
              item.rent ||
              "0"
            );

            const contractLevel = item.contractType || item.contractLevel || item.신규갱신구분 || item.계약구분 || "-";
            const useRequestRenew = item.renewalRequestUsage || item.renewalUsage || item.useRequestRenew || item.갱신요구권사용여부 || "-";
            const previousDeposit = parsePrice(item.preDeposit || item.previousDeposit || item.종전보증금 || item.종전보증금액 || "0");
            const previousMonthlyRent = parsePrice(item.preMonthlyRent || item.previousMonthlyRent || item.종전월세 || item.종전월세액 || "0");
            
            const dong = item.umdNm || item.dong || item.법정동 || "";
            const floor = parseInt(item.floor || item.flr || item.층 || "0");
            
            const yearStr = item.dealYear || item.year || item.년 || item.deal_year || "0";
            const monthStr = item.dealMonth || item.month || item.월 || item.deal_month || "0";
            const dayStr = item.dealDay || item.day || item.일 || item.deal_day || "0";
            
            let dealYear = parseInt(String(yearStr));
            let dealMonth = parseInt(String(monthStr));
            let dealDay = parseInt(String(dayStr));

            if (dealYear === 0) dealYear = parseInt(month.substring(0, 4));
            if (dealMonth === 0) dealMonth = parseInt(month.substring(4, 6));
            if (dealDay === 0) dealDay = 1;

            const buildYear = parseInt(item.buildYear || item.건축년도 || "0");

            return {
              id: `${month}-${tradeType}-${idx}-${Math.random().toString(36).substring(2, 9)}`,
              apartmentName,
              price,
              monthlyRent,
              area,
              floor,
              dealYear,
              dealMonth,
              dealDay,
              buildYear,
              dong,
              pyeong: calcPyeong(area),
              contractLevel,
              useRequestRenew,
              previousDeposit,
              previousMonthlyRent,
            };
          });
          
          combined = [...combined, ...normalized];
        } catch (monthError: any) {
          console.warn(`Failed to fetch for ${month}:`, monthError);
          lastError = monthError;
        }
      }

      if (successCount === 0 && lastError) {
        throw lastError; // Re-throw to handle in outer catch
      }

      setAllTransactions(combined);
      setLastSearchPeriod(searchPeriod);
      
      if (combined.length > 0) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    } catch (e: any) {
      console.error("Search failed:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedRegion, tradeType, startYear, startMonth, endYear, endMonth, keywordDraft, loading]);

  const handleResetFilters = useCallback(() => {
    setKeywordDraft('');
    setKeyword('');
    setPriceRange([0, 500000]);
    setAreaRange([0, 200]);
    const initialFilters = {
      contractLevel: '',
      useRequestRenew: '',
      floor: [] as string[],
      dong: '',
      priceMin: '',
      priceMax: '',
      rentMin: '',
      rentMax: '',
      areaCategory: [] as string[]
    };
    setTableFiltersDraft(initialFilters);
    setTableFilters(initialFilters);
  }, []);

  const filteredTransactions = useMemo(() => {
    return allTransactions
      .filter(t => {
        const matchKeyword = keyword ? t.apartmentName.includes(keyword) : true;
        const matchPrice = t.price >= priceRange[0] && t.price <= priceRange[1];
        const matchArea = t.area >= areaRange[0] && t.area <= areaRange[1];
        
        // Table Column Filters
        const matchContract = tableFilters.contractLevel ? t.contractLevel === tableFilters.contractLevel : true;
        const matchRenew = tableFilters.useRequestRenew ? t.useRequestRenew === tableFilters.useRequestRenew : true;
        const matchFloor = tableFilters.floor.length > 0 ? tableFilters.floor.includes(String(t.floor)) : true;
        const matchDong = tableFilters.dong 
          ? (t.apartmentName.toLowerCase().includes(tableFilters.dong.toLowerCase()) || t.dong.toLowerCase().includes(tableFilters.dong.toLowerCase()))
          : true;

        const matchTablePriceMin = tableFilters.priceMin ? t.price >= Number(tableFilters.priceMin) : true;
        const matchTablePriceMax = tableFilters.priceMax ? t.price <= Number(tableFilters.priceMax) : true;
        const matchTableRentMin = tableFilters.rentMin ? t.monthlyRent >= Number(tableFilters.rentMin) : true;
        const matchTableRentMax = tableFilters.rentMax ? t.monthlyRent <= Number(tableFilters.rentMax) : true;
        
        let matchAreaCategory = true;
        if (tableFilters.areaCategory.length > 0) {
          matchAreaCategory = tableFilters.areaCategory.includes(String(t.pyeong));
        }

        return matchKeyword && matchPrice && matchArea && matchContract && matchRenew && matchFloor && matchDong &&
               matchTablePriceMin && matchTablePriceMax && matchTableRentMin && matchTableRentMax &&
               matchAreaCategory;
      })
      .sort((a, b) => {
        // Sort by year, then month, then day descending
        if (b.dealYear !== a.dealYear) return b.dealYear - a.dealYear;
        if (b.dealMonth !== a.dealMonth) return b.dealMonth - a.dealMonth;
        return b.dealDay - a.dealDay;
      });
  }, [allTransactions, keyword, priceRange, areaRange, tableFilters]);

  // Reset table page to 0 when filtered results change
  useEffect(() => {
    setPage(0);
  }, [filteredTransactions]);

  // Save filter state whenever we have results
  useEffect(() => {
    if (filteredTransactions.length > 0) {
      setLastWorkingFilters({
        keywordDraft,
        keyword,
        priceRange: [priceRange[0], priceRange[1]],
        areaRange: [areaRange[0], areaRange[1]],
        tableFiltersDraft: { ...tableFiltersDraft },
        tableFilters: { ...tableFilters }
      });
    }
  }, [filteredTransactions.length, keyword, keywordDraft, priceRange, areaRange, tableFilters, tableFiltersDraft]);

  const handleRestoreFilters = useCallback(() => {
    if (lastWorkingFilters) {
      setKeywordDraft(lastWorkingFilters.keywordDraft);
      setKeyword(lastWorkingFilters.keyword);
      setPriceRange(lastWorkingFilters.priceRange);
      setAreaRange(lastWorkingFilters.areaRange);
      setTableFiltersDraft(lastWorkingFilters.tableFiltersDraft);
      setTableFilters(lastWorkingFilters.tableFilters);
    }
  }, [lastWorkingFilters]);

  const chartData = useMemo(() => {
    const grouped = filteredTransactions.reduce((acc: any, cur) => {
      const key = `${cur.dealYear}.${String(cur.dealMonth).padStart(2, '0')}`;
      if (!acc[key]) acc[key] = { 
        name: key, 
        prices: [] as number[],
        deposits: [] as number[],
        rents: [] as number[],
        items: [] as any[],
        count: 0 
      };
      
      if (tradeType === TradeType.SALE) {
        acc[key].prices.push(cur.price);
      } else {
        acc[key].deposits.push(cur.price);
        acc[key].rents.push(cur.monthlyRent);
        acc[key].items.push(cur);
      }
      
      acc[key].count += 1;
      return acc;
    }, {});

    return Object.values(grouped).map((v: any) => {
      // For Sale
      let avgPrice = 0;
      let maxPrice = 0;
      let minPrice = 0;
      if (v.prices.length > 0) {
        const sum = v.prices.reduce((s: number, p: number) => s + p, 0);
        avgPrice = Math.round(sum / v.prices.length);
        maxPrice = Math.max(...v.prices);
        minPrice = Math.min(...v.prices);
      }

      // For Rent
      let avgDeposit = 0;
      let maxDeposit: number | null = null;
      let minDeposit: number | null = null;
      if (v.deposits.length > 0) {
        const sum = v.deposits.reduce((s: number, d: number) => s + d, 0);
        avgDeposit = Math.round(sum / v.deposits.length);
      }

      // Max/Min Deposit: Filter only for items with monthlyRent === 0 (전세)
      if (v.items && v.items.length > 0) {
        const jeonseDeposits = v.items.filter((item: any) => item.monthlyRent === 0).map((item: any) => item.price);
        if (jeonseDeposits.length > 0) {
          maxDeposit = Math.max(...jeonseDeposits);
          minDeposit = Math.min(...jeonseDeposits);
        }
      }

      let avgMonthlyRent = 0;
      let maxMonthlyRent: number | null = null;
      let minMonthlyRent: number | null = null;
      if (v.rents.length > 0) {
        const sum = v.rents.reduce((s: number, r: number) => s + r, 0);
        avgMonthlyRent = Math.round(sum / v.rents.length);
      }

      // Max/Min Rent: Filter only for items with monthlyRent > 0 (월세)
      if (v.items && v.items.length > 0) {
        const activeRents = v.items.filter((item: any) => item.monthlyRent > 0).map((item: any) => item.monthlyRent);
        if (activeRents.length > 0) {
          maxMonthlyRent = Math.max(...activeRents);
          minMonthlyRent = Math.min(...activeRents);
        }
      }

      // Equivalents
      // Conversion logic (Annual rate 5.5% = 0.055)
      // Deposit Equivalent = Current Deposit + (Monthly Rent * 12 / 0.055)
      const avgDepositEquiv = Math.round(avgDeposit + (avgMonthlyRent * 12 / 0.055));
      // Rent Equivalent = Current Monthly Rent + (Deposit * 0.055 / 12)
      const avgRentEquiv = Math.round(avgMonthlyRent + (avgDeposit * 0.055 / 12));

      let maxDepositEquiv = 0;
      let minDepositEquiv = 0;
      let maxRentEquiv = 0;
      let minRentEquiv = 0;

      if (tradeType !== TradeType.SALE && v.deposits.length > 0) {
        const equivs = v.deposits.map((dep: number, idx: number) => {
          const rnt = v.rents[idx];
          const depEq = Math.round(dep + (rnt * 12 / 0.055));
          const rntEq = Math.round(rnt + (dep * 0.055 / 12));
          return { depEq, rntEq };
        });
        const depEqs = equivs.map((e: any) => e.depEq);
        const rntEqs = equivs.map((e: any) => e.rntEq);
        maxDepositEquiv = Math.max(...depEqs);
        minDepositEquiv = Math.min(...depEqs);
        maxRentEquiv = Math.max(...rntEqs);
        minRentEquiv = Math.min(...rntEqs);
      }

      return {
        ...v,
        avgPrice,
        maxPrice,
        minPrice,
        avgDeposit,
        maxDeposit,
        minDeposit,
        avgMonthlyRent,
        maxMonthlyRent,
        minMonthlyRent,
        avgDepositEquiv,
        maxDepositEquiv,
        minDepositEquiv,
        avgRentEquiv,
        maxRentEquiv,
        minRentEquiv,
        tradeCount: v.count
      };
    }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [filteredTransactions, tradeType]);

  const monthlyExtremes = useMemo(() => {
    if (tradeType === TradeType.SALE) {
      const extremes: Record<string, { 
        maxPrice: number; 
        minPrice: number;
        maxPriceIds: Set<string>;
        minPriceIds: Set<string>;
        count: number;
      }> = {};

      filteredTransactions.forEach((row) => {
        const monthKey = `${row.dealYear}.${String(row.dealMonth).padStart(2, '0')}`;
        const val = row.price;

        if (!extremes[monthKey]) {
          extremes[monthKey] = {
            maxPrice: val,
            minPrice: val,
            maxPriceIds: new Set([row.id]),
            minPriceIds: new Set([row.id]),
            count: 1
          };
        } else {
          extremes[monthKey].count += 1;
          
          if (val > extremes[monthKey].maxPrice) {
            extremes[monthKey].maxPrice = val;
            extremes[monthKey].maxPriceIds = new Set([row.id]);
          } else if (val === extremes[monthKey].maxPrice) {
            extremes[monthKey].maxPriceIds.add(row.id);
          }

          if (val < extremes[monthKey].minPrice) {
            extremes[monthKey].minPrice = val;
            extremes[monthKey].minPriceIds = new Set([row.id]);
          } else if (val === extremes[monthKey].minPrice) {
            extremes[monthKey].minPriceIds.add(row.id);
          }
        }
      });
      return { sale: extremes, rent: {} as Record<string, any> };
    } else {
      const extremes: Record<string, {
        maxDeposit?: number;
        minDeposit?: number;
        maxDepositIds: Set<string>;
        minDepositIds: Set<string>;
        maxRent?: number;
        minRent?: number;
        maxRentIds: Set<string>;
        minRentIds: Set<string>;
        count: number;
      }> = {};

      filteredTransactions.forEach((row) => {
        const monthKey = `${row.dealYear}.${String(row.dealMonth).padStart(2, '0')}`;
        const dep = row.price; // 보증금
        const rnt = row.monthlyRent; // 월세

        if (!extremes[monthKey]) {
          extremes[monthKey] = {
            maxDepositIds: new Set<string>(),
            minDepositIds: new Set<string>(),
            maxRentIds: new Set<string>(),
            minRentIds: new Set<string>(),
            count: 1
          };
        } else {
          extremes[monthKey].count += 1;
        }

        // Deposit Max/Min (Only if monthlyRent === 0)
        if (rnt === 0) {
          if (extremes[monthKey].maxDeposit === undefined) {
            extremes[monthKey].maxDeposit = dep;
            extremes[monthKey].minDeposit = dep;
            extremes[monthKey].maxDepositIds = new Set([row.id]);
            extremes[monthKey].minDepositIds = new Set([row.id]);
          } else {
            // Compare Max
            if (dep > extremes[monthKey].maxDeposit) {
              extremes[monthKey].maxDeposit = dep;
              extremes[monthKey].maxDepositIds = new Set([row.id]);
            } else if (dep === extremes[monthKey].maxDeposit) {
              extremes[monthKey].maxDepositIds.add(row.id);
            }

            // Compare Min
            if (dep < extremes[monthKey].minDeposit) {
              extremes[monthKey].minDeposit = dep;
              extremes[monthKey].minDepositIds = new Set([row.id]);
            } else if (dep === extremes[monthKey].minDeposit) {
              extremes[monthKey].minDepositIds.add(row.id);
            }
          }
        }

        // Rent Max/Min (Only if monthlyRent > 0)
        if (rnt > 0) {
          if (extremes[monthKey].maxRent === undefined) {
            extremes[monthKey].maxRent = rnt;
            extremes[monthKey].minRent = rnt;
            extremes[monthKey].maxRentIds = new Set([row.id]);
            extremes[monthKey].minRentIds = new Set([row.id]);
          } else {
            // Compare Max
            if (rnt > extremes[monthKey].maxRent) {
              extremes[monthKey].maxRent = rnt;
              extremes[monthKey].maxRentIds = new Set([row.id]);
            } else if (rnt === extremes[monthKey].maxRent) {
              extremes[monthKey].maxRentIds.add(row.id);
            }

            // Compare Min
            if (rnt < extremes[monthKey].minRent) {
              extremes[monthKey].minRent = rnt;
              extremes[monthKey].minRentIds = new Set([row.id]);
            } else if (rnt === extremes[monthKey].minRent) {
              extremes[monthKey].minRentIds.add(row.id);
            }
          }
        }
      });
      return { sale: {} as Record<string, any>, rent: extremes };
    }
  }, [filteredTransactions, tradeType]);

  const renderSidebar = (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Building2 color={theme.palette.primary.main} size={28} />
        <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
          Filter Studio
        </Typography>
      </Box>

      <ToggleButtonGroup
        value={tradeType}
        exclusive
        onChange={(_, val) => val && setTradeType(val)}
        fullWidth
        size="small"
        color="primary"
      >
        <ToggleButton value={TradeType.SALE} sx={{ fontWeight: 600 }}>매매</ToggleButton>
        <ToggleButton value={TradeType.RENT} sx={{ fontWeight: 600 }}>전월세</ToggleButton>
      </ToggleButtonGroup>

      <Autocomplete
        options={regions}
        getOptionLabel={(option) => option ? option.name : ''}
        value={selectedRegion}
        onChange={(_, val) => setSelectedRegion(val)}
        onInputChange={(_, val) => setRegionInput(val || '')}
        autoHighlight
        filterOptions={(options, state) => {
          const queryClean = state.inputValue.trim().toLowerCase().replace(/\s+/g, "");
          if (!queryClean) return options;
          
          const matches = options.filter(option => {
            if (!option || !option.name) return false;
            const nameClean = option.name.toLowerCase().replace(/\s+/g, "");
            return nameClean.includes(queryClean);
          });
          
          return matches.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const queryOriginal = state.inputValue.trim().toLowerCase();
            
            // 1. Exact match index first
            const aIndex = aName.indexOf(queryOriginal);
            const bIndex = bName.indexOf(queryOriginal);
            if (aIndex !== bIndex) {
              if (aIndex === -1) return 1;
              if (bIndex === -1) return -1;
              return aIndex - bIndex;
            }
            
            // 2. Starts with query
            const aStarts = aName.startsWith(queryOriginal);
            const bStarts = bName.startsWith(queryOriginal);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            
            // 3. Shorter length option first
            return a.name.length - b.name.length;
          });
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="지역 선택 (시군구)"
            variant="outlined"
            size="small"
            placeholder="예시: 송파구, 분당구, 해운대구"
          />
        )}
      />

      <TextField
        label="아파트명 검색"
        variant="outlined"
        size="small"
        placeholder="예: 래미안, 자이 (Enter)"
        value={keywordDraft}
        onChange={(e) => setKeywordDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setKeyword(keywordDraft);
          }
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} style={{ color: '#94a3b8' }} />
              </InputAdornment>
            ),
          },
          formHelperText: { style: { fontSize: '10px', marginTop: '2px' } }
        }}
        helperText="입력 후 Enter를 누르세요"
      />

      <Divider />

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 700 }}>
          조회 기간
        </Typography>
        <Grid container spacing={1}>
          <Grid size={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="시작 연"
              value={startYear}
              onChange={(e) => setStartYear(Number(e.target.value))}
              slotProps={{ select: { native: true } }}
            >
              {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년</option>)}
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="월"
              value={startMonth}
              onChange={(e) => setStartMonth(Number(e.target.value))}
              slotProps={{ select: { native: true } }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="종료 연"
              value={endYear}
              onChange={(e) => setEndYear(Number(e.target.value))}
              slotProps={{ select: { native: true } }}
            >
              {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}년</option>)}
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="월"
              value={endMonth}
              onChange={(e) => setEndMonth(Number(e.target.value))}
              slotProps={{ select: { native: true } }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
            </TextField>
          </Grid>
        </Grid>
      </Box>

      <Divider />

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 700 }}>
          가격 범위 (만원)
        </Typography>
        <Slider
          value={priceRange}
          onChange={(_, val) => setPriceRange(val as [number, number])}
          valueLabelDisplay="auto"
          min={0}
          max={500000}
          step={1000}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption">{priceRange[0].toLocaleString()}</Typography>
          <Typography variant="caption">{priceRange[1].toLocaleString()}</Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 700 }}>
          전용면적 (㎡)
        </Typography>
        <Slider
          value={areaRange}
          onChange={(_, val) => setAreaRange(val as [number, number])}
          valueLabelDisplay="auto"
          min={0}
          max={250}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption">{areaRange[0]}</Typography>
          <Typography variant="caption">{areaRange[1]}</Typography>
        </Box>
      </Box>

      <Button
        variant="contained"
        fullWidth
        startIcon={<Search size={20} />}
        onClick={handleSearch}
        disabled={loading}
        sx={{
          py: 1.5,
          borderRadius: 3,
          boxShadow: '0 8px 16px rgba(15, 23, 42, 0.1)',
          textTransform: 'none',
          fontWeight: 700,
        }}
      >
        조회하기
      </Button>
    </Box>
  );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh', fontSize: '0.9rem' }}>
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box', borderRight: '1px solid #e2e8f0' },
          }}
        >
          {renderSidebar}
        </Drawer>
      )}

      {isMobile && (
        <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #e2e8f0' }}>
          <Toolbar>
            <IconButton edge="start" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 800, ml: 2 }}>Insight Estate Pro</Typography>
          </Toolbar>
        </AppBar>
      )}

      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH } }}
      >
        {renderSidebar}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 4 }, mt: { xs: 8, md: 0 }, overflow: 'hidden' }}>
        <Container maxWidth="lg">
          <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: "-0.04em" }}>
                Insight Estate Pro <span style={{ color: theme.palette.primary.main }}>{selectedRegion?.name}</span>
              </Typography>
              {lastSearchPeriod && (
                <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                   조회 기간: {lastSearchPeriod} (최근 1년)
                </Typography>
              )}
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#2563eb' }}>
              총 {filteredTransactions.length}건
            </Typography>
          </Box>

          {!loading && allTransactions.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 4, border: '2px dashed #e2e8f0', bgcolor: '#f8fafc' }}>
               <Home size={48} style={{ color: '#94a3b8', marginBottom: 16 }} />
               <Typography variant="h6" sx={{ fontWeight: 700 }}>조회 준비 완료</Typography>
               {!config.hasServiceKey && (
                 <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
                   <strong>API 키 설정이 필요합니다.</strong><br/>
                   우측 하단의 <b>'Settings' → 'Secrets'</b> 메뉴에서 <code>DATA_GO_KR_SERVICE_KEY</code>를 추가해주세요.
                 </Alert>
               )}
               <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                 {allTransactions.length === 0 && !loading ? (
                    <>
                      지역을 선택하고 '조회하기' 버튼을 눌러보세요.<br/>
                      데이터가 계속 나오지 않는다면 API 키가 활성화 중(1-2시간 소요)이거나<br/>
                      해당 지역의 최근 거래가 없을 수 있습니다.
                    </>
                 ) : (
                    "지역을 선택하고 '조회하기' 버튼을 눌러 정밀 분석을 시작하세요."
                 )}
               </Typography>
               <Button 
                variant="outlined" 
                onClick={() => setMobileOpen(true)}
                sx={{ display: { md: 'none' } }}
               >
                 필터 열기
               </Button>
            </Paper>
          )}

          {loading && (
            <Box sx={{ mb: 4 }}>
              <LinearProgress sx={{ borderRadius: 2, height: 8 }} />
              <Typography variant="caption" sx={{ mt: 1, display: 'block', textAlign: 'center', fontWeight: 600 }}>
                국토교통부 데이터를 분석 중입니다...
              </Typography>
            </Box>
          )}

          {!loading && allTransactions.length > 0 && filteredTransactions.length === 0 && (
            <Paper sx={{ p: 10, textAlign: 'center', borderRadius: 4, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <Home size={64} style={{ color: '#94a3b8', marginBottom: 16 }} />
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>필터링된 결과가 없습니다.</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                지정한 필터 조건에 맞는 거래 내역이 없습니다. 필터를 조정해 보세요.
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                {lastWorkingFilters && (
                  <Button 
                    variant="contained" 
                    color="primary"
                    startIcon={<RotateCcw size={18} />}
                    onClick={handleRestoreFilters}
                  >
                    직전 상태로 되돌리기
                  </Button>
                )}
                <Button 
                  variant="outlined" 
                  startIcon={<Search size={18} />}
                  onClick={handleResetFilters}
                >
                  필터 초기화
                </Button>
              </Box>
            </Paper>
          )}

          {!loading && allTransactions.length > 0 && filteredTransactions.length > 0 && (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, borderRadius: 4, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700 }}>
                    {tradeType === TradeType.SALE ? '평균 거래가' : '평균 보증금 / 월세'}
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    {Math.round(filteredTransactions.reduce((a, b) => a + b.price, 0) / filteredTransactions.length).toLocaleString()}
                    {tradeType === TradeType.RENT && (
                      <Typography component="span" variant="h5" sx={{ mx: 1, color: '#94a3b8' }}>/</Typography>
                    )}
                    {tradeType === TradeType.RENT && (
                      Math.round(filteredTransactions.reduce((a, b) => a + b.monthlyRent, 0) / filteredTransactions.length).toLocaleString()
                    )}
                    <Typography component="span" variant="body1" sx={{ ml: 0.5 }}>만원</Typography>
                  </Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, borderRadius: 4, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700 }}>총 거래량</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>{filteredTransactions.length}건</Typography>
                </Paper>
              </Grid>

              <Grid size={12}>
                <Paper sx={{ p: 3, borderRadius: 4 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>시계열 가격 추이</Typography>
                    {tradeType === TradeType.RENT && (
                      <ToggleButtonGroup
                        value={chartMode}
                        exclusive
                        onChange={(_, val) => val && setChartMode(val)}
                        size="small"
                      >
                        <ToggleButton value="individual" sx={{ px: 2, fontSize: '11px', fontWeight: 700 }}>개별</ToggleButton>
                        <ToggleButton value="converted" sx={{ px: 2, fontSize: '11px', fontWeight: 700 }}>환산 (5.5%)</ToggleButton>
                      </ToggleButtonGroup>
                    )}
                  </Box>
                  <Box sx={{ height: 350, mt: 2 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="name" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis 
                          yAxisId="left"
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 11 }}
                          tickFormatter={(val) => val >= 10000 ? `${(val/10000).toFixed(1)}억` : `${val}만`} 
                        />
                        <YAxis 
                          yAxisId="count" 
                          orientation="right" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 11 }}
                          stroke="#94a3b8"
                        />
                        {tradeType === TradeType.RENT && (
                          <YAxis 
                            yAxisId="rent" 
                            orientation="right" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 11 }}
                            stroke="#fbbf24"
                            tickFormatter={(val) => `${val}만`}
                            // Offset to prevent overlap with count axis
                            dx={10}
                          />
                        )}
                        <ChartTooltip 
                          contentStyle={{ 
                            borderRadius: '12px', 
                            border: 'none', 
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '12px'
                          }}
                          formatter={(value: any, name: any) => {
                            if (name === "거래건수" || name === "거래 건수") return [`${value}건`, name];
                            const num = Number(value);
                            if (name.includes("월세")) {
                              return [`${num}만원`, name];
                            }
                            if (num >= 10000) {
                              const eok = Math.floor(num / 10000);
                              const remainder = num % 10000;
                              return [remainder > 0 ? `${eok}억 ${remainder.toLocaleString()}만` : `${eok}억`, name];
                            }
                            return [`${num.toLocaleString()}만`, name];
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        
                        {/* Transaction Volume */}
                        <Bar 
                          yAxisId="count" 
                          dataKey="tradeCount" 
                          name="거래건수" 
                          fill="#f1f5f9" 
                          radius={[4, 4, 0, 0]} 
                          barSize={20}
                        />

                        {tradeType === TradeType.SALE ? (
                          <>
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="maxPrice" 
                              name="최대 매매가" 
                              stroke="#f43f5e" 
                              strokeWidth={1.5} 
                              strokeDasharray="4 4"
                              dot={{ r: 3 }} 
                              activeDot={{ r: 5 }} 
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="avgPrice" 
                              name="평균 매매가" 
                              stroke={theme.palette.primary.main} 
                              strokeWidth={3} 
                              dot={{ r: 5 }} 
                              activeDot={{ r: 7 }} 
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="minPrice" 
                              name="최소 매매가" 
                              stroke="#10b981" 
                              strokeWidth={1.5} 
                              strokeDasharray="4 4"
                              dot={{ r: 3 }} 
                              activeDot={{ r: 5 }} 
                            />
                          </>
                        ) : chartMode === 'individual' ? (
                          <>
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="maxDeposit" 
                              name="최대 보증금" 
                              stroke="#f43f5e" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="avgDeposit" 
                              name="평균 보증금" 
                              stroke={theme.palette.primary.main} 
                              strokeWidth={3} 
                              dot={{ r: 4 }} 
                              activeDot={{ r: 6 }} 
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="minDeposit" 
                              name="최소 보증금" 
                              stroke="#10b981" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />

                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="maxMonthlyRent" 
                              name="최대 월세" 
                              stroke="#f59e0b" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="avgMonthlyRent" 
                              name="평균 월세" 
                              stroke="#fbbf24" 
                              strokeWidth={3} 
                              dot={{ r: 4 }} 
                              activeDot={{ r: 6 }} 
                            />
                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="minMonthlyRent" 
                              name="최소 월세" 
                              stroke="#34d399" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                          </>
                        ) : (
                          <>
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="maxDepositEquiv" 
                              name="최대 전세 환산가" 
                              stroke="#c084fc" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="avgDepositEquiv" 
                              name="평균 전세 환산가" 
                              stroke="#8b5cf6" 
                              strokeWidth={3} 
                              dot={{ r: 4 }} 
                              activeDot={{ r: 6 }} 
                            />
                            <Line 
                              yAxisId="left" 
                              type="monotone" 
                              dataKey="minDepositEquiv" 
                              name="최소 전세 환산가" 
                              stroke="#a7f3d0" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />

                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="maxRentEquiv" 
                              name="최대 월세 환산가" 
                              stroke="#fb7185" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="avgRentEquiv" 
                              name="평균 월세 환산가" 
                              stroke="#f43f5e" 
                              strokeWidth={3} 
                              dot={{ r: 4 }} 
                              activeDot={{ r: 6 }} 
                            />
                            <Line 
                              yAxisId="rent" 
                              type="monotone" 
                              dataKey="minRentEquiv" 
                              name="최소 월세 환산가" 
                              stroke="#34d399" 
                              strokeWidth={1.2} 
                              strokeDasharray="4 4"
                              dot={false}
                            />
                          </>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, borderRadius: 4 }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>면적 대비 가격 분포</Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis type="number" dataKey="area" name="면적" unit="㎡" />
                        <YAxis type="number" dataKey="price" name="가격" unit="만" />
                        <ZAxis type="number" range={[64, 144]} />
                        <ChartTooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter name="Transactions" data={filteredTransactions} fill={theme.palette.primary.main} opacity={0.6} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3, borderRadius: 4 }}>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>거래 평형대 비율</Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                         <XAxis dataKey="name" axisLine={false} tickLine={false} />
                         <YAxis axisLine={false} tickLine={false} />
                         <ChartTooltip cursor={{fill: 'transparent'}} />
                         <Bar dataKey="count" name="거래 건수" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Paper>
              </Grid>

              <Grid size={12}>
                <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
                  <Box sx={{ p: 2, px: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1e293b' }}>거래 세부 내역</Typography>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                      {tradeType === TradeType.SALE ? (
                        <>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(239, 68, 68, 0.08)', border: '1px solid #fca5a5' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              월별 최고가
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(16, 185, 129, 0.08)', border: '1px solid #6ee7b7' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              월별 최저가
                            </Typography>
                          </Box>
                        </>
                      ) : (
                        <>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(239, 68, 68, 0.08)', border: '1px solid #fca5a5' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              보증금 최고 (월세 0 기준)
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(16, 185, 129, 0.08)', border: '1px solid #6ee7b7' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              보증금 최저 (월세 0 기준)
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(245, 158, 11, 0.08)', border: '1px solid #fcd34d' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              월세 최고 (월세 0 제외)
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: 'rgba(59, 130, 246, 0.08)', border: '1px solid #93c5fd' }} />
                            <Typography variant="caption" sx={{ color: '#475569', fontWeight: 600, fontSize: '11px' }}>
                              월세 최저 (월세 0 제외)
                            </Typography>
                          </Box>
                        </>
                      )}
                    </Box>
                  </Box>
                  <TableContainer>
                    <Table sx={{ minWidth: 650 }}>
                    <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 800, color: theme.palette.primary.main, py: 1 }}>거래일</TableCell>
                        <TableCell sx={{ fontWeight: 700, py: 1 }}>
                          아파트명 (단지)
                          <TextField 
                            placeholder="아파트명/동 (Enter)" 
                            size="small" 
                            variant="standard" 
                            fullWidth 
                            slotProps={{ input: { style: { fontSize: '11px' } } }}
                            value={tableFiltersDraft.dong}
                            onChange={(e) => setTableFiltersDraft(prev => ({ ...prev, dong: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setTableFilters(tableFiltersDraft);
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, py: 1 }}>
                          {tradeType === TradeType.SALE ? '매매가 (만원)' : '보증금 / 월세 (만원)'}
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <TextField 
                              placeholder="최소 (Enter)" 
                              size="small" 
                              variant="standard" 
                              slotProps={{ input: { style: { fontSize: '10px' } } }}
                              value={tableFiltersDraft.priceMin}
                              onChange={(e) => setTableFiltersDraft(prev => ({ ...prev, priceMin: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  setTableFilters(tableFiltersDraft);
                                }
                              }}
                            />
                            <TextField 
                              placeholder="최대 (Enter)" 
                              size="small" 
                              variant="standard" 
                              slotProps={{ input: { style: { fontSize: '10px' } } }}
                              value={tableFiltersDraft.priceMax}
                              onChange={(e) => setTableFiltersDraft(prev => ({ ...prev, priceMax: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  setTableFilters(tableFiltersDraft);
                                }
                              }}
                            />
                          </Box>
                          {tradeType === TradeType.RENT && (
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                              <TextField 
                                placeholder="월세 최소 (Enter)" 
                                size="small" 
                                variant="standard" 
                                slotProps={{ input: { style: { fontSize: '10px' } } }}
                                value={tableFiltersDraft.rentMin}
                                onChange={(e) => setTableFiltersDraft(prev => ({ ...prev, rentMin: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    setTableFilters(tableFiltersDraft);
                                  }
                                }}
                              />
                              <TextField 
                                placeholder="월세 최대 (Enter)" 
                                size="small" 
                                variant="standard" 
                                slotProps={{ input: { style: { fontSize: '10px' } } }}
                                value={tableFiltersDraft.rentMax}
                                onChange={(e) => setTableFiltersDraft(prev => ({ ...prev, rentMax: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    setTableFilters(tableFiltersDraft);
                                  }
                                }}
                              />
                            </Box>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, py: 1 }}>
                          면적 (㎡/평)
                          <Select
                            multiple
                            displayEmpty
                            size="small"
                            variant="standard"
                            fullWidth
                            sx={{ fontSize: '11px', mt: 0.5 }}
                            value={tableFiltersDraft.areaCategory}
                            onChange={(e) => {
                              const val = e.target.value as string[];
                              setTableFiltersDraft(prev => {
                                const updated = { ...prev, areaCategory: val };
                                setTableFilters(updated);
                                return updated;
                              });
                            }}
                            renderValue={(selected) => {
                              if (!selected || selected.length === 0) {
                                return <span style={{ color: '#aaa', fontSize: '11px' }}>전체 평형</span>;
                              }
                              return <span style={{ fontSize: '11px' }}>{selected.length}개 선택</span>;
                            }}
                            MenuProps={{
                              PaperProps: {
                                style: {
                                  maxHeight: 300,
                                }
                              }
                            } as any}
                          >
                            {uniquePyeongs.map((py) => {
                              const pyStr = String(py);
                              return (
                                <MenuItem key={pyStr} value={pyStr} sx={{ py: 0.25 }}>
                                  <Checkbox checked={tableFiltersDraft.areaCategory.includes(pyStr)} size="small" sx={{ p: 0.5 }} />
                                  <ListItemText primary={<span style={{ fontSize: '12px' }}>{pyStr}평</span>} />
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, py: 1 }}>
                          층
                          <Select
                            multiple
                            displayEmpty
                            size="small"
                            variant="standard"
                            fullWidth
                            sx={{ fontSize: '11px', mt: 0.5 }}
                            value={tableFiltersDraft.floor}
                            onChange={(e) => {
                              const val = e.target.value as string[];
                              setTableFiltersDraft(prev => {
                                const updated = { ...prev, floor: val };
                                setTableFilters(updated);
                                return updated;
                              });
                            }}
                            renderValue={(selected) => {
                              if (!selected || selected.length === 0) {
                                return <span style={{ color: '#aaa', fontSize: '11px' }}>전체 층</span>;
                              }
                              return <span style={{ fontSize: '11px' }}>{selected.length}개 선택</span>;
                            }}
                            MenuProps={{
                              PaperProps: {
                                style: {
                                  maxHeight: 300,
                                }
                              }
                            } as any}
                          >
                            {uniqueFloors.map((fl) => {
                              const flStr = String(fl);
                              return (
                                <MenuItem key={flStr} value={flStr} sx={{ py: 0.25 }}>
                                  <Checkbox checked={tableFiltersDraft.floor.includes(flStr)} size="small" sx={{ p: 0.5 }} />
                                  <ListItemText primary={<span style={{ fontSize: '12px' }}>{flStr}층</span>} />
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </TableCell>
                        {tradeType === TradeType.RENT && (
                          <>
                            <TableCell sx={{ fontWeight: 700, py: 1 }}>
                              신규/갱신
                              <TextField 
                                select 
                                size="small" 
                                variant="standard" 
                                fullWidth 
                                slotProps={{ 
                                  select: { native: true },
                                  input: { style: { fontSize: '11px' } }
                                }}
                                value={tableFiltersDraft.contractLevel}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTableFiltersDraft(prev => {
                                    const updated = { ...prev, contractLevel: val };
                                    setTableFilters(updated);
                                    return updated;
                                  });
                                }}
                              >
                                <option value="">전체</option>
                                <option value="신규">신규</option>
                                <option value="갱신">갱신</option>
                              </TextField>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, py: 1 }}>
                              갱신청구권
                              <TextField 
                                select 
                                size="small" 
                                variant="standard" 
                                fullWidth 
                                slotProps={{ 
                                  select: { native: true },
                                  input: { style: { fontSize: '11px' } }
                                }}
                                value={tableFiltersDraft.useRequestRenew}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTableFiltersDraft(prev => {
                                    const updated = { ...prev, useRequestRenew: val };
                                    setTableFilters(updated);
                                    return updated;
                                  });
                                }}
                              >
                                <option value="">전체</option>
                                <option value="사용">사용</option>
                                <option value="-">-</option>
                              </TextField>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, py: 1 }}>종전 보증금/월세</TableCell>
                          </>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredTransactions.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((row) => {
                        const monthKey = `${row.dealYear}.${String(row.dealMonth).padStart(2, '0')}`;
                        
                        let isMaxPrice = false;
                        let isMinPrice = false;
                        let isMaxDeposit = false;
                        let isMinDeposit = false;
                        let isMaxRent = false;
                        let isMinRent = false;

                        if (tradeType === TradeType.SALE) {
                          const ext = monthlyExtremes.sale[monthKey];
                          const isExtreme = ext && ext.count > 1 && ext.maxPrice !== ext.minPrice;
                          isMaxPrice = isExtreme && ext.maxPriceIds.has(row.id);
                          isMinPrice = isExtreme && ext.minPriceIds.has(row.id);
                        } else {
                          const ext = monthlyExtremes.rent[monthKey];
                          if (ext && ext.count > 1) {
                            // Deposit extremes (Only if row.monthlyRent === 0)
                            if (row.monthlyRent === 0 && ext.maxDeposit !== undefined && ext.minDeposit !== undefined && ext.maxDeposit !== ext.minDeposit) {
                              isMaxDeposit = ext.maxDepositIds.has(row.id);
                              isMinDeposit = ext.minDepositIds.has(row.id);
                            }
                            // Rent extremes (Only if row.monthlyRent > 0)
                            if (row.monthlyRent > 0 && ext.maxRent !== undefined && ext.minRent !== undefined) {
                              if (ext.maxRent === ext.minRent) {
                                isMaxRent = ext.maxRentIds.has(row.id);
                              } else {
                                isMaxRent = ext.maxRentIds.has(row.id);
                                isMinRent = ext.minRentIds.has(row.id);
                              }
                            }
                          }
                        }

                        let rowBg = "inherit";
                        let textColor = "inherit";

                        if (isMaxPrice || isMaxDeposit) {
                          rowBg = "rgba(239, 68, 68, 0.04)";
                          textColor = "#ef4444";
                        } else if (isMinPrice || isMinDeposit) {
                          rowBg = "rgba(16, 185, 129, 0.04)";
                          textColor = "#10b981";
                        } else if (isMaxRent) {
                          rowBg = "rgba(245, 158, 11, 0.04)";
                          textColor = "#f59e0b";
                        } else if (isMinRent) {
                          rowBg = "rgba(59, 130, 246, 0.04)";
                          textColor = "#3b82f6";
                        }

                        if (textColor === "inherit") {
                          textColor = theme.palette.primary.dark;
                        }

                        return (
                          <TableRow key={row.id} hover sx={{ backgroundColor: rowBg }}>
                            <TableCell sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {`${row.dealYear}.${String(row.dealMonth).padStart(2, '0')}.${String(row.dealDay).padStart(2, '0')}`}
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{row.apartmentName}</TableCell>
                            <TableCell sx={{ fontWeight: 700, px: 2, color: textColor }}>
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                                <span>
                                  {tradeType === TradeType.SALE ? (
                                    row.price.toLocaleString()
                                  ) : (
                                    `${row.price.toLocaleString()} / ${row.monthlyRent.toLocaleString()}`
                                  )}
                                </span>
                                {isMaxPrice && (
                                  <Chip 
                                    label="최고가" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#fee2e2", 
                                      color: "#ef4444", 
                                      border: "1px solid #fca5a5",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                                {isMinPrice && (
                                  <Chip 
                                    label="최저가" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#d1fae5", 
                                      color: "#10b981", 
                                      border: "1px solid #6ee7b7",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                                {isMaxDeposit && (
                                  <Chip 
                                    label="보증금 최고" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#fee2e2", 
                                      color: "#ef4444", 
                                      border: "1px solid #fca5a5",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                                {isMinDeposit && (
                                  <Chip 
                                    label="보증금 최저" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#d1fae5", 
                                      color: "#10b981", 
                                      border: "1px solid #6ee7b7",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                                {isMaxRent && (
                                  <Chip 
                                    label="월세 최고" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#fef3c7", 
                                      color: "#d97706", 
                                      border: "1px solid #fcd34d",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                                {isMinRent && (
                                  <Chip 
                                    label="월세 최저" 
                                    size="small" 
                                    sx={{ 
                                      height: 18, 
                                      fontSize: "10px", 
                                      fontWeight: 800, 
                                      bgcolor: "#dbeafe", 
                                      color: "#2563eb", 
                                      border: "1px solid #93c5fd",
                                      ".MuiChip-label": { px: 0.8 }
                                    }} 
                                  />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell>{row.area}㎡ / {row.pyeong}평</TableCell>
                            <TableCell>{row.floor}층</TableCell>
                            {tradeType === TradeType.RENT && (
                              <>
                                <TableCell>
                                  <Chip 
                                    label={row.contractLevel || "-"} 
                                    size="small" 
                                    variant="outlined"
                                    color={row.contractLevel === "갱신" ? "secondary" : "default"}
                                  />
                                </TableCell>
                                <TableCell>{row.useRequestRenew || "-"}</TableCell>
                                <TableCell>
                                  {row.previousDeposit ? `${row.previousDeposit.toLocaleString()} / ${row.previousMonthlyRent?.toLocaleString()}` : "-"}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  rowsPerPageOptions={[10, 20, 50, 100, 200]}
                  component="div"
                  count={filteredTransactions.length}
                  rowsPerPage={rowsPerPage}
                  page={page}
                  onPageChange={(event, newPage) => setPage(newPage)}
                  onRowsPerPageChange={(event) => {
                    setRowsPerPage(parseInt(event.target.value, 10));
                    setPage(0);
                  }}
                  labelRowsPerPage="페이지당 줄 수:"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} / 전체 ${count !== -1 ? count : `현재 이상`}건`}
                  sx={{
                    borderTop: '1px solid #e2e8f0',
                    bgcolor: '#fff',
                  }}
                />
              </Paper>
            </Grid>
          </Grid>
        )}
        </Container>
      </Box>
    </Box>
  </ThemeProvider>
  );
}
