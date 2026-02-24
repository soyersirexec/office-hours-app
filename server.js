const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

app.use(express.static(path.join(__dirname, "public")));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const db = new sqlite3.Database("bookings.db");

db.run(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT UNIQUE,
    name TEXT
  )
`);

app.get("/api/slots", (req, res) => {
  db.all("SELECT slot, name FROM bookings", [], (err, rows) => {
    if (err) return res.status(500).json(err);

    const bookings = {};
    rows.forEach(r => bookings[r.slot] = r.name);
    res.json(bookings);
  });
});

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

app.delete("/api/cancel/:slot", (req, res) => {
  const slot = req.params.slot;

  db.run("DELETE FROM bookings WHERE slot = ?", [slot], function(err) {
    if (err) return res.status(500).json(err);
    res.json({ message: "Booking cancelled" });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});