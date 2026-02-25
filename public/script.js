document.addEventListener("DOMContentLoaded", () => {
  // booking
  const slots = document.querySelectorAll(".slot");
  slots.forEach((slot) => {
    slot.addEventListener("click", () => {
      const confirmed = confirm(`Book this slot: ${slot.textContent}?`);
      if (!confirmed) return;

      slot.classList.remove("bg-green-500", "hover:bg-green-600");
      slot.classList.add("bg-gray-400", "cursor-not-allowed", "opacity-80");
      slot.disabled = true;
    });
  });

  // pagination
  const grid = document.getElementById("daysGrid");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageInfo = document.getElementById("pageInfo");

  if (!grid || !prevBtn || !nextBtn || !pageInfo) return;

  const cards = Array.from(grid.children);
  const perPage = 6;
  let page = 1;
  const totalPages = Math.max(1, Math.ceil(cards.length / perPage));

  function render() {
    const start = (page - 1) * perPage;
    const end = start + perPage;

    cards.forEach((card, i) => {
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

  function goPrev() {
    if (page > 1) {
      page--;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goNext() {
    if (page < totalPages) {
      page++;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);

  // swipe (mobile)
  let startX = 0;
  let startY = 0;

  grid.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
  }, { passive: true });

  grid.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // ignore vertical scroll gestures
    if (Math.abs(dy) > Math.abs(dx)) return;

    // need a real swipe
    if (Math.abs(dx) < 60) return;

    if (dx < 0) goNext(); // swipe left
    else goPrev();        // swipe right
  }, { passive: true });

  render();
});