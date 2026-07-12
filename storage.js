// storage.js — localStorage load/save, export/import, backup-age tracking.
// The export file is the real home of the data: localStorage can be evicted
// (Safari clears it after about 7 days of disuse, and this tool is designed
// to be visited rarely).

import { todayISO, daysBetween } from "./engine.js";

export const SCHEMA_VERSION = 1;

const DATA_KEY = "somedayLease.data";
const BACKUP_KEY = "somedayLease.lastBackup";

export function freshData() {
  const now = new Date().toISOString();
  return { schemaVersion: SCHEMA_VERSION, created: now, modified: now, items: [] };
}

export function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return freshData();
    const data = JSON.parse(raw);
    if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.items)) {
      return freshData();
    }
    return data;
  } catch {
    return freshData();
  }
}

export function save(data) {
  data.modified = new Date().toISOString();
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

// ---------- export ----------

export function exportFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `someday-lease-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  recordBackup();
}

export function recordBackup() {
  localStorage.setItem(BACKUP_KEY, todayISO());
}

export function lastBackup() {
  return localStorage.getItem(BACKUP_KEY);
}

export function backupAgeDays() {
  const last = lastBackup();
  if (!last) return null;
  return daysBetween(last, todayISO());
}

export function backupAgeText() {
  const days = backupAgeDays();
  if (days === null) return "Last backup: never";
  if (days <= 0) return "Last backup: today";
  if (days === 1) return "Last backup: yesterday";
  return `Last backup: ${days} days ago`;
}

// ---------- import ----------

// Returns { data } on success or { error } with a human sentence.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file isn't valid JSON." };
  }
  if (!data || typeof data !== "object") {
    return { error: "That file doesn't look like a Someday Lease backup." };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return {
      error: `That backup uses schema version ${data.schemaVersion ?? "unknown"}, and this app reads version ${SCHEMA_VERSION}.`,
    };
  }
  if (!Array.isArray(data.items)) {
    return { error: "That backup has no items list." };
  }
  return { data };
}

// Merge: union by id; the imported copy wins when the same item exists in both.
export function mergeItems(current, imported) {
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const item of imported) byId.set(item.id, item);
  return [...byId.values()];
}
