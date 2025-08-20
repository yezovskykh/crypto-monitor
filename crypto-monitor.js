const axios = require('axios');
const fs = require('fs').promises;

class CryptoMonitor {
    constructor() {
        this.baseUrl = 'https://api.coingecko.com/api/v3';
        this.lastPrices = {};
        this.priceHistory = {};
        this.dataFile = 'crypto_history.json';
        this.htfHistoryFile = 'htf_history.json';
        this.cycleHistoryFile = 'cycle_history.json';
        this.marketLeaderHistoryFile = 'market_leader_history.json';
        this.cacheFile = 'api_cache.json';
        this.htfHistory = {}; // Store HTF scores over time for stability
        this.cycleHistory = []; // Store cycle analysis history for stability
        this.marketLeaderHistory = []; // Store market leader history for stability
        this.apiCache = {}; // Cache for API responses
        this.lastSuccessfulFetch = null;
        this.rateLimitInfo = {
            isLimited: false,
            resetTime: null,
            retryAfter: null,
            requestCount: 0,
            lastRequest: null
        };
        
        // Load existing histories
        this.loadPriceHistory();
        this.loadHTFHistory();
        this.loadCycleHistory();
        this.loadMarketLeaderHistory();
        this.loadApiCache();
    }

    async loadPriceHistory() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            this.priceHistory = JSON.parse(data);
            console.log('Price history loaded successfully');
        } catch (error) {
            console.log('No existing price history found, starting fresh');
            this.priceHistory = {};
        }
    }

    async loadHTFHistory() {
        try {
            const data = await fs.readFile(this.htfHistoryFile, 'utf8');
            this.htfHistory = JSON.parse(data);
            console.log('HTF history loaded successfully');
        } catch (error) {
            console.log('No existing HTF history found, starting fresh');
            this.htfHistory = {};
        }
    }

    async savePriceHistory() {
        try {
            await fs.writeFile(this.dataFile, JSON.stringify(this.priceHistory, null, 2));
        } catch (error) {
            console.error('Error saving price history:', error);
        }
    }

    async loadCycleHistory() {
        try {
            const data = await fs.readFile(this.cycleHistoryFile, 'utf8');
            this.cycleHistory = JSON.parse(data);
            console.log('Cycle history loaded successfully');
        } catch (error) {
            console.log('No existing cycle history found, starting fresh');
            this.cycleHistory = [];
        }
    }

    async loadMarketLeaderHistory() {
        try {
            const data = await fs.readFile(this.marketLeaderHistoryFile, 'utf8');
            this.marketLeaderHistory = JSON.parse(data);
            console.log('Market leader history loaded successfully');
        } catch (error) {
            console.log('No existing market leader history found, starting fresh');
            this.marketLeaderHistory = [];
        }
    }

    async saveHTFHistory() {
        try {
            await fs.writeFile(this.htfHistoryFile, JSON.stringify(this.htfHistory, null, 2));
        } catch (error) {
            console.error('Error saving HTF history:', error);
        }
    }

    async saveCycleHistory() {
        try {
            await fs.writeFile(this.cycleHistoryFile, JSON.stringify(this.cycleHistory, null, 2));
        } catch (error) {
            console.error('Error saving cycle history:', error);
        }
    }

    async loadApiCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            this.apiCache = JSON.parse(data);
            console.log('API cache loaded successfully');
        } catch (error) {
            console.log('No existing API cache found, starting fresh');
            this.apiCache = {};
        }
    }

    async saveMarketLeaderHistory() {
        try {
            await fs.writeFile(this.marketLeaderHistoryFile, JSON.stringify(this.marketLeaderHistory, null, 2));
        } catch (error) {
            console.error('Error saving market leader history:', error);
        }
    }

    async saveApiCache() {
        try {
            await fs.writeFile(this.cacheFile, JSON.stringify(this.apiCache, null, 2));
        } catch (error) {
            console.error('Error saving API cache:', error);
        }
    }

    // Sleep helper function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Check if we should use cached data
    shouldUseCachedData() {
        const now = Date.now();
        const cacheAge = now - (this.lastSuccessfulFetch || 0);
        const maxCacheAge = 10 * 60 * 1000; // 10 minutes
        
        // Use cache if we're rate limited or if cache is fresh
        return this.rateLimitInfo.isLimited || (this.lastSuccessfulFetch && cacheAge < maxCacheAge);
    }

    // Update rate limit info from response headers
    updateRateLimitInfo(response) {
        const headers = response.headers;
        this.rateLimitInfo.requestCount++;
        this.rateLimitInfo.lastRequest = Date.now();
        
        // Check for rate limit headers (common patterns)
        if (headers['x-ratelimit-remaining']) {
            const remaining = parseInt(headers['x-ratelimit-remaining']);
            if (remaining < 5) {
                console.warn(`⚠️ API rate limit warning: ${remaining} requests remaining`);
            }
        }
        
        if (headers['retry-after']) {
            this.rateLimitInfo.retryAfter = parseInt(headers['retry-after']) * 1000;
            this.rateLimitInfo.resetTime = Date.now() + this.rateLimitInfo.retryAfter;
        }
    }

    // Handle rate limit error
    handleRateLimitError(error) {
        this.rateLimitInfo.isLimited = true;
        
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after'];
            if (retryAfter) {
                this.rateLimitInfo.retryAfter = parseInt(retryAfter) * 1000;
                this.rateLimitInfo.resetTime = Date.now() + this.rateLimitInfo.retryAfter;
                console.error(`🚫 Rate limited! Retry after ${retryAfter} seconds`);
            } else {
                // Default backoff if no retry-after header
                this.rateLimitInfo.retryAfter = 5 * 60 * 1000; // 5 minutes
                this.rateLimitInfo.resetTime = Date.now() + this.rateLimitInfo.retryAfter;
                console.error('🚫 Rate limited! Using default 5-minute backoff');
            }
        } else {
            // Other errors - shorter backoff
            this.rateLimitInfo.retryAfter = 60 * 1000; // 1 minute
            this.rateLimitInfo.resetTime = Date.now() + this.rateLimitInfo.retryAfter;
            console.error(`🚫 API error: ${error.message}. Backing off for 1 minute`);
        }
    }

    // Check if rate limit has expired
    checkRateLimitExpiry() {
        if (this.rateLimitInfo.isLimited && this.rateLimitInfo.resetTime) {
            if (Date.now() > this.rateLimitInfo.resetTime) {
                console.log('✅ Rate limit expired, resuming API calls');
                this.rateLimitInfo.isLimited = false;
                this.rateLimitInfo.retryAfter = null;
                this.rateLimitInfo.resetTime = null;
            }
        }
    }

    async getTopCryptos(limit = 200) {
        const cacheKey = `top_cryptos_${limit}`;
        
        // Check if rate limit has expired
        this.checkRateLimitExpiry();
        
        // Use cached data if available and appropriate
        if (this.shouldUseCachedData() && this.apiCache[cacheKey]) {
            const cacheAge = Date.now() - this.apiCache[cacheKey].timestamp;
            console.log(`📦 Using cached crypto data (${Math.round(cacheAge / 1000 / 60)} minutes old)`);
            return this.apiCache[cacheKey].data;
        }

        // If we're still rate limited, return cached data or empty array
        if (this.rateLimitInfo.isLimited) {
            const timeUntilReset = this.rateLimitInfo.resetTime - Date.now();
            console.warn(`⏳ Still rate limited. Reset in ${Math.round(timeUntilReset / 1000 / 60)} minutes`);
            
            if (this.apiCache[cacheKey]) {
                return this.apiCache[cacheKey].data;
            } else {
                console.error('❌ No cached data available and rate limited');
                return [];
            }
        }

        const url = `${this.baseUrl}/coins/markets`;
        const params = {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: limit,
            page: 1,
            sparkline: 'true',
            price_change_percentage: '1h,24h,7d,30d'
        };

        const maxRetries = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 Fetching crypto data (attempt ${attempt}/${maxRetries})...`);
                
                const response = await axios.get(url, { 
                    params,
                    timeout: 30000, // 30 second timeout
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'CryptoMonitor/1.0'
                    }
                });

                // Update rate limit tracking
                this.updateRateLimitInfo(response);

                // Cache the successful response
                this.apiCache[cacheKey] = {
                    data: response.data,
                    timestamp: Date.now()
                };
                this.lastSuccessfulFetch = Date.now();
                
                // Save cache to file
                await this.saveApiCache();
                
                console.log(`✅ Successfully fetched ${response.data.length} cryptocurrencies`);
                return response.data;

            } catch (error) {
                lastError = error;
                
                // Handle rate limiting
                if (error.response?.status === 429) {
                    this.handleRateLimitError(error);
                    break; // Don't retry rate limit errors
                }
                
                // Handle other HTTP errors
                if (error.response) {
                    console.error(`❌ HTTP ${error.response.status}: ${error.response.statusText}`);
                    if (error.response.status >= 500) {
                        // Server error - retry with backoff
                        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                        console.log(`⏳ Server error, retrying in ${backoffMs/1000}s...`);
                        await this.sleep(backoffMs);
                        continue;
                    } else {
                        // Client error - don't retry
                        break;
                    }
                } else if (error.code === 'ECONNABORTED') {
                    console.error('❌ Request timeout');
                    const backoffMs = Math.min(2000 * attempt, 10000);
                    console.log(`⏳ Timeout, retrying in ${backoffMs/1000}s...`);
                    await this.sleep(backoffMs);
                    continue;
                } else {
                    // Network error - retry with backoff
                    console.error(`❌ Network error: ${error.message}`);
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                    console.log(`⏳ Network error, retrying in ${backoffMs/1000}s...`);
                    await this.sleep(backoffMs);
                    continue;
                }
            }
        }

        // All retries failed - handle gracefully
        console.error(`❌ Failed to fetch crypto data after ${maxRetries} attempts:`, lastError?.message);
        this.handleRateLimitError(lastError);

        // Return cached data if available
        if (this.apiCache[cacheKey]) {
            const cacheAge = Date.now() - this.apiCache[cacheKey].timestamp;
            console.log(`📦 Falling back to cached data (${Math.round(cacheAge / 1000 / 60)} minutes old)`);
            return this.apiCache[cacheKey].data;
        }

        // No cached data available
        console.error('❌ No cached data available, returning empty array');
        return [];
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) {
            return null;
        }

        const deltas = [];
        for (let i = 1; i < prices.length; i++) {
            deltas.push(prices[i] - prices[i - 1]);
        }

        const gains = deltas.map(delta => delta > 0 ? delta : 0);
        const losses = deltas.map(delta => delta < 0 ? Math.abs(delta) : 0);

        const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) return 100;

        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        return rsi;
    }

    // Calculate Simple Moving Average
    calculateSMA(prices, period) {
        if (prices.length < period) return null;
        const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    }

    // Calculate Exponential Moving Average
    calculateEMA(prices, period) {
        if (prices.length < period) return null;
        
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    // Calculate MACD (Moving Average Convergence Divergence)
    calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (prices.length < slowPeriod) return null;

        const fastEMA = this.calculateEMA(prices, fastPeriod);
        const slowEMA = this.calculateEMA(prices, slowPeriod);
        
        if (!fastEMA || !slowEMA) return null;
        
        const macdLine = fastEMA - slowEMA;
        
        // Calculate signal line (EMA of MACD line)
        // For simplicity, we'll use a basic calculation
        const signalLine = macdLine * 0.2 + (macdLine * 0.8); // Simplified signal
        const histogram = macdLine - signalLine;
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: histogram
        };
    }

    // Calculate Bollinger Bands
    calculateBollingerBands(prices, period = 20, stdDev = 2) {
        if (prices.length < period) return null;
        
        const sma = this.calculateSMA(prices, period);
        if (!sma) return null;
        
        // Calculate standard deviation
        const recentPrices = prices.slice(-period);
        const variance = recentPrices.reduce((acc, price) => {
            return acc + Math.pow(price - sma, 2);
        }, 0) / period;
        
        const standardDeviation = Math.sqrt(variance);
        
        return {
            upper: sma + (standardDeviation * stdDev),
            middle: sma,
            lower: sma - (standardDeviation * stdDev),
            bandwidth: ((sma + (standardDeviation * stdDev)) - (sma - (standardDeviation * stdDev))) / sma * 100
        };
    }

    // Calculate Support and Resistance levels
    calculateSupportResistance(coinData, prices) {
        const currentPrice = coinData.current_price || 0;
        const high24h = coinData.high_24h || 0;
        const low24h = coinData.low_24h || 0;
        
        if (prices.length < 20) {
            return {
                resistance: high24h,
                support: low24h,
                strength: 'weak'
            };
        }
        
        // Find recent highs and lows for support/resistance
        const recentPrices = prices.slice(-20);
        const maxPrice = Math.max(...recentPrices);
        const minPrice = Math.min(...recentPrices);
        
        // Calculate pivot points
        const pivot = (high24h + low24h + currentPrice) / 3;
        const resistance1 = (2 * pivot) - low24h;
        const support1 = (2 * pivot) - high24h;
        
        // Determine strength based on how many times price touched these levels
        const touchCount = recentPrices.filter(price => 
            Math.abs(price - resistance1) / resistance1 < 0.02 || 
            Math.abs(price - support1) / support1 < 0.02
        ).length;
        
        const strength = touchCount >= 3 ? 'strong' : touchCount >= 2 ? 'moderate' : 'weak';
        
        return {
            resistance: resistance1,
            support: support1,
            pivot: pivot,
            strength: strength,
            maxPrice: maxPrice,
            minPrice: minPrice
        };
    }

    // Comprehensive Technical Analysis
    calculateTechnicalAnalysis(coinData) {
        const coinId = coinData.id;
        let prices = this.priceHistory[coinId] || [];
        const currentPrice = coinData.current_price || 0;
        
        // If we don't have enough price history, try to use sparkline data as fallback
        if (prices.length < 20 && coinData.sparkline_in_7d && coinData.sparkline_in_7d.price) {
            const sparklinePrices = coinData.sparkline_in_7d.price.filter(price => price !== null && price !== undefined);
            if (sparklinePrices.length >= 20) {
                prices = sparklinePrices;
                console.log(`Using sparkline data for ${coinId} technical analysis (${prices.length} points)`);
            }
        }
        
        if (prices.length < 20) {
            return {
                available: false,
                reason: 'Insufficient price history'
            };
        }
        
        // Calculate all technical indicators
        const rsi = this.calculateRSI(prices);
        const sma20 = this.calculateSMA(prices, 20);
        const sma50 = this.calculateSMA(prices, 50);
        const sma200 = this.calculateSMA(prices, 200);
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macd = this.calculateMACD(prices);
        const bollinger = this.calculateBollingerBands(prices);
        const supportResistance = this.calculateSupportResistance(coinData, prices);
        
        // Generate trading signals
        const signals = [];
        
        // Moving Average signals
        if (sma20 && sma50) {
            if (currentPrice > sma20 && sma20 > sma50) {
                signals.push('📈 Bullish MA alignment (Price > SMA20 > SMA50)');
            } else if (currentPrice < sma20 && sma20 < sma50) {
                signals.push('📉 Bearish MA alignment (Price < SMA20 < SMA50)');
            }
        }
        
        // Bollinger Bands signals
        if (bollinger) {
            if (currentPrice <= bollinger.lower) {
                signals.push('🎯 Price at lower Bollinger Band - potential bounce');
            } else if (currentPrice >= bollinger.upper) {
                signals.push('⚠️ Price at upper Bollinger Band - potential reversal');
            }
        }
        
        // MACD signals
        if (macd) {
            if (macd.macd > macd.signal && macd.histogram > 0) {
                signals.push('🚀 MACD bullish crossover');
            } else if (macd.macd < macd.signal && macd.histogram < 0) {
                signals.push('🔻 MACD bearish crossover');
            }
        }
        
        // Support/Resistance signals
        const distanceToSupport = supportResistance.support ? ((currentPrice - supportResistance.support) / supportResistance.support * 100) : 0;
        const distanceToResistance = supportResistance.resistance ? ((supportResistance.resistance - currentPrice) / currentPrice * 100) : 0;
        
        if (distanceToSupport < 2 && distanceToSupport > 0) {
            signals.push(`💪 Near ${supportResistance.strength} support level`);
        }
        if (distanceToResistance < 2 && distanceToResistance > 0) {
            signals.push(`🚧 Near ${supportResistance.strength} resistance level`);
        }
        
        // Determine data source for display purposes
        const originalPrices = this.priceHistory[coinId] || [];
        const usingSparkline = originalPrices.length < 20 && coinData.sparkline_in_7d && coinData.sparkline_in_7d.price;
        
        return {
            available: true,
            dataSource: usingSparkline ? 'sparkline' : 'history',
            rsi: rsi ? parseFloat(rsi.toFixed(2)) : null,
            movingAverages: {
                sma20: sma20 ? parseFloat(sma20.toFixed(6)) : null,
                sma50: sma50 ? parseFloat(sma50.toFixed(6)) : null,
                sma200: sma200 ? parseFloat(sma200.toFixed(6)) : null,
                ema12: ema12 ? parseFloat(ema12.toFixed(6)) : null,
                ema26: ema26 ? parseFloat(ema26.toFixed(6)) : null
            },
            macd: macd ? {
                macd: parseFloat(macd.macd.toFixed(6)),
                signal: parseFloat(macd.signal.toFixed(6)),
                histogram: parseFloat(macd.histogram.toFixed(6))
            } : null,
            bollingerBands: bollinger ? {
                upper: parseFloat(bollinger.upper.toFixed(6)),
                middle: parseFloat(bollinger.middle.toFixed(6)),
                lower: parseFloat(bollinger.lower.toFixed(6)),
                bandwidth: parseFloat(bollinger.bandwidth.toFixed(2))
            } : null,
            supportResistance: {
                resistance: parseFloat(supportResistance.resistance.toFixed(6)),
                support: parseFloat(supportResistance.support.toFixed(6)),
                pivot: parseFloat(supportResistance.pivot.toFixed(6)),
                strength: supportResistance.strength,
                distanceToSupport: parseFloat(distanceToSupport.toFixed(2)),
                distanceToResistance: parseFloat(distanceToResistance.toFixed(2))
            },
            technicalSignals: signals,
            priceDataPoints: prices.length
        };
    }

    detectVolumeSpike(coinData) {
        const currentVolume = coinData.total_volume || 0;
        const marketCap = coinData.market_cap || 1;
        
        const volumeRatio = currentVolume / marketCap;
        
        // Look for moderate volume increase - early accumulation
        // Not massive spikes which indicate pump already happened
        return volumeRatio > 0.08 && volumeRatio < 0.25;
    }

    analyzePriceMomentum(coinData) {
        const priceChange1h = coinData.price_change_percentage_1h_in_currency || 0;
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        const priceChange7d = coinData.price_change_percentage_7d_in_currency || 0;

        let momentumScore = 0;

        // EARLY MOMENTUM DETECTION - Look for small but consistent gains
        // 1 hour - early signs, not major pumps
        if (priceChange1h > 0.5 && priceChange1h < 3) {
            momentumScore += 2; // Steady early growth
        } else if (priceChange1h >= 3) {
            momentumScore -= 1; // Already pumped
        }

        // 24 hour - moderate gains, not explosive
        if (priceChange24h > 2 && priceChange24h < 8) {
            momentumScore += 2; // Building momentum
        } else if (priceChange24h >= 8) {
            momentumScore -= 2; // Already pumped significantly
        }

        // 7 day analysis - recovery patterns
        if (priceChange7d < -15 && priceChange24h > 0) {
            // Recovering from dip - potential bounce
            momentumScore += 3;
        } else if (priceChange7d > 15) {
            momentumScore -= 1; // Already had major run
        }

        return momentumScore;
    }

    checkBreakoutPatterns(coinData) {
        const currentPrice = coinData.current_price || 0;
        const high24h = coinData.high_24h || 0;
        const low24h = coinData.low_24h || 0;

        if (high24h === 0 || low24h === 0) return false;

        const pricePosition = (currentPrice - low24h) / (high24h - low24h);
        
        // Look for accumulation pattern - price in middle range, not at highs
        // This suggests building pressure, not already broken out
        return pricePosition > 0.4 && pricePosition < 0.7;
    }

    // Check market cap movement - early growth signals
    checkMarketCapMovement(coinData) {
        const marketCapChange24h = coinData.market_cap_change_percentage_24h || 0;
        
        // Look for early market cap growth, not explosive growth
        return marketCapChange24h > 3 && marketCapChange24h < 12;
    }

    // New method: Check for whale accumulation patterns
    checkAccumulationPattern(coinData) {
        const priceChange1h = coinData.price_change_percentage_1h_in_currency || 0;
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        const volume = coinData.total_volume || 0;
        const marketCap = coinData.market_cap || 1;
        
        // Look for: stable/slightly positive price + increasing volume
        const volumeRatio = volume / marketCap;
        const priceStable = Math.abs(priceChange1h) < 2 && priceChange24h > -5;
        const moderateVolume = volumeRatio > 0.05;
        
        return priceStable && moderateVolume;
    }

    // New method: Detect recovery from dip
    checkDipRecovery(coinData) {
        const priceChange7d = coinData.price_change_percentage_7d_in_currency || 0;
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        const priceChange1h = coinData.price_change_percentage_1h_in_currency || 0;
        
        // Token was down significantly but showing early recovery signs
        const wasDown = priceChange7d < -10;
        const earlyRecovery = priceChange24h > 0 && priceChange1h > -1;
        
        return wasDown && earlyRecovery;
    }

    // New method: Check if token has been consolidating
    checkConsolidation(coinData) {
        const high24h = coinData.high_24h || 0;
        const low24h = coinData.low_24h || 0;
        const currentPrice = coinData.current_price || 0;
        
        if (high24h === 0 || low24h === 0) return false;
        
        // Small daily range suggests consolidation before breakout
        const dailyRange = ((high24h - low24h) / currentPrice) * 100;
        return dailyRange < 8; // Less than 8% daily range
    }

    // Analyze overall market trend based on top cryptocurrencies
    analyzeMarketTrend(coinsData) {
        if (!coinsData || coinsData.length === 0) {
            return {
                trend: 'Unknown',
                description: 'Unable to determine market trend - no data available',
                details: {}
            };
        }

        // Focus on top 20 coins by market cap for market trend analysis
        const topCoins = coinsData.slice(0, 20);
        
        let bullishCount = 0;
        let bearishCount = 0;
        let neutralCount = 0;
        
        let avgChange1h = 0;
        let avgChange24h = 0;
        let avgChange7d = 0;
        let totalVolume = 0;
        let totalMarketCap = 0;

        // Analyze each top coin
        topCoins.forEach(coin => {
            const change1h = coin.price_change_percentage_1h_in_currency || 0;
            const change24h = coin.price_change_percentage_24h_in_currency || 0;
            const change7d = coin.price_change_percentage_7d_in_currency || 0;
            
            avgChange1h += change1h;
            avgChange24h += change24h;
            avgChange7d += change7d;
            totalVolume += coin.total_volume || 0;
            totalMarketCap += coin.market_cap || 0;
            
            // Determine individual coin trend
            if (change24h > 2 && change7d > 0) {
                bullishCount++;
            } else if (change24h < -2 && change7d < 0) {
                bearishCount++;
            } else {
                neutralCount++;
            }
        });

        // Calculate averages
        avgChange1h /= topCoins.length;
        avgChange24h /= topCoins.length;
        avgChange7d /= topCoins.length;
        
        // Calculate volume to market cap ratio for market activity
        const volumeRatio = (totalVolume / totalMarketCap) * 100;

        // Determine overall trend
        let trend = 'Neutral';
        let description = '';
        let emoji = '⚖️';

        if (bullishCount >= topCoins.length * 0.6) {
            // 60% or more coins are bullish
            trend = 'Bullish';
            emoji = '🐂';
            if (avgChange24h > 5) {
                description = 'Strong bullish momentum across major cryptocurrencies';
            } else {
                description = 'Moderate bullish sentiment in the crypto market';
            }
        } else if (bearishCount >= topCoins.length * 0.6) {
            // 60% or more coins are bearish
            trend = 'Bearish';
            emoji = '🐻';
            if (avgChange24h < -5) {
                description = 'Strong bearish pressure across major cryptocurrencies';
            } else {
                description = 'Moderate bearish sentiment in the crypto market';
            }
        } else {
            // Mixed signals
            trend = 'Neutral';
            emoji = '⚖️';
            if (Math.abs(avgChange24h) < 1) {
                description = 'Sideways market with mixed signals from major cryptocurrencies';
            } else if (avgChange24h > 0) {
                description = 'Cautiously bullish with mixed signals across the market';
            } else {
                description = 'Cautiously bearish with mixed signals across the market';
            }
        }

        return {
            trend,
            emoji,
            description,
            details: {
                bullishCoins: bullishCount,
                bearishCoins: bearishCount,
                neutralCoins: neutralCount,
                avgChange1h: avgChange1h.toFixed(2),
                avgChange24h: avgChange24h.toFixed(2),
                avgChange7d: avgChange7d.toFixed(2),
                volumeRatio: volumeRatio.toFixed(2),
                totalCoinsAnalyzed: topCoins.length
            }
        };
    }

    analyzeCoin(coinData) {
        const signals = [];
        let score = 0;

        // Volume analysis - early accumulation
        if (this.detectVolumeSpike(coinData)) {
            signals.push('📊 Moderate volume increase - potential accumulation');
            score += 2;
        }

        // Momentum analysis - early momentum, not late pumps
        const momentumScore = this.analyzePriceMomentum(coinData);
        if (momentumScore >= 3) {
            signals.push(`🔄 Early positive momentum (${momentumScore}/7)`);
            score += momentumScore;
        } else if (momentumScore < 0) {
            signals.push('⚠️ Already pumped - reducing score');
            score += momentumScore; // This will reduce the score
        }

        // Pre-breakout accumulation pattern
        if (this.checkBreakoutPatterns(coinData)) {
            signals.push('📈 Accumulation pattern detected');
            score += 3;
        }

        // Market cap movement - early growth
        if (this.checkMarketCapMovement(coinData)) {
            signals.push('💹 Steady market cap growth');
            score += 2;
        }

        // New predictive indicators
        if (this.checkAccumulationPattern(coinData)) {
            signals.push('🐋 Potential whale accumulation pattern');
            score += 3;
        }

        if (this.checkDipRecovery(coinData)) {
            signals.push('🔄 Recovery from dip - potential bounce');
            score += 2;
        }

        if (this.checkConsolidation(coinData)) {
            signals.push('⚖️ Consolidation pattern - building pressure');
            score += 2;
        }

        // RSI analysis - focus on oversold for recovery plays
        const coinId = coinData.id;
        let rsiPrices = this.priceHistory[coinId] || [];
        
        // Use sparkline data as fallback if we don't have enough price history
        if (rsiPrices.length <= 14 && coinData.sparkline_in_7d && coinData.sparkline_in_7d.price) {
            const sparklinePrices = coinData.sparkline_in_7d.price.filter(price => price !== null && price !== undefined);
            if (sparklinePrices.length > 14) {
                rsiPrices = sparklinePrices;
            }
        }
        
        if (rsiPrices.length > 14) {
            const rsi = this.calculateRSI(rsiPrices);
            if (rsi !== null) {
                if (rsi < 35) {
                    signals.push(`📉 Oversold - potential reversal (RSI: ${rsi.toFixed(2)})`);
                    score += 3;
                } else if (rsi > 65) {
                    signals.push(`⚠️ Already overbought (RSI: ${rsi.toFixed(2)})`);
                    score -= 2; // Reduce score for overbought
                }
            }
        }

        // Penalty for tokens that already pumped significantly
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        if (priceChange24h > 15) {
            signals.push('🚨 Already pumped significantly today');
            score -= 5;
        }

        // Quality filters
        const marketCap = coinData.market_cap || 0;
        const volume24h = coinData.total_volume || 0;
        
        if (marketCap < 10000000 || volume24h < 100000) {
            score = Math.max(0, score - 3);
        }

        return { score, signals };
    }

    // Analyze Higher Time Frame (HTF) investment opportunities
    analyzeHTFInvestment(coinData) {
        const signals = [];
        let score = 0;

        const priceChange7d = coinData.price_change_percentage_7d_in_currency || 0;
        const priceChange30d = coinData.price_change_percentage_30d_in_currency || 0;
        const priceChange1h = coinData.price_change_percentage_1h_in_currency || 0;
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        const currentPrice = coinData.current_price || 0;
        const volume = coinData.total_volume || 0;
        const marketCap = coinData.market_cap || 1;
        const marketCapRank = coinData.market_cap_rank || 999;

        // HTF FOCUS: Prioritize longer timeframes (30d, 7d) over short-term noise
        // Reduce weight of 1h and 24h changes for more stability

        // Higher timeframe trend analysis (weekly/monthly) - MAIN SCORING
        if (priceChange30d > 20 && priceChange7d > 5) {
            signals.push('📈 Strong monthly uptrend with weekly momentum');
            score += 5; // Increased weight for strong HTF trends
        } else if (priceChange30d > 10 && priceChange7d > 0) {
            signals.push('📊 Positive monthly trend with weekly consolidation');
            score += 4; // Increased weight
        } else if (priceChange30d > 5 && priceChange7d > -5) {
            signals.push('📊 Moderate monthly growth with stable weekly trend');
            score += 2; // New condition for moderate stability
        }

        // Long-term momentum building
        if (priceChange7d > 15 && priceChange30d > 25) {
            signals.push('🚀 Accelerating long-term momentum');
            score += 4; // Increased weight
        }

        // Recovery from significant dip (buying the dip opportunity)
        if (priceChange30d < -20 && priceChange7d > 10) {
            signals.push('🔄 Strong recovery from monthly decline - potential reversal');
            score += 5; // Increased weight for recovery plays
        } else if (priceChange30d < -10 && priceChange7d > 5) {
            signals.push('🔄 Moderate recovery from monthly decline');
            score += 3; // New condition for moderate recovery
        }

        // Sustained growth pattern with REDUCED short-term volatility impact
        if (priceChange7d > 3 && priceChange30d > 10) {
            // Removed 24h volatility check for HTF stability
            signals.push('⚖️ Sustained growth pattern - HTF suitable');
            score += 3;
        }

        // Market cap and liquidity considerations for HTF investing
        if (marketCap > 1000000000) { // > $1B market cap
            signals.push('💎 Large cap stability for long-term holding');
            score += 3; // Increased weight for stability
        } else if (marketCap > 500000000) { // > $500M market cap
            signals.push('🔹 Large mid cap with institutional interest');
            score += 2; // New tier for better stability
        } else if (marketCap > 100000000) { // > $100M market cap
            signals.push('🔸 Mid cap with growth potential');
            score += 1;
        }

        // Volume consistency for HTF - STRICTER for stability
        const volumeRatio = volume / marketCap;
        if (volumeRatio > 0.01 && volumeRatio < 0.20) { // Wider range but higher minimum
            signals.push('📊 Consistent volume for HTF investment');
            score += 2;
        } else if (volumeRatio > 0.005) {
            signals.push('📊 Adequate volume for HTF consideration');
            score += 1; // New condition for moderate volume
        }

        // Technical analysis for HTF
        const coinId = coinData.id;
        let rsiPrices = this.priceHistory[coinId] || [];
        
        // Use sparkline data as fallback if we don't have enough price history
        if (rsiPrices.length <= 14 && coinData.sparkline_in_7d && coinData.sparkline_in_7d.price) {
            const sparklinePrices = coinData.sparkline_in_7d.price.filter(price => price !== null && price !== undefined);
            if (sparklinePrices.length > 14) {
                rsiPrices = sparklinePrices;
            }
        }
        
        if (rsiPrices.length > 14) {
            const rsi = this.calculateRSI(rsiPrices);
            if (rsi !== null) {
                if (rsi > 35 && rsi < 75) { // Wider range for HTF
                    signals.push(`📈 Healthy RSI for HTF entry (${rsi.toFixed(2)})`);
                    score += 2;
                } else if (rsi < 35) {
                    signals.push(`💪 Oversold RSI - HTF accumulation zone (${rsi.toFixed(2)})`);
                    score += 3;
                }
            }
        }

        // Rank consideration - STRICTER for HTF stability
        if (marketCapRank > 300) {
            signals.push('⚠️ Very low ranked coin - high risk for HTF');
            score -= 4; // Increased penalty
        } else if (marketCapRank > 150) {
            signals.push('⚠️ Lower ranked coin - moderate risk for HTF');
            score -= 2;
        } else if (marketCapRank <= 30) {
            signals.push('🏆 Top 30 coin - excellent for HTF investment');
            score += 3; // Increased reward
        } else if (marketCapRank <= 50) {
            signals.push('🏆 Top 50 coin - suitable for HTF investment');
            score += 2;
        } else if (marketCapRank <= 100) {
            signals.push('✅ Top 100 coin - good HTF candidate');
            score += 1;
        }

        // REDUCED impact of short-term pumps for HTF stability
        if (priceChange24h > 30) {
            signals.push('⚠️ Extreme short-term pump - wait for consolidation');
            score -= 2; // Reduced penalty
        } else if (priceChange1h > 15) {
            signals.push('⚠️ Recent large spike - monitor for HTF entry');
            score -= 1; // Reduced penalty
        }

        // STRICTER quality filters for HTF investing
        if (marketCap < 100000000 || volume < 5000000) { // Increased minimums
            score = Math.max(0, score - 6); // Increased penalty for low liquidity
        }

        // Enhanced bonus for established trends
        if (priceChange30d > 0 && priceChange7d > -5 && score >= 4) { // More lenient 7d requirement
            signals.push('🎯 Multi-timeframe HTF alignment');
            score += 2;
        }

        // NEW: Stability bonus for consistent performers
        if (Math.abs(priceChange7d) < 20 && priceChange30d > 5) {
            signals.push('⚖️ Stable weekly performance with monthly growth');
            score += 1;
        }

        return { score, signals };
    }

    // Enhanced HTF analysis with stability and persistence
    analyzeHTFInvestmentWithStability(coinData) {
        const coinId = coinData.id;
        const currentAnalysis = this.analyzeHTFInvestment(coinData);
        
        // Initialize HTF history for this coin if not exists
        if (!this.htfHistory[coinId]) {
            this.htfHistory[coinId] = {
                scores: [],
                firstSeen: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };
        }
        
        const htfData = this.htfHistory[coinId];
        
        // Add current score to history
        htfData.scores.push({
            score: currentAnalysis.score,
            timestamp: new Date().toISOString(),
            signals: currentAnalysis.signals
        });
        
        // Keep only last 10 scores for stability calculation
        if (htfData.scores.length > 10) {
            htfData.scores.shift();
        }
        
        htfData.lastUpdated = new Date().toISOString();
        
        // Calculate stability metrics
        const recentScores = htfData.scores.map(s => s.score);
        const avgScore = recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length;
        const scoreVariance = recentScores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / recentScores.length;
        const scoreStability = Math.max(0, 10 - scoreVariance); // Higher stability = lower variance
        
        // Calculate trend consistency (how many times it scored >= 5)
        const qualifyingScores = recentScores.filter(score => score >= 5).length;
        const consistencyRatio = qualifyingScores / recentScores.length;
        
        // Enhanced scoring with stability factors
        let stabilizedScore = avgScore;
        
        // Stability bonus: reward consistent high performers
        if (consistencyRatio >= 0.7 && avgScore >= 5) {
            stabilizedScore += 1;
            currentAnalysis.signals.push('🎯 Consistent HTF performer - stability bonus');
        }
        
        // Persistence bonus: reward coins that maintain HTF status
        if (htfData.scores.length >= 5 && consistencyRatio >= 0.6) {
            stabilizedScore += 0.5;
            currentAnalysis.signals.push('⚖️ Persistent HTF candidate - longevity bonus');
        }
        
        // Hysteresis: Make it harder for coins to drop out once established
        if (qualifyingScores >= 3 && currentAnalysis.score >= 4) {
            stabilizedScore = Math.max(stabilizedScore, 5.0);
            currentAnalysis.signals.push('🔒 HTF status maintained via hysteresis');
        }
        
        return {
            score: Math.round(stabilizedScore * 10) / 10, // Round to 1 decimal
            signals: currentAnalysis.signals,
            stability: {
                avgScore: Math.round(avgScore * 10) / 10,
                variance: Math.round(scoreVariance * 10) / 10,
                consistency: Math.round(consistencyRatio * 100),
                dataPoints: recentScores.length
            }
        };
    }

    // Analyze bearish signals for shorting opportunities
    analyzeBearishCoin(coinData) {
        const signals = [];
        let score = 0;

        const priceChange1h = coinData.price_change_percentage_1h_in_currency || 0;
        const priceChange24h = coinData.price_change_percentage_24h_in_currency || 0;
        const priceChange7d = coinData.price_change_percentage_7d_in_currency || 0;
        const currentPrice = coinData.current_price || 0;
        const high24h = coinData.high_24h || 0;
        const low24h = coinData.low_24h || 0;
        const volume = coinData.total_volume || 0;
        const marketCap = coinData.market_cap || 1;

        // Bearish momentum detection
        if (priceChange1h < -1 && priceChange24h < -3) {
            signals.push('📉 Strong bearish momentum - early decline');
            score += 3;
        } else if (priceChange1h < -0.5 && priceChange24h < -1.5) {
            signals.push('📉 Moderate bearish momentum');
            score += 2;
        }

        // Breakdown from resistance
        if (high24h > 0 && currentPrice < (high24h * 0.95)) {
            signals.push('💔 Breaking down from 24h high');
            score += 2;
        }

        // Volume spike with price decline (distribution)
        const volumeRatio = volume / marketCap;
        if (volumeRatio > 0.1 && priceChange24h < -2) {
            signals.push('📊 High volume with price decline - potential distribution');
            score += 3;
        }

        // Overbought conditions (potential for reversal down)
        const coinId = coinData.id;
        let rsiPrices = this.priceHistory[coinId] || [];
        
        // Use sparkline data as fallback if we don't have enough price history
        if (rsiPrices.length <= 14 && coinData.sparkline_in_7d && coinData.sparkline_in_7d.price) {
            const sparklinePrices = coinData.sparkline_in_7d.price.filter(price => price !== null && price !== undefined);
            if (sparklinePrices.length > 14) {
                rsiPrices = sparklinePrices;
            }
        }
        
        if (rsiPrices.length > 14) {
            const rsi = this.calculateRSI(rsiPrices);
            if (rsi !== null && rsi > 70) {
                signals.push(`📈 Overbought condition (RSI: ${rsi.toFixed(2)}) - potential reversal`);
                score += 3;
            }
        }

        // Recent pump followed by decline
        if (priceChange7d > 15 && priceChange24h < -3) {
            signals.push('🎢 Recent pump losing steam - potential correction');
            score += 2;
        }

        // Bearish divergence patterns
        if (priceChange7d > 0 && priceChange24h < -2 && priceChange1h < -1) {
            signals.push('📊 Bearish divergence - weekly gains fading');
            score += 2;
        }

        // Failed breakout (fake breakout)
        if (priceChange24h > 5 && priceChange1h < -2) {
            signals.push('🚫 Failed breakout - potential reversal');
            score += 3;
        }

        // Market cap decline with volume
        const marketCapChange24h = coinData.market_cap_change_percentage_24h || 0;
        if (marketCapChange24h < -5 && volumeRatio > 0.08) {
            signals.push('📉 Market cap declining with volume');
            score += 2;
        }

        // Quality filters - avoid very small caps for shorting
        if (marketCap < 50000000 || volume < 500000) {
            score = Math.max(0, score - 4);
        }

        // Penalty for already heavily declined coins
        if (priceChange24h < -15) {
            signals.push('⚠️ Already declined significantly');
            score -= 3;
        }

        return { score, signals };
    }

    // Comprehensive BTC Analysis
    analyzeBTC(btcData) {
        if (!btcData) return null;

        const currentPrice = btcData.current_price || 0;
        const change1h = btcData.price_change_percentage_1h_in_currency || 0;
        const change24h = btcData.price_change_percentage_24h_in_currency || 0;
        const change7d = btcData.price_change_percentage_7d_in_currency || 0;
        const change30d = btcData.price_change_percentage_30d_in_currency || 0;
        const volume = btcData.total_volume || 0;
        const marketCap = btcData.market_cap || 0;
        const high24h = btcData.high_24h || 0;
        const low24h = btcData.low_24h || 0;

        // Get technical analysis
        const technicalAnalysis = this.calculateTechnicalAnalysis(btcData);

        // BTC-specific analysis
        const analysis = {
            name: btcData.name || 'Bitcoin',
            symbol: btcData.symbol?.toUpperCase() || 'BTC',
            currentPrice: currentPrice,
            marketCap: marketCap,
            volume24h: volume,
            dominance: this.calculateBTCDominance(marketCap),
            priceChanges: {
                change1h: change1h,
                change24h: change24h,
                change7d: change7d,
                change30d: change30d
            },
            dailyRange: {
                high: high24h,
                low: low24h,
                range: high24h > 0 && low24h > 0 ? ((high24h - low24h) / low24h * 100).toFixed(2) : 0
            },
            technicalAnalysis: technicalAnalysis,
            marketSentiment: this.analyzeBTCMarketSentiment(btcData),
            keyLevels: this.calculateBTCKeyLevels(currentPrice, high24h, low24h),
            volumeAnalysis: this.analyzeBTCVolume(volume, marketCap),
            trendAnalysis: this.analyzeBTCTrend(change1h, change24h, change7d, change30d),
            lastUpdated: new Date().toISOString()
        };

        return analysis;
    }

    // Calculate BTC Dominance (estimated)
    calculateBTCDominance(btcMarketCap) {
        // Rough estimation - in reality this would need total market cap
        const estimatedTotalMarketCap = btcMarketCap * 2.2; // BTC typically ~45% dominance
        return ((btcMarketCap / estimatedTotalMarketCap) * 100).toFixed(1);
    }

    // Analyze BTC Market Sentiment
    analyzeBTCMarketSentiment(btcData) {
        const change24h = btcData.price_change_percentage_24h_in_currency || 0;
        const change7d = btcData.price_change_percentage_7d_in_currency || 0;
        const volume = btcData.total_volume || 0;
        const marketCap = btcData.market_cap || 1;
        const volumeRatio = (volume / marketCap) * 100;

        let sentiment = 'Neutral';
        let confidence = 'Medium';
        let signals = [];

        // Determine sentiment based on price action and volume
        if (change24h > 3 && change7d > 5) {
            sentiment = 'Very Bullish';
            confidence = volumeRatio > 3 ? 'High' : 'Medium';
            signals.push('🚀 Strong upward momentum');
        } else if (change24h > 1 && change7d > 0) {
            sentiment = 'Bullish';
            confidence = volumeRatio > 2 ? 'High' : 'Medium';
            signals.push('📈 Positive trend');
        } else if (change24h < -3 && change7d < -5) {
            sentiment = 'Very Bearish';
            confidence = volumeRatio > 3 ? 'High' : 'Medium';
            signals.push('📉 Strong downward pressure');
        } else if (change24h < -1 && change7d < 0) {
            sentiment = 'Bearish';
            confidence = volumeRatio > 2 ? 'High' : 'Medium';
            signals.push('🔻 Negative trend');
        } else {
            signals.push('⚖️ Sideways movement');
        }

        // Volume analysis
        if (volumeRatio > 4) {
            signals.push('📊 High trading volume');
        } else if (volumeRatio < 1) {
            signals.push('📊 Low trading volume');
        }

        return {
            sentiment: sentiment,
            confidence: confidence,
            signals: signals,
            volumeRatio: volumeRatio.toFixed(2)
        };
    }

    // Calculate BTC Key Levels
    calculateBTCKeyLevels(currentPrice, high24h, low24h) {
        // Psychological levels for BTC
        const psychLevels = [];
        const priceRounded = Math.floor(currentPrice / 1000) * 1000;
        
        for (let i = -2; i <= 2; i++) {
            const level = priceRounded + (i * 1000);
            if (level > 0) {
                psychLevels.push({
                    level: level,
                    type: i === 0 ? 'current' : i > 0 ? 'resistance' : 'support',
                    distance: ((level - currentPrice) / currentPrice * 100).toFixed(2)
                });
            }
        }

        return {
            psychological: psychLevels,
            dailyHigh: high24h,
            dailyLow: low24h,
            midPoint: high24h && low24h ? ((high24h + low24h) / 2).toFixed(2) : null
        };
    }

    // Analyze BTC Volume
    analyzeBTCVolume(volume, marketCap) {
        const volumeRatio = (volume / marketCap) * 100;
        let analysis = '';
        let strength = 'Medium';

        if (volumeRatio > 4) {
            analysis = 'Very High - Significant market activity';
            strength = 'High';
        } else if (volumeRatio > 2.5) {
            analysis = 'High - Above average trading';
            strength = 'High';
        } else if (volumeRatio > 1.5) {
            analysis = 'Moderate - Normal trading activity';
            strength = 'Medium';
        } else {
            analysis = 'Low - Below average trading';
            strength = 'Low';
        }

        return {
            ratio: volumeRatio.toFixed(2),
            analysis: analysis,
            strength: strength,
            volume24h: volume
        };
    }

    // Analyze BTC Trend
    analyzeBTCTrend(change1h, change24h, change7d, change30d) {
        const trends = [];
        
        // Short-term trend (1h)
        if (Math.abs(change1h) > 1) {
            trends.push({
                timeframe: '1h',
                direction: change1h > 0 ? 'Up' : 'Down',
                strength: Math.abs(change1h) > 2 ? 'Strong' : 'Moderate',
                change: change1h.toFixed(2)
            });
        }

        // Daily trend (24h)
        trends.push({
            timeframe: '24h',
            direction: change24h > 0 ? 'Up' : change24h < 0 ? 'Down' : 'Flat',
            strength: Math.abs(change24h) > 3 ? 'Strong' : Math.abs(change24h) > 1 ? 'Moderate' : 'Weak',
            change: change24h.toFixed(2)
        });

        // Weekly trend (7d)
        trends.push({
            timeframe: '7d',
            direction: change7d > 0 ? 'Up' : change7d < 0 ? 'Down' : 'Flat',
            strength: Math.abs(change7d) > 10 ? 'Strong' : Math.abs(change7d) > 3 ? 'Moderate' : 'Weak',
            change: change7d.toFixed(2)
        });

        // Monthly trend (30d)
        if (change30d !== undefined && change30d !== null) {
            trends.push({
                timeframe: '30d',
                direction: change30d > 0 ? 'Up' : change30d < 0 ? 'Down' : 'Flat',
                strength: Math.abs(change30d) > 20 ? 'Strong' : Math.abs(change30d) > 5 ? 'Moderate' : 'Weak',
                change: change30d.toFixed(2)
            });
        }

        return trends;
    }

    // Analyze Market Cap Indices (TOTAL, TOTAL2, TOTAL3)
    async analyzeMarketCapIndices() {
        try {
            // Fetch market cap indices data from CoinGecko
            // Note: These are synthetic indices, so we'll create them from actual market data
            const coinsUrl = `${this.baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d`;
            
            const response = await axios.get(coinsUrl);
            const coinsData = response.data;
            
            // Calculate TOTAL (all cryptocurrencies)
            const totalMarketCap = coinsData.reduce((sum, coin) => sum + (coin.market_cap || 0), 0);
            const totalVolume = coinsData.reduce((sum, coin) => sum + (coin.total_volume || 0), 0);
            
            // Calculate TOTAL2 (excluding Bitcoin)
            const btcData = coinsData.find(coin => coin.id === 'bitcoin');
            const total2MarketCap = totalMarketCap - (btcData ? btcData.market_cap || 0 : 0);
            const total2Volume = totalVolume - (btcData ? btcData.total_volume || 0 : 0);
            
            // Calculate TOTAL3 (altcoins only - excluding BTC and ETH)
            const ethData = coinsData.find(coin => coin.id === 'ethereum');
            const total3MarketCap = total2MarketCap - (ethData ? ethData.market_cap || 0 : 0);
            const total3Volume = total2Volume - (ethData ? ethData.total_volume || 0 : 0);
            
            // Calculate weighted average price changes for each index
            const calculateWeightedChanges = (coins, excludeIds = []) => {
                const filteredCoins = coins.filter(coin => !excludeIds.includes(coin.id));
                const totalMcap = filteredCoins.reduce((sum, coin) => sum + (coin.market_cap || 0), 0);
                
                if (totalMcap === 0) return { change1h: 0, change24h: 0, change7d: 0, change30d: 0 };
                
                const change1h = filteredCoins.reduce((sum, coin) => {
                    const weight = (coin.market_cap || 0) / totalMcap;
                    return sum + (weight * (coin.price_change_percentage_1h_in_currency || 0));
                }, 0);
                
                const change24h = filteredCoins.reduce((sum, coin) => {
                    const weight = (coin.market_cap || 0) / totalMcap;
                    return sum + (weight * (coin.price_change_percentage_24h_in_currency || 0));
                }, 0);
                
                const change7d = filteredCoins.reduce((sum, coin) => {
                    const weight = (coin.market_cap || 0) / totalMcap;
                    return sum + (weight * (coin.price_change_percentage_7d_in_currency || 0));
                }, 0);
                
                const change30d = filteredCoins.reduce((sum, coin) => {
                    const weight = (coin.market_cap || 0) / totalMcap;
                    return sum + (weight * (coin.price_change_percentage_30d_in_currency || 0));
                }, 0);
                
                return { change1h, change24h, change7d, change30d };
            };
            
            const totalChanges = calculateWeightedChanges(coinsData);
            const total2Changes = calculateWeightedChanges(coinsData, ['bitcoin']);
            const total3Changes = calculateWeightedChanges(coinsData, ['bitcoin', 'ethereum']);
            
            // Create synthetic data objects
            const totalData = {
                id: 'total-market-cap',
                name: 'Total Market Cap',
                symbol: 'total',
                current_price: totalMarketCap,
                market_cap: totalMarketCap,
                total_volume: totalVolume,
                price_change_percentage_1h_in_currency: totalChanges.change1h,
                price_change_percentage_24h_in_currency: totalChanges.change24h,
                price_change_percentage_7d_in_currency: totalChanges.change7d,
                price_change_percentage_30d_in_currency: totalChanges.change30d
            };
            
            const total2Data = {
                id: 'total2-market-cap',
                name: 'Total Market Cap (excl. BTC)',
                symbol: 'total2',
                current_price: total2MarketCap,
                market_cap: total2MarketCap,
                total_volume: total2Volume,
                price_change_percentage_1h_in_currency: total2Changes.change1h,
                price_change_percentage_24h_in_currency: total2Changes.change24h,
                price_change_percentage_7d_in_currency: total2Changes.change7d,
                price_change_percentage_30d_in_currency: total2Changes.change30d
            };
            
            const total3Data = {
                id: 'total3-market-cap',
                name: 'Altcoin Market Cap',
                symbol: 'total3',
                current_price: total3MarketCap,
                market_cap: total3MarketCap,
                total_volume: total3Volume,
                price_change_percentage_1h_in_currency: total3Changes.change1h,
                price_change_percentage_24h_in_currency: total3Changes.change24h,
                price_change_percentage_7d_in_currency: total3Changes.change7d,
                price_change_percentage_30d_in_currency: total3Changes.change30d
            };
            

            
            const analysis = {
                total: totalData ? this.analyzeMarketCapIndex(totalData, 'TOTAL', 'Total Crypto Market Cap') : null,
                total2: total2Data ? this.analyzeMarketCapIndex(total2Data, 'TOTAL2', 'Total Market Cap (excl. BTC)') : null,
                total3: total3Data ? this.analyzeMarketCapIndex(total3Data, 'TOTAL3', 'Altcoin Market Cap') : null,
                timestamp: new Date().toISOString(),
                analysis: this.analyzeMarketCapRelationships(totalData, total2Data, total3Data)
            };

            return analysis;
        } catch (error) {
            console.error('Error fetching market cap indices:', error.message);
            return null;
        }
    }

    // Analyze individual market cap index
    analyzeMarketCapIndex(data, symbol, name) {
        if (!data) return null;

        const currentPrice = data.current_price || 0;
        const change1h = data.price_change_percentage_1h_in_currency || 0;
        const change24h = data.price_change_percentage_24h_in_currency || 0;
        const change7d = data.price_change_percentage_7d_in_currency || 0;
        const change30d = data.price_change_percentage_30d_in_currency || 0;
        const marketCap = data.market_cap || 0;
        const volume = data.total_volume || 0;

        // Calculate technical analysis if we have price history
        const technicalAnalysis = this.calculateTechnicalAnalysis(data);

        // Determine market phase
        const marketPhase = this.determineMarketPhase(change24h, change7d, change30d);
        
        // Calculate momentum
        const momentum = this.calculateMomentum(change1h, change24h, change7d);

        return {
            name: name,
            symbol: symbol,
            currentValue: currentPrice,
            marketCap: marketCap,
            volume24h: volume,
            priceChanges: {
                change1h: change1h,
                change24h: change24h,
                change7d: change7d,
                change30d: change30d
            },
            marketPhase: marketPhase,
            momentum: momentum,
            technicalAnalysis: technicalAnalysis,
            signals: this.generateMarketCapSignals(change1h, change24h, change7d, change30d, volume, marketCap)
        };
    }

    // Determine market phase
    determineMarketPhase(change24h, change7d, change30d) {
        let phase = 'Consolidation';
        let strength = 'Weak';
        let description = '';

        // Bull Market Phases
        if (change24h > 2 && change7d > 5 && change30d > 10) {
            phase = 'Bull Run';
            strength = 'Strong';
            description = 'Strong upward momentum across all timeframes';
        } else if (change24h > 1 && change7d > 2 && change30d > 5) {
            phase = 'Bull Market';
            strength = 'Moderate';
            description = 'Consistent upward trend';
        } else if (change7d > 3 || change30d > 8) {
            phase = 'Recovery';
            strength = 'Moderate';
            description = 'Market recovering from previous decline';
        }
        
        // Bear Market Phases
        else if (change24h < -2 && change7d < -5 && change30d < -10) {
            phase = 'Bear Market';
            strength = 'Strong';
            description = 'Strong downward pressure across timeframes';
        } else if (change24h < -1 && change7d < -3 && change30d < -5) {
            phase = 'Correction';
            strength = 'Moderate';
            description = 'Market in correction phase';
        } else if (change7d < -2 || change30d < -5) {
            phase = 'Decline';
            strength = 'Weak';
            description = 'Gradual market decline';
        }
        
        // Sideways/Consolidation
        else {
            phase = 'Consolidation';
            strength = Math.abs(change7d) < 2 ? 'Weak' : 'Moderate';
            description = 'Market moving sideways with low volatility';
        }

        return {
            phase: phase,
            strength: strength,
            description: description
        };
    }

    // Calculate momentum
    calculateMomentum(change1h, change24h, change7d) {
        let momentum = 'Neutral';
        let score = 0;

        // Weight different timeframes
        score += change1h * 0.2;  // 20% weight for 1h
        score += change24h * 0.4; // 40% weight for 24h
        score += change7d * 0.4;  // 40% weight for 7d

        if (score > 3) {
            momentum = 'Very Bullish';
        } else if (score > 1) {
            momentum = 'Bullish';
        } else if (score > -1) {
            momentum = 'Neutral';
        } else if (score > -3) {
            momentum = 'Bearish';
        } else {
            momentum = 'Very Bearish';
        }

        return {
            momentum: momentum,
            score: score.toFixed(2),
            acceleration: this.calculateAcceleration(change1h, change24h, change7d)
        };
    }

    // Calculate acceleration (momentum change)
    calculateAcceleration(change1h, change24h, change7d) {
        // Simple acceleration calculation
        const shortTerm = (change1h + change24h) / 2;
        const longTerm = change7d;
        
        if (shortTerm > longTerm + 1) {
            return 'Accelerating Up';
        } else if (shortTerm < longTerm - 1) {
            return 'Accelerating Down';
        } else {
            return 'Stable';
        }
    }

    // Generate market cap signals
    generateMarketCapSignals(change1h, change24h, change7d, change30d, volume, marketCap) {
        const signals = [];

        // Momentum signals
        if (change1h > 0.5 && change24h > 1) {
            signals.push('🚀 Strong short-term momentum');
        } else if (change1h < -0.5 && change24h < -1) {
            signals.push('📉 Bearish short-term momentum');
        }

        // Trend signals
        if (change7d > 5 && change30d > 10) {
            signals.push('📈 Sustained uptrend across timeframes');
        } else if (change7d < -5 && change30d < -10) {
            signals.push('🔻 Sustained downtrend across timeframes');
        }

        // Reversal signals
        if (change24h > 2 && change7d < -3) {
            signals.push('🔄 Potential trend reversal - bounce from decline');
        } else if (change24h < -2 && change7d > 3) {
            signals.push('⚠️ Potential trend reversal - pullback from gains');
        }

        // Volume signals
        const volumeRatio = volume && marketCap ? (volume / marketCap) * 100 : 0;
        if (volumeRatio > 2) {
            signals.push('📊 High trading activity');
        } else if (volumeRatio < 0.5) {
            signals.push('📊 Low trading activity');
        }

        // Market phase signals
        if (change30d > 20) {
            signals.push('🎯 Monthly bull run in progress');
        } else if (change30d < -20) {
            signals.push('🎯 Monthly bear market conditions');
        }

        return signals;
    }

    // Analyze relationships between market cap indices
    analyzeMarketCapRelationships(totalData, total2Data, total3Data) {
        if (!totalData || !total2Data) return null;

        const btcDominance = total2Data.current_price && totalData.current_price ? 
            ((totalData.current_price - total2Data.current_price) / totalData.current_price * 100).toFixed(1) : null;

        const altcoinDominance = total3Data && totalData.current_price ? 
            (total3Data.current_price / totalData.current_price * 100).toFixed(1) : null;

        // Compare performance
        const totalChange24h = totalData.price_change_percentage_24h_in_currency || 0;
        const total2Change24h = total2Data.price_change_percentage_24h_in_currency || 0;
        const total3Change24h = total3Data ? (total3Data.price_change_percentage_24h_in_currency || 0) : 0;

        const relationships = [];

        // BTC vs Altcoin performance
        if (totalChange24h > total2Change24h + 1) {
            relationships.push('₿ Bitcoin outperforming altcoins');
        } else if (total2Change24h > totalChange24h + 1) {
            relationships.push('🔄 Altcoins outperforming Bitcoin');
        } else {
            relationships.push('⚖️ Bitcoin and altcoins moving in sync');
        }

        // Market leadership
        if (total3Change24h > total2Change24h && total3Change24h > totalChange24h) {
            relationships.push('🚀 Altcoins leading the market');
        } else if (totalChange24h > total2Change24h && totalChange24h > total3Change24h) {
            relationships.push('₿ Bitcoin leading the market');
        }

        // Dominance trends
        if (btcDominance) {
            if (totalChange24h - total2Change24h > 0.5) {
                relationships.push('📈 Bitcoin dominance increasing');
            } else if (total2Change24h - totalChange24h > 0.5) {
                relationships.push('📉 Bitcoin dominance decreasing');
            }
        }

        return {
            btcDominance: btcDominance,
            altcoinDominance: altcoinDominance,
            relationships: relationships,
            marketLeader: this.identifyMarketLeaderWithStability(totalChange24h, total2Change24h, total3Change24h)
        };
    }

    // Identify market leader with stability
    identifyMarketLeaderWithStability(totalChange, total2Change, total3Change) {
        const currentLeader = this.identifyMarketLeader(totalChange, total2Change, total3Change);
        
        // Add current analysis to history
        const leaderEntry = {
            timestamp: new Date().toISOString(),
            leader: currentLeader.leader,
            strength: currentLeader.strength,
            changes: {
                total: totalChange,
                total2: total2Change,
                total3: total3Change
            },
            margin: Math.abs(Math.max(totalChange, total2Change, total3Change) - 
                           Math.min(totalChange, total2Change, total3Change))
        };
        
        this.marketLeaderHistory.push(leaderEntry);
        
        // Keep only last 15 entries for stability analysis
        if (this.marketLeaderHistory.length > 15) {
            this.marketLeaderHistory.shift();
        }
        
        // Calculate stability metrics
        if (this.marketLeaderHistory.length >= 3) {
            const recentLeaders = this.marketLeaderHistory.slice(-10).map(entry => entry.leader);
            const leaderCounts = {};
            
            recentLeaders.forEach(leader => {
                leaderCounts[leader] = (leaderCounts[leader] || 0) + 1;
            });
            
            const dominantLeader = Object.keys(leaderCounts).reduce((a, b) => 
                leaderCounts[a] > leaderCounts[b] ? a : b
            );
            
            const dominantCount = leaderCounts[dominantLeader];
            const stabilityRatio = dominantCount / recentLeaders.length;
            
            // Apply hysteresis: if there's a clear dominant leader (>60% of recent history),
            // stick with it unless the margin is very clear (>3%)
            if (stabilityRatio > 0.6 && leaderEntry.margin < 3) {
                return {
                    leader: dominantLeader,
                    strength: `${currentLeader.strength} (stabilized)`,
                    stability: {
                        dominantLeader: dominantLeader,
                        stabilityRatio: Math.round(stabilityRatio * 100),
                        recentSwitches: this.countLeaderSwitches(),
                        margin: Math.round(leaderEntry.margin * 100) / 100
                    }
                };
            }
        }
        
        return {
            ...currentLeader,
            stability: {
                dominantLeader: currentLeader.leader,
                stabilityRatio: 100,
                recentSwitches: this.countLeaderSwitches(),
                margin: Math.round(leaderEntry.margin * 100) / 100
            }
        };
    }

    // Helper function to count recent leader switches
    countLeaderSwitches() {
        if (this.marketLeaderHistory.length < 2) return 0;
        
        let switches = 0;
        for (let i = 1; i < Math.min(this.marketLeaderHistory.length, 10); i++) {
            if (this.marketLeaderHistory[i].leader !== this.marketLeaderHistory[i-1].leader) {
                switches++;
            }
        }
        return switches;
    }

    // Original market leader identification (kept for internal use)
    identifyMarketLeader(totalChange, total2Change, total3Change) {
        if (totalChange > total2Change && totalChange > total3Change) {
            return { leader: 'Bitcoin', strength: 'Leading market direction' };
        } else if (total2Change > totalChange && total2Change > total3Change) {
            return { leader: 'Large Cap Altcoins', strength: 'Driving market performance' };
        } else if (total3Change > totalChange && total3Change > total2Change) {
            return { leader: 'Small Cap Altcoins', strength: 'Outperforming larger caps' };
        } else {
            return { leader: 'Mixed', strength: 'No clear market leader' };
        }
    }

    // Comprehensive Cycle Top/Bottom Analysis
    async analyzeCycles(coinsData, btcData, marketCapData) {
        try {
            const cycleAnalysis = {
                btcCycle: this.analyzeBTCCycle(btcData),
                marketCycle: this.analyzeMarketCycle(marketCapData),
                altcoinCycle: this.analyzeAltcoinCycle(coinsData),
                overallCycle: null,
                cyclePhase: null,
                cycleSignals: [],
                riskLevel: 'Medium',
                confidenceLevel: 'Medium',
                timeToNextPhase: null,
                historicalContext: this.getHistoricalContext(),
                timestamp: new Date().toISOString()
            };

            // Calculate overall cycle based on all indicators
            cycleAnalysis.overallCycle = this.calculateOverallCycle(
                cycleAnalysis.btcCycle,
                cycleAnalysis.marketCycle,
                cycleAnalysis.altcoinCycle
            );

            // Determine current cycle phase with stability
            cycleAnalysis.cyclePhase = this.determineCyclePhaseWithStability(cycleAnalysis.overallCycle);

            // Generate cycle signals
            cycleAnalysis.cycleSignals = this.generateCycleSignals(
                cycleAnalysis.btcCycle,
                cycleAnalysis.marketCycle,
                cycleAnalysis.altcoinCycle,
                cycleAnalysis.overallCycle
            );

            // Calculate risk level
            cycleAnalysis.riskLevel = this.calculateCycleRisk(cycleAnalysis.overallCycle);

            // Calculate confidence level
            cycleAnalysis.confidenceLevel = this.calculateConfidenceLevel(
                cycleAnalysis.btcCycle,
                cycleAnalysis.marketCycle,
                cycleAnalysis.altcoinCycle
            );

            return cycleAnalysis;
        } catch (error) {
            console.error('Error in cycle analysis:', error.message);
            return null;
        }
    }

    // Analyze Bitcoin Cycle
    analyzeBTCCycle(btcData) {
        if (!btcData) return null;

        const price = btcData.currentPrice || 0;
        const change24h = btcData.priceChanges?.change24h || 0;
        const change7d = btcData.priceChanges?.change7d || 0;
        const change30d = btcData.priceChanges?.change30d || 0;
        const volume = btcData.volume24h || 0;
        const marketCap = btcData.marketCap || 0;

        // Historical context (approximate)
        const athEstimate = 73000; // Approximate ATH
        const atlEstimate = 15500; // Approximate recent cycle low
        const priceFromATH = ((price - athEstimate) / athEstimate) * 100;
        const priceFromATL = ((price - atlEstimate) / atlEstimate) * 100;

        // Cycle indicators
        const indicators = {
            pricePosition: this.calculatePricePosition(price, athEstimate, atlEstimate),
            momentum: this.calculateCycleMomentum(change24h, change7d, change30d),
            volumeProfile: this.analyzeVolumeProfile(volume, marketCap),
            technicalPosition: this.analyzeTechnicalPosition(btcData.technicalAnalysis),
            fearGreedIndex: this.estimateFearGreedFromPrice(priceFromATH)
        };

        // Determine cycle stage
        const cycleStage = this.determineBTCCycleStage(indicators);

        return {
            asset: 'Bitcoin',
            currentPrice: price,
            priceFromATH: priceFromATH.toFixed(1),
            priceFromATL: priceFromATL.toFixed(1),
            cycleStage: cycleStage,
            indicators: indicators,
            signals: this.generateBTCCycleSignals(indicators, cycleStage),
            riskScore: this.calculateBTCRiskScore(indicators),
            opportunityScore: this.calculateBTCOpportunityScore(indicators)
        };
    }

    // Analyze Market Cycle
    analyzeMarketCycle(marketCapData) {
        if (!marketCapData || !marketCapData.total) return null;

        const totalMcap = marketCapData.total.currentValue || 0;
        const totalChange24h = marketCapData.total.priceChanges?.change24h || 0;
        const totalChange7d = marketCapData.total.priceChanges?.change7d || 0;
        const totalChange30d = marketCapData.total.priceChanges?.change30d || 0;

        // Market cycle indicators
        const indicators = {
            marketCapPosition: this.calculateMarketCapPosition(totalMcap),
            marketMomentum: this.calculateCycleMomentum(totalChange24h, totalChange7d, totalChange30d),
            dominanceShift: this.analyzeDominanceShift(marketCapData.analysis),
            marketPhase: marketCapData.total.marketPhase,
            altcoinSeason: this.detectAltcoinSeason(marketCapData)
        };

        const cycleStage = this.determineMarketCycleStage(indicators);

        return {
            totalMarketCap: totalMcap,
            cycleStage: cycleStage,
            indicators: indicators,
            signals: this.generateMarketCycleSignals(indicators, cycleStage),
            riskScore: this.calculateMarketRiskScore(indicators),
            opportunityScore: this.calculateMarketOpportunityScore(indicators)
        };
    }

    // Analyze Altcoin Cycle
    analyzeAltcoinCycle(coinsData) {
        if (!coinsData || coinsData.length === 0) return null;

        // Filter out BTC and ETH for pure altcoin analysis
        const altcoins = coinsData.filter(coin => 
            coin.id !== 'bitcoin' && coin.id !== 'ethereum'
        ).slice(0, 50); // Top 50 altcoins

        const altcoinMetrics = {
            averageChange24h: altcoins.reduce((sum, coin) => 
                sum + (coin.price_change_percentage_24h_in_currency || 0), 0) / altcoins.length,
            averageChange7d: altcoins.reduce((sum, coin) => 
                sum + (coin.price_change_percentage_7d_in_currency || 0), 0) / altcoins.length,
            averageChange30d: altcoins.reduce((sum, coin) => 
                sum + (coin.price_change_percentage_30d_in_currency || 0), 0) / altcoins.length,
            totalVolume: altcoins.reduce((sum, coin) => sum + (coin.total_volume || 0), 0),
            totalMarketCap: altcoins.reduce((sum, coin) => sum + (coin.market_cap || 0), 0)
        };

        const indicators = {
            altcoinMomentum: this.calculateCycleMomentum(
                altcoinMetrics.averageChange24h,
                altcoinMetrics.averageChange7d,
                altcoinMetrics.averageChange30d
            ),
            altcoinStrength: this.calculateAltcoinStrength(altcoinMetrics),
            breadth: this.calculateMarketBreadth(altcoins),
            speculation: this.calculateSpeculationLevel(altcoins),
            rotation: this.detectMarketRotation(altcoins)
        };

        const cycleStage = this.determineAltcoinCycleStage(indicators);

        return {
            altcoinCount: altcoins.length,
            averagePerformance: {
                change24h: altcoinMetrics.averageChange24h.toFixed(2),
                change7d: altcoinMetrics.averageChange7d.toFixed(2),
                change30d: altcoinMetrics.averageChange30d.toFixed(2)
            },
            cycleStage: cycleStage,
            indicators: indicators,
            signals: this.generateAltcoinCycleSignals(indicators, cycleStage),
            riskScore: this.calculateAltcoinRiskScore(indicators),
            opportunityScore: this.calculateAltcoinOpportunityScore(indicators)
        };
    }

    // Calculate price position in cycle
    calculatePricePosition(currentPrice, ath, atl) {
        const range = ath - atl;
        const position = ((currentPrice - atl) / range) * 100;
        
        if (position > 80) return { position: position.toFixed(1), zone: 'Cycle Top Zone', risk: 'Very High' };
        if (position > 60) return { position: position.toFixed(1), zone: 'Late Cycle', risk: 'High' };
        if (position > 40) return { position: position.toFixed(1), zone: 'Mid Cycle', risk: 'Medium' };
        if (position > 20) return { position: position.toFixed(1), zone: 'Early Cycle', risk: 'Low' };
        return { position: position.toFixed(1), zone: 'Cycle Bottom Zone', risk: 'Very Low' };
    }

    // Calculate cycle momentum
    calculateCycleMomentum(change24h, change7d, change30d) {
        const momentum = (change24h * 0.3) + (change7d * 0.4) + (change30d * 0.3);
        
        if (momentum > 15) return { momentum: momentum.toFixed(1), strength: 'Very Strong', direction: 'Up' };
        if (momentum > 5) return { momentum: momentum.toFixed(1), strength: 'Strong', direction: 'Up' };
        if (momentum > -5) return { momentum: momentum.toFixed(1), strength: 'Neutral', direction: 'Sideways' };
        if (momentum > -15) return { momentum: momentum.toFixed(1), strength: 'Weak', direction: 'Down' };
        return { momentum: momentum.toFixed(1), strength: 'Very Weak', direction: 'Down' };
    }

    // Determine BTC cycle stage
    determineBTCCycleStage(indicators) {
        const pricePos = parseFloat(indicators.pricePosition.position);
        const momentum = parseFloat(indicators.momentum.momentum);

        if (pricePos > 80 && momentum < -5) return { stage: 'Cycle Top', confidence: 'High' };
        if (pricePos > 70 && momentum > 10) return { stage: 'Late Bull Run', confidence: 'High' };
        if (pricePos > 50 && momentum > 5) return { stage: 'Mid Bull Run', confidence: 'Medium' };
        if (pricePos > 30 && momentum > 0) return { stage: 'Early Bull Run', confidence: 'Medium' };
        if (pricePos < 30 && momentum < -10) return { stage: 'Bear Market', confidence: 'High' };
        if (pricePos < 20 && momentum > -5) return { stage: 'Cycle Bottom', confidence: 'High' };
        return { stage: 'Accumulation', confidence: 'Medium' };
    }

    // Calculate overall cycle
    calculateOverallCycle(btcCycle, marketCycle, altcoinCycle) {
        const cycles = [btcCycle, marketCycle, altcoinCycle].filter(c => c !== null);
        if (cycles.length === 0) return null;

        // Weight BTC cycle more heavily (50%), market 30%, altcoin 20%
        const weights = { btc: 0.5, market: 0.3, altcoin: 0.2 };
        
        let overallRisk = 0;
        let overallOpportunity = 0;
        let totalWeight = 0;

        if (btcCycle) {
            overallRisk += btcCycle.riskScore * weights.btc;
            overallOpportunity += btcCycle.opportunityScore * weights.btc;
            totalWeight += weights.btc;
        }
        if (marketCycle) {
            overallRisk += marketCycle.riskScore * weights.market;
            overallOpportunity += marketCycle.opportunityScore * weights.market;
            totalWeight += weights.market;
        }
        if (altcoinCycle) {
            overallRisk += altcoinCycle.riskScore * weights.altcoin;
            overallOpportunity += altcoinCycle.opportunityScore * weights.altcoin;
            totalWeight += weights.altcoin;
        }

        overallRisk = overallRisk / totalWeight;
        overallOpportunity = overallOpportunity / totalWeight;

        return {
            overallRiskScore: overallRisk.toFixed(1),
            overallOpportunityScore: overallOpportunity.toFixed(1),
            cycleBias: overallOpportunity > overallRisk ? 'Bullish' : 'Bearish',
            cycleStrength: Math.abs(overallOpportunity - overallRisk).toFixed(1)
        };
    }

    // Determine cycle phase with stability
    determineCyclePhaseWithStability(overallCycle) {
        if (!overallCycle) return null;

        const currentPhase = this.determineCyclePhase(overallCycle);
        const risk = parseFloat(overallCycle.overallRiskScore);
        const opportunity = parseFloat(overallCycle.overallOpportunityScore);
        
        // Add current cycle analysis to history
        const cycleEntry = {
            timestamp: new Date().toISOString(),
            phase: currentPhase.phase,
            description: currentPhase.description,
            action: currentPhase.action,
            risk: risk,
            opportunity: opportunity,
            cycleBias: overallCycle.cycleBias,
            cycleStrength: parseFloat(overallCycle.cycleStrength)
        };
        
        this.cycleHistory.push(cycleEntry);
        
        // Keep only last 12 entries (about 1 hour of 5-minute intervals)
        if (this.cycleHistory.length > 12) {
            this.cycleHistory.shift();
        }
        
        // Calculate phase stability
        if (this.cycleHistory.length >= 3) {
            const recentPhases = this.cycleHistory.slice(-8).map(entry => entry.phase); // Last 8 entries
            const phaseCounts = {};
            
            recentPhases.forEach(phase => {
                phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
            });
            
            const dominantPhase = Object.keys(phaseCounts).reduce((a, b) => 
                phaseCounts[a] > phaseCounts[b] ? a : b
            );
            
            const dominantCount = phaseCounts[dominantPhase];
            const phaseStability = dominantCount / recentPhases.length;
            
            // Calculate average risk/opportunity for stability
            const recentEntries = this.cycleHistory.slice(-5);
            const avgRisk = recentEntries.reduce((sum, entry) => sum + entry.risk, 0) / recentEntries.length;
            const avgOpportunity = recentEntries.reduce((sum, entry) => sum + entry.opportunity, 0) / recentEntries.length;
            
            // Apply hysteresis for cycle phases
            // If we have a dominant phase (>60% of recent history) and current scores are close to boundaries,
            // stick with the dominant phase
            if (phaseStability > 0.6) {
                const riskDiff = Math.abs(risk - avgRisk);
                const opportunityDiff = Math.abs(opportunity - avgOpportunity);
                
                // If current reading is not dramatically different from recent average, keep dominant phase
                if (riskDiff < 2 && opportunityDiff < 2) {
                    const dominantEntry = this.cycleHistory.find(entry => entry.phase === dominantPhase);
                    return {
                        phase: dominantPhase,
                        description: `${dominantEntry.description} (stabilized)`,
                        action: dominantEntry.action,
                        stability: {
                            dominantPhase: dominantPhase,
                            stabilityRatio: Math.round(phaseStability * 100),
                            recentSwitches: this.countCycleSwitches(),
                            avgRisk: Math.round(avgRisk * 10) / 10,
                            avgOpportunity: Math.round(avgOpportunity * 10) / 10,
                            riskVolatility: Math.round(riskDiff * 10) / 10,
                            opportunityVolatility: Math.round(opportunityDiff * 10) / 10
                        }
                    };
                }
            }
        }
        
        return {
            ...currentPhase,
            stability: {
                dominantPhase: currentPhase.phase,
                stabilityRatio: 100,
                recentSwitches: this.countCycleSwitches(),
                avgRisk: risk,
                avgOpportunity: opportunity,
                riskVolatility: 0,
                opportunityVolatility: 0
            }
        };
    }

    // Helper function to count recent cycle phase switches
    countCycleSwitches() {
        if (this.cycleHistory.length < 2) return 0;
        
        let switches = 0;
        for (let i = 1; i < Math.min(this.cycleHistory.length, 8); i++) {
            if (this.cycleHistory[i].phase !== this.cycleHistory[i-1].phase) {
                switches++;
            }
        }
        return switches;
    }

    // Original cycle phase determination (kept for internal use)
    determineCyclePhase(overallCycle) {
        if (!overallCycle) return null;

        const risk = parseFloat(overallCycle.overallRiskScore);
        const opportunity = parseFloat(overallCycle.overallOpportunityScore);

        if (risk > 8 && opportunity < 3) return {
            phase: 'Cycle Top Warning',
            description: 'High risk of cycle top - consider taking profits',
            action: 'Reduce Risk'
        };
        if (risk > 6 && opportunity < 5) return {
            phase: 'Late Cycle',
            description: 'Advanced cycle stage - be cautious',
            action: 'Monitor Closely'
        };
        if (risk < 4 && opportunity > 7) return {
            phase: 'Cycle Bottom Opportunity',
            description: 'High probability cycle bottom - accumulation zone',
            action: 'Accumulate'
        };
        if (risk < 5 && opportunity > 5) return {
            phase: 'Early Cycle',
            description: 'Early cycle stage - good entry opportunities',
            action: 'Buy Dips'
        };
        return {
            phase: 'Mid Cycle',
            description: 'Middle of cycle - balanced risk/reward',
            action: 'Hold & Monitor'
        };
    }

    // Generate cycle signals
    generateCycleSignals(btcCycle, marketCycle, altcoinCycle, overallCycle) {
        const signals = [];

        // BTC cycle signals
        if (btcCycle) {
            if (btcCycle.cycleStage.stage === 'Cycle Top') {
                signals.push('🚨 Bitcoin showing cycle top characteristics');
            }
            if (btcCycle.cycleStage.stage === 'Cycle Bottom') {
                signals.push('🎯 Bitcoin in cycle bottom zone - accumulation opportunity');
            }
            if (parseFloat(btcCycle.priceFromATH) > -20) {
                signals.push('⚠️ Bitcoin near all-time highs - high risk zone');
            }
            if (parseFloat(btcCycle.priceFromATH) < -70) {
                signals.push('💎 Bitcoin deep discount from ATH - potential bottom');
            }
        }

        // Market cycle signals
        if (marketCycle) {
            if (marketCycle.cycleStage.stage === 'Late Bull Run') {
                signals.push('📈 Market in late bull run phase - prepare for reversal');
            }
            if (marketCycle.cycleStage.stage === 'Bear Market') {
                signals.push('🐻 Bear market conditions - focus on quality assets');
            }
        }

        // Altcoin cycle signals
        if (altcoinCycle) {
            if (altcoinCycle.indicators.speculation.level === 'Extreme') {
                signals.push('🎰 Extreme speculation in altcoins - bubble warning');
            }
            if (altcoinCycle.indicators.altcoinStrength.strength === 'Very Strong') {
                signals.push('🚀 Altcoin season in full swing');
            }
        }

        // Overall cycle signals
        if (overallCycle) {
            if (parseFloat(overallCycle.overallRiskScore) > 8) {
                signals.push('🔴 Very high cycle risk - consider profit taking');
            }
            if (parseFloat(overallCycle.overallOpportunityScore) > 8) {
                signals.push('🟢 Exceptional cycle opportunity - accumulation phase');
            }
        }

        return signals;
    }

    // Calculate various scores and indicators (helper methods)
    calculateBTCRiskScore(indicators) {
        let risk = 0;
        risk += parseFloat(indicators.pricePosition.position) / 10; // 0-10
        risk += indicators.momentum.direction === 'Down' ? 2 : 0;
        risk += indicators.fearGreedIndex > 80 ? 3 : 0;
        return Math.min(risk, 10);
    }

    calculateBTCOpportunityScore(indicators) {
        let opportunity = 0;
        opportunity += (100 - parseFloat(indicators.pricePosition.position)) / 10; // Inverse of position
        opportunity += indicators.momentum.direction === 'Up' ? 2 : 0;
        opportunity += indicators.fearGreedIndex < 20 ? 3 : 0;
        return Math.min(opportunity, 10);
    }

    estimateFearGreedFromPrice(priceFromATH) {
        // Rough estimation of fear/greed based on price position
        if (priceFromATH > -10) return 85; // Extreme greed
        if (priceFromATH > -30) return 65; // Greed
        if (priceFromATH > -50) return 50; // Neutral
        if (priceFromATH > -70) return 25; // Fear
        return 10; // Extreme fear
    }

    getHistoricalContext() {
        return {
            lastCycleTop: '2021-11',
            lastCycleLow: '2022-11',
            averageCycleLength: '4 years',
            currentCycleStart: '2022-11',
            nextHalving: '2028'
        };
    }

    // Additional helper methods for market cycle analysis
    calculateMarketCapPosition(marketCap) {
        // Rough estimates for market cap cycle analysis
        const cycleHigh = 3000000000000; // ~$3T
        const cycleLow = 800000000000;   // ~$0.8T
        const position = ((marketCap - cycleLow) / (cycleHigh - cycleLow)) * 100;
        return Math.max(0, Math.min(100, position)).toFixed(1);
    }

    analyzeDominanceShift(analysis) {
        if (!analysis || !analysis.relationships) return { shift: 'Stable', significance: 'Low' };
        
        const relationships = analysis.relationships;
        if (relationships.some(r => r.includes('Bitcoin outperforming'))) {
            return { shift: 'Bitcoin Dominance Rising', significance: 'High' };
        }
        if (relationships.some(r => r.includes('Altcoins outperforming'))) {
            return { shift: 'Altcoin Dominance Rising', significance: 'High' };
        }
        return { shift: 'Stable', significance: 'Medium' };
    }

    detectAltcoinSeason(marketCapData) {
        if (!marketCapData.total2 || !marketCapData.total) return false;
        
        const total2Change = marketCapData.total2.priceChanges?.change7d || 0;
        const totalChange = marketCapData.total.priceChanges?.change7d || 0;
        
        return total2Change > totalChange + 5; // Altcoins outperforming by 5%+
    }

    determineMarketCycleStage(indicators) {
        const mcapPos = parseFloat(indicators.marketCapPosition);
        const momentum = parseFloat(indicators.marketMomentum.momentum);
        
        if (mcapPos > 80 && momentum < -5) return { stage: 'Market Top', confidence: 'High' };
        if (mcapPos > 60 && momentum > 10) return { stage: 'Late Bull Run', confidence: 'High' };
        if (mcapPos < 30 && momentum < -10) return { stage: 'Bear Market', confidence: 'High' };
        if (mcapPos < 20) return { stage: 'Market Bottom', confidence: 'Medium' };
        return { stage: 'Mid Cycle', confidence: 'Medium' };
    }

    calculateMarketRiskScore(indicators) {
        let risk = parseFloat(indicators.marketCapPosition) / 10;
        risk += indicators.marketMomentum.direction === 'Down' ? 2 : 0;
        risk += indicators.altcoinSeason ? 1 : 0;
        return Math.min(risk, 10);
    }

    calculateMarketOpportunityScore(indicators) {
        let opportunity = (100 - parseFloat(indicators.marketCapPosition)) / 10;
        opportunity += indicators.marketMomentum.direction === 'Up' ? 2 : 0;
        opportunity += !indicators.altcoinSeason ? 1 : 0;
        return Math.min(opportunity, 10);
    }

    generateMarketCycleSignals(indicators, cycleStage) {
        const signals = [];
        if (cycleStage.stage === 'Market Top') signals.push('📊 Market showing top characteristics');
        if (cycleStage.stage === 'Market Bottom') signals.push('📊 Market in bottom zone');
        if (indicators.altcoinSeason) signals.push('🔄 Altcoin season detected');
        return signals;
    }

    // Altcoin cycle helper methods
    calculateAltcoinStrength(metrics) {
        const strength = (metrics.averageChange24h + metrics.averageChange7d + metrics.averageChange30d) / 3;
        if (strength > 10) return { strength: 'Very Strong', score: strength.toFixed(1) };
        if (strength > 5) return { strength: 'Strong', score: strength.toFixed(1) };
        if (strength > -5) return { strength: 'Neutral', score: strength.toFixed(1) };
        return { strength: 'Weak', score: strength.toFixed(1) };
    }

    calculateMarketBreadth(altcoins) {
        const positive = altcoins.filter(coin => (coin.price_change_percentage_24h_in_currency || 0) > 0).length;
        const breadth = (positive / altcoins.length) * 100;
        return { breadth: breadth.toFixed(1), assessment: breadth > 70 ? 'Strong' : breadth > 30 ? 'Mixed' : 'Weak' };
    }

    calculateSpeculationLevel(altcoins) {
        // Count coins with extreme moves (>20% in 24h)
        const extremeMoves = altcoins.filter(coin => 
            Math.abs(coin.price_change_percentage_24h_in_currency || 0) > 20
        ).length;
        const specRatio = (extremeMoves / altcoins.length) * 100;
        
        if (specRatio > 30) return { level: 'Extreme', ratio: specRatio.toFixed(1) };
        if (specRatio > 15) return { level: 'High', ratio: specRatio.toFixed(1) };
        if (specRatio > 5) return { level: 'Moderate', ratio: specRatio.toFixed(1) };
        return { level: 'Low', ratio: specRatio.toFixed(1) };
    }

    detectMarketRotation(altcoins) {
        // Simplified rotation detection
        const topPerformers = altcoins.slice(0, 10);
        const midTier = altcoins.slice(10, 30);
        
        const topAvg = topPerformers.reduce((sum, coin) => 
            sum + (coin.price_change_percentage_24h_in_currency || 0), 0) / topPerformers.length;
        const midAvg = midTier.reduce((sum, coin) => 
            sum + (coin.price_change_percentage_24h_in_currency || 0), 0) / midTier.length;
        
        if (midAvg > topAvg + 3) return { rotation: 'Into Smaller Caps', strength: 'Strong' };
        if (topAvg > midAvg + 3) return { rotation: 'Into Larger Caps', strength: 'Strong' };
        return { rotation: 'Stable', strength: 'Neutral' };
    }

    determineAltcoinCycleStage(indicators) {
        const momentum = parseFloat(indicators.altcoinMomentum.momentum);
        const speculation = indicators.speculation.level;
        
        if (speculation === 'Extreme' && momentum > 15) return { stage: 'Altcoin Bubble', confidence: 'High' };
        if (indicators.altcoinStrength.strength === 'Very Strong') return { stage: 'Altcoin Season', confidence: 'High' };
        if (momentum < -15) return { stage: 'Altcoin Winter', confidence: 'High' };
        if (momentum < -5) return { stage: 'Altcoin Decline', confidence: 'Medium' };
        return { stage: 'Altcoin Accumulation', confidence: 'Medium' };
    }

    calculateAltcoinRiskScore(indicators) {
        let risk = 0;
        if (indicators.speculation.level === 'Extreme') risk += 4;
        if (indicators.speculation.level === 'High') risk += 2;
        if (parseFloat(indicators.altcoinMomentum.momentum) < -10) risk += 3;
        if (indicators.breadth.assessment === 'Weak') risk += 2;
        return Math.min(risk, 10);
    }

    calculateAltcoinOpportunityScore(indicators) {
        let opportunity = 0;
        if (indicators.speculation.level === 'Low') opportunity += 3;
        if (parseFloat(indicators.altcoinMomentum.momentum) > 5) opportunity += 3;
        if (indicators.breadth.assessment === 'Strong') opportunity += 2;
        if (indicators.rotation.rotation.includes('Smaller Caps')) opportunity += 2;
        return Math.min(opportunity, 10);
    }

    generateAltcoinCycleSignals(indicators, cycleStage) {
        const signals = [];
        if (cycleStage.stage === 'Altcoin Bubble') signals.push('🎈 Altcoin bubble warning');
        if (cycleStage.stage === 'Altcoin Season') signals.push('🌟 Altcoin season active');
        if (cycleStage.stage === 'Altcoin Winter') signals.push('❄️ Altcoin winter conditions');
        if (indicators.speculation.level === 'Extreme') signals.push('⚠️ Extreme speculation detected');
        return signals;
    }

    calculateCycleRisk(overallCycle) {
        if (!overallCycle) return 'Medium';
        const risk = parseFloat(overallCycle.overallRiskScore);
        if (risk > 8) return 'Very High';
        if (risk > 6) return 'High';
        if (risk > 4) return 'Medium';
        if (risk > 2) return 'Low';
        return 'Very Low';
    }

    calculateConfidenceLevel(btcCycle, marketCycle, altcoinCycle) {
        const cycles = [btcCycle, marketCycle, altcoinCycle].filter(c => c !== null);
        if (cycles.length === 0) return 'Low';
        if (cycles.length === 3) return 'High';
        if (cycles.length === 2) return 'Medium';
        return 'Low';
    }

    // Additional helper methods for cycle analysis
    analyzeVolumeProfile(volume, marketCap) {
        const volumeRatio = marketCap > 0 ? (volume / marketCap) * 100 : 0;
        if (volumeRatio > 5) return { profile: 'High Volume', ratio: volumeRatio.toFixed(2), signal: 'Strong Activity' };
        if (volumeRatio > 2) return { profile: 'Normal Volume', ratio: volumeRatio.toFixed(2), signal: 'Moderate Activity' };
        return { profile: 'Low Volume', ratio: volumeRatio.toFixed(2), signal: 'Weak Activity' };
    }

    analyzeTechnicalPosition(technicalAnalysis) {
        if (!technicalAnalysis || !technicalAnalysis.available) {
            return { position: 'Unknown', signals: [], strength: 'Low' };
        }

        const signals = technicalAnalysis.technicalSignals || [];
        const bullishSignals = signals.filter(s => s.includes('bullish') || s.includes('buy') || s.includes('strong')).length;
        const bearishSignals = signals.filter(s => s.includes('bearish') || s.includes('sell') || s.includes('weak')).length;

        if (bullishSignals > bearishSignals + 1) {
            return { position: 'Bullish', signals: signals, strength: 'High' };
        } else if (bearishSignals > bullishSignals + 1) {
            return { position: 'Bearish', signals: signals, strength: 'High' };
        }
        return { position: 'Neutral', signals: signals, strength: 'Medium' };
    }

    generateBTCCycleSignals(indicators, cycleStage) {
        const signals = [];
        
        if (cycleStage.stage === 'Cycle Top') {
            signals.push('🚨 Cycle top formation detected');
        }
        if (cycleStage.stage === 'Cycle Bottom') {
            signals.push('💎 Cycle bottom opportunity');
        }
        if (indicators.pricePosition.zone === 'Cycle Top Zone') {
            signals.push('⚠️ Price in dangerous top zone');
        }
        if (indicators.pricePosition.zone === 'Cycle Bottom Zone') {
            signals.push('🎯 Price in accumulation zone');
        }
        if (indicators.fearGreedIndex > 80) {
            signals.push('😱 Extreme greed - high risk');
        }
        if (indicators.fearGreedIndex < 20) {
            signals.push('💪 Extreme fear - opportunity');
        }
        if (indicators.volumeProfile.profile === 'High Volume' && indicators.momentum.direction === 'Down') {
            signals.push('📉 High volume selling pressure');
        }
        if (indicators.volumeProfile.profile === 'High Volume' && indicators.momentum.direction === 'Up') {
            signals.push('📈 High volume buying pressure');
        }

        return signals;
    }

    updatePriceHistory(coinsData) {
        coinsData.forEach(coin => {
            const coinId = coin.id;
            const currentPrice = coin.current_price || 0;

            if (!this.priceHistory[coinId]) {
                this.priceHistory[coinId] = [];
            }

            this.priceHistory[coinId].push(currentPrice);

            // Keep only last 50 prices
            if (this.priceHistory[coinId].length > 50) {
                this.priceHistory[coinId].shift();
            }
        });

        // Save price history periodically
        this.savePriceHistory();
    }





    async runAnalysis() {
        console.log(`🔍 Starting crypto analysis at ${new Date().toLocaleString()}`);

        try {
            // Get top cryptocurrencies
            const coinsData = await this.getTopCryptos();

            if (!coinsData || coinsData.length === 0) {
                console.log('❌ No data retrieved');
                return;
            }

            console.log(`📊 Analyzing ${coinsData.length} cryptocurrencies...`);

            // Analyze overall market trend
            const marketTrend = this.analyzeMarketTrend(coinsData);
            console.log(`📈 Market Trend: ${marketTrend.emoji} ${marketTrend.trend} - ${marketTrend.description}`);

            // Update price history
            this.updatePriceHistory(coinsData);

            const alerts = [];

            for (const coin of coinsData) {
                const analysis = this.analyzeCoin(coin);

                // Alert threshold: score >= 6
                if (analysis.score >= 6) {
                    const alertData = {
                        name: coin.name || 'Unknown',
                        symbol: coin.symbol || 'unknown',
                        price: coin.current_price || 0,
                        rank: coin.market_cap_rank || 'N/A',
                        change24h: coin.price_change_percentage_24h_in_currency || 0,
                        score: analysis.score,
                        signals: analysis.signals
                    };
                    alerts.push(alertData);
                }
            }

            if (alerts.length > 0) {
                // Sort by score (highest first)
                alerts.sort((a, b) => b.score - a.score);
                
                console.log(`✅ Analysis complete: ${alerts.length} opportunities found`);
                alerts.forEach(alert => {
                    console.log(`   • ${alert.name} (${alert.symbol.toUpperCase()}) - Score: ${alert.score}`);
                });
            } else {
                console.log('📊 No significant signals detected in this analysis');
            }

        } catch (error) {
            console.error('❌ Error in analysis:', error.message);
        }
    }


}



module.exports = CryptoMonitor;