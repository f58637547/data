export const cryptoTemplate = `
Extract crypto news information and return it as a valid JSON object.

Message to analyze:
{{message}}

Required Information:
1. Headline/Summary:
   - Main headline or key summary
   - Source if available
2. Tokens/Projects:
   - Main token/project mentioned
   - Related tokens/projects
3. Market Data:
   - Price mentions
   - Volume/liquidity
   - Market cap
4. Event Type:
   - Listing/Delisting
   - Partnership/Integration
   - Protocol Update
   - Market Movement
5. Impact Assessment:
   - Market impact (1-100)
   - Confidence (1-100)

Return ONLY this JSON structure, no other text:
{
    "headline": {
        "text": "main headline or summary",
        "source": "source if available"
    },
    "tokens": {
        "primary": "main token symbol",
        "related": ["array", "of", "related", "tokens"]
    },
    "market_data": {
        "price": 0,
        "volume": 0,
        "market_cap": 0
    },
    "event": {
        "type": "one of: LISTING, PARTNERSHIP, UPDATE, MARKET_MOVE",
        "description": "brief event description",
        "timestamp": "ISO date if available"
    },
    "metrics": {
        "impact": 0,
        "confidence": 0
    }
}`;