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
   - Type must be one of: LISTING, PARTNERSHIP, UPDATE, MARKET_MOVE (REQUIRED)
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
        "type": "LISTING|PARTNERSHIP|UPDATE|MARKET_MOVE",
        "description": "brief event description",
        "timestamp": null
    },
    "metrics": {
        "impact": 50,
        "confidence": 50
    }
}`;