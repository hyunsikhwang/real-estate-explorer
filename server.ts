import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/config", (req, res) => {
    res.json({
      hasServiceKey: !!process.env.DATA_GO_KR_SERVICE_KEY
    });
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
