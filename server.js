// server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1994";

app.use(express.json());

// Serve static files (except admin.html)
app.use((req, res, next) => {
  if (req.path === "/admin.html") return next(); // skip admin
  express.static(path.join(__dirname, "public"))(req, res, next);
});

// Postgres connection (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Supabase
});

// Create bookings table if it doesn't exist
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      slot TEXT UNIQUE,
      name TEXT
    )
  `);
})();

// Get all bookings
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

// Book a slot
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

// Cancel booking (admin only)
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

// Admin page (password protected)
app.get("/admin.html", (req, res) => {
  const password = req.query.pw;
  if (password !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Self-ping to keep free Render instance awake
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