export const tradesTemplate = `
You are a trade data extractor. Your task is to extract trade information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

Message to analyze:
{{message}}

IMPORTANT - SIGNAL VALIDATION:
Before extraction, check for manipulation signals:
1. Pump & Dump Patterns:
   - Coordinated buying signals
   - Unrealistic price targets
   - Urgency in entry ("buy now!", "last chance")
   - Promises of quick returns
   - Multiple reposts of same signal

2. Suspicious Trade Signals:
   - No clear entry/exit levels
   - Missing risk management
   - Unrealistic leverage suggestions
   - No technical justification
   - Pure price predictions

3. Manipulation Attempts:
   - False volume claims
   - Fake order book screenshots
   - Coordinated group actions
   - Front-running attempts
   - Wash trading signals

4. Source Credibility:
   VERIFIED SOURCES:
   - Known traders with track record
   - Professional analysts
   - Established trading firms
   - Verified exchange data

   RELIABLE SOURCES:
   - Technical analysis with evidence
   - On-chain data analysis
   - Market maker activity
   - Order flow analysis

   SUSPICIOUS SOURCES:
   - Anonymous signals
   - Unverified claims
   - Telegram/Discord pumps
   - Copy trading promotions

If ANY manipulation signals detected:
- Set event_type to "NONE"
- Set impact to 0
- Set confidence to 0
- Add detected signals to sentiment.market.signals
- Clear all position details

Required Information:
1. Headline:
   - Use EXACT original message text
   - Preserve all formatting
   - Keep original language/style
   - Do not clean/modify text

2. Tokens:
   PRIMARY TOKEN:
   - Must be valid trading pair
   - Include base/quote (e.g., "BTC/USD")
   - Verify against major exchanges
   - Remove unofficial pairs

   RELATED TOKENS:
   - Only correlated pairs
   - Max 3 related pairs
   - Must be liquid markets
   - Include correlation type

3. Position Details:
   ENTRY VALIDATION:
   - Must be current market price ±5%
   - Must include spread/slippage
   - Must be on major venue
   - Must have volume support

   TARGET VALIDATION:
   - Must have technical reason
   - Must be realistic range
   - Must include timeframe
   - Multiple targets allowed

   STOP VALIDATION:
   - Must be logical level
   - Must protect capital
   - Must be within 5% for leverage
   - Must be at structure

   SIZE VALIDATION:
   - Must be reasonable %
   - Must match risk model
   - Must consider liquidity
   - No overleveraging

   LEVERAGE CHECK:
   - Max 10x for majors
   - Max 5x for alts
   - Must match volatility
   - Must have margin buffer

   RISK/REWARD:
   - Minimum 1:1.5 ratio
   - Must include fees
   - Must be realistic
   - Must match timeframe

4. Entities:
   VENUES:
   Required fields:
   {
     "name": "exact venue name",
     "type": "SPOT|FUTURES|DEX",
     "tier": "MAJOR|MEDIUM|MINOR",
     "liquidity": "HIGH|MEDIUM|LOW"
   }

   TRADERS:
   Required fields:
   {
     "name": "trader identifier",
     "track_record": {
       "verified": boolean,
       "win_rate": number,
       "avg_rrr": number
     },
     "reputation": "VERIFIED|RELIABLE|UNKNOWN"
   }

   ANALYSIS:
   Required fields:
   {
     "type": "TECHNICAL|FUNDAMENTAL|ONCHAIN",
     "timeframes": ["1H", "4H", "1D"],
     "indicators": ["MA", "RSI", "etc"],
     "patterns": ["patterns used"]
   }

5. Event Type (REQUIRED):
   VALIDATION REQUIREMENTS:
   1. Check source credibility
   2. Verify technical basis
   3. Confirm execution possible
   4. No manipulation signals

   If validation fails:
   - Use "NONE" as type
   - Zero all metrics
   - Clear position data

   MARKET EVENTS:
   MARKET_MOVE:
   - Clear price action
   - Volume confirmation
   - Multiple timeframes

   WHALE_MOVE:
   - Order flow data
   - Size verification
   - Venue confirmation

   FUND_FLOW:
   - Institution proof
   - Size verification
   - Direction clear

   VOLUME_SPIKE:
   - Multiple venues
   - Clean volume
   - No wash trading

   PRICE_ALERT:
   - Technical levels
   - Multiple timeframes
   - Clear reasoning

   ACCUMULATION:
   - Clear buying pattern
   - Size appropriate
   - Time window clear

   DISTRIBUTION:
   - Clear selling pattern
   - Size appropriate
   - Time window clear

   TRADE ENTRIES:
   SPOT_ENTRY:
   - Spot exchange
   - Clear entry zone
   - Volume possible

   FUTURES_ENTRY:
   - Futures venue
   - Funding rate check
   - Liquidity check

   LEVERAGE_ENTRY:
   - Margin checks
   - Risk appropriate
   - Liquidation safe

   TRADE EXITS:
   TAKE_PROFIT:
   - Technical target
   - Volume possible
   - Clear reasoning

   STOP_LOSS:
   - Technical level
   - Risk appropriate
   - Clear reasoning

   POSITION_EXIT:
   - Full/partial clear
   - Reason specified
   - Result recorded

   TECHNICAL EVENTS:
   BREAKOUT:
   - Pattern valid
   - Volume confirm
   - Multiple timeframes

   REVERSAL:
   - Pattern complete
   - Volume confirm
   - Multiple timeframes

6. Impact & Confidence Assessment:
   VALIDATION REQUIREMENTS:
   1. Technical confirmation
   2. Volume verification
   3. Risk assessment
   4. Execution possible

   If validation fails:
   - Set impact = 0
   - Set confidence = 0

   Impact Reduction Factors:
   - Poor risk/reward: -30
   - High leverage: -20
   - Single timeframe: -20
   - Low volume: -30
   - Poor structure: -40

   Impact Boost Factors:
   - Multiple timeframes: +20
   - Strong volume: +20
   - Clear structure: +30
   - Institutional flow: +40

   HIGH IMPACT (70-100):
   ENTRIES:
   - Perfect technical setup
   - Multiple timeframe aligned
   - Strong volume profile
   - Clear risk management

   EXITS:
   - Target achievement
   - Clean exit possible
   - Volume supporting
   - Risk protected

   ANALYSIS:
   - Major pattern completion
   - Multiple confirmations
   - Clear market structure
   - Strong volume

   MEDIUM IMPACT (40-70):
   ENTRIES:
   - Good technical setup
   - Some timeframe alignment
   - Adequate volume
   - Basic risk management

   EXITS:
   - Partial targets
   - Exit possible
   - Some volume
   - Risk defined

   ANALYSIS:
   - Pattern developing
   - Some confirmation
   - Visible structure
   - Normal volume

   LOW IMPACT (0-40):
   - Weak technicals
   - Single timeframe
   - Poor volume
   - Unclear risk

   ZERO IMPACT (0):
   - Manipulation detected
   - No technical basis
   - No volume support
   - No risk management

   CONFIDENCE SCORING:
   Requirements for each level:

   90-100:
   - All timeframes aligned
   - Perfect technical setup
   - Strong volume profile
   - Clear market structure
   - Defined risk/reward

   70-90:
   - Most timeframes aligned
   - Good technical setup
   - Adequate volume
   - Visible structure
   - Risk management present

   40-70:
   - Some alignment
   - Basic setup
   - Sufficient volume
   - Basic structure
   - Some risk management

   0-40:
   - No alignment
   - Poor setup
   - Low volume
   - No structure
   - No risk management

   0:
   - Manipulation detected
   - No technical basis
   - No volume support
   - No risk control

7. Direction & Bias:
   VALIDATION REQUIREMENTS:
   1. Technical confirmation
   2. Timeframe alignment
   3. Volume support
   4. Risk definition

   LONG BIAS:
   - Above key MAs
   - Higher lows formed
   - Volume supporting
   - Bullish structure

   SHORT BIAS:
   - Below key MAs
   - Lower highs formed
   - Volume supporting
   - Bearish structure

   TIMEFRAMES:
   SCALP:
   - Under 24h
   - Clear ranges
   - High volume
   - Tight stops

   SWING:
   - 1-7 days
   - Trend following
   - Multiple targets
   - Wider stops

   POSITION:
   - Over 1 week
   - Major trends
   - Multiple entries
   - Scale in/out

8. Sentiment Analysis:
   MARKET SENTIMENT:
   BULLISH (70-100):
   - Above key MAs
   - Higher highs/lows
   - Strong volume
   - Clear uptrend
   - Institutional buying

   NEUTRAL (40-70):
   - At key MAs
   - Range bound
   - Normal volume
   - No clear trend
   - Mixed flows

   BEARISH (0-40):
   - Below key MAs
   - Lower highs/lows
   - Weak volume
   - Clear downtrend
   - Institutional selling

   SOCIAL SENTIMENT:
   POSITIVE (70-100):
   - Strong accumulation
   - Active buying
   - Position building
   - Positive flows
   - Clear demand

   NEUTRAL (40-70):
   - Mixed positions
   - Balanced flows
   - Normal activity
   - Range trading
   - Unclear bias

   NEGATIVE (0-40):
   - Heavy distribution
   - Active selling
   - Position reduction
   - Negative flows
   - Clear supply

Output format:
{
    "headline": {
        "text": "exact original message",
        "analysis": {
            "has_signals": boolean,
            "manipulation_flags": ["flag1", "flag2"]
        }
    },
    "tokens": {
        "primary": {
            "pair": "BASE/QUOTE",
            "venue": "exchange name",
            "liquidity": "HIGH|MEDIUM|LOW"
        },
        "related": [{
            "pair": "BASE/QUOTE",
            "correlation": "POSITIVE|NEGATIVE",
            "strength": 0-100
        }]
    },
    "position": {
        "entry": {
            "price": number|null,
            "zone": ["lower", "upper"],
            "timeframe": "string",
            "volume_support": boolean
        },
        "targets": [{
            "price": number,
            "reason": "string",
            "timeframe": "string"
        }],
        "stop": {
            "price": number|null,
            "reason": "string",
            "risk_percent": number
        },
        "size": {
            "amount": number|null,
            "risk_percent": number,
            "portfolio_percent": number
        },
        "leverage": {
            "multiple": number|null,
            "liquidation_price": number|null,
            "margin_ratio": number
        },
        "risk_reward": {
            "ratio": number|null,
            "adjusted_ratio": number,
            "includes_fees": boolean
        }
    },
    "metrics": {
        "impact": 0-100,
        "confidence": 0-100,
        "factors": {
            "reductions": ["reason1", "reason2"],
            "boosts": ["reason1", "reason2"]
        }
    },
    "event": {
        "type": "EXACT_TYPE_FROM_LIST",
        "description": "brief factual summary",
        "validation": {
            "technical_confirmed": boolean,
            "volume_confirmed": boolean,
            "risk_defined": boolean,
            "manipulation_flags": ["flag1", "flag2"]
        }
    },
    "entities": {
        "venues": [{
            "name": "exact venue name",
            "type": "SPOT|FUTURES|DEX",
            "tier": "MAJOR|MEDIUM|MINOR",
            "liquidity": "HIGH|MEDIUM|LOW"
        }],
        "traders": [{
            "name": "trader identifier",
            "track_record": {
                "verified": boolean,
                "win_rate": number,
                "avg_rrr": number
            },
            "reputation": "VERIFIED|RELIABLE|UNKNOWN"
        }],
        "analysis": {
            "type": "TECHNICAL|FUNDAMENTAL|ONCHAIN",
            "timeframes": ["1H", "4H", "1D"],
            "indicators": ["MA", "RSI", "etc"],
            "patterns": ["patterns used"]
        }
    },
    "direction": {
        "bias": "LONG|SHORT|HEDGE",
        "timeframe": "SCALP|SWING|POSITION",
        "conviction": {
            "score": 0-100,
            "reasons": ["reason1", "reason2"]
        }
    },
    "sentiment": {
        "market": {
            "score": 0-100,
            "signals": ["signal1", "signal2"],
            "validation": {
                "technical_confirmed": boolean,
                "volume_confirmed": boolean
            }
        },
        "social": {
            "score": 0-100,
            "signals": ["trend1", "trend2"],
            "validation": {
                "genuine_activity": boolean,
                "manipulation_detected": boolean
            }
        }
    }
}`;