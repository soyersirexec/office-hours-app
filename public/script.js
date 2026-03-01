let notifyTimer = null;
function showManageLink(token) {
  const url = `${location.origin}/manage.html?token=${encodeURIComponent(token)}`;

  // reuse your existing notify if you want, otherwise basic alert:
  if (typeof showNotify === "function") {
    showNotify("Booked ✅", `Manage / cancel / change: ${url}`);
    return;
  }

  window.prompt("Manage / cancel / change link (copy):", url);
}
function notify({ type = "info", title = "Notice", message = "", ms } = {}) {
  const wrap = document.getElementById("notify");
  const card = document.getElementById("notifyCard");
  const icon = document.getElementById("notifyIcon");
  const t = document.getElementById("notifyTitle");
  const m = document.getElementById("notifyMsg");
  const close = document.getElementById("notifyClose");

  if (!wrap || !card || !icon || !t || !m || !close) return;

  // reset classes
  card.classList.remove("notify-success", "notify-error", "notify-warn", "notify-info");
  card.classList.add(
    type === "success" ? "notify-success" :
    type === "error" ? "notify-error" :
    type === "warn" ? "notify-warn" : "notify-info"
  );

  icon.textContent =
    type === "success" ? "✅" :
    type === "error" ? "⛔" :
    type === "warn" ? "⚠️" : "ℹ️";

  t.textContent = title;
  m.textContent = message;

  // show
  wrap.classList.remove("hidden");

  function hide() {
    wrap.classList.add("hidden");
  }

  // ALWAYS ensure close works (overwrite handler cleanly)
  close.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (notifyTimer) clearTimeout(notifyTimer);
    hide();
  };

  // click outside the card closes too
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      if (notifyTimer) clearTimeout(notifyTimer);
      hide();
    }
  };

  // ESC closes
  document.onkeydown = (e) => {
    if (e.key === "Escape" && !wrap.classList.contains("hidden")) {
      if (notifyTimer) clearTimeout(notifyTimer);
      hide();
    }
  };

  // auto-hide only if ms is a number > 0
  if (notifyTimer) clearTimeout(notifyTimer);
  if (typeof ms === "number" && ms > 0) {
    notifyTimer = setTimeout(hide, ms);
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".sc-check-btn").forEach((btn) => {
  btn.addEventListener("click", checkAppointmentFlow);
});
  const grid = document.getElementById("daysGrid");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInfo = document.getElementById("pageInfo");
  const pagerWrap = document.getElementById("pagerWrap");

  if (!grid || !prevBtn || !nextBtn || !pageInfo) return;

  function getISOWeekKey(yyyy_mm_dd) {
    const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const weekYear = date.getUTCFullYear();

    const firstThu = new Date(Date.UTC(weekYear, 0, 4));
    const firstDay = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);

    const weekNo = 1 + Math.round((date - firstThu) / (7 * 24 * 3600 * 1000));
    return `${weekYear}-W${String(weekNo).padStart(2, "0")}`;
  }

  function getCardDate(card) {
    const s = card.querySelector(".slot[data-slot]");
    if (!s) return null;
    return s.dataset.slot.slice(0, 10);
  }

  function disableSlot(btn, strong = false) {
    btn.classList.remove(
      "bg-green-500",
      "hover:bg-green-600",
      "bg-emerald-500",
      "hover:bg-emerald-600",
      "active:scale-95"
    );
    btn.classList.add(
      strong ? "bg-gray-400" : "bg-gray-200",
      "cursor-not-allowed",
      strong ? "opacity-80" : "opacity-70"
    );
    btn.disabled = true;
  }

  function showToastNear(element, message) {
    const toast = document.getElementById("toast");
    const text = document.getElementById("toastText");
    if (!toast || !text) return;

    text.textContent = message;

    const rect = element.getBoundingClientRect();
    toast.style.top = `${window.scrollY + rect.top - 42}px`;
    toast.style.left = `${rect.left}px`;

    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 1800);
  }

  // --------- Modern profile modal (no prompts) ----------
  const PROFILE_KEY = "booking_student_profile_v1";

  function getSavedProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      if (p?.name && p?.studentNo && p?.email) return p;
    } catch {}
    return null;
  }

  function saveProfile(p) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }

  function clearProfile() {
    localStorage.removeItem(PROFILE_KEY);
  }

  function openProfileModal({ force = false, errorText = "" } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("profileModal");
      const form = document.getElementById("profileForm");
      const nameEl = document.getElementById("pfName");
      const snEl = document.getElementById("pfStudentNo");
      const emailEl = document.getElementById("pfEmail");
      const errEl = document.getElementById("pfError");
      const cancelBtn = document.getElementById("pfCancel");

      const existing = !force ? getSavedProfile() : null;
      if (existing) return resolve(existing);

      errEl.classList.toggle("hidden", !errorText);
      errEl.textContent = errorText || "";
      nameEl.value = "";
      snEl.value = "";
      emailEl.value = "";

      modal.classList.remove("hidden");
      nameEl.focus();

      function close(val) {
        modal.classList.add("hidden");
        form.removeEventListener("submit", onSubmit);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(val);
      }

      function onCancel() {
        close(null);
      }

      function onSubmit(e) {
        e.preventDefault();
        const profile = {
          name: nameEl.value.trim(),
          studentNo: snEl.value.trim().replace(/\s+/g, "").toUpperCase(),
          email: emailEl.value.trim().toLowerCase(),
        };
        if (!profile.name || !profile.studentNo || !profile.email) {
          errEl.textContent = "Please fill all fields.";
          errEl.classList.remove("hidden");
          return;
        }
        saveProfile(profile);
        close(profile);
      }

      form.addEventListener("submit", onSubmit);
      cancelBtn.addEventListener("click", onCancel);
    });
  }
  // masking
  function maskName(full) {
  if (!full) return "";

  return full
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + "***")
    .join(" ");
}
  // ---- Disable past dates ----
  
  // ---- Tabs: Available / Previous ----
  const availableTab = document.getElementById("tab-available");
  const previousTab = document.getElementById("tab-previous");
  const tabBtnAvailable = document.getElementById("tabBtnAvailable");
  const tabBtnPrevious = document.getElementById("tabBtnPrevious");
  const previousCountEl = document.getElementById("previousCount");
  const previousGrid = document.getElementById("previousDaysGrid");
  const availableEmpty = document.getElementById("availableEmpty");
  const previousEmpty = document.getElementById("previousEmpty");

  let activeTabName = "available"; // ✅ always start on Available

  function setActiveTab(name) {
    activeTabName = name === "previous" ? "previous" : "available";

    if (availableTab) availableTab.classList.toggle("hidden", activeTabName !== "available");
    if (previousTab) previousTab.classList.toggle("hidden", activeTabName !== "previous");

    // button styles
    if (tabBtnAvailable) {
      tabBtnAvailable.classList.toggle("border-blue-700", activeTabName === "available");
      tabBtnAvailable.classList.toggle("text-blue-700", activeTabName === "available");
      tabBtnAvailable.classList.toggle("border-transparent", activeTabName !== "available");
      tabBtnAvailable.classList.toggle("text-gray-600", activeTabName !== "available");
    }
    if (tabBtnPrevious) {
      tabBtnPrevious.classList.toggle("border-blue-700", activeTabName === "previous");
      tabBtnPrevious.classList.toggle("text-blue-700", activeTabName === "previous");
      tabBtnPrevious.classList.toggle("border-transparent", activeTabName !== "previous");
      tabBtnPrevious.classList.toggle("text-gray-600", activeTabName !== "previous");
    }

    // reset paging when switching tabs
    page = 1;
    render();
    document.getElementById("appointmentsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  tabBtnAvailable?.addEventListener("click", () => setActiveTab("available"));
  tabBtnPrevious?.addEventListener("click", () => setActiveTab("previous"));

  // ---- Move past days into "Previous" tab + disable them ----
  function movePastDays() {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const allCards = Array.from(document.querySelectorAll(".day-card"));
    let moved = 0;

    allCards.forEach((card) => {
      const first = card.querySelector(".slot[data-slot]");
      if (!first) return;

      const d = first.dataset.slot.slice(0, 10);
      const [y, m, day] = d.split("-").map(Number);
      const cardDate = new Date(y, m - 1, day);
      cardDate.setHours(0, 0, 0, 0);

      if (cardDate < todayDate) {
        // disable all slots on this past day
        card.querySelectorAll(".slot").forEach((btn) => disableSlot(btn, false));
        card.classList.add("past-day");

        // move to previous grid (if present)
        if (previousGrid) {
          previousGrid.appendChild(card);
          moved++;
        }
      }
    });

    // count after move
    const previousCount = previousGrid?.querySelectorAll(".day-card").length || 0;
    if (previousCountEl) previousCountEl.textContent = String(previousCount);

    // hide Previous tab when empty
    if (tabBtnPrevious) tabBtnPrevious.classList.toggle("hidden", previousCount === 0);
    if (activeTabName === "previous" && previousCount === 0) setActiveTab("available");

    // empty states
    const availableCount = document.getElementById("daysGrid")?.querySelectorAll(".day-card").length || 0;
    if (availableEmpty) availableEmpty.classList.toggle("hidden", availableCount !== 0);

    const previousCount2 = previousGrid?.querySelectorAll(".day-card").length || 0;
    if (previousEmpty) previousEmpty.classList.toggle("hidden", previousCount2 !== 0);
  }
  movePastDays();


  // ---- Load booked slot IDs from server + apply on UI ----
  // /api/availability returns: { booked: ["YYYY-MM-DDTHH:mm", ...] }
  let bookedSet = new Set();

  async function loadBookedFromServer() {
    try {
      const resp = await fetch("/api/availability", { cache: "no-store" });
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data?.booked) ? data.booked : [];
    } catch {
      return [];
    }
  }

  function applyBookedToUI() {
    document.querySelectorAll(".slot[data-slot]").forEach((btn) => {
      const isBooked = bookedSet.has(btn.dataset.slot);
      if (isBooked) {
        disableSlot(btn, true);
        btn.classList.add("booked-slot");
        btn.title = "Booked";
      } else {
        // Don't re-enable past-day disabled buttons
        if (!btn.closest(".past-day")) {
          btn.disabled = false;
          btn.classList.remove("cursor-not-allowed", "opacity-80", "opacity-70", "bg-gray-400", "bg-gray-200");
          // restore your green styling (both variants used in your CSS)
          btn.classList.add("bg-green-500", "hover:bg-green-600", "active:scale-95");
        }
        btn.classList.remove("booked-slot");
        btn.title = "";
      }
    });
  }

  // initial load
  bookedSet = new Set(await loadBookedFromServer());
  applyBookedToUI();

  // keep availability fresh without requiring refresh ("live-ish")
  setInterval(async () => {
    const latest = await loadBookedFromServer();
    // avoid churn if nothing changed
    if (latest.length !== bookedSet.size || latest.some((s) => !bookedSet.has(s))) {
      bookedSet = new Set(latest);
      applyBookedToUI();
    }
  }, 10000);

  // ---- Click booking ----
  document.querySelectorAll(".slot[data-slot]").forEach((slot) => {
    slot.addEventListener("click", async () => {
      if (slot.disabled) return;

      // Block if this specific slot is already booked (client-side fast path)
      if (bookedSet.has(slot.dataset.slot)) {
        disableSlot(slot, true);
        slot.classList.add("booked-slot");
        slot.title = "Booked";
        notify({
          type: "warn",
          title: "Slot taken",
          message: "That time slot is already booked. Please choose another.",
        });
        return;
      }

      // Always ask for student info (shared device friendly)
      const profile = await openProfileModal({ force: true });
      if (!profile) return;

  let resp;
  try {
    resp = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot: slot.dataset.slot,
        name: profile.name,
        studentNo: profile.studentNo,
        email: profile.email,
      }),
    });
  } catch {
    notify({
      type: "error",
      title: "Connection problem",
      message: "Cannot reach the server. Check your internet and try again.",
      ms: 6000,
    });
    return;
  }

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    // Not allowed -> retry modal
    if (resp.status === 403 && data?.error === "Not allowed") {
      notify({
        type: "error",
        title: "Not allowed",
        message: "Student number not found in the allowed list.",
        ms: 6000,
      });
      clearProfile();
      await openProfileModal({
        force: true,
        errorText: "Student number not found. Try again.",
      });
      return;
    }

    if (resp.status === 409 && data?.error === "Already booked once") {
      notify({
        type: "error",
        title: "Already booked",
        message: "This student number has already booked a slot.",
        ms: 6000,
      });
      return;
    }

    // Slot just got taken by someone else — update UI immediately
    if (resp.status === 409 && data?.error === "Already booked") {
      bookedSet.add(slot.dataset.slot);
      applyBookedToUI();
      notify({
        type: "warn",
        title: "Slot taken",
        message: "Someone booked that slot just now. Please pick another time.",
        ms: 6000,
      });
      return;
    }

    if (resp.status === 409 && data?.error === "Slot already booked") {
      bookedSet.add(slot.dataset.slot);
      applyBookedToUI();
      notify({
        type: "warn",
        title: "Slot taken",
        message: "That time slot is already booked. Please choose another.",
        ms: 6000,
      });
      return;
    }

    if (resp.status === 500 && data?.error === "db_error") {
      notify({
        type: "error",
        title: "Server error",
        message: "Database error. Please try again in a moment.",
        ms: 7000,
      });
      return;
    }

    notify({
      type: "error",
      title: "Booking failed",
      message: data?.error || `Cannot book (${resp.status})`,
      ms: 6000,
    });
    return;
  }

  // Success — update local availability immediately
  bookedSet.add(slot.dataset.slot);
  applyBookedToUI();

  notify({
    type: "success",
    title: "Booked",
    message: "Your slot has been reserved.",
    ms: 5000,
  });
});
});

  // ---- Pagination by day cards (Available / Previous) ----
  const perPage = 2;
  let page = 1;

  function getActiveGrid() {
    return activeTabName === "previous" && previousGrid ? previousGrid : grid;
  }

  function getActiveCards() {
    const g = getActiveGrid();
    if (!g) return [];
    return Array.from(g.querySelectorAll(".day-card"));
  }

  function render() {
    const cards = getActiveCards();
    const totalPages = Math.max(1, Math.ceil(cards.length / perPage));

    if (page > totalPages) page = totalPages;

    const start = (page - 1) * perPage;
    const end = start + perPage;

    cards.forEach((card, i) => {
      card.style.display = i >= start && i < end ? "" : "none";
    });

    // hide cards in the non-active grid (so switching tabs doesn't show stale page)
    const otherGrid = getActiveGrid() === grid ? previousGrid : grid;
    if (otherGrid) otherGrid.querySelectorAll(".day-card").forEach((c) => (c.style.display = ""));

    // pager text
    pageInfo.textContent = cards.length ? `Page ${page} / ${totalPages}` : "";

    const disablePager = cards.length === 0;
    if (pagerWrap) pagerWrap.classList.toggle("hidden", disablePager);
    prevBtn.disabled = disablePager || page === 1;
    nextBtn.disabled = disablePager || page === totalPages;

    prevBtn.classList.toggle("opacity-50", prevBtn.disabled);
    prevBtn.classList.toggle("cursor-not-allowed", prevBtn.disabled);
    nextBtn.classList.toggle("opacity-50", nextBtn.disabled);
    nextBtn.classList.toggle("cursor-not-allowed", nextBtn.disabled);
  }

  prevBtn.addEventListener("click", () => {
    if (page > 1) {
      page--;
      render();
      document.getElementById("appointmentsSection")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  nextBtn.addEventListener("click", () => {
    const cards = getActiveCards();
    const totalPages = Math.max(1, Math.ceil(cards.length / perPage));
    if (page < totalPages) {
      page++;
      render();
      document.getElementById("appointmentsSection")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

function openCheckModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById("checkModal");
    const form = document.getElementById("checkForm");
    const snEl = document.getElementById("checkStudentNo");
    const errEl = document.getElementById("checkError");
    const cancelBtn = document.getElementById("checkCancel");

    errEl.classList.add("hidden");
    errEl.textContent = "";
    snEl.value = "";

    modal.classList.remove("hidden");
    snEl.focus();

    function close(val) {
      modal.classList.add("hidden");
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(val);
    }

    function onCancel() { close(null); }

    function onSubmit(e) {
      e.preventDefault();
      const sn = snEl.value.trim();
      if (!sn) {
        errEl.textContent = "Please enter your student number.";
        errEl.classList.remove("hidden");
        return;
      }
      close(sn);
    }

    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
  });
}

async function checkAppointmentFlow() {
  const studentNo = await openCheckModal();
  if (!studentNo) return;

  let resp;
  try {
    resp = await fetch(`/api/appointment/${encodeURIComponent(studentNo)}`, { cache: "no-store" });
  } catch {
    notify({ type: "error", title: "Connection problem", message: "Cannot reach the server. Try again.", ms: 6000 });
    return;
  }

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    if (resp.status === 404 && data?.error === "not_found") {
      notify({ type: "warn", title: "No booking found", message: "No appointment exists for this student number.", ms: 6000 });
      return;
    }
    notify({ type: "error", title: "Check failed", message: data?.error || `Error (${resp.status})`, ms: 6000 });
    return;
  }

  const b = data.booking || {};
  notify({
  type: "success",
  title: "Appointment found",
  message: `Slot: ${b.slot} • Name: ${b.name || ""}`,
  ms: 0, // ✅ stays until dismissed
});
}
  render();
  window.addEventListener("load", render);
});