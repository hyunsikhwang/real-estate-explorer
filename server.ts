import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// 공공기관 및 브이월드 API용 GPKI/자체 서명 인증서 관련 TLS 검증 해제
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// VWorld API의 인증 상태를 공유하기 위한 전역 캐시
let activeVWorldConfig: { key: string; referer: string; host: string } | null = null;

interface VWorldLog {
  timestamp: string;
  service: string;
  url: string;
  referer: string;
  domainParam: string;
  status: number;
  responseType: string;
  responseExcerpt: string;
  success: boolean;
}

const vworldLogs: VWorldLog[] = [];

function addVworldLog(log: Omit<VWorldLog, 'timestamp'>) {
  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  vworldLogs.unshift({ timestamp, ...log });
  if (vworldLogs.length > 50) {
    vworldLogs.pop();
  }
}

function maskApiKey(urlStr: string): string {
  try {
    const urlObj = new URL(urlStr);
    const key = urlObj.searchParams.get("key");
    if (key && key.length > 8) {
      const masked = key.substring(0, 4) + "-XXXX-XXXX-XXXX-" + key.substring(key.length - 4);
      urlObj.searchParams.set("key", masked);
      return urlObj.toString();
    }
  } catch (e) {
    // If not a full URL or parse error
    return urlStr.replace(/key=[A-Za-z0-9-]+/gi, (match) => {
      const parts = match.split("=");
      if (parts[1] && parts[1].length > 8) {
        return `key=${parts[1].substring(0, 4)}-XXXX-XXXX-XXXX-${parts[1].substring(parts[1].length - 4)}`;
      }
      return "key=XXXX";
    });
  }
  return urlStr;
}

import http from "http";
import https from "https";

const customHttpAgent = new http.Agent({ keepAlive: false });
const customHttpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

