export const cryptoTemplate = `
Extract crypto news information and return it as a valid JSON object.
DO NOT include any comments, markdown, or explanatory text - ONLY pure JSON.

Message to analyze:
{{message}}

Required Information:
1. Headline/Summary:
   - Main headline or key summary
   - Source if available
2. Tokens/Projects:
   - Main token/project mentioned (REQUIRED)
   - Related tokens/projects
3. Market Data:
   - Price mentions
   - Volume/liquidity
   - Market cap
4. Event Type:
   - Must be one of: LISTING, PARTNERSHIP, UPDATE, MARKET_MOVE (REQUIRED)
   - Description of the event (REQUIRED)
   - Timestamp (if available)
5. Impact Assessment:
   - Market impact (1-100)
   - Confidence (1-100)

Return ONLY this JSON structure, no markdown, no comments, no extra text:
{
    "headline": {
        "text": "main headline or summary",
        "source": "source if available"
    },
    "tokens": {
        "primary": "main token symbol (REQUIRED)",
        "related": ["array", "of", "related", "tokens"]
    },
    "market_data": {
        "price": 0,
        "volume": 0,
        "market_cap": 0
    },
    "event": {
        "type": "LISTING|PARTNERSHIP|UPDATE|MARKET_MOVE",
        "description": "brief event description",
        "timestamp": null
    },
    "metrics": {
        "impact": 50,
        "confidence": 50
    }
}`;