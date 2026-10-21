export const BRAND_NAME = "Sarim Events Planner";
export const BRAND_TAGLINE = "Make Your Moments Special";
export const BRAND_LOGO = "/logo.png";

/** Event categories offered when booking; legacy free-text types on old events still display as-is. */
export const EVENT_TYPES = [
  "Wedding",
  "Birthday",
  "Engagement",
  "Walima",
  "Aqiqah",
  "Other Events",
] as const;

/** Plural labels as printed on the logo and on invoices. */
export const EVENT_CATEGORIES = [
  "Weddings",
  "Birthdays",
  "Engagements",
  "Walima",
  "Aqiqah",
  "Other Events",
] as const;
