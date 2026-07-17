import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWmsParams,
  extractFeatureCollection,
  normalizeSearchResponse,
  normalizeVWorldDomain,
} from '../server/vworld';

test('VWorld 도메인의 마지막 슬래시와 공백을 제거한다', () => {
  assert.equal(normalizeVWorldDomain(' https://example.com/// '), 'https://example.com');
});

test('주소 검색 결과를 PNU와 경위도 후보로 정규화한다', () => {
  const candidates = normalizeSearchResponse({
    response: {
      status: 'OK',
      result: {
        items: [
          {
            id: '4113510900106240000',
            title: '<b>삼평동 624</b>',
            address: { parcel: '경기도 성남시 분당구 삼평동 624', road: '판교역로 235' },
            point: { x: '127.108', y: '37.402' },
          },
        ],
      },
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].pnu, '4113510900106240000');
  assert.equal(candidates[0].title, '삼평동 624');
  assert.equal(candidates[0].lon, 127.108);
});

test('Data API 응답의 FeatureCollection을 추출한다', () => {
  const collection = extractFeatureCollection({
    response: {
      status: 'OK',
      result: {
        featureCollection: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { pnu: '4113510900106240000' } }],
        },
      },
    },
  });

  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, 1);
});

test('WMS 요청은 공식 연속지적도 레이어로 고정하고 크기를 제한한다', () => {
  const params = buildWmsParams(
    {
      BBOX: '14100000,4500000,14200000,4600000',
      WIDTH: '9999',
      HEIGHT: '0',
      LAYERS: 'malicious_layer',
    } as any,
    { apiKey: 'secret', domain: 'https://example.com' },
  );

  assert.equal(params.layers, 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun');
  assert.equal(params.styles, 'lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line');
  assert.equal(params.width, '1024');
  assert.equal(params.height, '256');
  assert.equal(params.crs, 'EPSG:3857');
});

test('WMS BBOX에 명령 문자열을 허용하지 않는다', () => {
  assert.throws(() =>
    buildWmsParams(
      { BBOX: '1,2,3,4;DROP TABLE' } as any,
      { apiKey: 'secret', domain: 'https://example.com' },
    ),
  );
});

