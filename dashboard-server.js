const express = require('express');
const cors = require('cors');
const path = require('path');
const CryptoMonitor = require('./crypto-monitor.js');

class CryptoDashboard {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.cryptoMonitor = null;
        this.lastAnalysis = null;
        this.lastMarketTrend = null;
        this.setupMiddleware();
        this.setupRoutes();
        this.initializeCryptoMonitor();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    initializeCryptoMonitor() {
        this.cryptoMonitor = new CryptoMonitor();
        
        // Run initial analysis
        this.runAnalysis();
        
        // Set up periodic analysis every 5 minutes
        setInterval(() => {
            this.runAnalysis();
        }, 5 * 60 * 1000);
    }

    async runAnalysis() {
        try {
            console.log('🔄 Running crypto analysis for dashboard...');
            
            // Get crypto data (top 200)
            const coinsData = await this.cryptoMonitor.getTopCryptos(200);
            if (!coinsData || coinsData.length === 0) {
                console.log('❌ No data retrieved');
                return;
            }

            // Analyze market trend
            const marketTrend = this.cryptoMonitor.analyzeMarketTrend(coinsData);
            console.log(`📈 Market Trend: ${marketTrend.emoji} ${marketTrend.trend}`);

            // Update price history
            this.cryptoMonitor.updatePriceHistory(coinsData);

            // Analyze Bitcoin specifically
            const btcData = coinsData.find(coin => coin.id === 'bitcoin' || coin.symbol?.toLowerCase() === 'btc');
            const btcAnalysis = btcData ? this.cryptoMonitor.analyzeBTC(btcData) : null;

            // Analyze Market Cap Indices (TOTAL, TOTAL2, TOTAL3)
            const marketCapAnalysis = await this.cryptoMonitor.analyzeMarketCapIndices();

            // Analyze Cycles (Top/Bottom Analysis)
            const cycleAnalysis = await this.cryptoMonitor.analyzeCycles(coinsData, btcAnalysis, marketCapAnalysis);

            // Analyze individual coins for bullish, bearish, and HTF opportunities
            const bullishAlerts = [];
            const bearishAlerts = [];
            const htfAlerts = [];
            
            for (const coin of coinsData) {
                // Analyze for bullish signals
                const bullishAnalysis = this.cryptoMonitor.analyzeCoin(coin);
                if (bullishAnalysis.score >= 6) {
                    // Calculate technical analysis
                    const technicalAnalysis = this.cryptoMonitor.calculateTechnicalAnalysis(coin);
                    
                    const bullishData = {
                        name: coin.name || 'Unknown',
                        symbol: coin.symbol || 'unknown',
                        price: coin.current_price || 0,
                        rank: coin.market_cap_rank || 'N/A',
                        change1h: coin.price_change_percentage_1h_in_currency || 0,
                        change24h: coin.price_change_percentage_24h_in_currency || 0,
                        change7d: coin.price_change_percentage_7d_in_currency || 0,
                        volume: coin.total_volume || 0,
                        marketCap: coin.market_cap || 0,
                        score: bullishAnalysis.score,
                        signals: bullishAnalysis.signals,
                        type: 'bullish',
                        technicalAnalysis: technicalAnalysis,
                        lastUpdated: new Date().toISOString()
                    };
                    bullishAlerts.push(bullishData);
                }

                // Analyze for bearish signals
                const bearishAnalysis = this.cryptoMonitor.analyzeBearishCoin(coin);
                if (bearishAnalysis.score >= 6) {
                    // Calculate technical analysis
                    const technicalAnalysis = this.cryptoMonitor.calculateTechnicalAnalysis(coin);
                    
                    const bearishData = {
                        name: coin.name || 'Unknown',
                        symbol: coin.symbol || 'unknown',
                        price: coin.current_price || 0,
                        rank: coin.market_cap_rank || 'N/A',
                        change1h: coin.price_change_percentage_1h_in_currency || 0,
                        change24h: coin.price_change_percentage_24h_in_currency || 0,
                        change7d: coin.price_change_percentage_7d_in_currency || 0,
                        volume: coin.total_volume || 0,
                        marketCap: coin.market_cap || 0,
                        score: bearishAnalysis.score,
                        signals: bearishAnalysis.signals,
                        type: 'bearish',
                        technicalAnalysis: technicalAnalysis,
                        lastUpdated: new Date().toISOString()
                    };
                    bearishAlerts.push(bearishData);
                }

                // Analyze for HTF investment opportunities with stability
                const htfAnalysis = this.cryptoMonitor.analyzeHTFInvestmentWithStability(coin);
                if (htfAnalysis.score >= 5) { // Lower threshold for HTF as it's more selective
                    // Calculate technical analysis
                    const technicalAnalysis = this.cryptoMonitor.calculateTechnicalAnalysis(coin);
                    
                    const htfData = {
                        name: coin.name || 'Unknown',
                        symbol: coin.symbol || 'unknown',
                        price: coin.current_price || 0,
                        rank: coin.market_cap_rank || 'N/A',
                        change1h: coin.price_change_percentage_1h_in_currency || 0,
                        change24h: coin.price_change_percentage_24h_in_currency || 0,
                        change7d: coin.price_change_percentage_7d_in_currency || 0,
                        change30d: coin.price_change_percentage_30d_in_currency || 0,
                        volume: coin.total_volume || 0,
                        marketCap: coin.market_cap || 0,
                        score: htfAnalysis.score,
                        signals: htfAnalysis.signals,
                        type: 'htf',
                        technicalAnalysis: technicalAnalysis,
                        stability: htfAnalysis.stability, // Include stability metrics
                        lastUpdated: new Date().toISOString()
                    };
                    htfAlerts.push(htfData);
                }
            }

            // Sort by score (highest first)
            bullishAlerts.sort((a, b) => b.score - a.score);
            bearishAlerts.sort((a, b) => b.score - a.score);
            htfAlerts.sort((a, b) => b.score - a.score);

            // Store the analysis results
            this.lastAnalysis = {
                btcAnalysis,
                marketCapAnalysis,
                cycleAnalysis,
                bullishAlerts,
                bearishAlerts,
                htfAlerts,
                totalBullish: bullishAlerts.length,
                totalBearish: bearishAlerts.length,
                totalHTF: htfAlerts.length,
                totalOpportunities: bullishAlerts.length + bearishAlerts.length + htfAlerts.length,
                totalAnalyzed: coinsData.length,
                timestamp: new Date().toISOString()
            };
            
            this.lastMarketTrend = marketTrend;

            // Save all histories for persistence
            await this.cryptoMonitor.saveHTFHistory();
            await this.cryptoMonitor.saveCycleHistory();
            await this.cryptoMonitor.saveMarketLeaderHistory();
            
            console.log(`✅ Analysis complete: ${bullishAlerts.length} bullish, ${bearishAlerts.length} bearish, ${htfAlerts.length} HTF opportunities found`);

        } catch (error) {
            console.error('❌ Error in dashboard analysis:', error.message);
        }
    }

