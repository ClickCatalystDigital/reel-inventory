import type { Metadata } from "next";
import { FEATURES } from "@/lib/demo-features";

const NA = process.env.NEXT_PUBLIC_MARKET === "NA"; // per module, see lib/market.ts
// The demo's public address (wrangler.demo.jsonc / wrangler.us.jsonc routes).
const DEMO_ORIGIN = NA ? "https://electronics-erp-us.ahromlabs.com" : "https://electronics-erp.ahromlabs.com";

export const metadata: Metadata = {
  title: NA
    ? "Electronic Component Inventory ERP for US Distributors: Live Demo | Ahrom Labs"
    : "Electronics Component Inventory ERP: Live Demo | Ahrom Labs",
  description:
    "Try a reel-level inventory and CRM system for electronics-component traders: QR-labelled reels, two stores, scan-cart dispatch against customer POs, approvals and a customer stock portal.",
  robots: { index: true, follow: true },
  // One URL per demo (/ only redirects here), and the India and US builds named as each other's regional versions.
  alternates: {
    canonical: `${DEMO_ORIGIN}/demo`,
    languages: { "en-IN": "https://electronics-erp.ahromlabs.com/demo", "en-US": "https://electronics-erp-us.ahromlabs.com/demo", "x-default": "https://electronics-erp.ahromlabs.com/demo" },
  },
};

// Structured data for search engines: what the product is and what it does (the same text as the page).
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Inventory Ops",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Inventory and CRM for electronic-component traders",
  operatingSystem: "Web browser",
  url: `${DEMO_ORIGIN}/demo`,
  description: metadata.description,
  featureList: FEATURES.map(([, title, text]) => `${title}: ${text}`),
  publisher: { "@type": "Organization", name: "Ahrom Labs", url: "https://ahromlabs.com" },
  hasPart: FEATURES.map(([, , , id, heading]) => ({ "@type": "WebPageElement", name: heading, url: `${DEMO_ORIGIN}/demo#${id}`})),
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {children}
    </>
  );
}
