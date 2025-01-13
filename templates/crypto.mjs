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
    - Type MUST be one of: 
     
     PROJECT NEWS:
     - LISTING (new exchange/platform listings)
     - DELISTING (removed from exchanges)
     - DEVELOPMENT (code updates, features)
     - UPGRADE (protocol changes, forks)
     
     MARKET EVENTS:
     - MARKET_MOVE (general market movement)
     - WHALE_MOVE (large transactions)
     - FUND_FLOW (institutional money)
     - VOLUME_SPIKE (unusual trading volume)
     - PRICE_ALERT (significant price moves)
     - ACCUMULATION (buying zones)
     - DISTRIBUTION (selling zones)
     
     SECURITY:
     - HACK (confirmed breaches)
     - EXPLOIT (vulnerabilities found)
     - RUGPULL (confirmed scams)
     
     BUSINESS:
     - PARTNERSHIP (confirmed deals)
     - ACQUISITION (buyouts, mergers)
     - REGULATION (legal updates)
     
     Use NONE for:
     - Opinions/Analysis
     - Price predictions
     - General market commentary
     - Unconfirmed rumors
   - Description of the event (REQUIRED)
   - Timestamp (ISO format if available)
5. Impact Assessment:
   - Market impact (REQUIRED: numeric 1-100)
   - Confidence (REQUIRED: numeric 1-100)

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