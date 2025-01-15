export const cryptoTemplate = `
You are a crypto news data extractor. Your task is to extract information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

Message to analyze:
{{message}}

Required Information:
1. Headline/Summary:
   - Main headline or key summary (REQUIRED)
   - Source if available
2. Tokens/Projects:
   - Main token/project mentioned (REQUIRED)
   - Related tokens/projects (if any)
3. Market Data (if available):
   - Price (numeric value only)
   - Volume (numeric value only)
   - Market cap (numeric value only)
4. Event Type:
    - Type MUST be one of these exact values (no category headers): 
     
    LISTING              // New exchange/platform listings
    DELISTING            // Removed from exchanges
    DEVELOPMENT          // Code updates, features
    UPGRADE              // Protocol changes
    
    MARKET_MOVE          // General market movement
    WHALE_MOVE           // Large transactions
    FUND_FLOW           // Institutional money
    VOLUME_SPIKE        // Trading volume spikes
    PRICE_ALERT         // Price movements
    ACCUMULATION        // Buying zones
    DISTRIBUTION        // Selling zones
    
    HACK                // Confirmed breaches
    EXPLOIT             // Vulnerabilities found
    RUGPULL             // Confirmed scams
    
    PARTNERSHIP         // Confirmed deals
    ACQUISITION         // Buyouts, mergers
    REGULATION          // Legal updates
    
    UPDATE              // General updates
    INTEGRATION         // Platform integrations
    AIRDROP             // Token distributions
    TOKENOMICS          // Supply changes
    FORK                // Chain splits
    BRIDGE              // Cross-chain
    DELEGATE            // Staking
    REBASE              // Price rebalancing
    LIQUIDITY_POOL      // Liquidity pools
    DEX                 // Decentralized exchanges
    DEFI                // Decentralized finance
    DEX_POOL            // Decentralized exchange pools

    Use NONE for:
    - Opinions/Analysis
    - Unconfirmed rumors
    - General commentary

   - Description of the event (REQUIRED)
   - Timestamp (ISO format if available)
5. Impact Assessment:
   Score MUST be based on event type and evidence:

   HIGH IMPACT (70-100):
   - MARKET EVENTS:
     • WHALE_MOVE: Moves > $10M, multiple transactions
     • FUND_FLOW: Institutional-size flows, verified sources
     • VOLUME_SPIKE: >3x average volume, multiple exchanges
     • PRICE_ALERT: >10% price change with volume
   
   - SECURITY:
     • HACK: Confirmed breaches >$1M
     • EXPLOIT: Critical vulnerabilities, active threats
     • RUGPULL: Large-scale scams, multiple victims
   
   - PROJECT NEWS:
     • LISTING: Tier-1 exchanges, major platforms
     • DEVELOPMENT: Core protocol upgrades
     • UPGRADE: Network-wide changes
   
   MEDIUM IMPACT (40-70):
   - MARKET EVENTS:
     • WHALE_MOVE: Moves $1M-$10M
     • ACCUMULATION: Sustained buying, clear pattern
     • DISTRIBUTION: Notable selling pressure
   
   - BUSINESS:
     • PARTNERSHIP: Verified collaborations
     • ACQUISITION: Strategic buyouts
     • REGULATION: Regional policy changes
   
   LOW IMPACT (0-40):
   - General updates
   - Minor integrations
   - Small market moves
   - Unverified news

   CONFIDENCE SCORING:
   90-100: Multiple tier-1 sources, on-chain proof
   70-90:  Verified source + supporting evidence
   40-70:  Single reliable source
   0-40:   Unverified/unclear sources

Example:
"Binance lists new token" = {
    impact: 80,     // Tier-1 exchange listing
    confidence: 95  // Official announcement
}

"Unverified rumor of partnership" = {
    impact: 30,     // Potential but unconfirmed
    confidence: 20  // No reliable source
}

Output format (numbers must be numeric, not strings):
{
    "headline": {
        "text": "main headline or summary",
        "source": "source if available"
    },
    "tokens": {
        "primary": "main token symbol",
        "related": ["token1", "token2"]
    },
    "market_data": {
        "price": 0.0,
        "volume": 0.0,
        "market_cap": 0.0
    },
    "event": {
        "type": "MUST BE ONE OF THE TYPES LISTED ABOVE",
        "description": "brief event description",
        "timestamp": null
    },
    "metrics": {
        "impact": 50,
        "confidence": 50
    }
}`;