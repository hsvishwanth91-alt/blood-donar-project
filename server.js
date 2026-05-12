// ═══════════════════════════════════════════════════════════
//  BloodLink — server.js
//  Express backend with Twilio SMS + Voice Call integration
// ═══════════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const dns      = require('dns');
const { v4: uuidv4 } = require('uuid');
const twilio   = require('twilio');

require('dotenv').config({ path: path.join(__dirname, '.env') });

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const app  = express();
const PORT = process.env.PORT || 3000;

function envValue(name) {
  return (process.env[name] || '').trim().replace(/^['"]|['"]$/g, '');
}

const TWILIO_ACCOUNT_SID = envValue('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = envValue('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE = envValue('TWILIO_PHONE_NUMBER');
const TWILIO_VERIFY_SERVICE_SID = envValue('TWILIO_VERIFY_SERVICE_SID');

function hasTwilioConfig() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE);
}

// ── Twilio Client ────────────────────────────────────────────
const twilioClient = hasTwilioConfig()
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

function requireTwilio(res) {
  if (twilioClient) return true;

  res.status(500).json({
    success: false,
    message: 'Twilio is not configured. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in bloodlink/.env, then restart the server.'
  });
  return false;
}

function twilioErrorMessage(err) {
  const code = err && (err.code || (err.cause && err.cause.code));
  const networkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];

  if (code === 21608) {
    return 'This Twilio trial account can only send SMS to verified recipient numbers. Verify this phone number in Twilio, or upgrade/purchase a Twilio number to message unverified recipients.';
  }

  if (networkCodes.includes(code)) {
    return 'Could not reach Twilio. Check your internet connection, DNS, VPN/proxy, or firewall, then retry. Original error: ' + err.message;
  }

  return err.message || 'Twilio request failed.';
}

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory donor store (seeded from JSON) ────────────────
const DATA_FILE = path.join(__dirname, 'data', 'donors.json');

function loadDonors() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveDonors(donors) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(donors, null, 2));
}

// ── Helper: can donate? (90-day rule) ───────────────────────
function canDonateNow(dateStr) {
  if (!dateStr) return true;
  const diff = (Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24);
  return diff >= 90;
}

// ════════════════════════════════════════════════════════════
//  DONOR ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/donors — list all (with optional filters)
app.get('/api/donors', (req, res) => {
  let donors = loadDonors();
  const { blood, city, available } = req.query;

  if (blood && blood !== 'All')  donors = donors.filter(d => d.blood === blood);
  if (city)                      donors = donors.filter(d => d.city.toLowerCase().includes(city.toLowerCase()));
  if (available)                 donors = donors.filter(d => d.available === available);

  // Annotate each donor with donate eligibility
  donors = donors.map(d => ({ ...d, canDonate: canDonateNow(d.lastDonated) }));

  res.json({ success: true, count: donors.length, donors });
});

// POST /api/donors — register a new donor
app.post('/api/donors', async (req, res) => {
  const { name, age, blood, phone, city, state, lastDonated } = req.body;

  if (!name || !age || !blood || !phone || !city || !state) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  if (age < 18 || age > 65) {
    return res.status(400).json({ success: false, message: 'Age must be between 18 and 65.' });
  }

  const donors = loadDonors();
  const newDonor = {
    id: uuidv4(),
    name, age: parseInt(age), blood, phone,
    city, state, available: 'available',
    lastDonated: lastDonated || null,
    registeredAt: new Date().toISOString()
  };

  donors.unshift(newDonor);
  saveDonors(donors);

  // Send welcome SMS to the new donor
  try {
    if (!twilioClient) throw new Error('Twilio is not configured.');

    await twilioClient.messages.create({
      from: TWILIO_PHONE,
      to: phone,
      body:
        `🩸 Welcome to BloodLink, ${name}!\n\n` +
        `You're now registered as a ${blood} donor in ${city}.\n` +
        `You may receive emergency requests from patients in need.\n\n` +
        `Thank you for saving lives! 💪\n— BloodLink Team`
    });
    newDonor.smsSent = true;
  } catch (err) {
    console.warn('⚠️  Welcome SMS failed:', err.message);
    newDonor.smsSent = false;
  }

  res.status(201).json({ success: true, donor: newDonor });
});

