export const tradesTemplate = `
You are a trade data extractor. Your task is to extract trade information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

Message to analyze:
{{message}}

Required Information:
1. Headline/Summary:
   - Main trade idea/setup
   - Author/source if available
2. Position Details:
   - Token/Pair (REQUIRED)
   - Entry price (REQUIRED)
   - Target price
   - Stop loss
3. Trade Metrics:
   - Position size
   - Leverage used
   - Risk/Reward ratio
4. Event Type:
    - Type MUST be one of: SPOT_ENTRY, FUTURES_ENTRY, LEVERAGE_ENTRY, TAKE_PROFIT, 
     STOP_LOSS, POSITION_EXIT, BREAKOUT, REVERSAL, ACCUMULATION, DISTRIBUTION, or NONE if unclear
   
     ENTRY SIGNALS:
     - SPOT_ENTRY (spot market buys)
     - FUTURES_ENTRY (futures positions)
     - LEVERAGE_ENTRY (margin trades)
     
     EXIT SIGNALS:
     - TAKE_PROFIT (profit targets hit)
     - STOP_LOSS (stop levels hit)
     - POSITION_EXIT (general exits)
     
     ANALYSIS:
     - BREAKOUT (pattern breakouts)
     - REVERSAL (trend changes)
     - ACCUMULATION (buying zones)
     - DISTRIBUTION (selling zones)
     
     Use NONE for:
     - General market commentary
     - Unconfirmed signals
     - Past trade reviews
   
   - Description of the event (REQUIRED)
   - Timestamp (ISO format if available)

Output format (numbers must be numeric, not strings):
{
    "headline": {
        "text": "brief summary of trade",
        "author": "source if available"
    },
    "position": {
        "token": "base token symbol",
        "pair": "trading pair",
        "entry": 0.0,
        "target": 0.0,
        "stop": 0.0
    },
    "metrics": {
        "size": 0.0,
        "leverage": 0,
        "risk_reward": 0.0
    },
    "event": {
        "type": "MUST BE ONE OF THE TYPES LISTED ABOVE",
        "description": "brief event description",
        "timestamp": null
    }
}`;
