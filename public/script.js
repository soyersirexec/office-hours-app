document.addEventListener("DOMContentLoaded", () => {
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
});