// PATCH /api/donors/:id/availability — toggle availability
app.patch('/api/donors/:id/availability', (req, res) => {
  const donors = loadDonors();
  const idx = donors.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Donor not found.' });

  donors[idx].available = req.body.available;
  saveDonors(donors);
  res.json({ success: true, donor: donors[idx] });
});

// DELETE /api/donors/:id — remove a donor
app.delete('/api/donors/:id', (req, res) => {
  const donors = loadDonors();
  const filtered = donors.filter(d => d.id !== req.params.id);
  if (filtered.length === donors.length)
    return res.status(404).json({ success: false, message: 'Donor not found.' });

  saveDonors(filtered);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
//  TWILIO — SMS ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/sms/contact-donor — requester sends SMS to a specific donor
app.post('/api/sms/contact-donor', async (req, res) => {
  const { donorId, requesterName, requesterPhone, bloodType, hospital, message } = req.body;

  if (!donorId || !requesterPhone || !bloodType) {
    return res.status(400).json({ success: false, message: 'donorId, requesterPhone, bloodType are required.' });
  }

  const donors = loadDonors();
  const donor = donors.find(d => d.id === donorId);
  if (!donor) return res.status(404).json({ success: false, message: 'Donor not found.' });

  const smsBody =
    `🚨 URGENT BLOOD REQUEST — BloodLink\n\n` +
    `Blood Type Needed: ${bloodType}\n` +
    `Requested by: ${requesterName || 'Anonymous'}\n` +
    `Hospital: ${hospital || 'Not specified'}\n` +
    `Contact: ${requesterPhone}\n\n` +
    `${message ? `Message: ${message}\n\n` : ''}` +
    `Please reply to this number or call ${requesterPhone} if you can donate.\n` +
    `Reply STOP to opt out.`;

  return res.json({
    success: true,
    manual: true,
    to: donor.phone,
    body: smsBody,
    smsUrl: `sms:${donor.phone}?body=${encodeURIComponent(smsBody)}`
  });

  try {
    const msg = await twilioClient.messages.create({
      from: TWILIO_PHONE,
      to: donor.phone,
      body: smsBody
    });

    res.json({ success: true, sid: msg.sid, status: msg.status });
  } catch (err) {
    console.error('SMS error:', err);
    res.status(500).json({ success: false, message: twilioErrorMessage(err) });
  }
});

// POST /api/sms/alert-all — broadcast SMS to all matching donors
app.post('/api/sms/alert-all', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { bloodType, requesterName, requesterPhone, hospital, city } = req.body;

  if (!bloodType || !requesterPhone) {
    return res.status(400).json({ success: false, message: 'bloodType and requesterPhone are required.' });
  }

  let donors = loadDonors().filter(d => d.available === 'available' && canDonateNow(d.lastDonated));
  if (bloodType !== 'All') donors = donors.filter(d => d.blood === bloodType);
  if (city) donors = donors.filter(d => d.city.toLowerCase().includes(city.toLowerCase()));

  if (donors.length === 0) {
    return res.json({ success: false, message: 'No eligible donors found.' });
  }

  const results = { sent: 0, failed: 0, errors: [] };

  const smsBody =
    `🚨 EMERGENCY BLOOD ALERT — BloodLink\n\n` +
    `${bloodType} blood urgently needed!\n` +
    `Hospital: ${hospital || 'Not specified'}\n` +
    `City: ${city || 'Your area'}\n` +
    `Contact: ${requesterName || 'Patient'} — ${requesterPhone}\n\n` +
    `Please respond if you can help save a life. 🙏\n` +
    `Reply STOP to opt out.`;

  // Send in parallel (up to 10 donors to avoid rate limits)
  const targets = donors.slice(0, 10);
  const promises = targets.map(async donor => {
    try {
      await twilioClient.messages.create({ from: TWILIO_PHONE, to: donor.phone, body: smsBody });
      results.sent++;
    } catch (err) {
      results.failed++;
      results.errors.push({ donor: donor.name, error: twilioErrorMessage(err) });
    }
  });

  await Promise.all(promises);
  res.json({ success: true, totalTargeted: targets.length, ...results });
});

// POST /api/sms/confirmation — send confirmation SMS to requester
app.post('/api/sms/confirmation', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { to, donorName, donorPhone, bloodType } = req.body;

  const body =
    `✅ BloodLink — Donor Contacted!\n\n` +
    `${donorName} (${bloodType}) has been notified.\n` +
    `Their number: ${donorPhone}\n\n` +
    `They'll contact you shortly. Stay strong! 💪\n— BloodLink`;

  try {
    await twilioClient.messages.create({ from: TWILIO_PHONE, to, body });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: twilioErrorMessage(err) });
  }
});

