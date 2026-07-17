import assert from 'node:assert/strict';
import test from 'node:test';
import {
  directBaseMapUrl,
  directCadastralWmsParams,
  extractBrowserFeatureCollection,
  normalizeBrowserSearchResponse,
} from '../src/vworld-browser';

const configuration = {
  apiKey: 'domain-limited-key',
  domain: 'https://example.com',
};

test('브라우저 주소 검색 응답을 PNU와 좌표 후보로 정규화한다', () => {
  const candidates = normalizeBrowserSearchResponse({
    response: {
      status: 'OK',
      result: {
        items: [{
          id: '4113510900106240000',
          title: '<b>삼평동 624</b>',
          address: { parcel: '경기도 성남시 분당구 삼평동 624', road: '판교역로 235' },
          point: { x: '127.108', y: '37.402' },
        }],
      },
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].pnu, '4113510900106240000');
  assert.equal(candidates[0].title, '삼평동 624');
});

test('브라우저 Data API 응답에서 FeatureCollection을 추출한다', () => {
  const collection = extractBrowserFeatureCollection({
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

test('브라우저 지도 URL과 WMS 파라미터에 도메인 제한 설정을 포함한다', () => {
  assert.equal(
    directBaseMapUrl(configuration),
    'https://api.vworld.kr/req/wmts/1.0.0/domain-limited-key/Base/{z}/{y}/{x}.png',
  );
  const params = directCadastralWmsParams(configuration);
  assert.equal(params.key, 'domain-limited-key');
  assert.equal(params.domain, 'https://example.com');
  assert.equal(params.LAYERS, 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun');
});
