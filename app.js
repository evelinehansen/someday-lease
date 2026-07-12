// app.js — wires the logic (engine.js) and the data (storage.js) to the page.
// Everything renders from `data` plus today's date; derived state is never stored.

import {
  todayISO, daysBetween, newItem, renewItem, markActed, releaseItem, reLease,
  isUpForRenewal, sortActive, carryingLine, timeLeftText, leaseSentence,
  formatFullDate, formatMonthYear, renewalCountText, monthsWord,
} from "./engine.js";
import {
  load, save, exportFile, backupAgeText, lastBackup, parseImport, mergeItems,
} from "./storage.js";

let data = load();
let view = "active";      // "active" | "acted" | "released"
let seatInId = null;      // item that should play the seat-in animation on next render

const $ = (sel) => document.querySelector(sel);
const content = $("#content");
const panel = $("#panel");
const panelBody = $("#panelBody");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Escape user text before putting it into innerHTML.
function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function findItem(id) {
  return data.items.find((i) => i.id === id);
}

function replaceItem(updated) {
  data.items = data.items.map((i) => (i.id === updated.id ? updated : i));
}

// ---------- rendering ----------

function render() {
  const today = todayISO();

  const line = data.items.length ? carryingLine(data.items, today) : "";
  $("#carryingLine").textContent = line;
  $("#carryingLine").hidden = !line;

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === view);
  });

  $("#addBtn").hidden = view !== "active" || data.items.length === 0;

  if (view === "active") renderActiveView(today);
  else renderShelfView(view);

  $("#backupAge").textContent = backupAgeText();
  renderCategoryOptions();
}

function renderActiveView(today) {
  if (data.items.length === 0) {
    content.innerHTML = emptyStateHTML();
    return;
  }

  const active = sortActive(data.items, today);
  const due = active.filter((i) => isUpForRenewal(i, today));
  const rest = active.filter((i) => !isUpForRenewal(i, today));

  let html = "";
  if (due.length) {
    html += `<section class="renewal-band">
      <div class="section-h clay">Up for renewal</div>
      <p class="band-note">These leases have ended. Decide when you're ready.</p>
      <div class="list">${due.map((i) => activeCardHTML(i, today)).join("")}</div>
    </section>`;
  }
  if (rest.length) {
    html += `<section class="list">${rest.map((i) => activeCardHTML(i, today)).join("")}</section>`;
  } else if (!due.length) {
    html += `<p class="quiet-note">No active somedays right now. The shelves keep the finished stories.</p>`;
  }
  html += nudgeHTML();
  content.innerHTML = html;

  if (seatInId) {
    content.querySelector(`[data-id="${seatInId}"]`)?.classList.add("seat-in");
    seatInId = null;
  }
}

function activeCardHTML(item, today) {
  let meta = timeLeftText(item.leaseEnd, today);
  if (item.renewals.length) meta += `, ${renewalCountText(item.renewals.length)}`;
  return `<button class="item-card card" data-id="${item.id}">
    <span class="item-title">${esc(item.title)}</span>
    <span class="item-meta">${esc(meta)}${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}</span>
  </button>`;
}

function renderShelfView(which) {
  const items = data.items
    .filter((i) => i.status === which)
    .sort((a, b) => (a.closedOn < b.closedOn ? 1 : -1));

  const heading = which === "acted" ? "Did it" : "Released";
  const note = which === "acted"
    ? "Somedays that became doing. Tap one for its story."
    : "Let go on purpose. Tap one to revisit, or lease it again.";
  const empty = which === "acted"
    ? "Nothing here yet. When a someday truly starts, it moves here with its story."
    : "Nothing here yet. When you let a someday go, it rests here (and can always be leased again).";

  let html = `<div class="section-h">${heading}</div>`;
  if (!items.length) {
    html += `<p class="quiet-note">${empty}</p>`;
  } else {
    html += `<p class="shelf-note">${note}</p>
      <div class="list">${items.map(shelfCardHTML).join("")}</div>`;
  }
  content.innerHTML = html;
}

function shelfCardHTML(item) {
  const verb = item.status === "acted" ? "done" : "released";
  let meta = `${verb} ${formatMonthYear(item.closedOn)}`;
  if (item.renewals.length) meta += `, ${renewalCountText(item.renewals.length)} along the way`;
  return `<button class="item-card card" data-id="${item.id}">
    <span class="item-title">${esc(item.title)}</span>
    <span class="item-meta">${esc(meta)}${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}</span>
    ${item.closingNote ? `<span class="item-note">"${esc(item.closingNote)}"</span>` : ""}
  </button>`;
}

