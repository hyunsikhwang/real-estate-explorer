import regions from "../src/regions.json";

const VWORLD_API_BASE = "https://api.vworld.kr/req";
const CADASTRAL_LAYERS = "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun";
const CADASTRAL_STYLES = "lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line";
const PNU_PATTERN = /^\d{19}$/;
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

type JsonRecord = Record<string, any>;

export interface RuntimeEnv {
  DATA_GO_KR_SERVICE_KEY?: string;
  VWORLD_API_KEY?: string;
  VITE_VWORLD_API_KEY?: string;
  VWORLD_DOMAIN?: string;
}

interface VWorldConfiguration {
  apiKey: string;
  domain: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "UPSTREAM_ERROR",
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers });
}

function normalizeDomain(value?: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getVWorldConfiguration(request: Request, env: RuntimeEnv): VWorldConfiguration {
  const apiKey = String(env.VWORLD_API_KEY || env.VITE_VWORLD_API_KEY || "").trim();
  const requestUrl = new URL(request.url);
  const domain = normalizeDomain(env.VWORLD_DOMAIN || requestUrl.origin);
  return { apiKey, domain };
}

function ensureVWorldConfigured(config: VWorldConfiguration) {
  if (!config.apiKey) {
    throw new ApiError(
      "VWorld API 키가 설정되지 않았습니다. 호스팅 환경변수 VWORLD_API_KEY를 설정해 주세요.",
      503,
      "VWORLD_NOT_CONFIGURED",
    );
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function vworldUrl(path: string, params: Record<string, string>) {
  const url = new URL(`${VWORLD_API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function readVWorldJson(url: URL, domain: string): Promise<JsonRecord> {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", Referer: domain },
  });
  const text = await response.text();
  if (!response.ok || text.trim().startsWith("<")) {
    throw new ApiError(`VWorld API가 HTTP ${response.status}로 응답했습니다.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("VWorld API 응답을 해석할 수 없습니다.");
  }
}

function stripHtml(value: unknown) {
  return String(value || "").replace(/<\/?[^>]+(>|$)/g, "").trim();
}

function normalizeSearchResponse(data: JsonRecord) {
  const response = data?.response || {};
  if (response.status === "NOT_FOUND") return [];
  if (response.status !== "OK") {
    throw new ApiError(
      response.error?.text || "VWorld 지번 주소 검색에 실패했습니다.",
      502,
      String(response.error?.code || "SEARCH_FAILED"),
    );
  }
  const rawItems = response.result?.items;
  const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
  return items
    .map((item: JsonRecord, index: number) => {
      const pnuMatch = JSON.stringify(item).match(/\b\d{19}\b/);
      const pnu = String(item.id || item.pnu || item.address?.pnu || pnuMatch?.[0] || "");
      return {
        id: pnu || `candidate-${index}`,
        title: stripHtml(item.title || item.address?.parcel || "주소명 없음"),
        parcelAddress: stripHtml(item.address?.parcel || item.title || ""),
        roadAddress: stripHtml(item.address?.road || ""),
        pnu: PNU_PATTERN.test(pnu) ? pnu : "",
        lon: Number(item.point?.x),
        lat: Number(item.point?.y),
      };
    })
    .filter((item: { lon: number; lat: number }) => Number.isFinite(item.lon) && Number.isFinite(item.lat));
}

function extractFeatureCollection(data: JsonRecord) {
  const response = data?.response;
  if (response?.status && response.status !== "OK" && response.status !== "NOT_FOUND") {
    throw new ApiError(
      response.error?.text || "VWorld 연속지적도 조회에 실패했습니다.",
      502,
      String(response.error?.code || "PARCEL_FAILED"),
    );
  }
  const result = response?.result;
  const collection = data?.type === "FeatureCollection"
    ? data
    : result?.featureCollection?.type === "FeatureCollection"
      ? result.featureCollection
      : result?.type === "FeatureCollection"
        ? result
        : null;
  if (collection) {
    return {
      type: "FeatureCollection",
      features: Array.isArray(collection.features) ? collection.features : [],
    };
  }
  const rawFeatures = result?.features || data?.features || [];
  return {
    type: "FeatureCollection",
    features: Array.isArray(rawFeatures) ? rawFeatures : rawFeatures ? [rawFeatures] : [],
  };
}

function vworldDataParams(config: VWorldConfiguration, data: string) {
  return {
    service: "data",
    request: "GetFeature",
    version: "2.0",
    data,
    geometry: "true",
    attribute: "true",
    crs: "EPSG:4326",
    format: "json",
    errorformat: "json",
    size: "10",
    page: "1",
    key: config.apiKey,
    domain: config.domain,
  };
}

function normalizeData(value: unknown) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
}

function isServiceKeyError(data: unknown) {
  return typeof data === "string" && data.includes("SERVICE_KEY_IS_NOT_REGISTERED");
}

function publicDataErrorMessage(data: string) {
  if (data.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
    return "공공데이터포털 인증키가 유효하지 않습니다. 인증키와 활용 신청 상태를 확인해 주세요.";
  }
  if (data.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR")) {
    return "공공데이터 API의 일일 호출 한도를 초과했습니다.";
  }
  return "공공데이터 API가 오류를 반환했습니다.";
}

function filterByApartmentKeyword(data: any, keyword: string) {
  if (!keyword) return data;
  const body = data?.response?.body;
  const rawItems = body?.items?.item;
  if (!rawItems) return data;
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, "");
  const filtered = items.filter((item: any) => {
    const name = String(item.aptNm || item.아파트 || item.건물명 || item.단지 || "")
      .toLowerCase()
      .replace(/\s+/g, "");
    return name.includes(normalizedKeyword);
  });
  return {
    ...data,
    response: {
      ...data.response,
      body: {
        ...body,
        totalCount: filtered.length,
        items: { ...(body.items || {}), item: filtered },
      },
    },
  };
}

async function fetchTransactions(serviceKey: string, tradeType: string, sigunguCode: string, dealMonth: string) {
  const endpoints = TRANSACTION_ENDPOINTS[tradeType];
  const query = new URLSearchParams({
    LAWD_CD: sigunguCode,
    DEAL_YMD: dealMonth,
    numOfRows: "1000",
    pageNo: "1",
    _type: "json",
  });
  const keys = [serviceKey];
  try {
    const decoded = decodeURIComponent(serviceKey);
    if (decoded !== serviceKey) keys.push(decoded);
  } catch {
    // 원본 키로 계속 시도합니다.
  }
  let lastStatus = 502;
  for (const endpoint of endpoints) {
    for (const key of keys) {
      const response = await fetchWithTimeout(`${endpoint}?serviceKey=${key}&${query.toString()}`, {
        headers: { Accept: "application/json" },
      });
      lastStatus = response.status;
      const text = await response.text();
      const data = normalizeData(text);
      if (response.ok && !isServiceKeyError(data)) return data;
    }
  }
  throw new ApiError(`공공데이터 API가 HTTP ${lastStatus}로 응답했습니다.`);
}

async function handleTransactions(url: URL, env: RuntimeEnv) {
  const sigunguCode = String(url.searchParams.get("sigunguCode") || "").trim();
  const dealMonth = String(url.searchParams.get("dealMonth") || "").trim();
  const tradeType = String(url.searchParams.get("tradeType") || "").trim();
  const keyword = String(url.searchParams.get("keyword") || "").trim();
  const serviceKey = String(env.DATA_GO_KR_SERVICE_KEY || "").trim();
  if (!serviceKey) throw new ApiError("공공데이터포털 인증키가 설정되지 않았습니다.", 503, "DATA_KEY_MISSING");
  if (!/^\d{5}$/.test(sigunguCode)) throw new ApiError("법정동 시군구 코드는 5자리 숫자여야 합니다.", 400, "INVALID_REGION");
  if (!/^\d{6}$/.test(dealMonth)) throw new ApiError("계약월은 YYYYMM 형식이어야 합니다.", 400, "INVALID_MONTH");
  if (!TRANSACTION_ENDPOINTS[tradeType]) throw new ApiError("거래 유형은 매매 또는 전월세여야 합니다.", 400, "INVALID_TRADE_TYPE");
  const data = await fetchTransactions(serviceKey, tradeType, sigunguCode, dealMonth);
  if (typeof data === "string" && data.trim().startsWith("<")) {
    throw new ApiError(publicDataErrorMessage(data));
  }
  const header = (data as any)?.response?.header;
  const resultCode = String(header?.resultCode || "");
  const resultMessage = String(header?.resultMsg || "");
  const success = !resultCode || ["00", "000", "0", "OK"].includes(resultCode)
    || resultMessage.toUpperCase().includes("NORMAL SERVICE")
    || resultMessage.toUpperCase() === "OK";
  if (!success) throw new ApiError(`${resultMessage || "공공데이터 API 오류"} (${resultCode})`);
  return json(filterByApartmentKeyword(data, keyword));
}

async function handleVWorld(request: Request, env: RuntimeEnv, url: URL) {
  const config = getVWorldConfiguration(request, env);
  const path = url.pathname;
  if (path === "/api/map/status") {
    const configured = Boolean(config.apiKey);
    return json({
      configured,
      domain: config.domain,
      services: { addressSearch: configured, parcelGeometry: configured, cadastralWms: configured },
      browserDirect: {
        enabled: configured,
        apiKey: config.apiKey,
        domain: config.domain,
      },
    }, 200, { "Cache-Control": "no-store" });
  }
  ensureVWorldConfigured(config);

  if (path === "/api/map/search") {
    const query = String(url.searchParams.get("query") || "").trim();
    if (!query) throw new ApiError("검색할 지번 주소를 입력해 주세요.", 400, "QUERY_REQUIRED");
    const data = await readVWorldJson(vworldUrl("search", {
      service: "search",
      request: "search",
      version: "2.0",
      crs: "EPSG:4326",
      size: "10",
      page: "1",
      type: "address",
      category: "parcel",
      format: "json",
      errorformat: "json",
      key: config.apiKey,
      domain: config.domain,
      query,
    }), config.domain);
    return json({ candidates: normalizeSearchResponse(data) });
  }

  const parcelMatch = path.match(/^\/api\/map\/parcels\/(\d{19})$/);
  if (parcelMatch) {
    const pnu = parcelMatch[1];
    let lastError = "필지 경계를 찾지 못했습니다.";
    for (const dataSet of ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"]) {
      try {
        const data = await readVWorldJson(vworldUrl("data", {
          ...vworldDataParams(config, dataSet),
          attrFilter: `pnu:=:${pnu}`,
        }), config.domain);
        const collection = extractFeatureCollection(data);
        if (collection.features.length > 0) return json({ ...collection, dataSet, pnu });
        lastError = data?.response?.error?.text || lastError;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new ApiError(lastError, 404, "PARCEL_NOT_FOUND");
  }

  if (path === "/api/map/parcel-at-point") {
    const lon = Number(url.searchParams.get("lon"));
    const lat = Number(url.searchParams.get("lat"));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 124 || lon > 132 || lat < 33 || lat > 39) {
      throw new ApiError("대한민국 영역의 올바른 경위도 좌표가 필요합니다.", 400, "INVALID_COORDINATE");
    }
    const data = await readVWorldJson(vworldUrl("data", {
      ...vworldDataParams(config, "LP_PA_CBND_BUBUN"),
      geomFilter: `POINT(${lon} ${lat})`,
    }), config.domain);
    const collection = extractFeatureCollection(data);
    if (collection.features.length === 0) throw new ApiError("해당 좌표의 필지 경계를 찾지 못했습니다.", 404, "PARCEL_NOT_FOUND");
    return json({ ...collection, dataSet: "LP_PA_CBND_BUBUN" });
  }

  if (path === "/api/map/wms") {
    const bbox = String(url.searchParams.get("BBOX") || url.searchParams.get("bbox") || "").trim();
    if (!bbox || !/^[-+\d.eE,]+$/.test(bbox)) throw new ApiError("올바른 WMS BBOX 값이 필요합니다.", 400, "INVALID_BBOX");
    const width = Math.min(Math.max(Number(url.searchParams.get("WIDTH") || url.searchParams.get("width")) || 256, 1), 1024);
    const height = Math.min(Math.max(Number(url.searchParams.get("HEIGHT") || url.searchParams.get("height")) || 256, 1), 1024);
    const upstream = await fetchWithTimeout(vworldUrl("wms", {
      service: "WMS",
      request: "GetMap",
      version: "1.3.0",
      layers: CADASTRAL_LAYERS,
      styles: CADASTRAL_STYLES,
      crs: "EPSG:3857",
      bbox,
      width: String(width),
      height: String(height),
      format: "image/png",
      transparent: "true",
      exceptions: "application/json",
      key: config.apiKey,
      domain: config.domain,
    }), { headers: { Accept: "image/png", Referer: config.domain } });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.includes("image")) throw new ApiError(`연속지적도 WMS가 HTTP ${upstream.status}로 응답했습니다.`, 502, "WMS_FAILED");
    return new Response(upstream.body, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  }

  const tileMatch = path.match(/^\/api\/map\/base\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (tileMatch) {
    const [z, x, y] = tileMatch.slice(1).map(Number);
    const maxCoordinate = 2 ** z - 1;
    if (z > 20 || x > maxCoordinate || y > maxCoordinate) throw new ApiError("올바른 지도 타일 좌표가 필요합니다.", 400, "INVALID_TILE");
    const tileUrl = `${VWORLD_API_BASE}/wmts/1.0.0/${encodeURIComponent(config.apiKey)}/Base/${z}/${y}/${x}.png`;
    const upstream = await fetchWithTimeout(tileUrl, { headers: { Accept: "image/png", Referer: config.domain } });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.includes("image")) throw new ApiError("VWorld 배경지도를 불러오지 못했습니다.", 502, "BASE_TILE_FAILED");
    return new Response(upstream.body, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    });
  }

  return json({ error: "지도 API 경로를 찾을 수 없습니다.", code: "NOT_FOUND" }, 404);
}

export async function handleApiRequest(request: Request, env: RuntimeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (request.method !== "GET") return json({ error: "지원하지 않는 요청 방식입니다." }, 405);
  try {
    if (url.pathname === "/api/config") {
      const vworld = getVWorldConfiguration(request, env);
      return json({
        hasServiceKey: Boolean(env.DATA_GO_KR_SERVICE_KEY),
        hasVworldKey: Boolean(vworld.apiKey),
        vworldDomain: vworld.domain,
      });
    }
    if (url.pathname === "/api/regions") {
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase().replace(/\s+/g, "");
      if (!query) return json(regions);
      const filtered = regions
        .filter((region) => region.name.toLowerCase().replace(/\s+/g, "").includes(query))
        .sort((a, b) => {
          const aName = a.name.toLowerCase().replace(/\s+/g, "");
          const bName = b.name.toLowerCase().replace(/\s+/g, "");
          const aIndex = aName.indexOf(query);
          const bIndex = bName.indexOf(query);
          return aIndex === bIndex ? a.name.length - b.name.length : aIndex - bIndex;
        });
      return json(filtered);
    }
    if (url.pathname === "/api/transactions") return await handleTransactions(url, env);
    if (url.pathname.startsWith("/api/map/")) return await handleVWorld(request, env, url);
    return json({ error: "API 경로를 찾을 수 없습니다." }, 404);
  } catch (error) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 500;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known ? error.message : "요청 처리 중 오류가 발생했습니다.";
    if (!known) console.error("[API]", error);
    return json({ error: message, code }, status);
  }
}
