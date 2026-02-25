// Quick admin password
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "karakartal94";
const express = require("express");
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table if it doesn't exist
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      slot TEXT UNIQUE,
      name TEXT
    )
  `);
})();
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
// Serve all public files EXCEPT admin.html
app.use((req, res, next) => {
  if (req.path === "/admin.html") return next(); // skip for admin
  express.static(path.join(__dirname, "public"))(req, res, next);
});
aapp.get("/admin.html", (req, res) => {
  const password = req.query.pw;
  if (password !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Get all bookings
app.get("/api/slots", (req, res) => {
  app.get("/api/slots", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, name FROM bookings");
    const bookings = {};
    rows.forEach(r => bookings[r.slot] = r.name);
    res.json(bookings);
  } catch (err) {
    res.status(500).json(err);
  }
});
});

// Book a slot
app.post("/api/book", (req, res) => {
  const { slot, name } = req.body;

  app.post("/api/book", async (req, res) => {
  const { slot, name } = req.body;
  try {
    await pool.query(
      "INSERT INTO bookings (slot, name) VALUES ($1, $2)",
      [slot, name]
    );
    res.json({ message: "Booking confirmed" });
  } catch (err) {
    res.status(400).json({ message: "Slot already booked" });
  }
});
});

// Cancel booking
app.delete("/api/cancel/:slot", async (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ message: "Unauthorized" });

  const slot = req.params.slot;
  try {
    await pool.query("DELETE FROM bookings WHERE slot = $1", [slot]);
    res.json({ message: "Booking cancelled" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// Self-ping to reduce sleeping
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log("Self ping successful"))
      .catch(err => console.log("Self ping failed:", err.message));
  }, 4 * 60 * 1000);
}
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});