function emptyStateHTML() {
  return `<section class="empty-state">
    <h2>A someday list that stays honest.</h2>
    <p>Every someday you add signs a lease: three, six, or twelve months.</p>
    <p>When the lease ends, the item comes back to you with one question.</p>
    <p>Renew it with a fresh reason, act on it, or let it go.</p>
    <div class="empty-actions">
      <button class="btn primary" data-action="add">Add your first someday</button>
      <button class="btn ghost small" data-action="import">Or restore a backup file</button>
    </div>
    <div class="section-h">The kind of thing that lives here</div>
    <div class="ghost-list" aria-hidden="true">
      <div class="ghost-card"><span class="item-title">Learn to play the piano</span><span class="item-meta">on a 6 month lease</span></div>
      <div class="ghost-card"><span class="item-title">Walk the Camino de Santiago</span><span class="item-meta">on a 12 month lease</span></div>
      <div class="ghost-card"><span class="item-title">Write the short story</span><span class="item-meta">on a 3 month lease</span></div>
    </div>
  </section>`;
}

// The standing backup nudge. Most insistent tool in the family: this list is
// visited rarely, which is exactly when browsers evict localStorage.
function nudgeHTML() {
  if (!data.items.length) return "";
  const last = lastBackup();
  if (!last) {
    return `<aside class="nudge card">
      <p><strong>Back up your somedays.</strong> They live only in this browser, and browsers clear storage more often than you'd think. One tap saves a file you own.</p>
      <button class="btn small" data-action="export">Export backup</button>
    </aside>`;
  }
  const days = daysBetween(last, todayISO());
  if (days >= 14) {
    return `<aside class="nudge card">
      <p>Your last backup was ${days} days ago. If the list has changed since, export a fresh file.</p>
      <button class="btn small" data-action="export">Export backup</button>
    </aside>`;
  }
  return "";
}

function renderCategoryOptions() {
  const cats = [...new Set(data.items.map((i) => i.category).filter(Boolean))].sort();
  $("#categoryOptions").innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join("");
}

// ---------- panel (side panel on desktop, bottom sheet on mobile) ----------

function openPanel(title, bodyHTML) {
  $("#panelTitle").textContent = title;
  panelBody.innerHTML = bodyHTML;
  $("#backdrop").hidden = false;
  panel.hidden = false;
  panelBody.scrollTop = 0;
  requestAnimationFrame(() => {
    panel.classList.add("open");
    $("#backdrop").classList.add("show");
  });
}

function closePanel() {
  if (panel.hidden) return;
  panel.classList.remove("open");
  $("#backdrop").classList.remove("show");
  const wait = reducedMotion.matches ? 200 : 350;
  setTimeout(() => {
    panel.hidden = true;
    $("#backdrop").hidden = true;
    panelBody.innerHTML = "";
  }, wait);
}

// ---------- lease term picker (3 / 6 / 12 / custom) ----------

function termPickerHTML(selected = 6) {
  const pill = (m) =>
    `<button type="button" class="term-pill ${m === selected ? "selected" : ""}" data-m="${m}">${m} months</button>`;
  return `<div class="term-picker" data-months="${selected}">
    ${pill(3)}${pill(6)}${pill(12)}
    <button type="button" class="term-pill" data-m="custom">Custom</button>
    <span class="custom-term" hidden>
      <input type="number" class="custom-months" min="1" max="36" value="9" aria-label="Custom lease length in months"> months
    </span>
  </div>`;
}

function wireTermPicker(container, onChange) {
  const picker = container.querySelector(".term-picker");
  const customWrap = picker.querySelector(".custom-term");
  const customInput = picker.querySelector(".custom-months");

  picker.querySelectorAll(".term-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      picker.querySelectorAll(".term-pill").forEach((p) => p.classList.toggle("selected", p === pill));
      if (pill.dataset.m === "custom") {
        customWrap.hidden = false;
        picker.dataset.months = customInput.value;
        customInput.focus();
      } else {
        customWrap.hidden = true;
        picker.dataset.months = pill.dataset.m;
      }
      onChange?.();
    });
  });
  customInput.addEventListener("input", () => {
    picker.dataset.months = customInput.value;
    onChange?.();
  });
}

// Returns a whole number of months (1 to 36), or null if the custom value is nonsense.
function getPickedMonths(container) {
  const n = Math.round(Number(container.querySelector(".term-picker").dataset.months));
  if (!Number.isFinite(n) || n < 1 || n > 36) return null;
  return n;
}