    setupRoutes() {
        // Serve the main dashboard page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // API endpoint for crypto analysis data
        this.app.get('/api/analysis', (req, res) => {
            res.json({
                success: true,
                data: this.lastAnalysis,
                marketTrend: this.lastMarketTrend
            });
        });

        // API endpoint for market trend only
        this.app.get('/api/market-trend', (req, res) => {
            res.json({
                success: true,
                data: this.lastMarketTrend
            });
        });

        // API endpoint to trigger manual analysis
        this.app.post('/api/refresh', async (req, res) => {
            try {
                await this.runAnalysis();
                res.json({
                    success: true,
                    message: 'Analysis refreshed successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Health check endpoint
        this.app.get('/api/health', (req, res) => {
            res.json({
                success: true,
                status: 'running',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });
    }

    start() {
        this.app.listen(this.port, () => {
            console.log('🚀 Crypto Dashboard Server Started!');
            console.log(`📊 Dashboard: http://localhost:${this.port}`);
            console.log(`🔗 API: http://localhost:${this.port}/api/analysis`);
            console.log('🔄 Auto-refresh every 5 minutes');
            console.log('');
        });
    }
}

// Start the dashboard if this file is run directly
if (require.main === module) {
    const dashboard = new CryptoDashboard();
    dashboard.start();
}

module.exports = CryptoDashboard;
