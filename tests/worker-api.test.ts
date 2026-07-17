import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleApiRequest, type RuntimeEnv } from "../worker/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("호스팅 상태 API는 키를 노출하지 않고 설정 여부만 반환한다", async () => {
  const env: RuntimeEnv = {
    DATA_GO_KR_SERVICE_KEY: "data-secret",
    VWORLD_API_KEY: "vworld-secret",
    VWORLD_DOMAIN: "https://example.com/",
  };
  const response = await handleApiRequest(new Request("https://example.com/api/config"), env);
  assert.equal(response?.status, 200);
  const body = await response!.json() as Record<string, unknown>;
  assert.deepEqual(body, {
    hasServiceKey: true,
    hasVworldKey: true,
    vworldDomain: "https://example.com",
  });
  assert.equal(JSON.stringify(body).includes("secret"), false);
});

test("호스팅 WMS 프록시는 공식 연속지적도 레이어를 고정한다", async () => {
  let upstream = "";
  globalThis.fetch = async (input) => {
    upstream = String(input);
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };
  const request = new Request("https://example.com/api/map/wms?BBOX=1,2,3,4&WIDTH=256&HEIGHT=256");
  const response = await handleApiRequest(request, {
    VWORLD_API_KEY: "key",
    VWORLD_DOMAIN: "https://example.com",
  });
  const upstreamUrl = new URL(upstream);
  assert.equal(response?.status, 200);
  assert.equal(upstreamUrl.searchParams.get("layers"), "lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun");
  assert.equal(upstreamUrl.searchParams.get("styles"), "lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line");
  assert.equal(response?.headers.get("content-type"), "image/png");
});

test("호스팅 타일 프록시는 범위를 벗어난 좌표를 거부한다", async () => {
  const response = await handleApiRequest(
    new Request("https://example.com/api/map/base/10/99999/99999.png"),
    { VWORLD_API_KEY: "key", VWORLD_DOMAIN: "https://example.com" },
  );
  assert.equal(response?.status, 400);
  const body = await response!.json() as { code: string };
  assert.equal(body.code, "INVALID_TILE");
});

test("호스팅 실거래가 프록시는 공공데이터 응답을 전달한다", async () => {
  globalThis.fetch = async () => Response.json({
    response: {
      header: { resultCode: "000", resultMsg: "NORMAL SERVICE" },
      body: { totalCount: 1, items: { item: [{ aptNm: "테스트아파트" }] } },
    },
  });
  const tradeType = encodeURIComponent("매매");
  const response = await handleApiRequest(
    new Request(`https://example.com/api/transactions?sigunguCode=11710&dealMonth=202506&tradeType=${tradeType}`),
    { DATA_GO_KR_SERVICE_KEY: "encoded-key" },
  );
  assert.equal(response?.status, 200);
  const body = await response!.json() as any;
  assert.equal(body.response.body.totalCount, 1);
  assert.