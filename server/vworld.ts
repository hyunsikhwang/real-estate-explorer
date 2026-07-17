import axios, { AxiosInstance } from "axios";
import { Request, Router } from "express";

const VWORLD_API_BASE = "https://api.vworld.kr/req";
const CADASTRAL_LAYERS = "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun";
const CADASTRAL_STYLES = "lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line";
const PNU_PATTERN = /^\d{19}$/;

type JsonRecord = Record<string, any>;

export interface ParcelCandidate {
  id: string;
  title: string;
  parcelAddress: string;
  roadAddress: string;
  pnu: string;
  lon: number;
  lat: number;
}

export interface VWorldConfiguration {
  apiKey: string;
  domain: string;
}

class VWorldError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "VWORLD_ERROR") {
    super(message);
    this.name = "VWorldError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeVWorldDomain(value?: string): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function requestOrigin(req: Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host") || "localhost:3000";
  return normalizeVWorldDomain(`${protocol}://${host}`);
}

export function getVWorldConfiguration(req?: Request): VWorldConfiguration {
  const apiKey = String(
    process.env.VWORLD_API_KEY || process.env.VITE_VWORLD_API_KEY || "",
  ).trim();
  const domain = normalizeVWorldDomain(
    process.env.VWORLD_DOMAIN || (req ? requestOrigin(req) : ""),
  );
  return { apiKey, domain };
}

export function stripHtml(value: unknown): string {
  return String(value || "").replace(/<\/?[^>]+(>|$)/g, "").trim();
}

export function normalizeSearchResponse(data: JsonRecord): ParcelCandidate[] {
  const response = data?.response || {};
  if (response.status === "NOT_FOUND") return [];
  if (response.status !== "OK") {
    throw new VWorldError(
      response.error?.text || "VWorld 지번 주소 검색에 실패했습니다.",
      502,
      String(response.error?.code || "SEARCH_FAILED"),
    );
  }

  const rawItems = response.result?.items;
  const items = rawItems
    ? Array.isArray(rawItems)
      ? rawItems
      : [rawItems]
    : [];

  return items
    .map((item: JsonRecord, index: number) => {
      const serialized = JSON.stringify(item);
      const pnuMatch = serialized.match(/\b\d{19}\b/);
      const pnu = String(item.id || item.pnu || item.address?.pnu || pnuMatch?.[0] || "");
      const lon = Number(item.point?.x);
      const lat = Number(item.point?.y);
      return {
        id: pnu || `candidate-${index}`,
        title: stripHtml(item.title || item.address?.parcel || "주소명 없음"),
        parcelAddress: stripHtml(item.address?.parcel || item.title || ""),
        roadAddress: stripHtml(item.address?.road || ""),
        pnu: PNU_PATTERN.test(pnu) ? pnu : "",
        lon,
        lat,
      };
    })
    .filter((item: ParcelCandidate) => Number.isFinite(item.lon) && Number.isFinite(item.lat));
}

