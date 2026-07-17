import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createVWorldRouter, getVWorldConfiguration } from "./server/vworld";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const TRANSACTION_ENDPOINTS: Record<string, string[]> = {
  매매: [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  ],
  전월세: [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRentDev/getRTMSDataSvcAptRentDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRentService/getRTMSDataSvcAptRentService",
  ],
};

function isXmlResponse(data: unknown): data is string {
  return typeof data === "string" && (
    data.includes("<resultCode>") ||
    data.includes("<OpenAPI_ServiceResponse>") ||
    data.includes("<?xml")
  );
}

function isServiceKeyError(data: unknown): boolean {
  return typeof data === "string" && (
    data.includes("SERVICE_KEY_IS_NOT_REGISTERED") ||
    data.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")
  );
}

function publicDataErrorMessage(data: string): string {
  if (data.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
    return "공공데이터포털 인증키가 유효하지 않습니다. 디코딩 인증키와 활용 신청 상태를 확인해 주세요.";
  }
  if (data.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR")) {
    return "공공데이터 API의 일일 호출 한도를 초과했습니다.";
  }
  if (data.includes("DEADLINE_EXCEEDED")) {
    return "공공데이터 API 응답 시간이 초과되었습니다.";
  }
  return "공공데이터 API가 XML 오류 응답을 반환했습니다.";
}

function normalizeData(data: unknown): any {
  if (typeof data === "string" && data.trim().startsWith("{")) {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function filterByApartmentKeyword(data: any, keyword: string): any {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword || !data?.response?.body) return data;

  const body = data.response.body;
  const rawItems = body.items?.item ?? body.items ?? [];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const filtered = items.filter((item: any) => {
    const apartmentName = String(
      item?.aptNm || item?.아파트 || item?.건물명 || item?.단지 ||
      item?.aptName || item?.apartmentName || "",
    ).trim().toLowerCase();
    return apartmentName.includes(normalizedKeyword);
  });

  body.items = { item: filtered };
  body.totalCount = filtered.length;
  return data;
}

async function fetchTransactions(
  serviceKey: string,
  tradeType: string,
  sigunguCode: string,
  dealMonth: string,
) {
  const endpoints = TRANSACTION_ENDPOINTS[tradeType];
  const query = new URLSearchParams({
    LAWD_CD: sigunguCode,
    DEAL_YMD: dealMonth,
    numOfRows: "10000",
    pageNo: "1",
    _type: "json",
  });

  const keys = [serviceKey];
  try {
    const decoded = decodeURIComponent(serviceKey);
    if (decoded !== serviceKey) keys.push(decoded);
  } catch {
    // 이미 디코딩된 키는 그대로 사용합니다.
  }

  let lastResponse: any = null;
  for (const key of [...new Set(keys)]) {
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${endpoint}?serviceKey=${key}&${query.toString()}`, {
          timeout: 25000,
          headers: { Accept: "application/json, text/plain, */*", "User-Agent": "real-estate-explorer/1.0" },
          validateStatus: () => true,
        });
        lastResponse = response;
        if (response.status === 200 && !isServiceKeyError(response.data)) return response;
      } catch (error) {
        console.warn(`[실거래가 API] ${endpoint} 호출 실패`, error);
      }
    }
  }
  return lastResponse;
}

async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.use("/api/map", createVWorldRouter());

  app.get("/api/config", (req, res) => {
    const vworld = getVWorldConfiguration(req);
    res.json({
      hasServiceKey: Boolean(process.env.DATA_GO_KR_SERVICE_KEY),
      hasVworldKey: Boolean(vworld.apiKey),
      vworldDomain: vworld.domain,
    });
  });

  app.get("/api/transactions", async (req, res) => {
    const sigunguCode = String(req.query.sigunguCode || "").trim();
    const dealMonth = String(req.query.dealMonth || "").trim();
    const tradeType = String(req.query.tradeType || "").trim();
    const keyword = String(req.query.keyword || "").trim();
    const serviceKey = String(process.env.DATA_GO_KR_SERVICE_KEY || "").trim();

    if (!serviceKey) {
      return res.status(503).json({ error: "공공데이터포털 인증키가 설정되지 않았습니다." });
    }
    if (!/^\d{5}$/.test(sigunguCode)) {
      return res.status(400).json({ error: "법정동 시군구 코드는 5자리 숫자여야 합니다." });
    }
    if (!/^\d{6}$/.test(dealMonth)) {
      return res.status(400).json({ error: "계약월은 YYYYMM 형식이어야 합니다." });
    }
    if (!TRANSACTION_ENDPOINTS[tradeType]) {
      return res.status(400).json({ error: "거래 유형은 매매 또는 전월세여야 합니다." });
    }

    try {
      const response = await fetchTransactions(serviceKey, tradeType, sigunguCode, dealMonth);
      if (!response) {
        return res.status(502).json({ error: "공공데이터 API에 연결하지 못했습니다." });
      }
      if (response.status !== 200) {
        return res.status(502).json({ error: `공공데이터 API가 HTTP ${response.status}로 응답했습니다.` });
      }

      const data = normalizeData(response.data);
      if (isXmlResponse(data)) {
        return res.status(502).json({
          error: publicDataErrorMessage(data),
          details: data.slice(0, 300),
        });
      }

      const header = data?.response?.header;
      const resultCode = String(header?.resultCode || "");
      const resultMessage = String(header?.resultMsg || "");
      const success = !resultCode || ["00", "0", "OK"].includes(resultCode) ||
        resultMessage.toUpperCase().includes("NORMAL SERVICE") || resultMessage.toUpperCase() === "OK";
      if (!success) {
        return res.status(502).json({ error: `${resultMessage || "공공데이터 API 오류"} (${resultCode})` });
      }

      return res.json(filterByApartmentKeyword(data, keyword));
    } catch (error: any) {
      console.error("[실거래가 API]", error);
      return res.status(500).json({ error: "실거래가 조회 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/regions", (req, res) => {
    try {
      const regionsPath = path.join(process.cwd(), "src", "regions.json");
      const regions = JSON.parse(fs.readFileSync(regionsPath, "utf8"));
      const query = String(req.query.q || "").trim().toLowerCase().replace(/\s+/g, "");
      if (!query) return res.json(regions);

      const filtered = regions
        .filter((region: any) => region.name.toLowerCase().replace(/\s+/g, "").includes(query))
        .sort((a: any, b: any) => {
          const aName = a.name.toLowerCase().replace(/\s+/g, "");
          const bName = b.name.toLowerCase().replace(/\s+/g, "");
          const aIndex = aName.indexOf(query);
          const bIndex = bName.indexOf(query);
          return aIndex === bIndex ? a.name.length - b.name.length : aIndex - bIndex;
        });
      return res.json(filtered);
    } catch (error) {
      console.error("[지역 데이터]", error);
      return res.status(500).json({ error: "지역 목록을 읽지 못했습니다." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`부동산 조회 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

startServer().catch((error) => {
  console.error("서버 시작 실패", error);
  process.exitCode = 1;
});

