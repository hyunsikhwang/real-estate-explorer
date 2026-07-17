import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import TileWMS from 'ol/source/TileWMS';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { isEmpty as isEmptyExtent } from 'ol/extent';
import 'ol/ol.css';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Focus,
  Layers3,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Search,
  Server,
} from 'lucide-react';
import { Transaction } from '../types';

interface ApartmentMapProps {
  transaction: Transaction | null;
  regionName: string;
  filteredTransactions: Transaction[];
  onSelectTransaction: (id: string) => void;
}

interface ParcelCandidate {
  id: string;
  title: string;
  parcelAddress: string;
  roadAddress: string;
  pnu: string;
  lon: number;
  lat: number;
}

interface VWorldStatus {
  configured: boolean;
  domain: string;
  services: {
    addressSearch: boolean;
    parcelGeometry: boolean;
    cadastralWms: boolean;
  };
}

type StatusTone = 'info' | 'success' | 'error';

const INITIAL_CENTER = fromLonLat([126.978, 37.5665]);

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: (await response.text()).slice(0, 240) };
  if (!response.ok) {
    throw new Error(payload.error || `요청에 실패했습니다. (HTTP ${response.status})`);
  }
  return payload as T;
}

function parcelPnu(candidate: ParcelCandidate, features: Feature[]): string {
  if (candidate.pnu) return candidate.pnu;
  const properties = features[0]?.getProperties?.() || {};
  return String(properties.pnu || properties.PNU || '확인되지 않음');
}

