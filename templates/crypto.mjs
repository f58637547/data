export const cryptoTemplate = `
Extract from crypto news:
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

Output JSON only:
{
    "headline": {
        "text": string,
        "source": string?
    },
    "tokens": {
        "primary": string,
        "related": string[]
    },
    "market_data": {
        "price": number?,
        "volume": number?,
        "market_cap": number?
    },
    "event": {
        "type": string,
        "description": string,
        "timestamp": string?
    },
    "metrics": {
        "impact": number,
        "confidence": number
    }
}`;