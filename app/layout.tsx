import type { Metadata } from "next";
import { headers } from "next/headers";
import "../src/index.css";

const title = "부동산 실거래가·연속지적도 조회";
const description = "국토교통부 실거래가와 VWorld 연속지적도를 한 화면에서 조회합니다.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: "/",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{