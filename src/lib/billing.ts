/**
 * Billing integration point.
 *
 * BILLING_CONFIGURED stays false until a server-side entitlement service
 * exists. Client-side WASM cannot prove that a visitor paid. Do not flip
 * this flag to pretend a subscription is active.
 *
 * When a real check is added, replace `entitlements()` with a call that
 * reads a server-verified session. Team sharing is impossible without accounts.
 */
export const BILLING_CONFIGURED = false;

export type PlanId = "free" | "pro" | "team";

export const PLANS: { id: PlanId; name: string; summary: string; items: string[] }[] = [
  {
    id: "free",
    name: "Free",
    summary: "Local inspection on this device.",
    items: ["G-code parse and 3D preview", "Basic diagnostics", "Files stay in the browser"],
  },
  {
    id: "pro",
    name: "Pro",
    summary: "Proposed. Not for sale in this build.",
    items: ["Report export", "Custom machine profiles", "Saved projects", "Time estimates"],
  },
  {
    id: "team",
    name: "Team",
    summary: "Needs accounts. Not connected.",
    items: ["Shared profiles", "Collaboration", "Administration"],
  },
];

export function entitlements() {
  return {
    billingConfigured: BILLING_CONFIGURED,
    localInspection: true,
    preview: true,
    diagnostics: true,
    // Present locally because locking them in the browser would be theater.
    reports: true,
    customProfiles: true,
    savedProjects: true,
    teamAdmin: false,
    collaboration: false,
  };
}
