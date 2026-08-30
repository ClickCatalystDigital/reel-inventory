// Mirrors server.js's ROLE_PAGE_ALLOWLIST and app.js's role checks. UI-only —
// server.js remains the actual enforcement boundary; this just decides what
// the nav renders for a given role. Keep this in sync with server.js by hand
// (there's no shared source between the two processes/languages).
export const ROLE_PAGE_ALLOWLIST: Record<string, string[]> = {
  client: ["/stock"],
  gelco_worker: ["/outward"],
  gelco_manager: ["/", "/outward", "/gelco-docs"],
};

export const APPROVER_ROLES = ["admin", "manager", "gelco_manager"];
export const GELCO_ROLES = ["gelco_manager", "gelco_worker"];
export const NOTIFICATION_ROLES = ["admin", "manager"];
export const GELCO_DOCS_ROLES = ["admin", "manager", "gelco_manager"];

export function isNavLinkVisible(role: string | undefined, href: string): boolean {
  if (!role) return true;
  const allowed = ROLE_PAGE_ALLOWLIST[role];
  return !allowed || allowed.includes(href);
}
