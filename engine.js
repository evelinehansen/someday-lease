// engine.js — pure functions only. No DOM, no localStorage.
// Everything here can be tested from the browser console, for example:
//   import * as engine from "./engine.js"
//   engine.addMonths("2026-11-30", 3)   -> "2027-02-28" (clamped to month end)

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- dates ----------

// Today as "YYYY-MM-DD" in the user's local timezone.
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Add whole months to a "YYYY-MM-DD" date, clamping to the end of the
// target month: a 3 month lease signed November 30 ends February 28.
export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const monthIndex = (m - 1) + months;
  const targetYear = y + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const daysInTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, daysInTarget);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Whole days from one "YYYY-MM-DD" to another (positive when `to` is later).
// Noon avoids daylight-saving edge cases.
export function daysBetween(from, to) {
  const a = new Date(from + "T12:00:00");
  const b = new Date(to + "T12:00:00");
  return Math.round((b - a) / 86400000);
}

// "12 July 2026"
export function formatFullDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "July 2026"
export function formatMonthYear(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------- item lifecycle ----------

export function newItem({ title, why, category, leaseMonths }, today, nowISOString) {
  return {
    id: makeId(),
    title,
    why,
    category: category || "",
    created: nowISOString,
    leaseMonths,
    leaseEnd: addMonths(today, leaseMonths),
    renewals: [],
    status: "active",
    closedOn: null,
    closingNote: "",
  };
}

function makeId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for very old browsers.
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Renewing starts a fresh term from today (the old lease already ran out).
export function renewItem(item, { months, why, changeNote }, today) {
  return {
    ...item,
    leaseMonths: months,
    leaseEnd: addMonths(today, months),
    renewals: [...item.renewals, { on: today, months, why, changeNote: changeNote || "" }],
  };
}

export function markActed(item, note, today) {
  return { ...item, status: "acted", closedOn: today, closingNote: note || "" };
}

export function releaseItem(item, note, today) {
  return { ...item, status: "released", closedOn: today, closingNote: note || "" };
}

// Fixing the words is allowed anytime. Changing the term of an active lease
// re-dates it from its last signing (creation or most recent renewal), so the
// lease stays honest about when it was actually agreed.
export function editItem(item, { title, why, category, months }) {
  const updated = { ...item, title, why, category: category || "" };
  if (item.status === "active" && months && months !== item.leaseMonths) {
    const signedOn = item.renewals.length
      ? item.renewals[item.renewals.length - 1].on
      : item.created.slice(0, 10);
    updated.leaseMonths = months;
    updated.leaseEnd = addMonths(signedOn, months);
  }
  return updated;
}

// A released item can come back on a brand new lease, history intact.
// The extra `reLease` flag on the renewal entry is additive (valid when absent).
export function reLease(item, { months, why }, today) {
  return {
    ...item,
    status: "active",
    leaseMonths: months,
    leaseEnd: addMonths(today, months),
    closedOn: null,
    closingNote: "",
    renewals: [...item.renewals, { on: today, months, why, changeNote: "", reLease: true }],
  };
}

// ---------- derived state (computed, never stored) ----------

export function isUpForRenewal(item, today) {
  return item.status === "active" && item.leaseEnd < today;
}

// Active items sorted by lease end, soonest first. Expired leases have the
// earliest end dates, so they naturally sit on top.
export function sortActive(items, today) {
  return items
    .filter((i) => i.status === "active")
    .slice()
    .sort((a, b) => (a.leaseEnd < b.leaseEnd ? -1 : a.leaseEnd > b.leaseEnd ? 1 : 0));
}

// The one stat sentence at the top of the page.
export function carryingLine(items, today) {
  const active = items.filter((i) => i.status === "active");
  const due = active.filter((i) => isUpForRenewal(i, today));
  if (active.length === 0) return "You're not carrying any somedays right now.";
  let line = active.length === 1
    ? "You're carrying 1 someday."
    : `You're carrying ${active.length} somedays.`;
  if (due.length === 1) line += " 1 is up for renewal.";
  else if (due.length > 1) line += ` ${due.length} are up for renewal.`;
  if (active.length > 20) line += " That's a heavy list. Some may be ready for release.";
  return line;
}

// Time remaining (or time since expiry) in plain words.
export function timeLeftText(leaseEnd, today) {
  const days = daysBetween(today, leaseEnd);
  if (days < 0) {
    const ago = -days;
    if (ago === 1) return "lease ended yesterday";
    if (ago < 7) return `lease ended ${ago} days ago`;
    if (ago < 30) {
      const w = Math.round(ago / 7);
      return w === 1 ? "lease ended a week ago" : `lease ended ${w} weeks ago`;
    }
    const m = Math.round(ago / 30.44);
    return m === 1 ? "lease ended a month ago" : `lease ended ${m} months ago`;
  }
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  if (days <= 7) return "expires this week";
  if (days <= 13) return "expires next week";
  if (days < 60) return `${Math.round(days / 7)} weeks left`;
  const m = Math.round(days / 30.44);
  return m === 1 ? "1 month left" : `${m} months left`;
}

// "6 month lease, expires January 2027"
export function leaseSentence(months, leaseEnd) {
  return `${months} month lease, expires ${formatMonthYear(leaseEnd)}`;
}

export function renewalCountText(n) {
  if (n === 1) return "renewed once";
  if (n === 2) return "renewed twice";
  return `renewed ${n} times`;
}

export function monthsWord(n) {
  return n === 1 ? "month" : "months";
}