// ════════════════════════════════════════════════════════════
//  TWILIO — VOICE CALL ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/call/donor — make a live call to donor on behalf of requester
app.post('/api/call/donor', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { donorId, requesterName, bloodType, hospital } = req.body;

  if (!donorId) return res.status(400).json({ success: false, message: 'donorId is required.' });

  const donors = loadDonors();
  const donor = donors.find(d => d.id === donorId);
  if (!donor) return res.status(404).json({ success: false, message: 'Donor not found.' });

  // TwiML — what Twilio says when donor picks up
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">
    Hello ${donor.name}. This is an urgent message from BloodLink.
  </Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">
    A patient urgently needs ${bloodType} blood at ${hospital || 'a nearby hospital'}.
    The request was made by ${requesterName || 'a patient in need'}.
  </Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">
    If you can donate, please check your SMS for the contact number and reach out immediately.
    Thank you for being a lifesaver. Goodbye.
  </Say>
</Response>`;

  try {
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE,
      to: donor.phone,
      twiml
    });

    res.json({ success: true, callSid: call.sid, status: call.status });
  } catch (err) {
    console.error('Call error:', err);
    res.status(500).json({ success: false, message: twilioErrorMessage(err) });
  }
});

// POST /api/call/emergency-broadcast — robocall multiple donors
app.post('/api/call/emergency-broadcast', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { bloodType, city, requesterName, hospital } = req.body;

  let donors = loadDonors().filter(d => d.available === 'available' && canDonateNow(d.lastDonated));
  if (bloodType && bloodType !== 'All') donors = donors.filter(d => d.blood === bloodType);
  if (city) donors = donors.filter(d => d.city.toLowerCase().includes(city.toLowerCase()));

  const targets = donors.slice(0, 5); // Limit robocalls to 5

  const results = { called: 0, failed: 0, errors: [] };

  const twimlFn = (name) => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">
    Hello ${name}. Emergency alert from BloodLink.
    ${bloodType} blood is urgently needed at ${hospital || 'a hospital nearby'}.
    Please check your SMS for details and respond immediately if you can help.
    Thank you.
  </Say>
</Response>`;

  const promises = targets.map(async donor => {
    try {
      await twilioClient.calls.create({
        from: TWILIO_PHONE,
        to: donor.phone,
        twiml: twimlFn(donor.name)
      });
      results.called++;
    } catch (err) {
      results.failed++;
      results.errors.push({ donor: donor.name, error: twilioErrorMessage(err) });
    }
  });

  await Promise.all(promises);
  res.json({ success: true, totalTargeted: targets.length, ...results });
});

// ════════════════════════════════════════════════════════════
//  TWILIO — VERIFY / OTP (donor phone verification)
// ════════════════════════════════════════════════════════════

// POST /api/verify/send — send OTP to donor's phone
app.post('/api/verify/send', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Phone required.' });

  try {
    const verification = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: 'sms' });

    res.json({ success: true, status: verification.status });
  } catch (err) {
    res.status(500).json({ success: false, message: twilioErrorMessage(err) });
  }
});

// POST /api/verify/check — verify OTP entered by donor
app.post('/api/verify/check', async (req, res) => {
  if (!requireTwilio(res)) return;

  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ success: false, message: 'Phone and code required.' });

  try {
    const result = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    res.json({ success: result.status === 'approved', status: result.status });
  } catch (err) {
    res.status(500).json({ success: false, message: twilioErrorMessage(err) });
  }
});

// ── Stats endpoint ───────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const donors = loadDonors();
  const available = donors.filter(d => d.available === 'available').length;
  const cities = new Set(donors.map(d => d.city)).size;
  res.json({ total: donors.length, available, cities });
});

// ── Serve frontend for any non-API route ───────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🩸  BloodLink server running at http://localhost:${PORT}`);
  console.log(`📱  Twilio SMS/Call: ${TWILIO_PHONE || '⚠️  TWILIO_PHONE_NUMBER not set in .env'}\n`);
});
