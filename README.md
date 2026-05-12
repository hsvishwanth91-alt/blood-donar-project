# BloodLink - Emergency Blood Donor Finder

Full-stack emergency donor finder with manual SMS support. The app prepares donor messages and opens your device SMS app, so you stay in control and press send yourself.

## Project Structure

```text
bloodlink_project/
server.js
package.json
data/donors.json
public/index.html
```

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

No Twilio account, API key, or automated SMS service is required.

If you configure Twilio credentials in `.env`, the app can send SMS automatically. Otherwise it stays in manual SMS mode and prepares `sms:` links for your phone.

## How SMS Works

1. Search for matching donors.
2. Click `Alert` on a donor.
3. Fill requester details.
4. Click `Prepare SMS`.
5. Use `Open SMS App` or copy the message, then press send manually.

Emergency broadcast works the same way: it prepares one SMS link per eligible donor instead of sending anything automatically.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/donors` | List donors |
| GET | `/api/donors/:id` | Get one donor |
| POST | `/api/donors` | Register a donor |
| PATCH | `/api/donors/:id/availability` | Update donor availability |
| DELETE | `/api/donors/:id` | Remove a donor |
| GET | `/api/stats` | Get total, available, and city counts |
| POST | `/api/sms/contact-donor` | Prepare a manual SMS for one donor |
| POST | `/api/sms/alert-all` | Prepare manual SMS links for matching donors |
| POST | `/api/call/donor` | Prepare a manual phone dialer link |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/CSS/JS |
| Database | JSON file |
| SMS | Manual `sms:` links |

