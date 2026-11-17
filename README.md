# Ledgerstone

An institutional conversational trading journal that converts natural-language trade logs into verified, mathematically calculated entries saved directly to your private Google Sheet.

---

## 1. Motive

Manual trade logging across 30+ spreadsheet columns after market hours leads to friction, missed entries, and repeated behavioral mistakes. 

Ledgerstone eliminates manual logging by using conversational intelligence to extract trade parameters, execute deterministic financial math (Points, P&L, R:R), and record them into the trader's Google Drive via OAuth 2.0. It features dual-environment switching (Live Journal vs. Demo Journal), providing a dedicated sandbox to test setups and paper trade without corrupting verified portfolio history.

---

## 2. Installation & Development

### Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS
- **Backend & APIs**: Next.js Serverless Route Handlers, Google Sheets & Drive API v4/v3, Upstash Redis, Resend API
- **Inference**: Groq (primary), Google Gemini (fallback)

### Architecture & Routes
- `/`: Institutional Homepage, Macroeconomic Catalyst Radar, interactive column schema explorer, and feature breakdown.
- `/journal`: Conversational trade capture terminal, local memory questionnaire engine, live sheet preview, and Google Sheets synchronization.
- `/api/auth/google`: OAuth 2.0 initiation requesting minimal `drive.file` scope.
- `/api/save`: Serverless multi-trade ingestion and dual-sheet (Live/Demo) persistence engine.
- `/api/news`: Real-time macroeconomic event feed with impact filtering.

### Setup

1. **Clone & Install Dependencies**:
   ```bash
   git clone https://github.com/your-username/ai-trading-journal.git
   cd ai-trading-journal
   npm install
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the project root:
   ```env
   NEXT_PUBLIC_APP_URL="http://localhost:3000"

   # LLM Providers
   GROQ_API_KEY="gsk_..."
   GROQ_MODEL="openai/gpt-oss-120b"
   GEMINI_API_KEY="AIzaSy..."

   # Google OAuth 2.0 (drive.file scope)
   GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-..."
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"

   # Storage & Alerts (Optional for local dev)
   UPSTASH_REDIS_REST_URL="https://...upstash.io"
   UPSTASH_REDIS_REST_TOKEN="Ac..."
   RESEND_API_KEY="re_..."
   EMAIL_FROM="Ledgerstone <onboarding@resend.dev>"
   CRON_SECRET="your-cron-secret"
   ```

3. **Run Application**:
   ```bash
   # Development
   npm run dev

   # Production Build
   npm run build
   npm start
   ```

---

## 3. Next Phase (Roadmap)

- **Direct Broker Integration**: Automated trade capture from MetaTrader (MT4/MT5), TradingView webhooks, and broker REST APIs (Interactive Brokers, Binance, Zerodha).
- **Hybrid Capture Workflow**: Broker provides execution data (entry, exit, size, P&L); the system follows up with a brief qualitative debrief (emotional discipline, rule adherence).
- **20-Day Performance Audit**: Historical cross-correlation analyzing behavioral patterns (sleep, stress, session timing) against financial metrics (win rate, R:R, drawdown) to deliver actionable trading rules.

---
