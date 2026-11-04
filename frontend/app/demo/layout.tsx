import type { Metadata } from "next";
import { FEATURES } from "@/lib/demo-features";
import { DEMO_VIDEO } from "@/lib/demo-video";

export const metadata: Metadata = {
  title: "Electronics Component Inventory ERP: Live Demo | Ahrom Labs",
  description:
    "Try a reel-level inventory and CRM system for electronics-component traders: QR-labelled reels, two stores, scan-cart dispatch against customer POs, approvals and a customer stock portal.",
  robots: { index: true, follow: true },
};

// Structured data for search engines: what the product is and what it does (the same text as the page).
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Inventory Ops",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Inventory and CRM for electronic-component traders",
  operatingSystem: "Web browser",
  url: "https://electronics-erp.ahromlabs.com/demo",
  description: metadata.description,
  featureList: FEATURES.map(([, title, text]) => `${title}: ${text}`),
  publisher: { "@type": "Organization", name: "Ahrom Labs", url: "https://ahromlabs.com" },
  hasPart: FEATURES.map(([, , , id, heading]) => ({ "@type": "WebPageElement", name: heading, url: `https://electronics-erp.ahromlabs.com/demo#${id}` })),
};
// The tour embedded above the form (lib/demo-video.ts), for video results in search.
const video = DEMO_VIDEO && {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: DEMO_VIDEO.name,
  description: DEMO_VIDEO.description,
  thumbnailUrl: `https://i.ytimg.com/vi/${DEMO_VIDEO.id}/maxresdefault.jpg`,
  uploadDate: DEMO_VIDEO.uploadDate,
  duration: DEMO_VIDEO.duration,
  contentUrl: `https://www.youtube.com/watch?v=${DEMO_VIDEO.id}`,
  embedUrl: `https://www.youtube.com/embed/${DEMO_VIDEO.id}`,
  publisher: jsonLd.publisher,
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(video ? [jsonLd, video] : jsonLd).replace(/</g, "\\u003c") }} />
      {children}
    </>
  );
}
