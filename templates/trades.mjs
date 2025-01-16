export const tradesTemplate = `
You are a trade data extractor. Your task is to extract trade information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

Message to analyze:
{{message}}

Author: {{author}}
RT Author: {{rtAuthor}}

Required Information:
1. Headline:
   - Use original message text as headline
   - Extract Twitter username as source
   - For RTs, include both original and RT author

2. Tokens:
   - Primary token symbol (REQUIRED)
   - Related tokens/pairs (if any)

3. Position Details:
   - Entry price
   - Target price
   - Stop loss
   - Position size
   - Leverage used
   - Risk/Reward ratio

4. Entities:
   PROJECTS/ORGS:
   - Exchanges (e.g. Binance, Bybit)
   - Protocols (e.g. GMX, dYdX)
   
   PERSONS:
   - Traders (Authors, Analysts)
   - Notable Figures (Influencers)
   
   LOCATIONS:
   - Trading Venues
   - Jurisdictions

5. Event Type:
   IMPORTANT: Type MUST be EXACTLY one of these values, no variations allowed:
   
    // Trade Entry Events
    SPOT_ENTRY          // Spot market buys
    FUTURES_ENTRY       // Futures positions
    LEVERAGE_ENTRY      // Margin trades
    
    // Trade Exit Events
    TAKE_PROFIT         // Profit targets hit
    STOP_LOSS          // Stop levels hit
    POSITION_EXIT       // General exits
    
    // Technical Analysis Events
    BREAKOUT           // Pattern breakouts (triangles, ranges)
    REVERSAL           // Trend change signals
    ACCUMULATION       // Buying zone identified
    DISTRIBUTION       // Selling zone identified
    
    // Market Analysis Events
    MARKET_MOVE        // General price movement
    WHALE_MOVE         // Large wallet transactions
    FUND_FLOW          // Institutional money flow
    VOLUME_SPIKE       // Unusual trading volume
    PRICE_ALERT        // Significant price levels
    
    Use NONE for:
    - General market commentary
    - Unconfirmed signals
    - Past trade reviews
    - Educational content
   
   - Description of the event (REQUIRED)

6. Impact & Confidence Assessment:
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

7. Direction & Bias:
   POSITION DIRECTION:
   - LONG: Bullish position entry/setup
   - SHORT: Bearish position entry/setup
   - HEDGE: Risk management position
   - NONE: Analysis only
   
   TIMEFRAME:
   - SCALP: < 24 hours
   - SWING: 1-7 days
   - POSITION: > 1 week

8. Sentiment Analysis:
   Separate from impact/confidence, measures market mood:

   MARKET SENTIMENT (0-100):
   - BULLISH (>70):
     • Price increases
     • Institutional inflows
     • Positive developments
   
   - NEUTRAL (40-70):
     • Balanced news
     • Unclear direction
     • Mixed signals
   
   - BEARISH (<40):
     • Price decreases
     • Negative news
     • Market concerns

   SOCIAL SENTIMENT (0-100):
   - HIGH (>70): Strong community support
   - MID (40-70): Mixed reactions
   - LOW (<40): Negative community response

Output format:
{
    "headline": {
        "text": "original message text",
        "source": "{{author}}",
        "rt_source": "{{rtAuthor}}"
    },
    "tokens": {
        "primary": "main token symbol",
        "related": ["token1", "token2"]
    },
    "position": {
        "entry": 0.0,
        "target": 0.0,
        "stop": 0.0,
        "size": 0.0,
        "leverage": 0,
        "risk_reward": 0.0
    },
    "metrics": {
        "impact": 50,
        "confidence": 50
    },
     "event": {
        "type": "MUST BE ONE OF THE TYPES LISTED ABOVE",
        "description": "brief event description"
    },
    "entities": {
        "projects": [{
            "name": "exchange/protocol name",
            "type": "EXCHANGE|PROTOCOL|VENUE|PLATFORM",
            "role": "primary|related|venue"
        }],
        "persons": [{
            "name": "trader name",
            "title": "role/position",
            "org": "affiliated org"
        }],
        "locations": [{
            "name": "venue name",
            "type": "EXCHANGE|REGION"
        }]
    },
    "direction": {
        "bias": "LONG|SHORT|HEDGE",
        "timeframe": "SCALP|SWING|POSITION"
    },
    "sentiment": {
        "market": {
            "score": 0-100,
            "signals": ["reason1", "reason2"]
        },
        "social": {
            "score": 0-100,
            "signals": ["trend1", "trend2"]
        }
    }
}`;
