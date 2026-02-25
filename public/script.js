const slots = document.querySelectorAll(".slot");

slots.forEach(slot => {
  slot.addEventListener("click", () => {
    const confirmed = confirm(`Book this slot: ${slot.textContent}?`);
    if (confirmed) {
      slot.classList.remove("bg-green-500");
      slot.classList.add("bg-red-500");
      slot.disabled = true;
      // TODO: connect to backend to save booking
    }
  });
});