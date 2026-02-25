const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const db = new sqlite3.Database("bookings.db");

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT UNIQUE,
    name TEXT
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Get all bookings
app.get("/api/slots", (req, res) => {
  db.all("SELECT slot, name FROM bookings", [], (err, rows) => {
    if (err) return res.status(500).json(err);

    const bookings = {};
    rows.forEach(r => bookings[r.slot] = r.name);
    res.json(bookings);
  });
});

// Book a slot
app.post("/api/book", (req, res) => {
  const { slot, name } = req.body;

  db.run(
    "INSERT INTO bookings (slot, name) VALUES (?, ?)",
    [slot, name],
    function(err) {
      if (err) {
        return res.status(400).json({ message: "Slot already booked" });
      }
      res.json({ message: "Booking confirmed" });
    }
  );
});

// Cancel booking
app.delete("/api/cancel/:slot", (req, res) => {
  const slot = req.params.slot;

  db.run("DELETE FROM bookings WHERE slot = ?", [slot], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Booking cancelled" });
  });
});

// Self-ping to reduce sleeping
const SELF_URL = process.env.RENDER_EXTERNAL_URL;

if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log("Self ping successful"))
      .catch(err => console.log("Self ping failed:", err.message));
  }, 4 * 60 * 1000); // every 4 minutes
}
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});