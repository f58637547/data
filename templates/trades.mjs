export const tradesTemplate = `
Extract trade information from this message and return it as a valid JSON object.
DO NOT include any comments or explanatory text - ONLY pure JSON.

Message to analyze:
{{message}}

Required Information:
1. Headline/Summary:
   - Main trade idea/setup
   - Author/source if available
2. Position Details:
   - Token/Pair
   - Entry price
   - Target price
   - Stop loss
3. Trade Metrics:
   - Position size
   - Leverage used
   - Risk/Reward ratio
4. Strategy:
   - Trade type (Long/Short)
   - Timeframe
   - Key levels

Return ONLY this JSON structure, no comments or extra text:
{
    "headline": {
        "text": "brief summary of trade",
        "author": "source if available"
    },
    "position": {
        "token": "base token symbol",
        "pair": "trading pair (e.g. BTC/USD)",
        "entry": 0,
        "target": 0,
        "stop": 0
    },
    "metrics": {
        "size": 0,
        "leverage": 0,
        "risk_reward": 0
    },
    "strategy": {
        "type": "LONG or SHORT",
        "timeframe": "timeframe",
        "key_levels": [0, 0]
    }
}`;