// ---------- add form ----------

function openAddForm() {
  openPanel("A new someday", `
    <form id="addForm" class="form" autocomplete="off">
      <label for="fTitle">What is it?</label>
      <input type="text" id="fTitle" name="title" required maxlength="120" placeholder="Learn to play the piano">
      <label for="fWhy">Why does it matter? One honest line.</label>
      <textarea id="fWhy" name="why" required rows="2" maxlength="280" placeholder="Music was the thing I gave up first, and I miss it"></textarea>
      <label for="fCat">Category (optional)</label>
      <input type="text" id="fCat" name="category" list="categoryOptions" maxlength="40" placeholder="creative, travel, health">
      <div class="field-label">Lease term</div>
      ${termPickerHTML(6)}
      <p class="lease-preview" id="leasePreview"></p>
      <button type="submit" class="btn primary block">Sign the lease</button>
    </form>`);

  const updatePreview = () => {
    const months = getPickedMonths(panelBody);
    $("#leasePreview").textContent = months
      ? `${leaseSentence(months, addMonthsPreview(months))}.`
      : "Pick a term between 1 and 36 months.";
  };
  wireTermPicker(panelBody, updatePreview);
  updatePreview();

  $("#addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const months = getPickedMonths(panelBody);
    if (!months) return;
    const item = newItem({
      title: $("#fTitle").value.trim(),
      why: $("#fWhy").value.trim(),
      category: $("#fCat").value.trim(),
      leaseMonths: months,
    }, todayISO(), new Date().toISOString());
    if (!item.title || !item.why) return;

    data.items.push(item);
    save(data);
    seatInId = item.id;
    closePanel();
    view = "active";
    render();
    showToast(`Leased. ${leaseSentence(item.leaseMonths, item.leaseEnd)}.`);
  });

  setTimeout(() => $("#fTitle")?.focus(), reducedMotion.matches ? 220 : 380);
}

// Small helper so the preview can show the exact expiry date before saving.
function addMonthsPreview(months) {
  return newItem({ title: "x", why: "x", category: "", leaseMonths: months }, todayISO(), "").leaseEnd;
}

// ---------- item detail ----------

function openDetail(id) {
  const item = findItem(id);
  if (!item) return;
  if (item.status === "active") openActiveDetail(item);
  else if (item.status === "acted") openActedDetail(item);
  else openReleasedDetail(item);
}

function journeyHTML(item) {
  let html = `<div class="history-entry">
    <div class="history-date">Added ${formatFullDate(item.created.slice(0, 10))}</div>
    <blockquote class="why-quote">${esc(item.why)}</blockquote>
  </div>`;
  for (const r of item.renewals) {
    const label = r.reLease ? "Leased again" : "Renewed";
    html += `<div class="history-entry">
      <div class="history-date">${label} ${formatFullDate(r.on)}, for ${r.months} ${monthsWord(r.months)}</div>
      <blockquote class="why-quote">${esc(r.why)}</blockquote>
      ${r.changeNote ? `<p class="change-note">On what would need to change: "${esc(r.changeNote)}"</p>` : ""}
    </div>`;
  }
  return html;
}

function openActiveDetail(item) {
  const today = todayISO();
  const due = isUpForRenewal(item, today);
  const leaseLine = due
    ? `${item.leaseMonths} month lease. The ${timeLeftText(item.leaseEnd, today)}.`
    : `${leaseSentence(item.leaseMonths, item.leaseEnd)} (${timeLeftText(item.leaseEnd, today)}).`;

  openPanel(item.title, `
    <p class="lease-line">${esc(leaseLine)}${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}</p>
    <div class="section-h">Its story so far</div>
    ${journeyHTML(item)}
    <div class="section-h" style="margin-top:1rem">${due ? "The lease is up" : "Decisions"}</div>
    ${due ? `<p class="shelf-note">Renew it, act on it, or let it go. Take your time.</p>` : ""}
    <div class="decisions">
      ${due ? `<button class="decision-btn renew-btn" data-decide="renew">Renew the lease<span class="sub">a fresh why and a new term</span></button>` : ""}
      <button class="decision-btn" data-decide="acted">I acted on it<span class="sub">move it to the did it shelf</span></button>
      <button class="decision-btn" data-decide="release">Let it go<span class="sub">rest it on the released shelf</span></button>
    </div>
    <div id="decisionForm"></div>`);

  panelBody.querySelectorAll("[data-decide]").forEach((btn) => {
    btn.addEventListener("click", () => {
      panelBody.querySelectorAll("[data-decide]").forEach((b) => b.classList.toggle("selected", b === btn));
      renderDecisionForm(item, btn.dataset.decide);
    });
  });
}

