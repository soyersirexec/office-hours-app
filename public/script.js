let notifyTimer = null;

function notify({ type = "info", title = "Notice", message = "", ms = 4000 } = {}) {
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

  wrap.classList.remove("hidden");

  const hide = () => wrap.classList.add("hidden");

  close.onclick = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    hide();
  };

  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(hide, ms);
}
document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("daysGrid");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInfo = document.getElementById("pageInfo");
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
          studentNo: snEl.value.trim(),
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
  (function disablePastDates() {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    document.querySelectorAll(".day-card").forEach((card) => {
      const first = card.querySelector(".slot[data-slot]");
      if (!first) return;

      const d = first.dataset.slot.slice(0, 10);
      const [y, m, day] = d.split("-").map(Number);
      const cardDate = new Date(y, m - 1, day);
      cardDate.setHours(0, 0, 0, 0);

      if (cardDate < todayDate) {
        card.querySelectorAll(".slot").forEach((btn) => disableSlot(btn, false));
      }
    });
  })();

  // ---- Load bookings from server + apply on UI ----
  let serverBooked = {};

  async function loadBookedFromServer() {
    try {
      const resp = await fetch("/api/bookings", { cache: "no-store" });
      if (!resp.ok) return {};
      return await resp.json();
    } catch {
      return {};
    }
  }

  serverBooked = await loadBookedFromServer();

  // Apply server bookings (disable ONLY the booked slot)
  document.querySelectorAll(".slot[data-slot]").forEach((btn) => {
  const booking = serverBooked[btn.dataset.slot];

  if (booking) {
    disableSlot(btn, true);
    btn.classList.add("booked-slot");

    if (booking.name) {
  btn.title = `Booked by: ${maskName(booking.name)}`;
} else {
  btn.title = "Booked";
}
  } else {
    btn.classList.remove("booked-slot"); // 🔥 ensure free slots stay clean
    btn.title = "";
  }
});

  // ---- Click booking ----
  document.querySelectorAll(".slot[data-slot]").forEach((slot) => {
    slot.addEventListener("click", async () => {
  if (slot.disabled) return;

  // Block if this specific slot is already booked
  if (serverBooked[slot.dataset.slot]) {
    slot.classList.add("booked-slot");   // 🔒 add only here
slot.title = `Booked by: ${maskName(profile.name)}`;
    disableSlot(slot, true);
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

    if (resp.status === 409 && data?.error === "Slot already booked") {
      disableSlot(slot, true);
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

  // Success
  serverBooked[slot.dataset.slot] = { bookedAt: Date.now(), name: profile.name };
  slot.title = `Booked by: ${profile.name}`;
  disableSlot(slot, true);

  notify({
    type: "success",
    title: "Booked",
    message: "Your slot has been reserved.",
    ms: 5000,
  });
});
});

  // ---- Pagination by day cards (no week grouping) ----
  const dayCards = Array.from(grid.querySelectorAll(".day-card"));
  const perPage = 2;
  let page = 1;
  const totalPages = Math.max(1, Math.ceil(dayCards.length / perPage));

  function render() {
    const start = (page - 1) * perPage;
    const end = start + perPage;

    dayCards.forEach((card, i) => {
      card.style.display = i >= start && i < end ? "" : "none";
    });

    pageInfo.textContent = `Page ${page} / ${totalPages}`;

    prevBtn.disabled = page === 1;
    nextBtn.disabled = page === totalPages;

    prevBtn.classList.toggle("opacity-50", prevBtn.disabled);
    prevBtn.classList.toggle("cursor-not-allowed", prevBtn.disabled);
    nextBtn.classList.toggle("opacity-50", nextBtn.disabled);
    nextBtn.classList.toggle("cursor-not-allowed", nextBtn.disabled);
  }

  prevBtn.addEventListener("click", () => {
    if (page > 1) {
      page--;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  nextBtn.addEventListener("click", () => {
    if (page < totalPages) {
      page++;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  render();
  window.addEventListener("load", render);
});