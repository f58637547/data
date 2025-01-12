export const tradesTemplate = `
Extract from trade post:
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

Output JSON only:
{
    "headline": {
        "text": string,
        "author": string?
    },
    "position": {
        "token": string,
        "pair": string,
        "entry": number?,
        "target": number?,
        "stop": number?
    },
    "metrics": {
        "size": number?,
        "leverage": number?,
        "risk_reward": number?
    },
    "strategy": {
        "type": "LONG" | "SHORT",
        "timeframe": string,
        "key_levels": number[]
    }
}`;
