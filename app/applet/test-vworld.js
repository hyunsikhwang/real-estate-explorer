const axios = require("axios");

const keys = ["CE4DEC2E-CE4D-3AC4-8A8E-E575231D12E9", "767B7AD0-CA3E-3BC3-A449-746658820988"];
const referers = [
  "http://localhost:3000",
  "https://api.vworld.kr",
  "http://api.vworld.kr"
];

async function run() {
  console.log("Starting diagnostics...");
  for (const key of keys) {
    for (const ref of referers) {
      const url = `https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&type=address&category=parcel&format=json&errorformat=json&key=${key}&query=${encodeURIComponent("서울특별시 송파구 신천동 7")}&domain=${encodeURIComponent(ref)}`;
      try {
        const response = await axios.get(url, {
          headers: {
            "Referer": ref,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        console.log(`Key: ${key.substring(0, 5)}..., Ref: ${ref} -> HTTP: ${response.status}`);
        const data = response.data;
        if (typeof data === "string") {
          console.log(`  Raw String response (length ${data.length}): ${data.substring(0, 150)}`);
        } else {
          console.log(`  JSON response: Status: ${data?.response?.status}, Results: ${data?.response?.result?.items ? "Found" : "None"}`);
          if (data?.response?.status === "OK") {
            console.log(`  First item title: ${data?.response?.result?.items?.[0]?.title}`);
            console.log(`  First item point: ${JSON.stringify(data?.response?.result?.items?.[0]?.point)}`);
            console.log(`  First item id/pnu: ${data?.response?.result?.items?.[0]?.id || data?.response?.result?.items?.[0]?.pnu}`);
            return; // Found a working combo!
          } else {
            console.log(`  Error text: ${data?.response?.error?.text}`);
          }
        }
      } catch (err) {
        console.log(`Key: ${key.substring(0, 5)}..., Ref: ${ref} -> Error: ${err.message}`);
      }
    }
  }
}

run();
