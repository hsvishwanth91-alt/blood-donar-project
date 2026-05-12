require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const cors = require("cors");
const twilio = require("twilio");
const { v4: uuidv4 } = require("uuid");

const app = express();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DONORS_FILE = path.join(DATA_DIR, "donors.json");

const twilioConfigured =
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER;

const verifyConfigured = twilioConfigured && process.env.TWILIO_VERIFY_SERVICE_SID;
const twilioClient = twilioConfigured
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DONORS_FILE);
  } catch {
    await fs.writeFile(DONORS_FILE, "[]\n", "utf8");
  }
}

async function readDonors() {
  await ensureDataFile();
  const data = await fs.readFile(DONORS_FILE, "utf8");
  return JSON.parse(data || "[]");
}

async function writeDonors(donors) {
  await ensureDataFile();
  await fs.writeFile(DONORS_FILE, JSON.stringify(donors, null, 2) + "\n", "utf8");
}

function canDonate(lastDonated) {
  if (!lastDonated) return true;

  const lastDate = new Date(lastDonated);
  if (Number.isNaN(lastDate.getTime())) return true;

  const daysSinceDonation = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceDonation >= 90;
}

function normalizeDonor(donor) {
  return {
    ...donor,
    canDonate: canDonate(donor.lastDonated),
  };
}

function donorMatches(donor, { blood, city, available }) {
  if (blood && blood !== "All" && donor.blood !== blood) return false;
  if (city && !String(donor.city || "").toLowerCase().includes(city.toLowerCase())) return false;
  if (available && donor.available !== available) return false;
  return true;
}

function emergencyMessage({ requesterName, requesterPhone, bloodType, hospital, city, message }) {
  const parts = [
    "BloodLink emergency alert.",
    bloodType && bloodType !== "All" ? `Blood needed: ${bloodType}.` : null,
    requesterName ? `Requester: ${requesterName}.` : null,
    requesterPhone ? `Phone: ${requesterPhone}.` : null,
    hospital ? `Hospital: ${hospital}.` : null,
    city ? `City: ${city}.` : null,
    message ? `Note: ${message}` : null,
  ];

  return parts.filter(Boolean).join(" ");
}

function manualSmsResponse(to, body) {
  return {
    success: true,
    manual: true,
    to,
    body,
    smsUrl: `sms:${encodeURIComponent(to)}?body=${encodeURIComponent(body)}`,
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "BloodLink API is working",
    endpoints: ["/api/donors", "/api/stats", "/api/verify/send", "/api/sms/contact-donor"],
  });
});

