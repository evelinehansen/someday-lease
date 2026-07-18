// storage.js — localStorage load/save, export/import, backup-age tracking.
// The export file is the real home of the data: localStorage can be evicted
// (Safari clears it after about 7 days of disuse, and this tool is designed
// to be visited rarely).

import { todayISO, daysBetween } from "./engine.js";

// Bumping this without a migration wipes existing data: load() treats a
// version mismatch as unreadable and silently returns freshData(). Add a
// migration from every older version first.
export const SCHEMA_VERSION = 1;

// All tools share one GitHub Pages origin, so keys are namespaced by tool
// and the data key carries the schema version (a future v2 writes a new key
// and leaves v1 in place). The backup key is device-only state, unversioned.
const DATA_KEY = "someday-lease:v1";
const BACKUP_KEY = "someday-lease:backup";

// One-time rename from the older unversioned keys. Copies each value to its
// new key (unless the new key is already written) and removes the old one.
const RENAMED_KEYS = {
  "somedayLease.data": DATA_KEY,
  "somedayLease.lastBackup": BACKUP_KEY,
};
try {
  for (const [oldKey, newKey] of Object.entries(RENAMED_KEYS)) {
    const value = localStorage.getItem(oldKey);
    if (value === null) continue;
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value);
    localStorage.removeItem(oldKey);
  }
} catch {
  // Quota or private mode: leave the old keys alone so nothing is lost.
}

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

// This file never touches the page, so it cannot show a message itself.
// app.js hands us a function to call (it shows the toast) whenever a save
// fails, so the user hears about it instead of losing data silently.
let saveFailed = () => {};
export function onSaveFailure(fn) {
  saveFailed = fn;
}

export function save(data) {
  data.modified = new Date().toISOString();
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch {
    // Storage is full or the browser is in private mode. The write did not
    // happen: the change is only on screen and is gone after a reload.
    saveFailed(
      "Saving failed. This browser could not store the change (storage may be full or in private mode), so it will be lost when you leave. Export a backup to keep your data."
    );
  }
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
  try {
    localStorage.setItem(BACKUP_KEY, todayISO());
  } catch {
    // The backup file itself already downloaded fine. Only today's date
    // could not be stored, so the header nudge may look older than it is.
    saveFailed(
      "Your backup file downloaded, but the browser could not record the date, so the last backup note may look out of date."
    );
  }
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
