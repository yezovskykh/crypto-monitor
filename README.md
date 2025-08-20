# 🎯 Crypto Monitor Dashboard

A real-time web dashboard for cryptocurrency analysis and market trends monitoring.

## 🚀 Features

- **Real-time Market Trend Analysis** - Overall market sentiment (Bullish/Bearish/Neutral)
- **Crypto Opportunity Detection** - Identifies cryptocurrencies with high potential
- **Interactive Web Dashboard** - Beautiful, responsive web interface
- **Auto-refresh** - Updates every 5 minutes automatically
- **Manual Refresh** - Force refresh data on demand
- **Detailed Analytics** - Price changes, volume analysis, technical signals

## 📊 Dashboard Features

### Market Trend Section
- Overall market sentiment with visual indicators
- Breakdown of bullish/bearish/neutral coins
- Average price changes (24h, 7d)
- Analysis based on top 20 cryptocurrencies by market cap

### Crypto Opportunities
- Cards showing high-potential cryptocurrencies (score ≥ 6)
- Price information with 1h, 24h, and 7d changes
- Detected technical signals and indicators
- Color-coded scoring system

## 🛠️ Installation & Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the dashboard:**
   ```bash
   npm run dashboard
   ```

3. **Open your browser:**
   - Dashboard: http://localhost:3000
   - API: http://localhost:3000/api/analysis

## 📱 Available Scripts

- `npm run dashboard` - Start the web dashboard server
- `npm start` - Run the original crypto monitor

## 🔗 API Endpoints

- `GET /` - Main dashboard page
- `GET /api/analysis` - Complete crypto analysis data
- `GET /api/market-trend` - Market trend data only
- `POST /api/refresh` - Trigger manual analysis refresh
- `GET /api/health` - Server health check

## 🎨 Dashboard Interface

The dashboard features:
- **Responsive design** that works on desktop and mobile
- **Real-time updates** every 5 minutes
- **Beautiful gradient backgrounds** and modern styling
- **Interactive elements** with hover effects
- **Color-coded market trends** (Green=Bullish, Red=Bearish, Yellow=Neutral)
- **Detailed crypto cards** with all relevant information

## ⚙️ Configuration

The dashboard runs analysis every 5 minutes and serves the data via the web interface.

Server runs on port 3000 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=8080 npm run dashboard
```

## 🔄 Auto-refresh

- Dashboard auto-refreshes every 5 minutes
- Server runs analysis every 5 minutes
- You can toggle auto-refresh on/off in the dashboard
- Manual refresh button forces immediate data update

## 📈 Market Analysis

The dashboard analyzes:
- Top 200 cryptocurrencies by market cap
- Technical indicators (RSI, volume spikes, momentum)
- Price patterns and consolidation
- Recovery signals and accumulation patterns

Cryptocurrencies with a score of 6 or higher are displayed as opportunities.

## 🌐 Access

Once running, access your dashboard at:
**http://localhost:3000**

Enjoy monitoring the crypto markets with your new dashboard! 🚀
