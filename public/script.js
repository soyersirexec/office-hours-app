document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("daysGrid");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInfo = document.getElementById("pageInfo");
  if (!grid || !prevBtn || !nextBtn || !pageInfo) return;

  function getISOWeekKey(yyyy_mm_dd) {
    const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    date.setUTCDate(date.getUTCDate() - day + 3); // move to Thursday
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
    return s.dataset.slot.slice(0, 10); // YYYY-MM-DD
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

  function applyWeekRuleFromDayCard(dayCard, chosenSlotBtn) {
    if (!dayCard) return;

    // disable other slots in same day
    dayCard.querySelectorAll(".slot").forEach((btn) => {
      if (btn !== chosenSlotBtn) disableSlot(btn, false);
    });

    // disable other day in same week
    const dateStr = getCardDate(dayCard);
    if (!dateStr) return;
    const weekKey = getISOWeekKey(dateStr);

    document.querySelectorAll(".day-card").forEach((card) => {
      if (card === dayCard) return;
      const d = getCardDate(card);
      if (!d) return;
      if (getISOWeekKey(d) !== weekKey) return;

      card.querySelectorAll(".slot").forEach((btn) => disableSlot(btn, false));
    });
  }

  // ---- Disable past dates (no duplicates / no const re-declare issues) ----
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

  // Apply server bookings (treat as "booked" and lock the whole week like your rule)
  document.querySelectorAll(".slot[data-slot]").forEach((btn) => {
    if (btn.disabled) return; // already disabled by past-date rule
    if (serverBooked[btn.dataset.slot]) {
      disableSlot(btn, true);
      const dayCard = btn.closest(".day-card");
      applyWeekRuleFromDayCard(dayCard, btn);
    }
  });

  // ---- Click booking (POST first, then update UI) ----
  document.querySelectorAll(".slot").forEach((slot) => {
    slot.addEventListener("click", async () => {
      if (slot.disabled) return;

      // if already known booked locally
      if (serverBooked[slot.dataset.slot]) {
        disableSlot(slot, true);
        showToastNear(slot, "Already booked");
        const dayCard = slot.closest(".day-card");
        applyWeekRuleFromDayCard(dayCard, slot);
        return;
      }

      let ok = false;

      try {
        const res = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: slot.dataset.slot })
        });

        if (res.ok) ok = true;
        else ok = false;
      } catch {
        ok = false;
      }

      if (!ok) {
        // if someone else booked it
        disableSlot(slot, true);
        serverBooked[slot.dataset.slot] = { bookedAt: Date.now() };
        showToastNear(slot, "Already booked");
        const dayCard = slot.closest(".day-card");
        applyWeekRuleFromDayCard(dayCard, slot);
        return;
      }

      // success
      serverBooked[slot.dataset.slot] = { bookedAt: Date.now() };
      disableSlot(slot, true);
      showToastNear(slot, "Booked");

      const dayCard = slot.closest(".day-card");
      applyWeekRuleFromDayCard(dayCard, slot);
    });
  });

  // ---- Group into week boxes (outline) ----
  const dayCards = Array.from(grid.querySelectorAll(".day-card"));
  const groups = new Map();

  dayCards.forEach((card) => {
    const d = getCardDate(card);
    if (!d) return;
    const key = getISOWeekKey(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  grid.innerHTML = "";

  for (const [, cards] of groups.entries()) {
    const box = document.createElement("div");
    box.className = "week-group border-2 border-gray-400 rounded-2xl p-5 bg-white shadow-md";

    const inner = document.createElement("div");
    inner.className = "grid grid-cols-1 md:grid-cols-2 gap-6 items-start";

    cards.forEach((c) => inner.appendChild(c));
    box.appendChild(inner);
    grid.appendChild(box);
  }

  // ---- Pagination: 2 weeks per page ----
  const weekBoxes = Array.from(document.querySelectorAll("#daysGrid .week-group"));
  const perPage = 2;
  let page = 1;
  const totalPages = Math.max(1, Math.ceil(weekBoxes.length / perPage));

  function render() {
    const start = (page - 1) * perPage;
    const end = start + perPage;

    weekBoxes.forEach((box, i) => {
      box.style.display = i >= start && i < end ? "" : "none";
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