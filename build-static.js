const fs = require('fs').promises;
const path = require('path');
const CryptoMonitor = require('./crypto-monitor.js');

async function buildStatic() {
    console.log('🔧 Building static version for GitHub Pages...');
    
    // Create dist directory
    const distDir = path.join(__dirname, 'dist');
    await fs.mkdir(distDir, { recursive: true });
    
    // Initialize crypto monitor
    const monitor = new CryptoMonitor();
    
    console.log('📊 Fetching crypto data for static build...');
    
    try {
        // Get top cryptocurrencies with retry logic
        let coinsData, marketCapAnalysis, btcAnalysis, cycleAnalysis;
        let marketTrend = {
            trend: 'Neutral',
            emoji: '⚖️',
            description: 'Market data unavailable during build',
            details: {
                totalCoinsAnalyzed: 0,
                bullishCoins: 0,
                bearishCoins: 0,
                neutralCoins: 0,
                avgChange24h: 0,
                avgChange7d: 0
            }
        };
        
        try {
            console.log('🔄 Attempting to fetch crypto data...');
            
            // Set timeout for API calls in CI environment
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('API timeout after 30 seconds')), 30000);
            });
            
            coinsData = await Promise.race([
                monitor.getTopCryptos(200),
                timeoutPromise
            ]);
            console.log(`✅ Successfully fetched ${coinsData.length} cryptocurrencies`);
            
            // Analyze market trend
            marketTrend = monitor.analyzeMarketTrend(coinsData);
            
            // Analyze BTC
            const btcData = coinsData.find(coin => coin.symbol.toLowerCase() === 'btc');
            btcAnalysis = btcData ? await monitor.analyzeBTC(btcData) : null;
            
            // Analyze market cap indices
            marketCapAnalysis = await monitor.analyzeMarketCapIndices();
            
            // Analyze cycles
            cycleAnalysis = await monitor.analyzeCycles(coinsData, btcAnalysis, marketCapAnalysis);
            
        } catch (apiError) {
            console.warn('⚠️  API fetch failed, using fallback data:', apiError.message);
            
            // Create minimal fallback data
            coinsData = [];
            btcAnalysis = {
                name: 'Bitcoin',
                symbol: 'BTC',
                currentPrice: 0,
                error: 'Data unavailable during build'
            };
            marketCapAnalysis = {
                total: { error: 'Data unavailable during build' },
                total2: { error: 'Data unavailable during build' },
                total3: { error: 'Data unavailable during build' }
            };
            cycleAnalysis = {
                overall: {
                    phase: 'Unknown',
                    description: 'Cycle analysis unavailable during build'
                }
            };
        }
        
        // Separate bullish and bearish opportunities
        const bullishAlerts = [];
        const bearishAlerts = [];
        
        // Only analyze coins if we have data
        if (coinsData && coinsData.length > 0) {
            for (const coin of coinsData) {
            const analysis = monitor.analyzeCoin(coin);
            const bearishAnalysis = monitor.analyzeBearishCoin(coin);
            
            if (analysis.score >= 6) {
                const technicalAnalysis = monitor.calculateTechnicalAnalysis(coin);
                
                const alertData = {
                    name: coin.name || 'Unknown',
                    symbol: coin.symbol || 'unknown',
                    price: coin.current_price || 0,
                    rank: coin.market_cap_rank || 'N/A',
                    change1h: coin.price_change_percentage_1h_in_currency || 0,
                    change24h: coin.price_change_percentage_24h_in_currency || 0,
                    change7d: coin.price_change_percentage_7d_in_currency || 0,
                    score: analysis.score,
                    signals: analysis.signals,
                    technicalAnalysis: technicalAnalysis
                };
                bullishAlerts.push(alertData);
            }
            
            if (bearishAnalysis.score >= 6) {
                const technicalAnalysis = monitor.calculateTechnicalAnalysis(coin);
                
                const alertData = {
                    name: coin.name || 'Unknown',
                    symbol: coin.symbol || 'unknown',
                    price: coin.current_price || 0,
                    rank: coin.market_cap_rank || 'N/A',
                    change1h: coin.price_change_percentage_1h_in_currency || 0,
                    change24h: coin.price_change_percentage_24h_in_currency || 0,
                    change7d: coin.price_change_percentage_7d_in_currency || 0,
                    score: bearishAnalysis.score,
                    signals: bearishAnalysis.signals,
                    technicalAnalysis: technicalAnalysis
                };
                bearishAlerts.push(alertData);
            }
            }
        }
        
        // Sort alerts by score
        bullishAlerts.sort((a, b) => b.score - a.score);
        bearishAlerts.sort((a, b) => b.score - a.score);
        
        // Create analysis data
        const analysisData = {
            success: true,
            data: {
                marketTrend,
                bullishAlerts,
                bearishAlerts,
                btcAnalysis,
                marketCapAnalysis,
                cycleAnalysis,
                timestamp: new Date().toISOString(),
                totalOpportunities: bullishAlerts.length + bearishAlerts.length
            }
        };
        
        // Save analysis data as JSON
        await fs.writeFile(
            path.join(distDir, 'analysis.json'),
            JSON.stringify(analysisData, null, 2)
        );
        
        if (coinsData && coinsData.length > 0) {
            console.log(`✅ Generated analysis data: ${bullishAlerts.length} bullish, ${bearishAlerts.length} bearish opportunities`);
        } else {
            console.log('⚠️  Generated fallback data (API was unavailable during build)');
        }
        
        // Read and modify the HTML file for static deployment
        const htmlContent = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
        
        // Modify the HTML to work with static data
        const modifiedHtml = htmlContent.replace(
            /fetch\('\/api\/analysis'\)/g,
            "fetch('./analysis.json')"
        ).replace(
            /fetch\('\/api\/health'\)/g,
            "Promise.resolve({ok: true, json: () => Promise.resolve({success: true, status: 'static'})})"
        ).replace(
            /fetch\('\/api\/market-trend'\)/g,
            "fetch('./analysis.json').then(r => r.json()).then(data => ({ok: true, json: () => Promise.resolve({success: true, data: data.data.marketTrend})}))"
        );
        
        // Save the modified HTML
        await fs.writeFile(path.join(distDir, 'index.html'), modifiedHtml);
        
        console.log('📄 Generated static HTML file');
        
        // Create a simple API endpoint simulation
        const apiData = {
            '/api/analysis': analysisData,
            '/api/health': { success: true, status: 'static', timestamp: new Date().toISOString() },
            '/api/market-trend': { success: true, data: marketTrend }
        };
        
        await fs.writeFile(
            path.join(distDir, 'api.json'),
            JSON.stringify(apiData, null, 2)
        );
        
        console.log('🚀 Static build completed successfully!');
        console.log(`📁 Files created in ./dist/`);
        console.log(`   • index.html (${Math.round((await fs.stat(path.join(distDir, 'index.html'))).size / 1024)}KB)`);
        console.log(`   • analysis.json (${Math.round((await fs.stat(path.join(distDir, 'analysis.json'))).size / 1024)}KB)`);
        console.log(`   • api.json (${Math.round((await fs.stat(path.join(distDir, 'api.json'))).size / 1024)}KB)`);
        
    } catch (error) {
        console.error('❌ Error building static site:', error.message);
        process.exit(1);
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    buildStatic().catch(error => {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = buildStatic;
