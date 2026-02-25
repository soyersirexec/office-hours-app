// server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Www1903121912-";

app.use(express.json());

// ---- Postgres connection (Supabase) ----
// IMPORTANT: On Supabase/Render you usually need SSL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create bookings table if it doesn't exist (schema matches API)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        slot TEXT PRIMARY KEY,
        name TEXT,
        booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("DB ready: bookings table ok");
  } catch (err) {
    console.error("DB init failed:", err);
  }
})();

// ---- API ----

// Frontend uses this to mark booked slots on load
app.get("/api/bookings", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, booked_at, name FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = { bookedAt: r.booked_at, name: r.name || null };
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Frontend uses this to book a slot
// If already booked -> 409
app.post("/api/book", async (req, res) => {
  const { slot, name } = req.body || {};
  if (!slot) return res.status(400).json({ ok: false, error: "Missing slot" });

  try {
    const q = `
      INSERT INTO bookings (slot, name)
      VALUES ($1, $2)
      ON CONFLICT (slot) DO NOTHING
      RETURNING slot
    `;
    const result = await pool.query(q, [slot, name || null]);

    if (result.rowCount === 0) {
      return res.status(409).json({ ok: false, error: "Already booked" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});
// Admin page (password protected) — MUST be before express.static
app.get("/admin.html", (req, res) => {
  const password = req.query.pw;
  if (password !== ADMIN_PASSWORD) return res.status(401).send("Unauthorized");
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Serve static files EXCEPT admin.html
app.use((req, res, next) => {
  if (req.path === "/admin.html") return next();
  express.static(path.join(__dirname, "public"))(req, res, next);
});
// Optional: Admin cancel booking (password protected)
app.delete("/api/cancel/:slot", async (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ message: "Unauthorized" });

  const slot = req.params.slot;
  try {
    await pool.query("DELETE FROM bookings WHERE slot = $1", [slot]);
    res.json({ message: "Booking cancelled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "db_error" });
  }
});
// Backward-compatible: old admin page expects /api/slots
app.get("/api/slots", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT slot, name FROM bookings");
    const out = {};
    for (const r of rows) out[r.slot] = r.name || null;
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Self-ping (Render)
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL)
      .then(() => console.log("Self ping successful"))
      .catch((err) => console.log("Self ping failed:", err.message));
  }, 4 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});