async function vworldAxiosGet(url: string, referer: string, responseType: "json" | "arraybuffer" = "json"): Promise<any> {
  // Always log the complete request URL to the server console
  console.log(`[VWorld Request URL] ${url}`);

  const headers: Record<string, string> = {
    "Accept": "application/json, text/plain, image/*, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  if (referer) {
    headers["Referer"] = referer;
  }

  const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: false, // Disabling keep-alive prevents socket hang up on old/government servers
  });

  try {
    const response = await axios.get(url, {
      headers,
      responseType,
      httpsAgent: agent,
      timeout: 15000, // Slightly longer timeout
      validateStatus: () => true,
    });

    // Check if the response is valid
    if (response.status === 200) {
      if (responseType === "json") {
        const data = response.data;
        const isJson = typeof data === "object" && data !== null;
        if (!isJson) {
          const rawText = String(data).trim();
          console.warn(`[VWorld Response Warning] Expected JSON but received raw content for URL: ${url}`);
          console.error(`[VWorld Response Raw Content] Length: ${rawText.length} bytes. Body:\n${rawText}`);
        }
      } else if (responseType === "arraybuffer") {
        // Sometimes VWorld returns HTML or a text error instead of an image
        const buf = Buffer.from(response.data);
        const text = buf.toString("utf-8").trim();
        const isHtml = text.startsWith("<") || text.includes("Service Not URL") || text.includes("인증") || text.includes("Unauthorized") || text.includes("Authentication");
        
        if (isHtml) {
          console.warn(`[VWorld Response Warning] Expected Image but received HTML/Error content for URL: ${url}`);
          console.error(`[VWorld Response Raw HTML/Error] Length: ${text.length} bytes. Body:\n${text}`);
        }
      }
    } else {
      console.error(`[VWorld Response Error Status] HTTP Status: ${response.status} for URL: ${url}`);
    }

    return {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };
  } catch (err: any) {
    console.error(`[VWorld Axios Exception] URL: ${url}, Error: ${err.message}`);
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/config", (req, res) => {
    res.json({
      hasServiceKey: !!process.env.DATA_GO_KR_SERVICE_KEY,
      vworldApiKey: process.env.VITE_VWORLD_API_KEY || "CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9"
    });
  });

  // VWorld real-time API request/response logging for frontend debugging
  app.get("/api/vworld-logs", (req, res) => {
    res.json(vworldLogs);
  });

  // API Routes
  app.get("/api/transactions", async (req, res) => {
    const sigunguCode = req.query.sigunguCode;
    const dealMonth = req.query.dealMonth;
    const tradeType = req.query.tradeType;
    const keyword = req.query.keyword;
    const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;

    if (!serviceKey) {
      console.warn("DATA_GO_KR_SERVICE_KEY is missing.");
      return res.status(401).json({ 
        error: "인증키 누락", 
        details: "API 서비스 키가 설정되지 않았습니다." 
      });
    }

    // Search parameters
    try {
      console.log(`[API REQUEST] Type: ${tradeType}, Region: ${sigunguCode}, Month: ${dealMonth}`);
      
      const queryParams = new URLSearchParams({
        LAWD_CD: String(sigunguCode),
        DEAL_YMD: String(dealMonth),
        numOfRows: '10000',
        pageNo: '1',
        _type: 'json'
      });
      
      const tryFetch = async (key: string, apiType: string) => {
        // Known endpoints for Apartment Transactions
        const endpoints = apiType === "매매" 
          ? [
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
            ]
          : [
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptRentDev/getRTMSDataSvcAptRentDev",
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
              "https://apis.data.go.kr/1613000/RTMSDataSvcAptRentService/getRTMSDataSvcAptRentService"
            ];

        console.log(`[STRATEGY] Starting fetch strategy for ${apiType} using key: ${key.substring(0, 5)}...`);

        for (const url of endpoints) {
          try {
            console.log(`[ATTEMPT] URL: ${url}`);
            const fullUrl = `${url}?serviceKey=${key}&${queryParams.toString()}`;
            
            const res = await axios.get(fullUrl, {
              timeout: 25000,
              headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0'
              },
              validateStatus: () => true
            });

            const data = res.data;
            const isRegistrationError = typeof data === 'string' && (data.includes('SERVICE_KEY_IS_NOT_REGISTERED') || data.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR'));
            const isNoData = typeof data === 'object' && data?.response?.body?.totalCount === 0;

            if (res.status === 200 && !isRegistrationError) {
              console.log(`[SUCCESS] API responded successfully from ${url}. Total items: ${data?.response?.body?.totalCount || 0}`);
              return res; // Stop at the first successful endpoint
            } else if (isRegistrationError) {
              console.warn(`[FAILURE] Service key not registered for ${url}. Trying next...`);
            } else {
              console.warn(`[WARNING] Unexpected response from ${url} (Status: ${res.status}). Trying next...`);
            }
          } catch (e: any) {
            console.error(`[ERROR] Exception while fetching from ${url}: ${e.message}`);
          }
        }
        
        // Final fallback: try once more with the first endpoint just to get the response object for error handling
        return await axios.get(`${endpoints[0]}?serviceKey=${key}&${queryParams.toString()}`, {
          validateStatus: () => true
        });
      };

      // Attempt with provided serviceKey
      let response = await tryFetch(serviceKey, tradeType as string);
      let data = response.data;

      // Logic check for registration error or XML error
      const isXml = typeof data === 'string' && (data.includes('<resultCode>') || data.includes('<OpenAPI_ServiceResponse>') || data.includes('<?xml'));
      const isRegistrationError = isXml && (data.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR') || data.includes('SERVICE_KEY_IS_NOT_REGISTERED'));
      
      // Attempt 2: If failed with registration error, try decoding the key (common fix)
      if (isRegistrationError) {
        try {
          const decodedKey = decodeURIComponent(serviceKey);
          if (decodedKey !== serviceKey) {
            console.log("Retry with decoded serviceKey...");
            const retryResponse = await tryFetch(decodedKey, tradeType as string);
            // Only update if retry was better
            if (retryResponse.status === 200 && !(typeof retryResponse.data === 'string' && retryResponse.data.includes('SERVICE_KEY_IS_NOT_REGISTERED'))) {
              response = retryResponse;
              data = retryResponse.data;
            }
          }
        } catch (e) {
          console.warn("Failed to decode service key for retry");
        }
      }

      if (response.status !== 200) {
        console.error(`API returned HTTP ${response.status}`);
        return res.status(response.status).json({ error: "API Server Error", details: `HTTP Status ${response.status}`, raw: data });
      }
      
      // Handle the case where JSON is returned as string
      if (typeof data === 'string' && data.trim().startsWith('{')) {
        try {
          data = JSON.parse(data);
        } catch (e) {
          console.error("Failed to parse response as JSON");
        }
      }

      // Filter by keyword if provided (Server-side optimization)
      const queryKeyword = keyword ? String(keyword).trim().toLowerCase() : "";
      if (queryKeyword && typeof data === 'object' && data?.response?.body) {
        const body = data.response.body;
        let items: any[] = [];
        
        if (body?.items && typeof body.items === 'object') {
          const itemVal = body.items.item;
          if (Array.isArray(itemVal)) {
            items = itemVal;
          } else if (itemVal) {
            items = [itemVal];
          }
        } else if (Array.isArray(body?.items)) {
          items = body.items;
        } else if (body?.items?.item) {
          if (Array.isArray(body.items.item)) {
            items = body.items.item;
          } else {
            items = [body.items.item];
          }
        }

        if (Array.isArray(items)) {
          const filteredItems = items.filter((item: any) => {
            if (!item) return false;
            const aptName = (
              item.aptNm || 
              item.아파트 || 
              item.건물명 || 
              item.단지 || 
              item.aptName || 
              item.apartmentName ||
              ""
            ).trim().toLowerCase();
            return aptName.includes(queryKeyword);
          });
          
          if (body.items && typeof body.items === 'object') {
            body.items.item = filteredItems;
          } else {
            body.items = { item: filteredItems };
          }
          
          if (typeof body.totalCount !== 'undefined') {
            body.totalCount = filteredItems.length;
          }
          console.log(`[FILTER] Screened items with keyword "${queryKeyword}". Kept ${filteredItems.length} out of ${items.length} items.`);
        }
      }
      
      // Final check for XML (error message usually comes as XML if key is wrong or not yet active)
      if (typeof data === 'string' && (data.includes('<resultCode>') || data.includes('<OpenAPI_ServiceResponse>') || data.includes('<?xml'))) {
         console.error("API returned XML Error/Response:", data);
         
         let details = "API 키가 잘못되었거나, 아직 활성화되지 않았습니다. (보통 승인 후 1-2시간 소요)";
         if (data.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
           details = "공공데이터 서비스 키가 유효하지 않습니다. (Decoding/Encoding 키 확인 필요)";
         } else if (data.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR')) {
           details = "일일 API 호출 한도를 초과했습니다.";
         } else if (data.includes('DEADLINE_EXCEEDED')) {
           details = "API 응답 시간이 초과되었습니다.";
         }

         return res.status(500).json({ 
           error: "API Identity or Auth Error", 
           details,
           raw: data.substring(0, 300)
         });
      }

      // Many gov APIs use '00', '0', or 'OK' as success indicators
      // Also check if resultMsg contains success-like strings
      const header = data?.response?.header;
      const resultCode = String(header?.resultCode || "");
      const resultMsg = String(header?.resultMsg || "");

      const isSuccess = resultCode === '00' || 
                        resultCode === '0' || 
                        resultCode === 'OK' ||
                        resultMsg.toUpperCase().includes('NORMAL SERVICE') ||
                        resultMsg.toUpperCase() === 'OK' ||
                        !resultCode; // Some versions don't return resultCode on success

      if (!isSuccess && resultCode !== "") {
        console.error("API Logical Error:", resultMsg, "Code:", resultCode);
        return res.status(500).json({ 
          error: "API Header Error", 
          details: `${resultMsg} (Code: ${resultCode})`,
          raw: header 
        });
      }

      res.json(data);
    } catch (error: any) {
      console.error("Fetch Error:", error.response?.status, error.message);
      res.status(error.response?.status || 500).json({ 
        error: "Failed to fetch data", 
        details: error.response?.data || error.message 
      });
    }
  });

  // VWorld 2.0 API proxy to bypass CORS, domain locks and SSL/TLS validation issues
  app.get("/api/vworld/:service", async (req, res) => {
    const { service } = req.params;
    
    // 1. Get client-provided credentials if they exist
    const clientKey = req.query.key ? String(req.query.key).trim() : "";
    const clientDomain = req.query.domain ? String(req.query.domain).trim() : "";
    
    // Server fallback key
    const serverKey = process.env.VITE_VWORLD_API_KEY || "CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9";
    
    // Choose active key and domain
    const activeKey = clientKey || serverKey;
    
    // Extract referer header or fallback
    let requestOrigin = "http://localhost:3000";
    if (req.headers.referer) {
      try {
        const parsed = new URL(req.headers.referer);
        requestOrigin = parsed.origin;
      } catch (e) {
        requestOrigin = String(req.headers.referer);
      }
    }
    
    // Strip trailing slashes to prevent VWorld Referer mismatches
    let cleanedClientDomain = clientDomain;
    if (cleanedClientDomain.endsWith("/")) {
      cleanedClientDomain = cleanedClientDomain.slice(0, -1);
    }
    if (requestOrigin.endsWith("/")) {
      requestOrigin = requestOrigin.slice(0, -1);
    }
    
    // For VWorld, the domain parameter must match the Referer header exactly
    const activeDomain = cleanedClientDomain || requestOrigin || "http://localhost:3000";
    
    // Assemble parameters for upstream API request
    const queryParams = new URLSearchParams();
    for (const [qKey, qVal] of Object.entries(req.query)) {
      if (qKey !== "key" && qKey !== "domain" && qVal !== undefined && qVal !== null) {
        queryParams.set(qKey, String(qVal));
      }
    }
    
    queryParams.set("key", activeKey);
    queryParams.set("domain", activeDomain);
    
    const host = "https://api.vworld.kr";
    const url = `${host}/req/${service}?${queryParams.toString()}`;
    
    try {
      console.log(`[VWorld Proxy Request] Service: ${service}, URL: ${url}, Domain Param: ${activeDomain}, Referer: ${activeDomain}`);
      // Use the client's provided domain as both domain param and Referer header to ensure a perfect match!
      const response = await vworldAxiosGet(url, activeDomain);
      
      const responseDataStr = typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data);
      const isJson = typeof response.data === "object" && response.data !== null;
      const isHtml = typeof response.data === "string" && response.data.trim().startsWith("<");
      
      const hasAuthError = typeof response.data === "string" && (
        response.data.includes("Service Not URL") || 
        response.data.includes("인증") || 
        response.data.includes("Unauthorized") || 
        response.data.includes("Authentication")
      );
      
      // Log this primary attempt
      addVworldLog({
        service,
        url: maskApiKey(url),
        referer: activeDomain,
        domainParam: activeDomain,
        status: response.status,
        responseType: isJson ? "JSON" : (isHtml ? "HTML" : "TEXT"),
        responseExcerpt: responseDataStr.substring(0, 500),
        success: response.status === 200 && !isHtml && !hasAuthError
      });
      
      if (response.status === 200) {
        if (!isJson) {
          console.error(`[VWorld Proxy non-JSON Response] URL: ${url}`);
          console.error(`[VWorld Proxy Raw Content] (Length: ${responseDataStr.length}):\n${responseDataStr}`);
        }
        
        if (!isHtml && !hasAuthError) {
          // Store active credentials in a globally shared object in the server so other requests (like tiles) can reuse it!
          activeVWorldConfig = {
            key: activeKey,
            referer: activeDomain,
            host: "https://api.vworld.kr"
          };
          return res.status(200).json(response.data);
        } else {
          console.warn(`[VWorld Proxy Warning] Auth/HTML error with domain: ${activeDomain}. HTML starts with: ${responseDataStr.substring(0, 100)}`);
        }
      }
    } catch (err: any) {
      console.warn(`[VWorld Proxy Error] ${err.message}. Trying backup local fallbacks...`);
      addVworldLog({
        service,
        url: maskApiKey(url),
        referer: activeDomain,
        domainParam: activeDomain,
        status: 500,
        responseType: "EXCEPTION",
        responseExcerpt: err.message,
        success: false
      });
    }

    // Backup 1: Try with key but fallback to 'http://localhost:3000' as domain/referer (extremely common registered domain for local testing)
    const fallbackDomains = [
      "http://localhost:3000",
      "http://localhost",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1"
    ];

    for (const fallbackDom of fallbackDomains) {
      queryParams.set("domain", fallbackDom);
      const backupUrl = `${host}/req/${service}?${queryParams.toString()}`;
      try {
        console.log(`[VWorld Proxy Backup Request] Trying fallback domain: ${fallbackDom}, URL: ${backupUrl}`);
        const response = await vworldAxiosGet(backupUrl, fallbackDom);
        
        const responseDataStr = typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data);
        const isJson = typeof response.data === "object" && response.data !== null;
        const isHtml = typeof response.data === "string" && response.data.trim().startsWith("<");
        
        const hasAuthError = typeof response.data === "string" && (
          response.data.includes("Service Not URL") || 
          response.data.includes("인증") || 
          response.data.includes("Unauthorized") || 
          response.data.includes("Authentication")
        );

        addVworldLog({
          service: `${service} (Backup: ${fallbackDom})`,
          url: maskApiKey(backupUrl),
          referer: fallbackDom,
          domainParam: fallbackDom,
          status: response.status,
          responseType: isJson ? "JSON" : (isHtml ? "HTML" : "TEXT"),
          responseExcerpt: responseDataStr.substring(0, 500),
          success: response.status === 200 && !isHtml && !hasAuthError
        });

        if (response.status === 200) {
          if (!isJson) {
            console.error(`[VWorld Proxy non-JSON Response] Backup URL: ${backupUrl}`);
          }

          if (!isHtml && !hasAuthError) {
            console.log(`[VWorld Proxy Success] Recovered with fallback domain: ${fallbackDom}`);
            activeVWorldConfig = {
              key: activeKey,
              referer: fallbackDom,
              host: "https://api.vworld.kr"
            };
            return res.status(200).json(response.data);
          }
        }
      } catch (err: any) {
        // ignore and try next
      }
    }

    // Backup 2: Try without 'domain' parameter completely
    queryParams.delete("domain");
    const noDomainUrl = `${host}/req/${service}?${queryParams.toString()}`;
    try {
      console.log(`[VWorld Proxy No-Domain Request] URL: ${noDomainUrl}`);
      const response = await vworldAxiosGet(noDomainUrl, "");
      
      const responseDataStr = typeof response.data === "object" ? JSON.stringify(response.data) : String(response.data);
      const isJson = typeof response.data === "object" && response.data !== null;
      const isHtml = typeof response.data === "string" && response.data.trim().startsWith("<");
      
      const hasAuthError = typeof response.data === "string" && (
        response.data.includes("Service Not URL") || 
        response.data.includes("인증") || 
        response.data.includes("Unauthorized") || 
        response.data.includes("Authentication")
      );

      addVworldLog({
        service: `${service} (Backup: No-Domain)`,
        url: maskApiKey(noDomainUrl),
        referer: "none",
        domainParam: "none",
        status: response.status,
        responseType: isJson ? "JSON" : (isHtml ? "HTML" : "TEXT"),
        responseExcerpt: responseDataStr.substring(0, 500),
        success: response.status === 200 && !isHtml && !hasAuthError
      });

      if (response.status === 200) {
        if (!isHtml && !hasAuthError) {
          console.log(`[VWorld Proxy Success] Recovered without domain parameter`);
          return res.status(200).json(response.data);
        }
      }
    } catch (err: any) {
      console.error(`[VWorld Proxy Final Failure] ${err.message}`);
    }

    // If everything fails, return the error message
    return res.status(502).json({
      response: {
        status: "ERROR",
        error: {
          text: `브이월드 인증에 실패하였습니다. 입력하신 API 키와 등록 도메인이 일치하는지 확인해 주세요. (현재 요청 도메인: ${activeDomain})`
        }
      }
    });
  });

  // VWorld Geocoder API 2.0 (지번/도로명 주소를 좌표로 고정밀 변환)
  app.get("/api/map/geocode", async (req, res) => {
    const { address } = req.query;
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }

    const keys = [];
    if (process.env.VITE_VWORLD_API_KEY) {
      keys.push(process.env.VITE_VWORLD_API_KEY);
    }
    keys.push("CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9");
    keys.push("767B7AD0-CA3E-3BC3-A449-746658820988");

    const referers = [];
    if (req.headers.referer) {
      try {
        const parsed = new URL(req.headers.referer);
        referers.push(parsed.origin);
      } catch (e) {
        referers.push(req.headers.referer);
      }
    }
    referers.push("http://localhost:3000");
    referers.push("http://localhost");
    referers.push("http://127.0.0.1:3000");
    referers.push("http://127.0.0.1");
    referers.push("http://api.vworld.kr");
    referers.push("https://api.vworld.kr");
    referers.push("localhost");

    const hosts = ["https://api.vworld.kr"];

    // 1순위: 이미 작동함이 확인된 활성 설정이 있다면 그것으로 먼저 시도
    if (activeVWorldConfig) {
      try {
        const domainParam = activeVWorldConfig.referer.startsWith("http") ? activeVWorldConfig.referer : `http://${activeVWorldConfig.referer}`;
        const url = `${activeVWorldConfig.host}/req/address?service=address&request=getcoord&version=2.0&key=${activeVWorldConfig.key}&address=${encodeURIComponent(address as string)}&domain=${encodeURIComponent(domainParam)}`;
        
        console.log(`[VWorld Geocode] Trying already-cached active config with key: ${activeVWorldConfig.key.substring(0, 5)}...`);
        const response = await vworldAxiosGet(url, activeVWorldConfig.referer);

        if (response.status === 200) {
          const data = response.data;
          if (data?.response?.status === "OK") {
            return res.json(data);
          }
        }
      } catch (err: any) {
        console.warn(`[VWorld Geocode Active Cache Fail] ${err.message}`);
        activeVWorldConfig = null; // 활성 설정 에러 시 만료 처리
      }
    }

    // 2순위: 다중 조합 루프 검색
    for (const host of hosts) {
      for (const key of keys) {
        for (const referer of referers) {
          try {
            const domainParam = referer.startsWith("http") ? referer : `http://${referer}`;
            const url = `${host}/req/address?service=address&request=getcoord&version=2.0&key=${key}&address=${encodeURIComponent(address as string)}&domain=${encodeURIComponent(domainParam)}`;
            
            const response = await vworldAxiosGet(url, referer);

            if (response.status === 200) {
              const data = response.data;
              if (data?.response?.status === "OK") {
                console.log(`[VWorld Geocode] SUCCESS! Host: ${host}, Key: ${key.substring(0, 5)}..., Referer: ${referer}`);
                activeVWorldConfig = { key, referer, host }; // 정상 작동 설정 전역 캐싱!
                return res.json(data);
              }
            }
          } catch (err: any) {
            // 다음 루프 시도
          }
        }
      }
    }

    // 3순위: domain 없이 시도
    for (const host of hosts) {
      for (const key of keys) {
        for (const referer of referers) {
          try {
            const url = `${host}/req/address?service=address&request=getcoord&version=2.0&key=${key}&address=${encodeURIComponent(address as string)}`;
            const response = await vworldAxiosGet(url, referer);

            if (response.status === 200) {
              const data = response.data;
              if (data?.response?.status === "OK") {
                console.log(`[VWorld Geocode Step 3] SUCCESS! Host: ${host}, Key: ${key.substring(0, 5)}..., Referer: ${referer}`);
                activeVWorldConfig = { key, referer, host };
                return res.json(data);
              }
            }
          } catch (err) {
            // 다음 루프
          }
        }
      }
    }

    return res.status(404).json({ error: "Address coordinate not found via VWorld" });
  });

  // VWorld 지적도 및 배경지도 국토교통부 타일 프록시 (리퍼러 잠금 우회)
  app.get("/api/map/boundary", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: "lat and lng are required parameters" });
    }

    const keys = [];
    if (process.env.VITE_VWORLD_API_KEY) {
      keys.push(process.env.VITE_VWORLD_API_KEY);
    }
    keys.push("CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9");
    keys.push("767B7AD0-CA3E-3BC3-A449-746658820988");

    const referers = [];
    if (req.headers.referer) {
      try {
        const parsed = new URL(req.headers.referer);
        referers.push(parsed.origin); // e.g., https://ais-dev-a6ul6w6pzuixpxrdrl7fpt...
      } catch (e) {
        referers.push(req.headers.referer);
      }
    }
    referers.push("http://localhost:3000");
    referers.push("http://localhost");
    referers.push("http://127.0.0.1:3000");
    referers.push("http://127.0.0.1");
    referers.push("http://api.vworld.kr");
    referers.push("https://api.vworld.kr");
    referers.push("localhost");

    const hosts = ["https://api.vworld.kr"];
    const dataSets = ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN", "LP_PA_CBND"];

    // 0단계: 전역 활성 작동 설정이 있다면 최우선 시도
    if (activeVWorldConfig) {
      for (const dataSet of dataSets) {
        try {
          const domainParam = activeVWorldConfig.referer.startsWith("http") ? activeVWorldConfig.referer : `http://${activeVWorldConfig.referer}`;
          const url = `${activeVWorldConfig.host}/req/data?service=data&request=GetFeature&data=${dataSet}&key=${activeVWorldConfig.key}&geomFilter=POINT(${lng} ${lat})&crs=EPSG:4326&format=json&size=10&domain=${encodeURIComponent(domainParam)}`;
          
          const response = await vworldAxiosGet(url, activeVWorldConfig.referer);

          if (response.status === 200) {
            const data = response.data;
            if (data?.response?.status === "OK") {
              return res.json(data);
            }
          }
        } catch (err: any) {
          console.warn(`[VWorld Boundary Active Cache Fail] dataset: ${dataSet}, error: ${err.message}`);
        }
      }
      activeVWorldConfig = null; // 모든 데이터셋 실패 시 캐시 클리어
    }

    // 1단계: domain 쿼리 파라미터를 포함하여 최적의 조합을 시도 (VWorld 2.0 권장 스펙)
    for (const host of hosts) {
      for (const key of keys) {
        for (const referer of referers) {
          for (const dataSet of dataSets) {
            try {
              const domainParam = referer.startsWith("http") ? referer : `http://${referer}`;
              const url = `${host}/req/data?service=data&request=GetFeature&data=${dataSet}&key=${key}&geomFilter=POINT(${lng} ${lat})&crs=EPSG:4326&format=json&size=10&domain=${encodeURIComponent(domainParam)}`;
              
              console.log(`[VWorld Boundary Step 1] Trying: ${host} with key: ${key.substring(0, 5)}... dataset: ${dataSet} with Referer/Domain: ${referer}`);
              const response = await vworldAxiosGet(url, referer);

              if (response.status === 200) {
                const data = response.data;
                if (data?.response?.status === "OK") {
                  console.log(`[VWorld Boundary] SUCCESS with host: ${host}, key: ${key.substring(0, 5)}... dataset: ${dataSet} and referer: ${referer}`);
                  activeVWorldConfig = { key, referer, host }; // 활성 지적 정보 및 키 세션 동기화!
                  return res.json(data);
                } else {
                  console.warn(`[VWorld Boundary Info] dataset ${dataSet} returned: ${data?.response?.status || "unknown status"} - ${data?.response?.error?.text || "no error text"}`);
                }
              }
            } catch (err: any) {
              console.error(`[VWorld Boundary Fetch Err] dataset: ${dataSet}, host: ${host}, error: ${err.message}`);
            }
          }
        }
      }
    }

    // 2단계: domain 쿼리 파라미터 없이 순수한 Referer 헤더 조합만으로 2차 시도
    for (const host of hosts) {
      for (const key of keys) {
        for (const referer of referers) {
          for (const dataSet of dataSets) {
            try {
              const url = `${host}/req/data?service=data&request=GetFeature&data=${dataSet}&key=${key}&geomFilter=POINT(${lng} ${lat})&crs=EPSG:4326&format=json&size=10`;
              
              console.log(`[VWorld Boundary Step 2] Trying: ${host} with key: ${key.substring(0, 5)}... dataset: ${dataSet} without domain query, Referer: ${referer}`);
              const response = await vworldAxiosGet(url, referer);

              if (response.status === 200) {
                const data = response.data;
                if (data?.response?.status === "OK") {
                  console.log(`[VWorld Boundary Step 2] SUCCESS with host: ${host}, key: ${key.substring(0, 5)}... dataset: ${dataSet} and referer: ${referer}`);
                  activeVWorldConfig = { key, referer, host };
                  return res.json(data);
                }
              }
            } catch (err) {
              // 다음 조합 시도
            }
          }
        }
      }
    }

    return res.status(500).json({ 
      error: "모든 VWorld API 키, 데이터셋(부번/본번/연속지적) 및 도메인/리퍼러 조합이 지번 경계 데이터를 가져오는 데 실패했습니다.",
      status: "ERROR"
    });
  });

  // VWorld 타일용 활성 설정 임시 캐시 (매번 반복 연산을 방지하여 타일 로딩을 극도로 빠르게 처리)
  let cachedTileConfig: { key: string; referer: string } | null = null;

  async function fetchTileWithFallback(layer: string, z: string, x: string, y: string, reqRefererHeader?: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const keys = [];
    if (process.env.VITE_VWORLD_API_KEY) {
      keys.push(process.env.VITE_VWORLD_API_KEY);
    }
    keys.push("CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9");
    keys.push("767B7AD0-CA3E-3BC3-A449-746658820988");

    const referers = [];
    if (reqRefererHeader) {
      try {
        const parsed = new URL(reqRefererHeader);
        referers.push(parsed.origin);
      } catch (e) {
        referers.push(reqRefererHeader);
      }
    }
    referers.push("http://localhost:3000");
    referers.push("http://localhost");
    referers.push("http://127.0.0.1:3000");
    referers.push("http://127.0.0.1");
    referers.push("http://api.vworld.kr");
    referers.push("https://api.vworld.kr");
    referers.push("localhost");

    const hosts = ["https://api.vworld.kr"];

    // 0순위: GetFeature나 Geocode에서 정상 작동이 100% 입증된 전역 설정을 우선 로드
    const activeKey = activeVWorldConfig?.key || cachedTileConfig?.key;
    const activeReferer = activeVWorldConfig?.referer || cachedTileConfig?.referer;
    const activeHost = activeVWorldConfig?.host || "https://api.vworld.kr";

    if (activeKey && activeReferer) {
      try {
        const url = `${activeHost}/req/wmts/1.0.0/${activeKey}/${layer}/${z}/${y}/${x}.png`;
        const response = await vworldAxiosGet(url, activeReferer, "arraybuffer");
        const contentType = String(response.headers["content-type"] || "");
        if (response.status === 200 && contentType.includes("image")) {
          const buffer = response.data;
          // 실제로 잘 작동하므로 캐시를 최신화해 둡니다.
          cachedTileConfig = { key: activeKey, referer: activeReferer };
          return { buffer: Buffer.from(buffer), contentType };
        }
      } catch (err) {
        // 전역 설정 실패 시 일반 루프로 폴백
      }
    }

    if (cachedTileConfig) {
      for (const host of hosts) {
        try {
          const url = `${host}/req/wmts/1.0.0/${cachedTileConfig.key}/${layer}/${z}/${y}/${x}.png`;
          const response = await vworldAxiosGet(url, cachedTileConfig.referer, "arraybuffer");
          const contentType = String(response.headers["content-type"] || "");
          if (response.status === 200 && contentType.includes("image")) {
            const buffer = response.data;
            return { buffer: Buffer.from(buffer), contentType };
          }
        } catch (err) {
          // 다음 호스트 시도
        }
      }
      cachedTileConfig = null; // 실패 시 초기화 후 재생성 시도
    }

    for (const host of hosts) {
      for (const key of keys) {
        for (const referer of referers) {
          try {
            const url = `${host}/req/wmts/1.0.0/${key}/${layer}/${z}/${y}/${x}.png`;
            const response = await vworldAxiosGet(url, referer, "arraybuffer");
            const contentType = String(response.headers["content-type"] || "");
            if (response.status === 200 && contentType.includes("image")) {
              const buffer = response.data;
              cachedTileConfig = { key, referer };
              console.log(`[VWorld WMTS] Working config found & cached. Host: ${host}, Key: ${key.substring(0, 5)}..., Referer: ${referer}`);
              return { buffer: Buffer.from(buffer), contentType };
            }
          } catch (err) {
            // 다음 조합 시도
          }
        }
      }
    }

    return null;
  }

  app.get("/api/map/cadastral/:z/:x/:y.png", async (req, res) => {
    const { z, x, y } = req.params;
    try {
      let result = await fetchTileWithFallback("LP_PA_CBND_BUBUN", z, x, y, req.headers.referer);
      if (!result) {
        result = await fetchTileWithFallback("LP_PA_CBND", z, x, y, req.headers.referer);
      }
      if (result) {
        res.setHeader("Content-Type", result.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(result.buffer);
      }
      
      // 1x1 투명 이미지 반환
      const transparent1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      res.setHeader("Content-Type", "image/png");
      return res.send(transparent1x1);
    } catch (error) {
      const transparent1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      res.setHeader("Content-Type", "image/png");
      return res.send(transparent1x1);
    }
  });

  app.get("/api/map/vworld-base/:z/:x/:y.png", async (req, res) => {
    const { z, x, y } = req.params;
    try {
      const result = await fetchTileWithFallback("Base", z, x, y, req.headers.referer);
      if (result) {
        res.setHeader("Content-Type", result.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(result.buffer);
      }
      return res.status(500).send("Error fetching tile");
    } catch (error) {
      res.status(500).send("Proxy error");
    }
  });

  app.get("/api/regions", (req, res) => {
    try {
      const regionsPath = path.join(process.cwd(), "src", "regions.json");
      const regions = JSON.parse(fs.readFileSync(regionsPath, "utf-8"));
      
      const { q } = req.query;
      if (q) {
        const queryStr = String(q).trim().toLowerCase().replace(/\s+/g, "");
        if (queryStr) {
          const filtered = regions.filter((r: any) => {
            const nameClean = r.name.toLowerCase().replace(/\s+/g, "");
            return nameClean.includes(queryStr);
          });
          
          const sorted = filtered.sort((a: any, b: any) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const qOriginal = String(q).trim().toLowerCase();
            
            const aIndex = aName.indexOf(qOriginal);
            const bIndex = bName.indexOf(qOriginal);
            if (aIndex !== bIndex) {
              if (aIndex === -1) return 1;
              if (bIndex === -1) return -1;
              return aIndex - bIndex;
            }
            
            const aStarts = aName.startsWith(qOriginal);
            const bStarts = bName.startsWith(qOriginal);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            
            return a.name.length - b.name.length;
          });
          
          return res.json(sorted);
        }
      }
      res.json(regions);
    } catch (err) {
      console.error("Error reading regions.json:", err);
      res.json([]);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
