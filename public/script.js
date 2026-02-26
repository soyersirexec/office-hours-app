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

  function getStudentKey() {
    const keyName = "ampas_student_key_v1";
    let key = localStorage.getItem(keyName);
    if (key && key.trim()) return key;

    key = prompt("Enter your Student Number (one-time):");
    if (!key || !key.trim()) return null;

    key = key.trim();
    localStorage.setItem(keyName, key);
    return key;
  }
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

    // reset + show
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
      const res = await fetch("/api/bookings", { cache: "no-store" });
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  serverBooked = await loadBookedFromServer();

  // Apply server bookings (disable ONLY the booked slot)
  document.querySelectorAll(".slot[data-slot]").forEach((btn) => {
    if (btn.disabled) return;
    if (serverBooked[btn.dataset.slot]) disableSlot(btn, true);
  });

  // ---- Click booking (DB enforces "one booking per student") ----
  document.querySelectorAll(".slot[data-slot]").forEach((slot) => {
    slot.addEventListener("click", async () => {
      if (slot.disabled) return;

      const studentKey = getStudentKey();
      if (!studentKey) return;

      if (serverBooked[slot.dataset.slot]) {
        disableSlot(slot, true);
        showToastNear(slot, "Already booked");
        return;
      }

      let res;
      try {
        res = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: slot.dataset.slot, studentKey })
        });
      } catch {
        showToastNear(slot, "Network error");
        return;
      }

      if (!res.ok) {
        let msg = "Cannot book";
        try {
          const j = await res.json();
          if (j && j.error === "You already booked once") msg = "You already booked once";
          else if (j && (j.error === "Slot already booked" || j.error === "Already booked")) msg = "Slot already booked";
        } catch {}
        showToastNear(slot, msg);
        return;
      }

      serverBooked[slot.dataset.slot] = { bookedAt: Date.now() };
      disableSlot(slot, true);
      showToastNear(slot, "Booked");
    });
  });

  // ---- Pagination by day cards (no week grouping) ----
  const dayCards = Array.from(grid.querySelectorAll(".day-card"));
  const perPage = 6; // change if you want (4, 8, 10...)
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