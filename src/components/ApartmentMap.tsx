import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Transaction } from '../types';
import { 
  MapPin, 
  Info, 
  ExternalLink, 
  Settings, 
  Navigation, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  Layers, 
  Compass, 
  Search, 
  Copy, 
  RotateCcw, 
  ShieldAlert 
} from 'lucide-react';

interface ApartmentMapProps {
  transaction: Transaction | null;
  regionName: string;
  filteredTransactions: Transaction[];
  onSelectTransaction: (id: string) => void;
}

const DEFAULT_VWORLD_KEY = "CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9";

export default function ApartmentMap({
  transaction,
  regionName,
  filteredTransactions,
  onSelectTransaction,
}: ApartmentMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const olMapRef = useRef<any>(null);
  const pointSourceRef = useRef<any>(null);
  const parcelSourceRef = useRef<any>(null);
  const vworldBaseLayerRef = useRef<any>(null);
  const vworldCadastralLayerRef = useRef<any>(null);

  const [olLoaded, setOlLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  
  // Search Address
  const [parcelAddress, setParcelAddress] = useState("");
  const [status, setStatus] = useState<{ text: string; type: 'info' | 'success' | 'error' }>({
    text: "아파트 단지를 선택하면 지적 경계가 자동으로 검색 및 조회됩니다.",
    type: "info"
  });

  // Results
  const [results, setResults] = useState<any[]>([]);
  const [selectedResultIndex, setSelectedResultIndex] = useState<number | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<any | null>(null);
  const [selectedParcelSummary, setSelectedParcelSummary] = useState<any | null>(null);

  // Layer state
  const [showVWorldBase, setShowVWorldBase] = useState<boolean>(true);
  const [showCadastral, setShowCadastral] = useState<boolean>(true);
  const [vworldKey, setVworldKey] = useState<string>(() => {
    return localStorage.getItem('vworld-map-api-key') || DEFAULT_VWORLD_KEY;
  });
  const [vworldDomain, setVworldDomain] = useState<string>(() => {
    return localStorage.getItem('vworld-map-domain') || "";
  });

  // Settings UI Input states
  const [apiKeyInput, setApiKeyInput] = useState<string>(vworldKey);
  const [domainInput, setDomainInput] = useState<string>(vworldDomain);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Real-time server-side VWorld logs for debugging
  const [vworldLogs, setVworldLogs] = useState<any[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState<boolean>(false);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  const fetchVworldLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/vworld-logs');
      if (res.ok) {
        const data = await res.json();
        setVworldLogs(data);
      }
    } catch (err) {
      console.error("Failed to load VWorld logs", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Fetch VWorld Key configuration from server
  useEffect(() => {
    const fetchVworldConfig = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data.vworldApiKey) {
            // Only use server key if local custom key is not present
            if (!localStorage.getItem('vworld-map-api-key')) {
              setVworldKey(data.vworldApiKey);
              setApiKeyInput(data.vworldApiKey);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load VWorld Key", err);
      }
    };
    fetchVworldConfig();
  }, []);

  // Address helper for direct map links
  const currentAddressInfo = useMemo(() => {
    if (!transaction) return null;
    const dong = transaction.dong || "";
    const jibun = transaction.jibun ? ` ${transaction.jibun}` : "";
    const name = transaction.apartmentName || "";
    
    let addressBase = regionName;
    if (dong && !regionName.includes(dong)) {
      addressBase = `${regionName} ${dong}`;
    }
    
    const cleanAddress = `${addressBase}${jibun}`.trim();
    const fullSearchText = `${addressBase}${jibun} ${name}`.trim();
    
    return {
      fullSearchText,
      cleanAddress,
      apartmentName: name,
      naverMapLink: `https://map.naver.com/v5/search/${encodeURIComponent(fullSearchText)}?c=17,0,0,2,dh`,
      kakaoMapLink: `https://map.kakao.com/?q=${encodeURIComponent(fullSearchText)}`,
      hogangnonoLink: `https://hogangnono.com/search?q=${encodeURIComponent(name)}`
    };
  }, [transaction, regionName]);

  // Load OpenLayers assets dynamically
  useEffect(() => {
    if (olLoaded) return;

    if ((window as any).ol) {
      setOlLoaded(true);
      return;
    }

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://cdn.jsdelivr.net/npm/ol@10.6.1/ol.css';
    document.head.appendChild(cssLink);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/ol@10.6.1/dist/ol.js';
    script.onload = () => {
      setOlLoaded(true);
    };
    document.head.appendChild(script);
  }, [olLoaded]);

  // Apply VWorld XYZ WMTS Base Map layer to the map instance
  const applyVWorldBaseMap = (mapInstance: any) => {
    if (!mapInstance) return;
    const ol = (window as any).ol;
    if (!ol) return;

    const layers = mapInstance.getLayers();
    if (vworldBaseLayerRef.current) {
      layers.remove(vworldBaseLayerRef.current);
      vworldBaseLayerRef.current = null;
    }

    const activeKey = vworldKey || DEFAULT_VWORLD_KEY;
    const directUrl = `https://api.vworld.kr/req/wmts/1.0.0/${activeKey}/Base/{z}/{y}/{x}.png`;

    const newBase = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: directUrl,
        attributions: "VWorld",
      }),
      zIndex: 1,
    });

    // Fallback to server proxy on direct tile load error
    newBase.getSource().setTileLoadFunction((tile: any, src: string) => {
      const img = tile.getImage();
      img.onerror = () => {
        const match = src.match(/\/Base\/(\d+)\/(\d+)\/(\d+)\.png/);
        if (match) {
          const z = match[1];
          const y = match[2];
          const x = match[3];
          const fallbackSrc = `/api/map/vworld-base/${z}/${x}/${y}.png`;
          if (img.src !== fallbackSrc) {
            console.warn(`[Base Tile] Direct load failed for ${src}. Falling back to proxy: ${fallbackSrc}`);
            img.src = fallbackSrc;
          }
        }
      };
      img.src = src;
    });

    vworldBaseLayerRef.current = newBase;
    layers.push(newBase);
  };

  // Apply VWorld XYZ WMTS Cadastral overlay map layer to the map instance
  const applyCadastralOverlay = (mapInstance: any) => {
    if (!mapInstance) return;
    const ol = (window as any).ol;
    if (!ol) return;

    const layers = mapInstance.getLayers();
    if (vworldCadastralLayerRef.current) {
      layers.remove(vworldCadastralLayerRef.current);
      vworldCadastralLayerRef.current = null;
    }

    const activeKey = vworldKey || DEFAULT_VWORLD_KEY;
    const directUrl = `https://api.vworld.kr/req/wmts/1.0.0/${activeKey}/LP_PA_CBND_BUBUN/{z}/{y}/{x}.png`;

    const newCadastral = new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: directUrl,
        attributions: "VWorld Cadastral",
      }),
      opacity: 0.7,
      zIndex: 2,
    });

    // Fallback to server proxy on direct tile load error
    newCadastral.getSource().setTileLoadFunction((tile: any, src: string) => {
      const img = tile.getImage();
      img.onerror = () => {
        const match = src.match(/\/LP_PA_CBND_BUBUN\/(\d+)\/(\d+)\/(\d+)\.png/) || src.match(/\/LP_PA_CBND\/(\d+)\/(\d+)\/(\d+)\.png/);
        if (match) {
          const z = match[1];
          const y = match[2];
          const x = match[3];
          const fallbackSrc = `/api/map/cadastral/${z}/${x}/${y}.png`;
          if (img.src !== fallbackSrc) {
            console.warn(`[Cadastral Tile] Direct load failed for ${src}. Falling back to proxy: ${fallbackSrc}`);
            img.src = fallbackSrc;
          }
        }
      };
      img.src = src;
    });

    vworldCadastralLayerRef.current = newCadastral;
    layers.push(newCadastral);
  };

  // Map initialization
  useEffect(() => {
    if (!olLoaded || !mapContainerRef.current) return;

    const ol = (window as any).ol;
    if (!ol) return;

    if (olMapRef.current) {
      olMapRef.current.setTarget(undefined);
      olMapRef.current = null;
    }

    const pSource = new ol.source.Vector();
    const lSource = new ol.source.Vector();
    pointSourceRef.current = pSource;
    parcelSourceRef.current = lSource;

    const initialCenter = ol.proj.fromLonLat([126.978, 37.5665]);

    const osmLayer = new ol.layer.Tile({
      source: new ol.source.OSM({
        crossOrigin: "anonymous",
      }),
      zIndex: 0,
    });

    const pointLayer = new ol.layer.Vector({
      source: pSource,
      style: new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7,
          fill: new ol.style.Fill({ color: "#0f8f87" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
        }),
      }),
      zIndex: 10,
    });

    const parcelLayer = new ol.layer.Vector({
      source: lSource,
      style: new ol.style.Style({
        fill: new ol.style.Fill({ color: "rgba(245, 174, 64, 0.34)" }),
        stroke: new ol.style.Stroke({ color: "#05847e", width: 3 }),
      }),
      zIndex: 5,
    });

    const map = new ol.Map({
      target: mapContainerRef.current,
      layers: [osmLayer, pointLayer, parcelLayer],
      view: new ol.View({
        center: initialCenter,
        zoom: 12,
        maxZoom: 20,
      }),
    });

    olMapRef.current = map;

    // Apply base map if set
    if (showVWorldBase) {
      applyVWorldBaseMap(map);
    }

    // Apply cadastral map if set
    if (showCadastral) {
      applyCadastralOverlay(map);
    }

    return () => {
      if (olMapRef.current) {
        olMapRef.current.setTarget(undefined);
        olMapRef.current = null;
      }
    };
  }, [olLoaded]);

  // Toggle/Update VWorld WMTS Map Layer
  useEffect(() => {
    const map = olMapRef.current;
    if (!map) return;

    if (showVWorldBase) {
      applyVWorldBaseMap(map);
    } else {
      const layers = map.getLayers();
      if (vworldBaseLayerRef.current) {
        layers.remove(vworldBaseLayerRef.current);
        vworldBaseLayerRef.current = null;
      }
    }
  }, [showVWorldBase, vworldKey]);

  // Toggle/Update VWorld Cadastral Overlay Layer
  useEffect(() => {
    const map = olMapRef.current;
    if (!map) return;

    if (showCadastral) {
      applyCadastralOverlay(map);
    } else {
      const layers = map.getLayers();
      if (vworldCadastralLayerRef.current) {
        layers.remove(vworldCadastralLayerRef.current);
        vworldCadastralLayerRef.current = null;
      }
    }
  }, [showCadastral, vworldKey]);

  // Fetch helper with Client-Direct-First and Server-Proxy failover
  const fetchJson = async (url: string): Promise<any> => {
    // If the URL is for VWorld, try calling VWorld directly from the browser first using JSONP!
    // Since JSONP bypasses CORS completely, and the user is in Korea (where VWorld is not geo-blocked)
    // with a Korean IP, this direct browser-side call is extremely fast, reliable, and bypasses Tokyo GCP IP blocking.
    if (url.startsWith("/api/vworld/")) {
      const directUrl = url.replace("/api/vworld/", "https://api.vworld.kr/req/");
      try {
        console.log(`[VWorld Client] Attempting direct browser-side JSONP call to: ${directUrl}`);
        
        const data = await new Promise<any>((resolve, reject) => {
          const callbackName = 'vworldCallback_' + Math.random().toString(36).substring(2, 9);
          const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error("JSONP 요청 시간 초과 (5초)"));
          }, 5000);

          const cleanup = () => {
            clearTimeout(timeoutId);
            const el = document.getElementById(scriptId);
            if (el) el.remove();
            delete (window as any)[callbackName];
          };

          const scriptId = 'jsonp_' + callbackName;
          (window as any)[callbackName] = (jsonData: any) => {
            cleanup();
            resolve(jsonData);
          };

          // Attach callback parameter
          const separator = directUrl.includes('?') ? '&' : '?';
          const finalUrl = `${directUrl}${separator}callback=${callbackName}`;

          const script = document.createElement('script');
          script.id = scriptId;
          script.src = finalUrl;
          script.onerror = (err) => {
            cleanup();
            reject(new Error("JSONP Script load error (CORS/Network error)"));
          };

          document.body.appendChild(script);
        });

        // Validate JSONP response
        if (data && data.response) {
          const status = data.response.status;
          if (status === "OK") {
            console.log(`[VWorld Client] Direct browser-side JSONP SUCCESS!`, data);
            return data;
          } else {
            console.warn(`[VWorld Client] Direct JSONP returned non-OK status: ${status}`, data);
          }
        } else {
          console.warn(`[VWorld Client] Direct JSONP returned invalid structure`, data);
        }
      } catch (jsonpErr: any) {
        console.warn(`[VWorld Client] Direct browser-side JSONP failed: ${jsonpErr.message}. Falling back to standard proxy fetch.`);
      }
    }

    // Fallback or standard fetch: Call the server proxy or other APIs
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`요청 실패: HTTP ${response.status} ${text.slice(0, 160)}`);
    }

    const text = await response.text();
    const trimmed = text.trim();
    if (trimmed.startsWith("<")) {
      console.error(`[VWorld Proxy Response HTML Error] URL: ${url}\nRaw response:`, trimmed);
      if (trimmed.includes("Service Not URL") || trimmed.includes("인증") || trimmed.includes("Unauthorized") || trimmed.includes("Authentication")) {
        throw new Error("VWorld API 인증 실패: 도메인 설정 또는 API 키가 유효하지 않습니다.");
      }
      throw new Error(`VWorld에서 HTML 응답이 수신되었습니다: "${trimmed.slice(0, 150)}" (API 설정을 확인하세요).`);
    }

    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`JSON 파싱 실패: 응답이 올바른 JSON 형식이 아닙니다. 응답내용: ${trimmed.slice(0, 200)}`);
    }
  };

  const searchParcelAddress = async (query: string) => {
    const params: any = {
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
      key: vworldKey,
      domain: vworldDomain || window.location.origin,
      query,
    };

    const queryStr = new URLSearchParams(params).toString();
    const url = `/api/vworld/search?${queryStr}`;
    const data = await fetchJson(url);
    const response = data.response || {};
    
    if (response.status !== "OK") {
      throw new Error(response.error?.text || "지번 검색에 실패했습니다.");
    }

    const items = response.result?.items 
      ? (Array.isArray(response.result.items) ? response.result.items : [response.result.items])
      : [];

    return items.map((item: any, idx: number) => {
      const rawStr = JSON.stringify(item);
      const point = item.point || {};
      
      let pnu = "";
      if (item.id) pnu = item.id;
      else if (item.pnu) pnu = item.pnu;
      else if (item.address?.pnu) pnu = item.address.pnu;
      else {
        const match = rawStr.match(/\b\d{19}\b/);
        pnu = match ? match[0] : "";
      }

      const stripHtml = (val: string) => {
        if (!val) return "";
        return val.replace(/<\/?[^>]+(>|$)/g, "");
      };

      return {
        index: idx,
        title: stripHtml(item.title) || item.address?.parcel || "주소명 없음",
        parcelAddress: stripHtml(item.address?.parcel || item.title || ""),
        roadAddress: stripHtml(item.address?.road || ""),
        pnu,
        lon: Number(point.x),
        lat: Number(point.y),
        raw: item,
      };
    });
  };

  const buildBoundaryRequests = (pnu: string, lon: number, lat: number, dataSet: string) => {
    const dataParams: any = {
      service: "data",
      request: "GetFeature",
      version: "2.0",
      data: dataSet,
      format: "json",
      errorformat: "json",
      crs: "EPSG:4326",
      geometry: "true",
      key: vworldKey,
      domain: vworldDomain || window.location.origin,
    };

    if (pnu) {
      dataParams.attrFilter = `pnu:=:${pnu}`;
    } else if (Number.isFinite(lon) && Number.isFinite(lat)) {
      dataParams.geomFilter = `POINT(${lon} ${lat})`;
    }

    const requests = [`/api/vworld/data?${new URLSearchParams(dataParams).toString()}`];

    if (pnu) {
      const wfsParams: any = {
        service: "WFS",
        request: "GetFeature",
        version: "1.1.0",
        typename: dataSet.toLowerCase(),
        srsName: "EPSG:4326",
        output: "application/json",
        key: vworldKey,
        domain: vworldDomain || window.location.origin,
        cql_filter: `pnu='${pnu}'`,
      };
      requests.push(`/api/vworld/wfs?${new URLSearchParams(wfsParams).toString()}`);
    }

    return requests;
  };

  const normalizeGeoJson = (data: any) => {
    if (data.type === "FeatureCollection") {
      return data;
    }
    const result = data.response?.result;
    const featureCollection = result?.featureCollection || result;
    if (featureCollection?.type === "FeatureCollection") {
      return featureCollection;
    }
    const features = result?.features || data.features || [];
    return {
      type: "FeatureCollection",
      features: Array.isArray(features) ? features : [features],
    };
  };

  const fetchParcelBoundary = async (pnu: string, lon: number, lat: number) => {
    const dataSets = ["LP_PA_CBND", "LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"];
    const errors: string[] = [];

    for (const dataSet of dataSets) {
      const candidates = buildBoundaryRequests(pnu, lon, lat, dataSet);
      for (const url of candidates) {
        try {
          const data = await fetchJson(url);
          const collection = normalizeGeoJson(data);
          if (collection.features && collection.features.length > 0) {
            return collection;
          }
        } catch (error: any) {
          errors.push(error.message);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`연속 지적도 경계 조회에 실패했습니다. ${errors[0]}`);
    }
    return { type: "FeatureCollection", features: [] };
  };

  const selectResult = async (result: any) => {
    const ol = (window as any).ol;
    const map = olMapRef.current;
    if (!ol || !map) return;

    setSelectedResultIndex(result.index);
    
    const pSource = pointSourceRef.current;
    const lSource = parcelSourceRef.current;
    if (!pSource || !lSource) return;

    pSource.clear();
    lSource.clear();
    setSelectedParcel(null);
    setSelectedParcelSummary(null);

    if (Number.isFinite(result.lon) && Number.isFinite(result.lat)) {
      const pointFeature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([result.lon, result.lat])),
      });
      pSource.addFeature(pointFeature);
      map.getView().animate({
        center: ol.proj.fromLonLat([result.lon, result.lat]),
        zoom: 18,
        duration: 350,
      });
    }

    if (!result.pnu) {
      setStatus({
        text: "검색 결과에서 PNU를 찾지 못했습니다. PNU 없이 좌표 기반 경계 조회를 시도합니다.",
        type: "error"
      });
    } else {
      setStatus({
        text: `PNU ${result.pnu}의 연속 지적도 경계를 조회하는 중입니다.`,
        type: "info"
      });
    }

    try {
      const featureCollection = await fetchParcelBoundary(
        result.pnu,
        result.lon,
        result.lat
      );

      const features = new ol.format.GeoJSON().readFeatures(featureCollection, {
        dataProjection: "EPSG:4326",
        featureProjection: map.getView().getProjection(),
      });

      lSource.addFeatures(features);

      const pnuVal = result.pnu || featureCollection.features[0]?.properties?.pnu || "확인되지 않음";

      if (features.length === 0) {
        setSelectedParcelSummary({
          title: result.parcelAddress || result.title,
          pnu: pnuVal,
          countText: "지도 경계 없음"
        });
        setStatus({
          text: "연속 지적도 경계 데이터가 비어 있습니다. 경계를 찾지 못했습니다.",
          type: "error"
        });
        return;
      }

      setSelectedParcel({
        result,
        features,
        pnu: pnuVal,
      });

      setSelectedParcelSummary({
        title: result.parcelAddress || result.title,
        pnu: pnuVal,
        countText: `지도 경계 ${features.length}건 표시`
      });

      const extent = lSource.getExtent();
      if (extent && !ol.extent.isEmpty(extent)) {
        map.getView().fit(extent, {
          padding: [90, 90, 90, 90],
          maxZoom: 19,
          duration: 350,
        });
      }

      setStatus({
        text: "경계 조회가 완료되었습니다.",
        type: "success"
      });
    } catch (err: any) {
      console.error(err);
      setStatus({
        text: err.message || "연속 지적도 경계 조회에 실패했습니다.",
        type: "error"
      });
    }
  };

  const triggerSearch = async (queryText: string) => {
    const trimmedQuery = queryText.trim();
    if (!trimmedQuery) {
      setStatus({
        text: "지번 주소를 입력하세요.",
        type: "error"
      });
      return;
    }

    setBusy(true);
    setStatus({
      text: "VWorld 검색 API에서 지번 후보를 찾는 중입니다.",
      type: "info"
    });

    try {
      const searchResults = await searchParcelAddress(trimmedQuery);
      setResults(searchResults);

      if (searchResults.length === 0) {
        setStatus({
          text: "검색 결과가 없습니다. 시/군/구와 법정동을 포함해 다시 입력하세요.",
          type: "error"
        });
        setBusy(false);
        return;
      }

      setStatus({
        text: `${searchResults.length}개 후보를 찾았습니다. 첫 번째 후보의 경계를 조회합니다.`,
        type: "success"
      });

      await selectResult(searchResults[0]);
    } catch (err: any) {
      console.error(err);
      setStatus({
        text: err.message || "조회 중 오류가 발생했습니다.",
        type: "error"
      });
    } finally {
      setBusy(false);
    }
  };

  // Sync selected transaction to search box and perform automatic lookup
  useEffect(() => {
    if (!currentAddressInfo?.cleanAddress) return;

    const text = currentAddressInfo.cleanAddress;
    setParcelAddress(text);

    if (olLoaded && olMapRef.current) {
      const timer = setTimeout(() => {
        triggerSearch(text);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [transaction, olLoaded, currentAddressInfo?.cleanAddress]);

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSearch(parcelAddress);
  };

  const handleFitToBoundary = () => {
    const ol = (window as any).ol;
    const map = olMapRef.current;
    const lSource = parcelSourceRef.current;
    const pSource = pointSourceRef.current;
    if (!ol || !map) return;

    if (lSource && lSource.getFeatures().length > 0) {
      const extent = lSource.getExtent();
      if (extent && !ol.extent.isEmpty(extent)) {
        map.getView().fit(extent, {
          padding: [90, 90, 90, 90],
          maxZoom: 19,
          duration: 350,
        });
      }
    } else if (pSource && pSource.getFeatures().length > 0) {
      const extent = pSource.getExtent();
      if (extent && !ol.extent.isEmpty(extent)) {
        map.getView().fit(extent, {
          padding: [90, 90, 90, 90],
          maxZoom: 18,
          duration: 350,
        });
      }
    }
  };

  const handleCopyPnu = async () => {
    const pnu = selectedParcel?.pnu || (results.length > 0 ? results[0].pnu : null);
    if (!pnu) {
      setStatus({
        text: "복사할 PNU 코드가 없습니다. 먼저 지번을 검색/선택해 주세요.",
        type: "error"
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(pnu);
      setStatus({
        text: `PNU 코드 [${pnu}]가 클립보드에 복사되었습니다.`,
        type: "success"
      });
    } catch (err) {
      setStatus({
        text: "클립보드 복사에 실패했습니다.",
        type: "error"
      });
    }
  };

  const handleClearAll = () => {
    const pSource = pointSourceRef.current;
    const lSource = parcelSourceRef.current;
    if (pSource) pSource.clear();
    if (lSource) lSource.clear();

    setResults([]);
    setSelectedParcel(null);
    setSelectedResultIndex(null);
    setSelectedParcelSummary(null);
    setStatus({
      text: "입력값은 유지하고 지도와 검색 결과를 초기화했습니다.",
      type: "info"
    });
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKeyInput.trim();
    const cleanDomain = domainInput.trim();
    
    // 마스킹된 인증키가 그대로 붙여넣어져 저장되는 것을 방지합니다.
    if (cleanKey.includes("XXXX") || cleanKey.includes("xxxx")) {
      setStatus({
        text: "보안 마스킹 처리된 인증키(XXXX 포함)는 저장할 수 없습니다. 실제 발급받으신 원본 인증키를 입력해 주십시오.",
        type: "error"
      });
      return;
    }
    
    if (cleanKey) {
      localStorage.setItem('vworld-map-api-key', cleanKey);
      setVworldKey(cleanKey);
    } else {
      localStorage.removeItem('vworld-map-api-key');
      // Reset to default/server key
      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          setVworldKey(data.vworldApiKey || DEFAULT_VWORLD_KEY);
        });
    }

    if (cleanDomain) {
      localStorage.setItem('vworld-map-domain', cleanDomain);
      setVworldDomain(cleanDomain);
    } else {
      localStorage.removeItem('vworld-map-domain');
      setVworldDomain("");
    }

    setStatus({
      text: "브이월드 설정이 성공적으로 저장되었습니다.",
      type: "success"
    });
    
    // Hide settings panel
    setShowSettings(false);

    // Refresh map tiles briefly by triggering reload
    const currentShow = showVWorldBase;
    const currentCadastral = showCadastral;
    setShowVWorldBase(false);
    setShowCadastral(false);
    setTimeout(() => {
      setShowVWorldBase(currentShow);
      setShowCadastral(currentCadastral);
    }, 150);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xl mt-6 mb-2 flex flex-col">
      {/* Top Controller Panel */}
      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center">
            <Compass size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">
              연속 지적도 경계 분석 엔진
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {transaction ? `${transaction.apartmentName} 단지의 국토교통부 실시간 지적 경계와 토지 상세 정보를 동기화합니다.` : "아파트 단지를 선택하거나 직접 검색하여 지적 경계를 조회할 수 있습니다."}
            </p>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl cursor-pointer hover:bg-slate-200 transition-all">
            <input
              type="checkbox"
              checked={showVWorldBase}
              onChange={(e) => setShowVWorldBase(e.target.checked)}
              className="accent-teal-600 h-4 w-4 rounded"
            />
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <Layers size={15} className="text-teal-500" />
              배경 지도 오버레이
            </span>
          </label>

          <label className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl cursor-pointer hover:bg-slate-200 transition-all">
            <input
              type="checkbox"
              checked={showCadastral}
              onChange={(e) => setShowCadastral(e.target.checked)}
              className="accent-teal-600 h-4 w-4 rounded"
            />
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <Layers size={15} className="text-amber-500 animate-pulse" />
              지적도 오버레이
            </span>
          </label>

          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-sm font-semibold ${
              showSettings 
                ? 'bg-teal-50 border-teal-200 text-teal-700 shadow-sm'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Settings size={15} className={showSettings ? "text-teal-600 animate-spin" : "text-slate-500"} style={{ animationDuration: '3s' }} />
            브이월드 설정
          </button>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* Left Side: VWorld Config, Search & List */}
        <div className="lg:col-span-4 p-6 bg-slate-50/50 border-r border-slate-100 flex flex-col justify-between gap-6 max-h-[700px] overflow-y-auto">
          <div className="flex flex-col gap-4">
            
            {/* VWorld API Key & Domain Settings Panel */}
            {showSettings && (
              <form onSubmit={handleSaveSettings} className="p-4 bg-white border border-teal-100 rounded-2xl shadow-md shadow-teal-500/5 flex flex-col gap-3 animate-slideDown">
                <div className="flex items-center gap-1.5 pb-1 border-b border-slate-100">
                  <Settings size={15} className="text-teal-600 animate-spin" style={{ animationDuration: '6s' }} />
                  <strong className="text-xs font-bold text-slate-700">브이월드 인증 키 설정</strong>
                </div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-500">인증키 (API Key)</label>
                  <input
                    type="text"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="비어있으면 서버 공용 인증키를 사용합니다."
                    className="h-9 px-3 border border-slate-200 rounded-xl text-xs focus:border-teal-500 focus:outline-none bg-slate-50 focus:bg-white transition-all font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-500">등록 도메인 (Domain)</label>
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="예: http://localhost:3000"
                    className="h-9 px-3 border border-slate-200 rounded-xl text-xs focus:border-teal-500 focus:outline-none bg-slate-50 focus:bg-white transition-all font-mono"
                  />
                  <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50 border border-slate-100 p-2.5 rounded-xl flex flex-col gap-1 mt-1">
                    <span>
                      브이월드 발급 시 지정한 인증 도메인을 입력해 주십시오.
                    </span>
                    <div className="flex items-center justify-between gap-1.5 mt-1 bg-white px-2 py-1 border border-slate-150 rounded-lg">
                      <span className="font-mono text-slate-600 text-[10px] select-all truncate">
                        {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            navigator.clipboard.writeText(window.location.origin);
                            alert("현재 주소가 복사되었습니다. 브이월드 키 발급 시 '웹 URL'에 등록하세요!");
                          }
                        }}
                        className="text-[9px] font-bold text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100 shrink-0 hover:bg-teal-100 active:scale-95 transition-all"
                      >
                        주소 복사
                      </button>
                    </div>
                    <span className="text-[9px] text-teal-600 font-medium">
                      * 브이월드 마이페이지에서 위 주소를 '웹 URL'에 등록해야 API 조회가 작동합니다.
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-1 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setApiKeyInput("");
                      setDomainInput("");
                    }}
                    className="px-3 h-8 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                  >
                    입력 초기화
                  </button>
                  <button
                    type="submit"
                    className="px-4 h-8 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition-all"
                  >
                    저장 후 적용
                  </button>
                </div>
              </form>
            )}
            
            {/* VWorld Real-time API Connection Diagnostics */}
            {(showSettings || showDebugLogs) && (
              <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl shadow-xl flex flex-col gap-3 animate-slideDown font-sans border border-slate-800">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                    <strong className="text-xs font-bold text-slate-300">실시간 API 연동 로그 진단기</strong>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={fetchVworldLogs}
                      disabled={loadingLogs}
                      className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-50 transition-all text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {loadingLogs ? "조회중..." : "새로고침 ↻"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDebugLogs(false);
                        setVworldLogs([]);
                      }}
                      className="text-slate-500 hover:text-slate-300 text-[11px] cursor-pointer"
                    >
                      닫기
                    </button>
                  </div>
                </div>

                {/* Info Text */}
                <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex flex-col gap-1.5">
                  <p>• 브이월드 서버와 우리 프록시 서버 간의 통신 상태를 실시간으로 추적합니다.</p>
                  <p className="text-teal-400 font-medium">
                    • [보안 안내] 로그 화면 상에는 API 인증키 유출 방지를 위해 일부 영역이 마스킹(<span className="font-mono bg-teal-950/40 px-1 py-0.5 rounded text-[9px] text-teal-300 border border-teal-800/20">858A-XXXX-XXXX-XXXX-04D2</span> 등) 처리되어 표기되나, <strong>실제 브이월드 API 전송 시에는 고객님의 원본 API 키가 완전히 보존되어 정상적으로 전달</strong>됩니다.
                  </p>
                </div>

                {vworldLogs.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-[11px] border border-dashed border-slate-800 rounded-xl">
                    아직 기록된 VWorld 연동 로그가 없습니다.<br />주소를 검색하거나 지적도를 켜보세요.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1 text-[11px]">
                    {vworldLogs.map((log: any, idx: number) => {
                      const isSuccess = log.success;
                      let statusText = "정상 완료";
                      let badgeColor = "bg-teal-500/20 text-teal-400 border-teal-500/30";
                      
                      if (!isSuccess) {
                        badgeColor = "bg-rose-500/20 text-rose-400 border-rose-500/30";
                        if (log.responseExcerpt?.includes("Service Not URL")) {
                          statusText = "도메인 불일치 (Referer Mismatch)";
                        } else if (log.responseExcerpt?.includes("인증") || log.responseExcerpt?.includes("Unauthorized") || log.responseExcerpt?.includes("Authentication")) {
                          statusText = "API Key 승인 대기/오류";
                        } else if (log.responseType === "HTML" && log.responseExcerpt?.startsWith("<!doctype html>")) {
                          statusText = "HTML 템플릿 반환됨 (서버 측 비정상 오류)";
                        } else {
                          statusText = `연동 실패 (HTTP ${log.status})`;
                        }
                      }

                      return (
                        <div key={idx} className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl flex flex-col gap-1.5 font-mono">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">{log.timestamp}</span>
                            <span className={`px-1.5 py-0.5 border rounded-md font-semibold text-[9px] ${badgeColor}`}>
                              {statusText}
                            </span>
                          </div>

                          <div className="flex flex-col gap-0.5 text-[10px] text-slate-300">
                            <div><span className="text-slate-500 font-bold">서비스:</span> {log.service}</div>
                            <div className="truncate"><span className="text-slate-500 font-bold">URL:</span> <span className="select-all text-slate-400">{log.url}</span></div>
                            <div><span className="text-slate-500 font-bold">Referer:</span> <span className="text-slate-400 select-all">{log.referer}</span></div>
                            <div><span className="text-slate-500 font-bold">Domain Param:</span> <span className="text-slate-400 select-all">{log.domainParam}</span></div>
                          </div>

                          <div className="mt-1 bg-slate-900 border border-slate-850 p-1.5 rounded-lg text-[9px] text-slate-400 break-all max-h-[60px] overflow-y-auto">
                            <span className="font-bold text-slate-500">결과 데이터:</span> {log.responseExcerpt}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
            {/* Address Search Form */}
            <form onSubmit={handleManualSearch} className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                지번 주소 정밀 검색
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="search"
                    value={parcelAddress}
                    onChange={(e) => setParcelAddress(e.target.value)}
                    placeholder="예: 서울시 강남구 대치동 316"
                    className="w-full h-12 pl-10 pr-4 border border-slate-200 rounded-2xl text-sm focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/5 bg-white transition-all shadow-sm"
                  />
                  <Search size={18} className="absolute left-3.5 top-3.5 text-slate-400" />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 h-12 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-2xl text-sm transition-all shadow-md shadow-teal-500/10 disabled:opacity-55 disabled:cursor-not-allowed shrink-0 flex items-center justify-center gap-1.5"
                >
                  {busy ? "조회 중" : "검색"}
                </button>
              </div>
            </form>

            {/* Dynamic Status Log Area */}
            <div className={`p-4 rounded-2xl border text-sm leading-relaxed transition-all duration-300 flex flex-col gap-3 ${
              status.type === 'error' 
                ? 'bg-rose-50 border-rose-100 text-rose-800' 
                : status.type === 'success'
                ? 'bg-teal-50 border-teal-100 text-teal-800'
                : 'bg-slate-50 border-slate-100 text-slate-600'
            }`}>
              <div className="flex items-start gap-3">
                <Info size={18} className="mt-0.5 shrink-0" />
                <span className="flex-1">{status.text}</span>
              </div>
              
              {status.type === 'error' && (status.text.includes("VWorld") || status.text.includes("HTML") || status.text.includes("인증") || status.text.includes("지적도")) && (
                <div className="mt-1 p-3 bg-white/75 border border-rose-200/55 rounded-xl text-xs text-rose-900 flex flex-col gap-2">
                  <p className="font-semibold">💡 원인 및 해결 방법:</p>
                  <p className="leading-relaxed">
                    브이월드 인증 키가 올바르지 않거나 현재 실행 중인 사이트 주소(도메인)가 브이월드에 등록되어 있지 않습니다.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setShowSettings(true)}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg shadow-sm text-[11px] transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Settings size={12} />
                      인증키/도메인 등록 설정 열기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDebugLogs(true);
                        fetchVworldLogs();
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold rounded-lg border border-slate-700 shadow-sm text-[11px] transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <span>⚡ 실시간 로그 진단</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Candidate List Results */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  지번 후보 검색 결과 ({results.length})
                </span>
                {results.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 transition-all"
                  >
                    초기화
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-sm">
                  아직 조회된 지번 정보가 없습니다. 단지를 선택하거나 위에 직접 주소를 입력해 주십시오.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
                  {results.map((result, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => selectResult(result)}
                      className={`w-full p-4 rounded-2xl text-left border transition-all duration-200 flex flex-col gap-1.5 ${
                        selectedResultIndex === result.index
                          ? 'border-teal-500 bg-teal-50/20 shadow-md shadow-teal-500/5'
                          : 'border-slate-200 bg-white hover:border-teal-400 hover:shadow-sm'
                      }`}
                    >
                      <strong className="text-sm font-bold text-slate-800 line-clamp-1">
                        {result.parcelAddress || result.title}
                      </strong>
                      {result.roadAddress && (
                        <span className="text-xs text-slate-500 line-clamp-1">
                          도로명: {result.roadAddress}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 font-mono tracking-tight">
                        PNU: {result.pnu || "미확인 (좌표 기반 연동)"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Bottom Help Desk */}
          <div className="pt-4 border-t border-slate-100">
            {currentAddressInfo ? (
              <div className="flex flex-col gap-2 bg-slate-100/50 p-4 rounded-2xl border border-slate-100">
                <h4 className="text-xs font-bold text-slate-600 flex items-center gap-1">
                  <Navigation size={13} /> 실시간 토지분석 외부연동
                </h4>
                <div className="flex gap-2">
                  <a
                    href={currentAddressInfo.naverMapLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-9 bg-[#03c75a] hover:bg-[#02ab4d] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1 shadow-sm transition-all"
                  >
                    네이버 지적도 ↗
                  </a>
                  <a
                    href={currentAddressInfo.kakaoMapLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-9 bg-yellow-400 hover:bg-yellow-500 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center gap-1 shadow-sm transition-all"
                  >
                    카카오맵 ↗
                  </a>
                </div>
              </div>
            ) : (
              <div className="bg-slate-100 p-3.5 rounded-xl text-xs text-slate-500 leading-normal flex gap-1.5 items-start">
                <Info size={14} className="shrink-0 mt-0.5 text-slate-400" />
                <span>지적 데이터는 실제 국토교통부 수치 지도와 일부 상이할 수 있으므로 부동산 실무 의사결정 시 법적 공적 문서를 확인하십시오.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Map viewport */}
        <div className="lg:col-span-8 relative bg-slate-100 overflow-hidden min-h-[480px]">
          
          {/* Map Target Anchor */}
          <div ref={mapContainerRef} className="absolute inset-0 z-0 w-full h-full" />

          {/* Floating Control Toolbar */}
          <div className="absolute top-4 right-4 flex gap-2 z-10">
            <button
              type="button"
              onClick={handleFitToBoundary}
              className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-lg border border-slate-200/60 transition-all flex items-center gap-1.5"
            >
              <RotateCcw size={14} className="text-teal-600" />
              경계로 이동
            </button>
            <button
              type="button"
              onClick={handleCopyPnu}
              className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-lg border border-slate-200/60 transition-all flex items-center gap-1.5"
            >
              <Copy size={14} className="text-teal-600" />
              PNU 복사
            </button>
          </div>

          {/* Selected Feature Info Summary (Bottom Right overlay) */}
          <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[400px] z-10">
            {selectedParcelSummary ? (
              <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-200/50 flex flex-col gap-1 text-slate-800 animate-slideUp">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={16} className="text-teal-600" />
                  <strong className="text-sm font-bold text-slate-800 line-clamp-1">
                    {selectedParcelSummary.title}
                  </strong>
                </div>
                <div className="text-xs text-slate-500 font-mono mt-1 flex flex-col gap-0.5">
                  <span>PNU: {selectedParcelSummary.pnu}</span>
                  <span className="font-sans text-teal-600 font-semibold">{selectedParcelSummary.countText}</span>
                </div>
              </div>
            ) : (
              <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-200/50 flex gap-2.5 items-start text-slate-500 animate-slideUp text-xs leading-normal">
                <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-700 font-bold block mb-0.5">선택된 필지 없음</strong>
                  지번 후보 검색 결과에서 카드를 하나 선택하면 경계 분석 및 필지 상세(PNU, 범위 등)가 활성화됩니다.
                </div>
              </div>
            )}
          </div>

          {/* VWorld Engine Active Status Mark */}
          <div className="absolute bottom-4 left-4 z-10 hidden md:flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-sm px-3.5 py-2 rounded-xl border border-slate-700 text-[11px] text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            VWorld 2.0 공간 정보 API 활성화됨
          </div>

        </div>
      </div>
    </div>
  );
}
