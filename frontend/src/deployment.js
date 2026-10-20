export const APP_TARGET = import.meta.env.VITE_APP_TARGET || "all";

const apps = {
  all: { name: "OncoBrief", roles: null },
  patient: { name: "OncoBrief Patient", roles: ["patient", "caregiver"] },
  doctor: { name: "OncoBrief Doctor", roles: ["doctor"] },
  staff: {
    name: "OncoBrief Staff",
    roles: ["nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "admin"],
  },
};

export const APP = apps[APP_TARGET] || apps.all;

// This selects the sign-in choices, not permissions. The API enforces access.
export function appAccounts(accounts) {
  return APP.roles ? accounts.filter((account) => APP.roles.includes(account.role)) : accounts;
}
