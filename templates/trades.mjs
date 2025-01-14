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
    - Type MUST be one of:
   
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
     - MARKET_MOVE (general market movement)
     - WHALE_MOVE (large transactions)
     - FUND_FLOW (institutional money)
     - VOLUME_SPIKE (unusual trading volume)
     - PRICE_ALERT (significant price moves)
     
     Use NONE for:
     - General market commentary
     - Unconfirmed signals
     - Past trade reviews
   
   - Description of the event (REQUIRED)
   - Timestamp (ISO format if available)

5. Impact Assessment:
   Score MUST be based on event type and evidence:

   HIGH IMPACT (70-100):
   - ENTRY SIGNALS:
     • LEVERAGE_ENTRY: Large size (>$100K), clear setup
     • FUTURES_ENTRY: Major support/resistance levels
     • SPOT_ENTRY: Strong accumulation zones
   
   - EXIT SIGNALS:
     • TAKE_PROFIT: Major targets hit
     • STOP_LOSS: Key level breaches
     • POSITION_EXIT: Complete position close
   
   - ANALYSIS:
     • BREAKOUT: Major pattern completion
     • REVERSAL: Trend change confirmation
     • WHALE_MOVE: >$10M position changes
     • VOLUME_SPIKE: >3x average volume
   
   MEDIUM IMPACT (40-70):
   - ENTRY/EXIT:
     • Regular position sizes
     • Partial entries/exits
     • Multiple timeframe alignment
   
   - MARKET EVENTS:
     • ACCUMULATION: Clear buying patterns
     • DISTRIBUTION: Notable selling
     • FUND_FLOW: Institutional activity
   
   LOW IMPACT (0-40):
   - Small position sizes
   - Unclear patterns
   - Single timeframe signals
   - Unconfirmed movements

   CONFIDENCE SCORING:
   90-100: Multiple confirmations:
          • Multiple timeframe alignment
          • Volume confirmation
          • Pattern completion
   70-90:  Strong setup:
          • Clear support/resistance
          • Good risk/reward
          • Clean chart structure
   40-70:  Basic setup:
          • Single timeframe
          • Basic pattern
          • Average risk/reward
   0-40:   Weak setup:
          • No clear levels
          • Poor risk/reward
          • Messy chart

Example:
"BTC breaks major resistance with volume" = {
    impact: 85,     // Major breakout + volume
    confidence: 90  // Multiple confirmations
}

"Small altcoin showing possible reversal" = {
    impact: 35,     // Minor pattern, small cap
    confidence: 50  // Single timeframe only
}

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