export function extractFeatureCollection(data: JsonRecord): JsonRecord {
  const response = data?.response;
  if (response?.status && response.status !== "OK" && response.status !== "NOT_FOUND") {
    throw new VWorldError(
      response.error?.text || "VWorld 연속지적도 조회에 실패했습니다.",
      502,
      String(response.error?.code || "PARCEL_FAILED"),
    );
  }

  const result = response?.result;
  const collection =
    data?.type === "FeatureCollection"
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

export function buildWmsParams(query: Request["query"], config: VWorldConfiguration) {
  const bbox = String(query.BBOX || query.bbox || "").trim();
  const width = Math.min(Math.max(Number(query.WIDTH || query.width) || 256, 1), 1024);
  const height = Math.min(Math.max(Number(query.HEIGHT || query.height) || 256, 1), 1024);

  if (!bbox || !/^[-+\d.eE,]+$/.test(bbox)) {
    throw new VWorldError("올바른 WMS BBOX 값이 필요합니다.", 400, "INVALID_BBOX");
  }

  return {
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
  };
}

function ensureConfigured(config: VWorldConfiguration) {
  if (!config.apiKey) {
    throw new VWorldError(
      "VWorld API 키가 설정되지 않았습니다. 서버 환경변수 VWORLD_API_KEY를 설정해 주세요.",
      503,
      "VWORLD_NOT_CONFIGURED",
    );
  }
}

function responseLooksLikeHtml(data: unknown): boolean {
  if (typeof data === "string") return data.trim().startsWith("<");
  if (Buffer.isBuffer(data)) return data.subarray(0, 64).toString("utf8").trim().startsWith("<");
  return false;
}

function sendError(res: any, error: unknown) {
  const known = error instanceof VWorldError;
  const message = known ? error.message : "VWorld 연동 중 알 수 없는 오류가 발생했습니다.";
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  if (!known) console.error("[VWorld]", error);
  return res.status(status).json({ error: message, code });
}

function createHttpClient(): AxiosInstance {
  return axios.create({
    timeout: 15000,
    maxRedirects: 3,
    validateStatus: () => true,
    headers: {
      Accept: "application/json, image/png, */*",
      "User-Agent": "real-estate-explorer/1.0",
    },
  });
}

export function createVWorldRouter(httpClient: AxiosInstance = createHttpClient()) {
  const router = Router();

  router.get("/status", (req, res) => {
    const config = getVWorldConfiguration(req);
    res.json({
      configured: Boolean(config.apiKey),
      domain: config.domain,
      services: {
        addressSearch: Boolean(config.apiKey),
        parcelGeometry: Boolean(config.apiKey),
        cadastralWms: Boolean(config.apiKey),
      },
    });
  });

  router.get("/search", async (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      if (!query) throw new VWorldError("검색할 지번 주소를 입력해 주세요.", 400, "QUERY_REQUIRED");

      const config = getVWorldConfiguration(req);
      ensureConfigured(config);
      const response = await httpClient.get(`${VWORLD_API_BASE}/search`, {
        params: {
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
        },
        headers: { Referer: config.domain },
      });

      if (response.status !== 200 || responseLooksLikeHtml(response.data)) {
        throw new VWorldError(
          `VWorld 주소 검색 응답이 올바르지 않습니다. (HTTP ${response.status})`,
          502,
          "INVALID_UPSTREAM_RESPONSE",
        );
      }
      res.json({ candidates: normalizeSearchResponse(response.data) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/parcels/:pnu", async (req, res) => {
    try {
      const pnu = String(req.params.pnu || "").trim();
      if (!PNU_PATTERN.test(pnu)) {
        throw new VWorldError("PNU는 19자리 숫자여야 합니다.", 400, "INVALID_PNU");
      }

      const config = getVWorldConfiguration(req);
      ensureConfigured(config);
      const dataSets = ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"];
      let lastError = "필지 경계를 찾지 못했습니다.";

      for (const dataSet of dataSets) {
        const response = await httpClient.get(`${VWORLD_API_BASE}/data`, {
          params: {
            service: "data",
            request: "GetFeature",
            version: "2.0",
            data: dataSet,
            attrFilter: `pnu:=:${pnu}`,
            geometry: "true",
            attribute: "true",
            crs: "EPSG:4326",
            format: "json",
            errorformat: "json",
            size: "10",
            page: "1",
            key: config.apiKey,
            domain: config.domain,
          },
          headers: { Referer: config.domain },
        });

        if (response.status !== 200 || responseLooksLikeHtml(response.data)) {
          lastError = `VWorld Data API가 HTTP ${response.status}로 응답했습니다.`;
          continue;
        }

        try {
          const collection = extractFeatureCollection(response.data);
          if (collection.features.length > 0) {
            return res.json({ ...collection, dataSet, pnu });
          }
          lastError = response.data?.response?.error?.text || lastError;
        } catch (error: any) {
          lastError = error.message || lastError;
        }
      }

      throw new VWorldError(lastError, 404, "PARCEL_NOT_FOUND");
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/parcel-at-point", async (req, res) => {
    try {
      const lon = Number(req.query.lon);
      const lat = Number(req.query.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 124 || lon > 132 || lat < 33 || lat > 39) {
        throw new VWorldError("대한민국 영역의 올바른 경위도 좌표가 필요합니다.", 400, "INVALID_COORDINATE");
      }

      const config = getVWorldConfiguration(req);
      ensureConfigured(config);
      const response = await httpClient.get(`${VWORLD_API_BASE}/data`, {
        params: {
          service: "data",
          request: "GetFeature",
          version: "2.0",
          data: "LP_PA_CBND_BUBUN",
          geomFilter: `POINT(${lon} ${lat})`,
          geometry: "true",
          attribute: "true",
          crs: "EPSG:4326",
          format: "json",
          errorformat: "json",
          size: "10",
          page: "1",
          key: config.apiKey,
          domain: config.domain,
        },
        headers: { Referer: config.domain },
      });

      if (response.status !== 200 || responseLooksLikeHtml(response.data)) {
        throw new VWorldError("좌표 기반 필지 조회에 실패했습니다.", 502, "POINT_LOOKUP_FAILED");
      }
      const collection = extractFeatureCollection(response.data);
      if (collection.features.length === 0) {
        throw new VWorldError("해당 좌표에서 필지 경계를 찾지 못했습니다.", 404, "PARCEL_NOT_FOUND");
      }
      res.json({ ...collection, dataSet: "LP_PA_CBND_BUBUN" });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/wms", async (req, res) => {
    try {
      const config = getVWorldConfiguration(req);
      ensureConfigured(config);
      const params = buildWmsParams(req.query, config);
      const response = await httpClient.get(`${VWORLD_API_BASE}/wms`, {
        params,
        responseType: "arraybuffer",
        headers: { Referer: config.domain, Accept: "image/png" },
      });
      const contentType = String(response.headers["content-type"] || "");
      if (response.status !== 200 || !contentType.includes("image") || responseLooksLikeHtml(response.data)) {
        throw new VWorldError(
          `연속지적도 WMS 이미지를 불러오지 못했습니다. (HTTP ${response.status})`,
          502,
          "WMS_FAILED",
        );
      }
      res.setHeader("Content-Type", contentType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
      res.send(Buffer.from(response.data));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/base/:z/:x/:y.png", async (req, res) => {
    try {
      const { z, x, y } = req.params;
      if (![z, x, y].every((value) => /^\d+$/.test(value))) {
        throw new VWorldError("올바른 지도 타일 좌표가 필요합니다.", 400, "INVALID_TILE");
      }
      const config = getVWorldConfiguration(req);
      ensureConfigured(config);
      const url = `${VWORLD_API_BASE}/wmts/1.0.0/${encodeURIComponent(config.apiKey)}/Base/${z}/${y}/${x}.png`;
      const response = await httpClient.get(url, {
        responseType: "arraybuffer",
        headers: { Referer: config.domain, Accept: "image/png" },
      });
      const contentType = String(response.headers["content-type"] || "");
      if (response.status !== 200 || !contentType.includes("image") || responseLooksLikeHtml(response.data)) {
        throw new VWorldError("VWorld 배경지도를 불러오지 못했습니다.", 502, "BASE_TILE_FAILED");
      }
      res.setHeader("Content-Type", contentType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.send(Buffer.from(response.data));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