function renderDecisionForm(item, decision) {
  const holder = $("#decisionForm");
  const today = todayISO();

  if (decision === "renew") {
    // The fresh-why rule: this field is never pre-filled. The history above is
    // right there, verbatim, but the blank field asks the real question.
    const n = item.renewals.length + 1;
    const thirdQuestion = n >= 3
      ? `<label for="dChange">${n === 3 ? "Third renewal" : `Renewal number ${n}`}. What would need to change for this to actually happen? (optional)</label>
         <textarea id="dChange" rows="2" maxlength="280"></textarea>`
      : "";
    holder.innerHTML = `<form class="form decision-form" id="decideForm">
      <label for="dWhy">Why does it still matter? Fresh words, not the old ones.</label>
      <textarea id="dWhy" rows="2" required maxlength="280"></textarea>
      <div class="field-label">New term</div>
      ${termPickerHTML(item.leaseMonths === 3 || item.leaseMonths === 12 ? item.leaseMonths : 6)}
      ${thirdQuestion}
      <button type="submit" class="btn primary block">Renew the lease</button>
    </form>`;
    wireTermPicker(holder);
    $("#decideForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const months = getPickedMonths(holder);
      const why = $("#dWhy").value.trim();
      if (!months || !why) return;
      const updated = renewItem(item, { months, why, changeNote: $("#dChange")?.value.trim() || "" }, today);
      replaceItem(updated);
      save(data);
      seatInId = item.id;
      closePanel();
      render();
      showToast(`Renewed. ${months} more ${monthsWord(months)}, until ${formatMonthYear(updated.leaseEnd)}.`);
    });
  }

  if (decision === "acted") {
    holder.innerHTML = `<form class="form decision-form" id="decideForm">
      <label for="dNote">How did it start? One line for the shelf.</label>
      <textarea id="dNote" rows="2" required maxlength="280"></textarea>
      <button type="submit" class="btn primary block">Move it to did it</button>
    </form>`;
    $("#decideForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const note = $("#dNote").value.trim();
      if (!note) return;
      replaceItem(markActed(item, note, today));
      save(data);
      departThenRender(item.id, "acted", "Started. Off the someday list, into your life.");
    });
  }

  if (decision === "release") {
    holder.innerHTML = `<form class="form decision-form" id="decideForm">
      <label for="dNote">Any parting words? (optional)</label>
      <textarea id="dNote" rows="2" maxlength="280"></textarea>
      <button type="submit" class="btn block">Release it</button>
    </form>`;
    $("#decideForm").addEventListener("submit", (e) => {
      e.preventDefault();
      replaceItem(releaseItem(item, $("#dNote").value.trim(), today));
      save(data);
      departThenRender(item.id, "released", "Released. That was yours to decide.");
    });
  }

  holder.querySelector("textarea")?.focus();
  holder.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
}

// Close the panel, let the card animate toward its shelf, then re-render.
function departThenRender(id, kind, toastText) {
  closePanel();
  showToast(toastText);
  const el = content.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.classList.add(kind === "acted" ? "depart-acted" : "depart-released");
    el.addEventListener("animationend", () => render(), { once: true });
    setTimeout(render, 800); // safety net if the animation never fires
  } else {
    render();
  }
}

function openActedDetail(item) {
  openPanel(item.title, `
    <p class="lease-line">Done ${formatFullDate(item.closedOn)}.${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}</p>
    <div class="section-h">The journey</div>
    ${journeyHTML(item)}
    <div class="history-entry">
      <div class="history-date">Done ${formatFullDate(item.closedOn)}</div>
      ${item.closingNote ? `<blockquote class="why-quote">${esc(item.closingNote)}</blockquote>` : ""}
    </div>`);
}

