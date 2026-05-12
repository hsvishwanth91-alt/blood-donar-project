const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "donors.json");

// ─────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serve frontend if any

// ─────────────────────────────────────────
// Helper: Read & Write JSON file
// ─────────────────────────────────────────
function readDonors() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  }
  const data = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(data);
}

function writeDonors(donors) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(donors, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────

// GET / — Health check
app.get("/api", (req, res) => {
  res.json({ message: "Blood Donor Finder API is running 🩸" });
});

// ─────────────────────────────────────────
// 1. Register a new donor
// POST /api/donors
// Body: { name, bloodGroup, city, phone, age, available }
// ─────────────────────────────────────────
app.post("/api/donors", (req, res) => {
  const { name, bloodGroup, city, phone, age, available } = req.body;

  // Validation
  if (!name || !bloodGroup || !city || !phone || !age) {
    return res.status(400).json({ error: "All fields are required: name, bloodGroup, city, phone, age" });
  }

  const validBloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  if (!validBloodGroups.includes(bloodGroup.toUpperCase())) {
    return res.status(400).json({ error: `Invalid blood group. Valid options: ${validBloodGroups.join(", ")}` });
  }

  const donors = readDonors();

  // Check if phone already registered
  const existing = donors.find((d) => d.phone === phone);
  if (existing) {
    return res.status(409).json({ error: "A donor with this phone number is already registered." });
  }

  const newDonor = {
    id: generateId(),
    name: name.trim(),
    bloodGroup: bloodGroup.toUpperCase(),
    city: city.trim().toLowerCase(),
    phone: phone.trim(),
    age: Number(age),
    available: available !== undefined ? available : true,
    registeredAt: new Date().toISOString(),
  };

  donors.push(newDonor);
  writeDonors(donors);

  res.status(201).json({ message: "Donor registered successfully!", donor: newDonor });
});

// ─────────────────────────────────────────
// 2. Get all donors
// GET /api/donors
// ─────────────────────────────────────────
app.get("/api/donors", (req, res) => {
  const donors = readDonors();
  res.json({ total: donors.length, donors });
});

// ─────────────────────────────────────────
// 3. Search donors by blood group and/or city
// GET /api/donors/search?bloodGroup=A+&city=patna
// ─────────────────────────────────────────
app.get("/api/donors/search", (req, res) => {
  const { bloodGroup, city } = req.query;

  if (!bloodGroup && !city) {
    return res.status(400).json({ error: "Provide at least one search param: bloodGroup or city" });
  }

  let donors = readDonors();

  // Filter by blood group
  if (bloodGroup) {
    donors = donors.filter(
      (d) => d.bloodGroup === bloodGroup.toUpperCase() && d.available === true
    );
  }

  // Filter by city
  if (city) {
    donors = donors.filter(
      (d) => d.city === city.trim().toLowerCase() && d.available === true
    );
  }

  if (donors.length === 0) {
    return res.status(404).json({ message: "No available donors found for the given criteria." });
  }

  res.json({ total: donors.length, donors });
});

// ─────────────────────────────────────────
// 4. Get a single donor by ID
// GET /api/donors/:id
// ─────────────────────────────────────────
app.get("/api/donors/:id", (req, res) => {
  const donors = readDonors();
  const donor = donors.find((d) => d.id === req.params.id);

  if (!donor) {
    return res.status(404).json({ error: "Donor not found." });
  }

  res.json(donor);
});

// ─────────────────────────────────────────
// 5. Update donor info or availability
// PUT /api/donors/:id
// Body: any field(s) to update
// ─────────────────────────────────────────
app.put("/api/donors/:id", (req, res) => {
  const donors = readDonors();
  const index = donors.findIndex((d) => d.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Donor not found." });
  }

  const allowedFields = ["name", "bloodGroup", "city", "phone", "age", "available"];
  const updates = req.body;

  allowedFields.forEach((field) => {
    if (updates[field] !== undefined) {
      if (field === "bloodGroup") {
        donors[index][field] = updates[field].toUpperCase();
      } else if (field === "city") {
        donors[index][field] = updates[field].toLowerCase();
      } else {
        donors[index][field] = updates[field];
      }
    }
  });

  donors[index].updatedAt = new Date().toISOString();
  writeDonors(donors);

  res.json({ message: "Donor updated successfully!", donor: donors[index] });
});

// ─────────────────────────────────────────
// 6. Delete a donor
// DELETE /api/donors/:id
// ─────────────────────────────────────────
app.delete("/api/donors/:id", (req, res) => {
  let donors = readDonors();
  const exists = donors.find((d) => d.id === req.params.id);

  if (!exists) {
    return res.status(404).json({ error: "Donor not found." });
  }

  donors = donors.filter((d) => d.id !== req.params.id);
  writeDonors(donors);

  res.json({ message: "Donor removed successfully." });
});

// ─────────────────────────────────────────
// 7. Blood Request — find best match
// POST /api/request
// Body: { bloodGroup, city }
// ─────────────────────────────────────────
app.post("/api/request", (req, res) => {
  const { bloodGroup, city } = req.body;

  if (!bloodGroup || !city) {
    return res.status(400).json({ error: "bloodGroup and city are required." });
  }

  const donors = readDonors();

  // First: exact city + blood group match
  let matches = donors.filter(
    (d) =>
      d.bloodGroup === bloodGroup.toUpperCase() &&
      d.city === city.trim().toLowerCase() &&
      d.available === true
  );

  // Fallback: blood group match in any city
  if (matches.length === 0) {
    matches = donors.filter(
      (d) => d.bloodGroup === bloodGroup.toUpperCase() && d.available === true
    );
  }

  if (matches.length === 0) {
    return res.status(404).json({
      message: `No available donors found for blood group ${bloodGroup.toUpperCase()}.`,
    });
  }

  res.json({
    message: `Found ${matches.length} donor(s) for blood group ${bloodGroup.toUpperCase()}.`,
    donors: matches,
  });
});

// ─────────────────────────────────────────
// 8. Admin — Get stats
// GET /api/admin/stats
// ─────────────────────────────────────────
app.get("/api/admin/stats", (req, res) => {
  const donors = readDonors();

  const stats = {
    totalDonors: donors.length,
    availableDonors: donors.filter((d) => d.available).length,
    unavailableDonors: donors.filter((d) => !d.available).length,
    byBloodGroup: {},
    byCity: {},
  };

  donors.forEach((d) => {
    // Count by blood group
    stats.byBloodGroup[d.bloodGroup] = (stats.byBloodGroup[d.bloodGroup] || 0) + 1;
    // Count by city
    stats.byCity[d.city] = (stats.byCity[d.city] || 0) + 1;
  });

  res.json(stats);
});

// ─────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// ─────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🩸 Blood Donor Finder server running at http://localhost:${PORT}`);
});