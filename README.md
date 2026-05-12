# 🩸 BloodLink — Emergency Blood Donor Finder

Full-stack emergency donor finder with **real SMS alerts** and **voice calls** powered by Twilio.

---

## 📁 Project Structure

```
bloodlink/
├── server.js           ← Express backend (API + Twilio)
├── package.json        ← Dependencies
├── .env.example        ← Copy to .env and fill keys
├── .env                ← Your actual credentials (DO NOT commit)
├── data/
│   └── donors.json     ← Persistent donor database (JSON)
└── public/
    └── index.html      ← Frontend UI (served by Express)
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd bloodlink
npm install
```

### 2. Set up Twilio
1. Sign up free at **https://www.twilio.com/try-twilio**
2. Go to **Console → Account Info**
3. Copy your **Account SID** and **Auth Token**
4. Go to **Phone Numbers → Manage → Buy a Number**
   - Enable both **SMS** and **Voice** capabilities
5. *(Optional)* For OTP verification: **Verify → Create Service** → copy the Service SID

### 3. Configure environment variables
```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Run the server
```bash
node server.js
# or with auto-reload:
npm run dev
```

### 5. Open the app
Visit **http://localhost:3000** in your browser.

---

## 📡 API Endpoints

### Donors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/donors` | List donors (supports `?blood=A+&city=Mumbai&available=available`) |
| POST | `/api/donors` | Register a new donor |
| PATCH | `/api/donors/:id/availability` | Toggle availability |
| DELETE | `/api/donors/:id` | Remove a donor |
| GET | `/api/stats` | Get total, available, cities count |

### SMS (Twilio)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sms/contact-donor` | Send emergency SMS to one donor |
| POST | `/api/sms/alert-all` | Broadcast SMS to all eligible donors |
| POST | `/api/sms/confirmation` | Send confirmation to requester |

### Voice Calls (Twilio)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/call/donor` | Auto-call one donor with TwiML message |
| POST | `/api/call/emergency-broadcast` | Robocall up to 5 matching donors |

### OTP Verification
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/verify/send` | Send OTP to phone number |
| POST | `/api/verify/check` | Verify OTP code |

---

## 🛠 Features

- **🩸 Donor Registry** — Search by blood type, city, availability
- **📩 SMS Alerts** — Real Twilio SMS sent to donors in emergency
- **📞 Voice Calls** — Automated robocall with alice voice (en-IN)
- **📣 Broadcast** — Alert all eligible donors at once
- **🔐 OTP Verify** — Phone verification before registration
- **💾 Persistent Storage** — JSON file-based donor database
- **📱 Responsive UI** — Works on mobile and desktop

---

## ⚠️ Twilio Trial Account Notes

With a **free trial account**:
- You can only send SMS/calls to **verified numbers** (add them in Twilio Console → Verified Caller IDs)
- Upgrade to a paid account for unrestricted messaging
- Trial credits are sufficient for testing all features

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| SMS & Calls | Twilio Programmable SMS + Voice |
| OTP | Twilio Verify |
| Frontend | Vanilla HTML/CSS/JS |
| Database | JSON file (easily swappable to MongoDB/PostgreSQL) |

---

## 📝 License
MIT — Built for life-saving missions.