function openReleasedDetail(item) {
  openPanel(item.title, `
    <p class="lease-line">Released ${formatFullDate(item.closedOn)}.${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}</p>
    <div class="section-h">The journey</div>
    ${journeyHTML(item)}
    <div class="history-entry">
      <div class="history-date">Released ${formatFullDate(item.closedOn)}</div>
      ${item.closingNote ? `<blockquote class="why-quote">${esc(item.closingNote)}</blockquote>` : ""}
    </div>
    <div class="section-h" style="margin-top:1rem">Sometimes one comes back</div>
    <div class="decisions">
      <button class="decision-btn renew-btn" data-decide="release">Lease it again<span class="sub">a new lease, its history intact</span></button>
    </div>
    <div id="decisionForm"></div>`);

  panelBody.querySelector("[data-decide='release']").addEventListener("click", (e) => {
    e.target.closest(".decision-btn").classList.add("selected");
    const holder = $("#decisionForm");
    holder.innerHTML = `<form class="form decision-form" id="decideForm">
      <label for="dWhy">It's back. Why now, in a fresh line?</label>
      <textarea id="dWhy" rows="2" required maxlength="280"></textarea>
      <div class="field-label">Lease term</div>
      ${termPickerHTML(6)}
      <button type="submit" class="btn primary block">Sign a new lease</button>
    </form>`;
    wireTermPicker(holder);
    $("#decideForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const months = getPickedMonths(holder);
      const why = $("#dWhy").value.trim();
      if (!months || !why) return;
      const updated = reLease(item, { months, why }, todayISO());
      replaceItem(updated);
      save(data);
      seatInId = item.id;
      closePanel();
      view = "active";
      render();
      showToast(`Back on the list. ${leaseSentence(months, updated.leaseEnd)}.`);
    });
    holder.querySelector("textarea").focus();
  });
}

// ---------- export / import ----------

function doExport() {
  exportFile(data);
  render();
  showToast("Backup exported. Keep the file somewhere safe.");
}

async function handleImportFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showToast("Couldn't read that file.");
    return;
  }
  const result = parseImport(text);
  if (result.error) {
    showToast(result.error);
    return;
  }
  const incoming = result.data;
  if (data.items.length === 0) {
    applyImport(incoming.items, "replace");
    return;
  }
  openImportModal(incoming);
}

function openImportModal(incoming) {
  const n = incoming.items.length;
  const m = data.items.length;
  $("#modalCard").innerHTML = `
    <div class="modal-title">Restore a backup</div>
    <p>The file holds ${n} ${n === 1 ? "item" : "items"}. You have ${m} ${m === 1 ? "item" : "items"} here already.
       Merge the two lists, or replace what's here with the file?</p>
    <div class="modal-actions">
      <button class="btn primary" id="mMerge">Merge</button>
      <button class="btn danger" id="mReplace">Replace</button>
      <button class="btn ghost" id="mCancel">Cancel</button>
    </div>`;
  $("#modalWrap").hidden = false;
  $("#mMerge").addEventListener("click", () => { closeModal(); applyImport(incoming.items, "merge"); });
  $("#mReplace").addEventListener("click", () => { closeModal(); applyImport(incoming.items, "replace"); });
  $("#mCancel").addEventListener("click", closeModal);
}

function closeModal() {
  $("#modalWrap").hidden = true;
  $("#modalCard").innerHTML = "";
}

function applyImport(items, mode) {
  data.items = mode === "merge" ? mergeItems(data.items, items) : items;
  save(data);
  view = "active";
  render();
  const n = data.items.length;
  showToast(mode === "merge"
    ? `Merged. Now holding ${n} ${n === 1 ? "item" : "items"}.`
    : `Backup restored. ${n} ${n === 1 ? "item" : "items"} on file.`);
}

// ---------- toast ----------

let toastTimer = null;
function showToast(text) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 3400);
}

// ---------- global wiring ----------

$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  view = tab.dataset.view;
  render();
});

$("#addBtn").addEventListener("click", openAddForm);
$("#panelClose").addEventListener("click", closePanel);
$("#backdrop").addEventListener("click", closePanel);
$("#exportBtn").addEventListener("click", doExport);
$("#importBtn").addEventListener("click", () => $("#importFile").click());

$("#importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) handleImportFile(file);
});

$("#modalWrap").addEventListener("click", (e) => {
  if (e.target === $("#modalWrap")) closeModal();
});

// Clicks inside the rendered content: item cards and inline action buttons.
content.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]");
  if (action) {
    if (action.dataset.action === "add") openAddForm();
    if (action.dataset.action === "import") $("#importFile").click();
    if (action.dataset.action === "export") doExport();
    return;
  }
  const card = e.target.closest("[data-id]");
  if (card) openDetail(card.dataset.id);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    closePanel();
  }
});

// A day can pass while the tab sits open; re-derive when it comes back.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && panel.hidden) render();
});

render();