export default function ApartmentMap({
  transaction,
  regionName,
  filteredTransactions,
  onSelectTransaction,
}: ApartmentMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const parcelSourceRef = useRef(new VectorSource());
  const markerSourceRef = useRef(new VectorSource());
  const vworldBaseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const cadastralLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const [searchText, setSearchText] = useState('');
  const [candidates, setCandidates] = useState<ParcelCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<ParcelCandidate | null>(null);
  const [selectedPnu, setSelectedPnu] = useState('');
  const [busy, setBusy] = useState(false);
  const [showVWorldBase, setShowVWorldBase] = useState(true);
  const [showCadastral, setShowCadastral] = useState(true);
  const [overlayState, setOverlayState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [configuration, setConfiguration] = useState<VWorldStatus | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: 'info',
    text: '거래 행을 선택하면 해당 지번의 연속지적도 경계를 자동으로 조회합니다.',
  });

  const addressInfo = useMemo(() => {
    if (!transaction) return null;
    const dong = transaction.dong || '';
    const jibun = transaction.jibun ? ` ${transaction.jibun}` : '';
    const addressBase = dong && !regionName.includes(dong) ? `${regionName} ${dong}` : regionName;
    const address = `${addressBase}${jibun}`.trim();
    const fullSearchText = `${address} ${transaction.apartmentName || ''}`.trim();
    return {
      address,
      naver: `https://map.naver.com/v5/search/${encodeURIComponent(fullSearchText)}?c=17,0,0,2,dh`,
      kakao: `https://map.kakao.com/?q=${encodeURIComponent(fullSearchText)}`,
    };
  }, [regionName, transaction]);

  useEffect(() => {
    readJson<VWorldStatus>('/api/map/status')
      .then((value) => {
        setConfiguration(value);
        if (!value.configured) {
          setStatus({
            tone: 'error',
            text: '서버에 VWorld API 키가 없습니다. VWORLD_API_KEY와 등록 도메인을 설정해 주세요.',
          });
        }
      })
      .catch((error) => setStatus({ tone: 'error', text: error.message }));
  }, []);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const osmLayer = new TileLayer({ source: new OSM(), zIndex: 0 });
    const vworldBaseSource = new XYZ({
      url: '/api/map/base/{z}/{x}/{y}.png',
      maxZoom: 19,
      crossOrigin: 'anonymous',
      attributions: '공간정보 오픈플랫폼 VWorld',
    });
    const vworldBaseLayer = new TileLayer({ source: vworldBaseSource, zIndex: 1, visible: false });

    const cadastralSource = new TileWMS({
      url: '/api/map/wms',
      params: {
        VERSION: '1.3.0',
        LAYERS: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun',
        STYLES: 'lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line',
        FORMAT: 'image/png',
        TRANSPARENT: true,
      },
      projection: 'EPSG:3857',
      transition: 0,
      attributions: '연속지적도 VWorld',
    });
    cadastralSource.on('tileloadstart', () => setOverlayState('loading'));
    cadastralSource.on('tileloadend', () => setOverlayState('ready'));
    cadastralSource.on('tileloaderror', () => setOverlayState('error'));
    const cadastralLayer = new TileLayer({
      source: cadastralSource,
      opacity: 0.82,
      zIndex: 2,
      visible: false,
    });

    const parcelLayer = new VectorLayer({
      source: parcelSourceRef.current,
      style: new Style({
        fill: new Fill({ color: 'rgba(14, 165, 164, 0.24)' }),
        stroke: new Stroke({ color: '#0f766e', width: 4 }),
      }),
      zIndex: 5,
    });
    const markerLayer = new VectorLayer({
      source: markerSourceRef.current,
      style: new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color: '#e11d48' }),
          stroke: new Stroke({ color: '#ffffff', width: 3 }),
        }),
      }),
      zIndex: 6,
    });

    const map = new Map({
      target: mapElementRef.current,
      layers: [osmLayer, vworldBaseLayer, cadastralLayer, parcelLayer, markerLayer],
      view: new View({ center: INITIAL_CENTER, zoom: 12, minZoom: 6, maxZoom: 20 }),
    });
    mapRef.current = map;
    vworldBaseLayerRef.current = vworldBaseLayer;
    cadastralLayerRef.current = cadastralLayer;

    return () => {
      activeRequestRef.current?.abort();
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    vworldBaseLayerRef.current?.setVisible(showVWorldBase && Boolean(configuration?.configured));
  }, [configuration?.configured, showVWorldBase]);

  useEffect(() => {
    const enabled = showCadastral && Boolean(configuration?.configured);
    cadastralLayerRef.current?.setVisible(enabled);
    if (enabled) cadastralLayerRef.current?.getSource()?.refresh();
    if (!configuration?.configured) setOverlayState('idle');
  }, [configuration?.configured, showCadastral]);

  const fitToParcel = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const extent = parcelSourceRef.current.getExtent();
    if (!isEmptyExtent(extent)) {
      map.getView().fit(extent, { padding: [70, 70, 70, 70], maxZoom: 19, duration: 300 });
      return;
    }
    const markerExtent = markerSourceRef.current.getExtent();
    if (!isEmptyExtent(markerExtent)) {
      map.getView().fit(markerExtent, { padding: [70, 70, 70, 70], maxZoom: 18, duration: 300 });
    }
  }, []);

  const loadCandidate = useCallback(async (
    candidate: ParcelCandidate,
    signal: AbortSignal,
    sequence: number,
  ) => {
    const map = mapRef.current;
    if (!map) return;

    setSelectedCandidate(candidate);
    setSelectedPnu(candidate.pnu);
    parcelSourceRef.current.clear();
    markerSourceRef.current.clear();
    markerSourceRef.current.addFeature(
      new Feature({ geometry: new Point(fromLonLat([candidate.lon, candidate.lat])) }),
    );
    map.getView().animate({ center: fromLonLat([candidate.lon, candidate.lat]), zoom: 18, duration: 300 });
    setStatus({ tone: 'info', text: 'PNU 기준 연속지적도 경계를 조회하고 있습니다.' });

    const endpoint = candidate.pnu
      ? `/api/map/parcels/${candidate.pnu}`
      : `/api/map/parcel-at-point?lon=${candidate.lon}&lat=${candidate.lat}`;
    const collection = await readJson<Record<string, any>>(endpoint, signal);
    if (sequence !== requestSequenceRef.current) return;

    const features = new GeoJSON().readFeatures(collection, {
      dataProjection: 'EPSG:4326',
      featureProjection: map.getView().getProjection(),
    });
    if (features.length === 0) throw new Error('조회 결과에 표시할 필지 경계가 없습니다.');
    parcelSourceRef.current.addFeatures(features);
    setSelectedPnu(parcelPnu(candidate, features));
    fitToParcel();
    setStatus({ tone: 'success', text: `연속지적도 경계 ${features.length}건을 정확한 PNU 기준으로 표시했습니다.` });
  }, [fitToParcel]);

  const executeSearch = useCallback(async (query: string) => {
    const normalized = query.trim();
    if (!normalized) {
      setStatus({ tone: 'error', text: '시·군·구와 법정동을 포함한 지번 주소를 입력해 주세요.' });
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setBusy(true);
    setCandidates([]);
    setSelectedCandidate(null);
    setSelectedPnu('');
    setStatus({ tone: 'info', text: '지번 주소와 PNU를 확인하고 있습니다.' });

    try {
      const result = await readJson<{ candidates: ParcelCandidate[] }>(
        `/api/map/search?query=${encodeURIComponent(normalized)}`,
        controller.signal,
      );
      if (sequence !== requestSequenceRef.current) return;
      setCandidates(result.candidates);
      if (result.candidates.length === 0) {
        throw new Error('검색 결과가 없습니다. 지번을 포함한 주소로 다시 검색해 주세요.');
      }
      await loadCandidate(result.candidates[0], controller.signal, sequence);
    } catch (error: any) {
      if (error.name !== 'AbortError' && sequence === requestSequenceRef.current) {
        setStatus({ tone: 'error', text: error.message || '연속지적도 조회 중 오류가 발생했습니다.' });
      }
    } finally {
      if (sequence === requestSequenceRef.current) setBusy(false);
    }
  }, [loadCandidate]);

  useEffect(() => {
    if (!addressInfo?.address || !configuration?.configured) return;
    setSearchText(addressInfo.address);
    const timer = window.setTimeout(() => executeSearch(addressInfo.address), 350);
    return () => window.clearTimeout(timer);
  }, [addressInfo?.address, configuration?.configured, executeSearch]);

  const selectCandidate = async (candidate: ParcelCandidate) => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setBusy(true);
    try {
      await loadCandidate(candidate, controller.signal, sequence);
    } catch (error: any) {
      if (error.name !== 'AbortError') setStatus({ tone: 'error', text: error.message });
    } finally {
      if (sequence === requestSequenceRef.current) setBusy(false);
    }
  };

  const clearMap = () => {
    activeRequestRef.current?.abort();
    requestSequenceRef.current += 1;
    parcelSourceRef.current.clear();
    markerSourceRef.current.clear();
    setCandidates([]);
    setSelectedCandidate(null);
    setSelectedPnu('');
    setBusy(false);
    setStatus({ tone: 'info', text: '지도와 검색 결과를 초기화했습니다.' });
  };

  const StatusIcon = status.tone === 'success' ? CheckCircle2 : status.tone === 'error' ? AlertCircle : MapPin;

  return (
    <section id="apartment-location-map-section" className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Layers3 size={21} className="text-teal-700" />
            연속지적도·필지 경계
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {transaction
              ? `${transaction.apartmentName} · ${addressInfo?.address || '지번 확인 중'}`
              : `검색 결과 ${filteredTransactions.length.toLocaleString()}건 중 거래 행을 선택해 주세요.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setShowVWorldBase((value) => !value)}
            disabled={!configuration?.configured}
            className={`rounded-full border px-3 py-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${showVWorldBase ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-300 bg-white text-slate-500'}`}
          >
            VWorld 배경 {!configuration?.configured ? '설정 필요' : showVWorldBase ? '켜짐' : '꺼짐'}
          </button>
          <button
            type="button"
            onClick={() => setShowCadastral((value) => !value)}
            disabled={!configuration?.configured}
            className={`rounded-full border px-3 py-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${showCadastral ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-300 bg-white text-slate-500'}`}
          >
            연속지적도 {!configuration?.configured ? '설정 필요' : showCadastral ? '켜짐' : '꺼짐'}
          </button>
          <span className={`rounded-full px-3 py-2 ${overlayState === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-white text-slate-500'}`}>
            WMS {overlayState === 'ready' ? '정상' : overlayState === 'loading' ? '불러오는 중' : overlayState === 'error' ? '오류' : '대기'}
          </span>
        </div>
      </header>

      <div className="grid min-h-[620px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              executeSearch(searchText);
            }}
            className="space-y-2"
          >
            <label htmlFor="parcel-search" className="text-sm font-bold text-slate-700">지번 주소 검색</label>
            <div className="flex gap-2">
              <input
                id="parcel-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="예: 서울 송파구 신천동 7"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
              <button
                type="submit"
                disabled={busy || !configuration?.configured}
                aria-label="지번 검색"
                className="rounded-xl bg-slate-900 px-3 text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Search size={18} />}
              </button>
            </div>
          </form>

          <div className={`rounded-2xl border p-3 text-sm ${status.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : status.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
            <div className="flex items-start gap-2">
              <StatusIcon size={17} className="mt-0.5 shrink-0" />
              <span>{status.text}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-3 text-xs text-slate-600">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <Server size={15} /> 서버 연동 상태
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>VWorld API</span>
              <span className={configuration?.configured ? 'text-emerald-700' : 'text-rose-700'}>
                {configuration?.configured ? '설정됨' : '설정 필요'}
              </span>
            </div>
            {configuration?.domain && <p className="mt-1 break-all text-[11px] text-slate-400">등록 도메인: {configuration.domain}</p>}
          </div>

          {candidates.length > 0 && (
            <div className="min-h-0 flex-1">
              <div className="mb-2 text-sm font-bold text-slate-700">검색 후보 {candidates.length}건</div>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => selectCandidate(candidate)}
                    className={`w-full rounded-xl border p-3 text-left transition ${selectedCandidate?.id === candidate.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-400'}`}
                  >
                    <div className="text-sm font-bold text-slate-800">{candidate.parcelAddress || candidate.title}</div>
                    {candidate.roadAddress && <div className="mt-1 text-xs text-slate-500">{candidate.roadAddress}</div>}
                    <div className="mt-1 font-mono text-[11px] text-slate-400">PNU {candidate.pnu || '좌표 조회'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" onClick={fitToParcel} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              <Focus size={14} /> 경계 맞춤
            </button>
            <button type="button" onClick={clearMap} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              <RotateCcw size={14} /> 초기화
            </button>
            {addressInfo && (
              <>
                <a href={addressInfo.naver} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                  네이버 <ExternalLink size={12} />
                </a>
                <a href={addressInfo.kakao} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                  카카오 <ExternalLink size={12} />
                </a>
              </>
            )}
          </div>
        </aside>

        <div className="relative min-h-[520px] bg-slate-100">
          <div ref={mapElementRef} className="absolute inset-0" aria-label="연속지적도 지도" />
          {selectedCandidate && (
            <div className="absolute bottom-4 left-4 right-4 z-10 rounded-2xl border border-white/70 bg-white/95 p-3 shadow-lg backdrop-blur sm:right-auto sm:max-w-md">
              <div className="text-sm font-bold text-slate-900">{selectedCandidate.parcelAddress || selectedCandidate.title}</div>
              <div className="mt-1 font-mono text-xs text-teal-700">PNU {selectedPnu || '확인 중'}</div>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>연속지적도는 위치 확인용이며 경계·면적에 관한 법적 효력은 지적공부를 기준으로 합니다.</span>
        {transaction && (
          <button type="button" onClick={() => onSelectTransaction(transaction.id)} className="text-left font-semibold text-teal-700">
            선택 거래 유지 · {transaction.apartmentName}
          </button>
        )}
      </footer>
    </section>
  );
}
