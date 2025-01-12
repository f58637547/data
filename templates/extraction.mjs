export const extractionTemplate = `
Extract entities from message:
{{message}}

Required Information:
1. Crypto Symbols/Tokens
2. Price Data:
   - Current price
   - Price changes
   - Volume
3. Time References
4. Event Types:
   - Listings
   - Partnerships
   - Updates
   - Trading events

Output JSON only:
{
    "symbols": string[],
    "prices": {
        "current": number?,
        "change": number?,
        "volume": number?
    },
    "events": {
        "type": string,
        "importance": number,
        "timestamp": string?
    },
    "metrics": {
        "market_impact": number,
        "confidence": number
    }
}
`;