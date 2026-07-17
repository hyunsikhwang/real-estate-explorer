export interface BrowserVWorldConfiguration {
  apiKey: string;
  domain: string;
}

export interface ParcelCandidate {
  id: string;
  title: string;
  parcelAddress: string;
  roadAddress: string;
  pnu: string;
  lon: number;
  lat: number;
}

type JsonRecord = Record<string, any>;

const VWORLD_API_BASE = 'https://api.vworld.kr/req';
const PNU_PATTERN = /^\d{19}$/;

function stripHtml(value: unknown): string {
  return String(value || '').replace(/<\/?[^>]+(>|$)/g, '').trim();
}

function vworldError(data: JsonRecord, fallback: string): Error | null {
  const response = data?.response;
  if (!response?.status || response.status === 'OK' || response.status === 'NOT_FOUND') return null;
  return new Error(response.error?.text || fallback);
}

export function normalizeBrowserSearchResponse(data: JsonRecord): ParcelCandidate[] {
  const error = vworldError(data, 'VWorld 지번 주소 검색에 실패했습니다.');
  if (error) throw error;
  if (data?.response?.status === 'NOT_FOUND') return [];

  const rawItems = data?.response?.result?.items;
  const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
  return items
    .map((item: JsonRecord, index: number) => {
      const pnuMatch = JSON.stringify(item).match(/\b\d{19}\b/);
      const pnu = String(item.id || item.pnu || item.address?.pnu || pnuMatch?.[0] || '');
      return {
        id: pnu || `candidate-${index}`,
        title: stripHtml(item.title || item.address?.parcel || '주소명 없음'),
        parcelAddress: stripHtml(item.address?.parcel || item.title || ''),
        roadAddress: stripHtml(item.address?.road || ''),
        pnu: PNU_PATTERN.test(pnu) ? pnu : '',
        lon: Number(item.point?.x),
        lat: Number(item.point?.y),
      };
    })
    .filter((item: ParcelCandidate) => Number.isFinite(item.lon) && Number.isFinite(item.lat));
}

export function extractBrowserFeatureCollection(data: JsonRecord): JsonRecord {
  const error = vworldError(data, 'VWorld 연속지적도 조회에 실패했습니다.');
  if (error) throw error;

  const result = data?.response?.result;
  const collection = data?.type === 'FeatureCollection'
    ? data
    : result?.featureCollection?.type === 'FeatureCollection'
      ? result.featureCollection
      : result?.type === 'FeatureCollection'
        ? result
        : null;

  if (collection) {
    return {
      type: 'FeatureCollection',
      features: Array.isArray(collection.features) ? collection.features : [],
    };
  }

  const rawFeatures = result?.features || data?.features || [];
  return {
    type: 'FeatureCollection',
    features: Array.isArray(rawFeatures) ? rawFeatures : rawFeatures ? [rawFeatures] : [],
  };
}

export function readVWorldJsonp<T>(url: URL, signal?: AbortSignal): Promise<T> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('VWorld 브라우저 호출은 브라우저에서만 사용할 수 있습니다.'));
  }

  const callbackName = `__vworld_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  url.searchParams.set('callback', callbackName);

  return new Promise<T>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      script.remove();
      delete (window as any)[callbackName];
      action();
    };
    const abort = () => finish(() => reject(new DOMException('요청이 취소되었습니다.', 'AbortError')));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error('VWorld 응답 시간이 초과되었습니다.'))),
      15_000,
    );

    (window as any)[callbackName] = (payload: T) => finish(() => resolve(payload));
    script.async = true;
    script.src = url.toString();
    script.onerror = () => finish(() => reject(new Error('VWorld 브라우저 요청을 불러오지 못했습니다.')));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    document.head.appendChild(script);
  });
}

function vworldUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`${VWORLD_API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

function dataParams(config: BrowserVWorldConfiguration, data: string): Record<string, string> {
  return {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data,
    geometry: 'true',
    attribute: 'true',
    crs: 'EPSG:4326',
    format: 'json',
    errorformat: 'json',
    size: '10',
    page: '1',
    key: config.apiKey,
    domain: config.domain,
  };
}

export async function searchVWorldParcels(
  query: string,
  config: BrowserVWorldConfiguration,
  signal?: AbortSignal,
): Promise<ParcelCandidate[]> {
  const data = await readVWorldJsonp<JsonRecord>(vworldUrl('search', {
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    type: 'address',
    category: 'parcel',
    format: 'json',
    errorformat: 'json',
    key: config.apiKey,
    domain: config.domain,
    query,
  }), signal);
  return normalizeBrowserSearchResponse(data);
}

async function requestFeatureCollection(
  url: URL,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  return extractBrowserFeatureCollection(await readVWorldJsonp<JsonRecord>(url, signal));
}

export async function loadVWorldParcel(
  candidate: ParcelCandidate,
  config: BrowserVWorldConfiguration,
  signal?: AbortSignal,
): Promise<JsonRecord> {
  if (candidate.pnu) {
    let lastError: unknown = new Error('필지 경계를 찾지 못했습니다.');
    for (const dataSet of ['LP_PA_CBND_BUBUN', 'LP_PA_CBND_BONBUN']) {
      try {
        const collection = await requestFeatureCollection(vworldUrl('data', {
          ...dataParams(config, dataSet),
          attrFilter: `pnu:=:${candidate.pnu}`,
        }), signal);
        if (collection.features?.length) return { ...collection, dataSet, pnu: candidate.pnu };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  const collection = await requestFeatureCollection(vworldUrl('data', {
    ...dataParams(config, 'LP_PA_CBND_BUBUN'),
    geomFilter: `POINT(${candidate.lon} ${candidate.lat})`,
  }), signal);
  if (!collection.features?.length) throw new Error('해당 좌표의 필지 경계를 찾지 못했습니다.');
  return { ...collection, dataSet: 'LP_PA_CBND_BUBUN' };
}

export function directBaseMapUrl(config: BrowserVWorldConfiguration): string {
  return `${VWORLD_API_BASE}/wmts/1.0.0/${encodeURIComponent(config.apiKey)}/Base/{z}/{y}/{x}.png`;
}

export function directCadastralWmsUrl(): string {
  return `${VWORLD_API_BASE}/wms`;
}

export function directCadastralWmsParams(config: BrowserVWorldConfiguration): Record<string, string | boolean> {
  return {
    VERSION: '1.3.0',
    LAYERS: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun',
    STYLES: 'lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line',
    FORMAT: 'image/png',
    TRANSPARENT: true,
    key: config.apiKey,
    domain: config.domain,
  };
}