app.get("/api/stats", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const available = donors.filter((donor) => donor.available === "available").length;
    const cities = new Set(donors.map((donor) => String(donor.city || "").trim().toLowerCase()).filter(Boolean));

    res.json({
      total: donors.length,
      available,
      cities: cities.size,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/donors", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const filtered = donors
      .filter((donor) => donorMatches(donor, req.query))
      .map(normalizeDonor);

    res.json({
      success: true,
      count: filtered.length,
      donors: filtered,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/donors/:id", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const donor = donors.find((item) => item.id === req.params.id);

    if (!donor) {
      return res.status(404).json({ success: false, message: "Donor not found." });
    }

    res.json({ success: true, donor: normalizeDonor(donor) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/donors", async (req, res, next) => {
  try {
    const { name, age, blood, phone, city, state, lastDonated } = req.body;

    if (!name || !age || !blood || !phone || !city || !state) {
      return res.status(400).json({
        success: false,
        message: "Name, age, blood group, phone, city, and state are required.",
      });
    }

    const donors = await readDonors();
    const donor = {
      id: uuidv4(),
      name: String(name).trim(),
      age: Number(age),
      blood: String(blood).trim(),
      phone: String(phone).trim(),
      city: String(city).trim(),
      state: String(state).trim(),
      available: "available",
      lastDonated: lastDonated || null,
      registeredAt: new Date().toISOString(),
    };

    donors.unshift(donor);
    await writeDonors(donors);

    res.status(201).json({
      success: true,
      donor: normalizeDonor(donor),
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/donors/:id/availability", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const donor = donors.find((item) => item.id === req.params.id);

    if (!donor) {
      return res.status(404).json({ success: false, message: "Donor not found." });
    }

    donor.available = req.body.available === "busy" ? "busy" : "available";
    await writeDonors(donors);

    res.json({ success: true, donor: normalizeDonor(donor) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/donors/:id", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const remaining = donors.filter((donor) => donor.id !== req.params.id);

    if (remaining.length === donors.length) {
      return res.status(404).json({ success: false, message: "Donor not found." });
    }

    await writeDonors(remaining);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/verify/send", async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: "Phone number is required." });
  }

  if (!verifyConfigured) {
    return res.json({
      success: true,
      demo: true,
      message: "OTP skipped because Twilio Verify is not configured.",
    });
  }

  try {
    await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/verify/check", async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ success: false, message: "Phone and OTP code are required." });
  }

  if (!verifyConfigured) {
    return res.json({
      success: true,
      demo: true,
      message: "OTP accepted because Twilio Verify is not configured.",
    });
  }

  try {
    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    res.json({ success: check.status === "approved", status: check.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/sms/contact-donor", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const donor = donors.find((item) => item.id === req.body.donorId);

    if (!donor) {
      return res.status(404).json({ success: false, message: "Donor not found." });
    }

    const body = emergencyMessage(req.body);

    if (!twilioConfigured) {
      return res.json(manualSmsResponse(donor.phone, body));
    }

    const message = await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: donor.phone,
    });

    res.json({ success: true, sid: message.sid });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sms/alert-all", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const targets = donors
      .map(normalizeDonor)
      .filter((donor) =>
        donor.available === "available" &&
        donor.canDonate &&
        donorMatches(donor, {
          blood: req.body.bloodType,
          city: req.body.city,
        })
      );

    const body = emergencyMessage(req.body);

    if (!twilioConfigured) {
      return res.json({
        success: true,
        manual: true,
        sent: 0,
        eligible: targets.length,
        message: "Twilio is not configured. No live SMS was sent.",
      });
    }

    const results = await Promise.allSettled(
      targets.map((donor) =>
        twilioClient.messages.create({
          body,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: donor.phone,
        })
      )
    );

    res.json({
      success: true,
      sent: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
      eligible: targets.length,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/call/donor", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const donor = donors.find((item) => item.id === req.body.donorId);

    if (!donor) {
      return res.status(404).json({ success: false, message: "Donor not found." });
    }

    if (!twilioConfigured) {
      return res.json({
        success: false,
        message: "Twilio Voice is not configured on this server.",
      });
    }

    const call = await twilioClient.calls.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: donor.phone,
      twiml: `<Response><Say voice="alice">BloodLink emergency alert. Blood is needed at ${req.body.hospital || "the hospital"}. Please contact the requester as soon as possible.</Say></Response>`,
    });

    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    next(error);
  }
});

app.post("/api/call/emergency-broadcast", async (req, res, next) => {
  try {
    const donors = await readDonors();
    const targets = donors
      .map(normalizeDonor)
      .filter((donor) =>
        donor.available === "available" &&
        donor.canDonate &&
        donorMatches(donor, {
          blood: req.body.bloodType,
          city: req.body.city,
        })
      )
      .slice(0, 5);

    if (!twilioConfigured) {
      return res.json({
        success: false,
        called: 0,
        eligible: targets.length,
        message: "Twilio Voice is not configured on this server.",
      });
    }

    const twiml = `<Response><Say voice="alice">BloodLink emergency alert. Blood is needed at ${req.body.hospital || "the hospital"}. Please contact ${req.body.requesterName || "the requester"} immediately.</Say></Response>`;
    const results = await Promise.allSettled(
      targets.map((donor) =>
        twilioClient.calls.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: donor.phone,
          twiml,
        })
      )
    );

    res.json({
      success: true,
      called: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
      eligible: targets.length,
    });
  } catch (error) {
    next(error);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    success: false,
    message: "Server error",
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

app.listen(PORT, () => {
  console.log(`BloodLink server running on port ${PORT}`);
});
