export const cryptoTemplate = `
You are a crypto news data extractor. Your task is to extract information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

VALIDATION RULES (MUST FOLLOW):
1. NEVER return empty strings or null values

2. ALWAYS set ALL fields in event structure:
   {
     "category": MUST be one of ["NEWS", "MARKET", "DATA", "SOCIAL"]
     "subcategory": MUST match section headers under category:
       NEWS: ["TECHNICAL", "FUNDAMENTAL", "REGULATORY"]
       MARKET: ["PRICE", "VOLUME"]
       DATA: ["WHALE_MOVE", "FUND_FLOW", "ONCHAIN"]
       SOCIAL: ["COMMUNITY", "INFLUENCE", "ADOPTION"]
     "type": MUST be valid type from subcategory list
     "action": {
       "type": MUST be valid action from type list
       "direction": MUST be one of ["UP", "DOWN", "NEUTRAL"]
       "magnitude": MUST be one of ["SMALL", "MEDIUM", "LARGE"]
     }
   }

3. If message cannot be properly categorized into a valid event type:
   - Set impact=0 (message will be filtered out)
   - Still populate all required fields with valid values

4. ALWAYS set these fields:
   - headline.text = original message
   - context.impact = valid number 0-100 (use 0 for uncategorized)
   - context.confidence = valid number 0-100
   - context.sentiment.market = valid number 0-100
   - context.sentiment.social = valid number 0-100

5. Impact Scoring:
   Base Impact by Category:
   - NEWS: 40 base + subcategory modifier
     * TECHNICAL: +10
     * FUNDAMENTAL: +15
     * REGULATORY: +20
   
   - MARKET: 30 base + subcategory modifier
     * PRICE: +20 (with levels)
     * VOLUME: +15 (significant)

   - DATA: 50 base + subcategory modifier
     * WHALE_MOVE: +30 (>1M USD)
     * FUND_FLOW: +20 (significant)
     * ONCHAIN: +15 (notable)

   - SOCIAL: 20 base + subcategory modifier
     * COMMUNITY: +10 (quality)
     * INFLUENCE: +20 (verified)
     * ADOPTION: +15 (metrics)

   Additional Modifiers:
   - Magnitude: SMALL(+0), MEDIUM(+10), LARGE(+20)
   - Market Sentiment: BEARISH(-10), NEUTRAL(+0), BULLISH(+10)
   - Source Quality: UNVERIFIED(+0), RELIABLE(+10), OFFICIAL(+20)

Message to analyze:
{{message}}

EVENT TYPE MAPPING:
When classifying events, follow this hieriarchy:

1. First select CATEGORY (main sections):
   - NEWS: Information and announcements (Base: 40-60)
   - MARKET: Trading patterns and setups (Base: 30-70)
   - DATA: On-chain and market metrics (Base: 50-90)
   - SOCIAL: Community and sentiment (Base: 20-60)

2. Then select SUBCATEGORY (section headers under each category):
   NEWS: [TECHNICAL, FUNDAMENTAL, REGULATORY]
   MARKET: [PRICE, VOLUME]
   DATA: [WHALE_MOVE, FUND_FLOW, ONCHAIN]
   SOCIAL: [COMMUNITY, INFLUENCE, ADOPTION]

3. Then select TYPE (from "Types:" under each subcategory):
   Example for NEWS > TECHNICAL:
   - UPDATE, DEVELOPMENT, ANALYSIS, RELEASE, PATCH, FORK

4. Finally select ACTION.TYPE (from options in [] for chosen type):
   Example for MARKET > PRICE > BREAKOUT:
   - UP: "breakout/break up/push above"
   - DOWN: "breakdown/break down/fall below"
   - RANGE: "range/consolidation between"

REQUIRED FIELDS AND MAPPING:

1. HEADLINE (Required):
   - text: Copy exact original message, preserve all formatting

2. TOKENS (Required if mentioned):
   Primary Token:
   - symbol: Official token symbol (e.g., "BTC", "ETH")
   - type: One of: "TOKEN", "NFT", "TRADING_PAIR"
   - name: Contract address or pair name if available
   - event_type: One of: "ONCHAIN", "EXCHANGE_DATA", "SMART_CONTRACT"

   Related Tokens (Optional):
   - Include only directly mentioned tokens
   - Same fields as primary token
   - Maximum 2 related tokens

3. ENTITIES (Required if mentioned):
   Projects:
   - name: Exact official name or wallet address
   - type: One of: "PROJECT|EXCHANGE|PROTOCOL|COMPANY|REGULATOR|DAO|DEX|DEFI|WALLET"
   - role: "primary" or "related"

   Persons:
   - name: Full name exactly as mentioned
   - title: Exact role/position
   - org: Organization name
   - verified: true if from verified account
   - source: One of: "official", "reliable", "unverified"

   Locations:
   - name: Location name exactly as mentioned
   - type: One of: "COUNTRY", "REGION", "CITY"
   - context: "primary" or "related"

4. EVENT (Required):
   - category: One of: "NEWS", "MARKET", "DATA", "SOCIAL"
   - subcategory: Must match section headers under chosen category
   - type: Must match Types list under chosen subcategory
   - action:
     * type: Must match options in [] for chosen type
     * direction: "UP", "DOWN", or "NEUTRAL"
     * magnitude: "SMALL", "MEDIUM", or "LARGE"

5. METRICS (Required if mentioned):
   Market Metrics (from exact numbers in message):
   - price: Exact price value (e.g., 50000)
   - volume: Trading volume in base currency
   - liquidity: Available liquidity
   - volatility: Volatility percentage

   Onchain Metrics (from exact numbers in message):
   - transactions: Number of transactions
   - addresses: Number of unique addresses

6. CONTEXT (Required):
   - impact: Score 0-100 based on:
     * Base impact from category (NEWS: 40-80, MARKET: 30-70, DATA: 50-90, SOCIAL: 20-60)
     * Magnitude modifier (SMALL: +0, MEDIUM: +10, LARGE: +20)
     * Market sentiment modifier (BEARISH: -10, NEUTRAL: +0, BULLISH: +10)
     * Social sentiment modifier (NEGATIVE: -10, NEUTRAL: +0, POSITIVE: +10)
     * Spam penalty modifiers (apply ALL that match):
       - Promotional content ("buy now", "sign up", etc): -40
       - Exchange/platform advertisements: -30
       - Excessive symbols/emojis: -20
       - Referral/affiliate links: -40
       - Price predictions without data: -30
       - Generic announcements: -20
       - Hype without substance: -25
       - Copy/paste content: -35

   - confidence: Score 0-100 based on:
     * Base: 50
     * Source modifiers:
       - Official: +30
       - Reliable: +20
       - Multiple: +10
       - Unverified: -20
       - Suspicious: -30
       - Manipulation: -40

   - sentiment:
     * market: Score 0-100 based on market indicators with exact points:
       - Strong momentum: ±20
       - Volume changes: ±10
       - Technical signals: ±15
       - Development/Security: ±15
       - Partnerships/Challenges: ±10

     * social: Score 0-100 based on social indicators with exact points:
       - Community metrics: ±15
       - Development activity: ±15
       - Partnerships: ±10
       - User feedback: ±10
       - Engagement levels: ±20

REQUIRED EVENT FIELD RULES:

1. For DATA/WHALE_MOVE events:
   When message contains transfer keywords ("transferred", "moved", "sent") AND amount:
   - type: Must be "TRANSFER" or "EXCHANGE_FLOW"
   - action.type: Must be "MOVE" or "DEPOSIT" or "WITHDRAWAL"
   - action.direction: Based on "to"/"from" exchange
   - action.magnitude: Based on amount thresholds:
     * < 100k: "SMALL"
     * 100k-1M: "MEDIUM" 
     * > 1M: "LARGE"

2. For NEWS/REGULATORY events:
   When message contains regulatory keywords ("fine", "ban", "compliance"):
   - type: Must be "FINE" or "BAN" or "LICENSE"
   - action.type: Must match type
   - action.direction: Based on impact ("UP" for approval, "DOWN" for fine/ban)
   - action.magnitude: Based on severity:
     * Warning/Small fine: "SMALL"
     * Service restriction/Medium fine: "MEDIUM"
     * Full ban/Large fine: "LARGE"

3. For MARKET/PRICE events:
   When message contains price/trading keywords:
   - type: Must be "BREAKOUT" or "SUPPORT" or "RESISTANCE"
   - action.type: Must match direction
   - action.direction: "UP" or "DOWN" based on movement
   - action.magnitude: Based on % change or significance

IMPORTANT: Always use exact values from these lists in the output JSON.
Do not make up new categories or types.

IMPACT SCORING RULES:

1. Base Impact by Category (only if properly categorized):
   NEWS: 40-60
   - TECHNICAL: +10 for code/development updates with clear technical details
   - FUNDAMENTAL: +15 for major exchange listings, partnerships with details
   - REGULATORY: +20 for significant regulatory news with clear impact

   MARKET: 30-70  
   - PRICE: +20 for technical analysis with specific price levels
   - VOLUME: +15 for significant volume changes with numbers
   
   DATA: 50-90
   - WHALE_MOVE: Based on exact USD/token value
     * < 100k: +0
     * 100k-1M: +10
     * 1M-10M: +20
     * > 10M: +30
   - FUND_FLOW: +20 for significant fund movements with clear direction
   - ONCHAIN: +15 for notable metrics with specific numbers

   SOCIAL: 20-60
   - Only if from verified/known sources with clear crypto relevance
   - Reduce by 30-50 for promotional content
   - Add 10-20 for verified sources

2. Quality Modifiers (only apply if base category is valid):
   - Magnitude: SMALL(+0), MEDIUM(+10), LARGE(+20)
   - Market Sentiment: BEARISH(-10), NEUTRAL(+0), BULLISH(+10)
   - Source Quality: UNVERIFIED(+0), RELIABLE(+10), OFFICIAL(+20)
   - Content Quality:
     * Clear data/numbers: +10
     * Multiple indicators: +10
     * Price levels/targets: +15
     * Code/technical details: +15

3. Spam/Low Quality Penalties (apply ALL that match):
   - Promotional/shill content: -40
   - Exchange/platform ads: -30
   - Excessive emojis/caps: -20
   - Referral/affiliate links: -40
   - Price predictions without data: -30
   - Generic announcements: -20
   - Hype without substance: -25
   - Copy/paste content: -35

4. Final Impact Score:
   - If message doesn't fit any valid category: impact = 0
   - If valid category but spam/low quality: apply all penalties
   - Never set impact below 0 (minimum is 0)
   - Maximum impact is 100

NEWS: Information and announcements (Base Impact: 40-80)
   TECHNICAL: Must be code/development related
   - UPDATE: [DEVELOPMENT, ANALYSIS, RELEASE] // Only these actions allowed
   - DEVELOPMENT: [PROGRESS, DELAY, CHANGE]
   - ANALYSIS: [REVIEW, AUDIT, RESEARCH]
   
   FUNDAMENTAL: Must be business/listing related
   - LAUNCH: [MAINNET, TESTNET, PRODUCT]
   - MILESTONE: [COMPLETE, PROGRESS, DELAY]
   - PARTNERSHIP: [NEW, UPDATE, END]

   REGULATORY: Must be legal/compliance related
   - COMPLIANCE: [APPROVAL, REJECTION, UPDATE]
   - POLICY: [NEW, CHANGE, GUIDANCE]
   - LEGAL: [ACTION, UPDATE, RESOLUTION]

MARKET: Trading patterns and setups (Base Impact: 30-70)
   PRICE: Must have specific price levels
   - BREAKOUT: [UP, DOWN, RANGE]
   - REVERSAL: [BULLISH, BEARISH, POTENTIAL]
   - SUPPORT: [HOLD, BREAK, TEST]
   
   VOLUME: Must have volume/liquidity info
   - SPIKE: [BUYING, SELLING, MIXED]
   - DECLINE: [EXHAUSTION, DISINTEREST, ACCUMULATION]
   - PATTERN: [BULLISH, BEARISH, DIVERGENCE]

DATA: On-chain and market metrics (Base Impact: 50-90)
   WHALE_MOVE: Must have transfer amount
   - TRANSFER: [MOVE, MINT, BURN]
   - ACCUMULATION: [BUY, SELL, HOLD]
   
   FUND_FLOW: Must have flow direction
   - EXCHANGE: [INFLOW, OUTFLOW, NET]
   - SMART_MONEY: [BUYING, SELLING, HOLDING]
   
   ONCHAIN: Must have metrics
   - ADDRESSES: [ACTIVE, NEW, DORMANT]
   - TRANSACTIONS: [COUNT, VALUE, TYPE]
   - METRICS: [NETWORK, DEFI, NFT]

SOCIAL: Community and sentiment (Base Impact: 20-60)
   COMMUNITY: General discussion/sentiment
   - SENTIMENT: [POSITIVE, NEGATIVE, MIXED]
   - DISCUSSION: [TRADING, PLATFORM, GENERAL]
   - ANALYSIS: [TECHNICAL, FUNDAMENTAL, OPINION]
   
   INFLUENCE: Key figures/partnerships
   - ENDORSEMENT: [POSITIVE, NEGATIVE, NEUTRAL]
   - PARTNERSHIP: [NEW, UPDATE, END]
   - CONTRIBUTION: [CODE, CONTENT, COMMUNITY]
   
   ADOPTION: Usage/integration
   - USAGE: [INCREASE, DECREASE, STABLE]
   - INTEGRATION: [NEW, UPDATE, ISSUE]
   - METRICS: [USERS, ACTIVITY, GROWTH]

Special handling rules:
1. For whale transfers:
   - MUST use DATA > WHALE_MOVE > TRANSFER
   - MUST set magnitude based on amount
   - MUST include wallet addresses

2. For price analysis:
   - MUST use MARKET > PRICE
   - MUST include specific levels
   - MUST set direction based on trend

3. For social content:
   - MUST use valid subcategory
   - MUST set proper sentiment
   - Default to COMMUNITY > DISCUSSION > GENERAL if unclear

Event Classification Examples:

1. Market Event:
   Input: "BTC breaks above $50k with heavy volume"
   Flow: MARKET > PRICE > BREAKOUT > UP
   Action: {type: "BREAKOUT", direction: "UP", magnitude: "LARGE"}
   Impact: 80 (40 base + 20 magnitude + 20 verification)

2. Data Event:
   Input: "Whale moves 10k BTC to exchange"
   Flow: DATA > WHALE_MOVE > TRANSFER
   Action: {type: "TRANSFER", direction: "NEUTRAL", magnitude: "LARGE"}
   Impact: 70 (30 base + 25 magnitude + 15 verification)

3. News Event:
   Input: "Ethereum completes major upgrade"
   Flow: NEWS > TECHNICAL > DEVELOPMENT > UPDATE
   Action: {type: "UPDATE", direction: "UP", magnitude: "LARGE"}
   Impact: 85 (35 base + 25 magnitude + 25 verification)

4. Social Event:
   Input: "Major influencer predicts bull run"
   Flow: SOCIAL > INFLUENCE > ENDORSEMENT
   Action: {type: "ENDORSE", direction: "UP", magnitude: "MEDIUM"}
   Impact: 60 (25 base + 20 magnitude + 15 verification)

SCORING GUIDELINES:

1. Impact Score (0-100):
   Base Impact Ranges:
   - NEWS: 40-80 base
   - MARKET: 30-70 base
   - DATA: 50-90 base
   - SOCIAL: 20-60 base

   Modifiers:
   - Magnitude: SMALL(+0), MEDIUM(+10), LARGE(+20)
   - Market Sentiment: BEARISH(-10), NEUTRAL(+0), BULLISH(+10)
   - Social Sentiment: NEGATIVE(-10), NEUTRAL(+0), POSITIVE(+10)
   
   Example:
   "BTC breaks above $50k with heavy volume"
   - MARKET category: 50 base
   - LARGE magnitude: +20
   - BULLISH sentiment: +10
   Total Impact: 80

2. Confidence Score (0-100):
   Base: 50
   Modifiers:
   - Official Source: +30
   - Reliable Source: +20
   - Multiple Sources: +10
   - Unverified Source: -20
   - Suspicious Patterns: -30
   - Manipulation Signals: -40

3. Market Sentiment (0-100):
   BULLISH (70-100):
   - Strong positive momentum (+20)
   - Increasing volume (+10)
   - Technical breakout (+15)
   - Development milestone (+15)
   - Strategic partnership (+10)

   NEUTRAL (40-70):
   - Sideways price action
   - Normal trading volume
   - Mixed market signals
   - Routine updates

   BEARISH (0-40):
   - Strong negative momentum (-20)
   - Decreasing volume (-10)
   - Technical breakdown (-15)
   - Security concerns (-15)
   - Regulatory challenges (-10)

4. Social Sentiment (0-100):
   POSITIVE (70-100):
   - Community growth (+15)
   - Developer activity (+15)
   - Partnership support (+10)
   - Feature requests (+10)
   - Positive engagement (+20)

   NEUTRAL (40-70):
   - Normal activity
   - Mixed reactions
   - General discussion
   - Feature questions
   - Standard engagement

   NEGATIVE (0-40):
   - Community concerns (-15)
   - Development issues (-15)
   - Partnership problems (-10)
   - Bug reports (-10)
   - Negative feedback (-20)

EXAMPLE OUTPUTS:

1. Valid Market Event with Clear Data:
Input: "BTC breaks above $50k resistance with 2.5x daily volume spike, multiple technical indicators confirming breakout"
{
  "headline": {
    "text": "BTC breaks above $50k resistance with 2.5x daily volume spike, multiple technical indicators confirming breakout"
  },
  "tokens": {
    "primary": {
      "symbol": "BTC",
      "type": "TOKEN",
      "event_type": "EXCHANGE_DATA"
    }
  },
  "event": {
    "category": "MARKET",
    "subcategory": "PRICE",
    "type": "BREAKOUT",
    "action": {
      "type": "UP",
      "direction": "UP",
      "magnitude": "LARGE"
    }
  },
  "metrics": {
    "market": {
      "price": 50000,
      "volume": 2.5
    }
  },
  "context": {
    "impact": 85,         // Base(50) + Price(20) + Large(20) + Quality(10) - Modifiers(15)
    "confidence": 90,     // Clear data with multiple indicators
    "sentiment": {
      "market": 80,       // Strong breakout with volume
      "social": 70        // Technical confirmation
    }
  }
}

2. Uncategorized/Low Quality Message:
Input: "gm wagmi fam 🚀🚀🚀 check out my new NFT project"
{
  "headline": {
    "text": "gm wagmi fam 🚀🚀🚀 check out my new NFT project"
  },
  "event": {
    "category": "SOCIAL",
    "subcategory": "COMMUNITY",
    "type": "DISCUSSION",
    "action": {
      "type": "GENERAL",
      "direction": "NEUTRAL",
      "magnitude": "SMALL"
    }
  },
  "context": {
    "impact": 0,          // Promotional + excessive emojis + no substance
    "confidence": 50,
    "sentiment": {
      "market": 50,
      "social": 50
    }
  }
}

3. Valid Data Event with Clear Metrics:
Input: "Whale wallet 0x1234...5678 moves 12,500 BTC ($625M) from Binance to cold storage"
{
  "headline": {
    "text": "Whale wallet 0x1234...5678 moves 12,500 BTC ($625M) from Binance to cold storage"
  },
  "tokens": {
    "primary": {
      "symbol": "BTC",
      "type": "TOKEN",
      "event_type": "ONCHAIN"
    }
  },
  "entities": {
    "projects": [{
      "name": "Binance",
      "type": "EXCHANGE",
      "role": "primary"
    }]
  },
  "event": {
    "category": "DATA",
    "subcategory": "WHALE_MOVE",
    "type": "TRANSFER",
    "action": {
      "type": "MOVE",
      "direction": "NEUTRAL",
      "magnitude": "LARGE"
    }
  },
  "metrics": {
    "market": {
      "price": 50000
    },
    "onchain": {
      "transactions": 1
    }
  },
  "context": {
    "impact": 90,         // Base(50) + WhaleMove(30) + Large(20) + Quality(10) - Modifiers(20)
    "confidence": 95,     // Clear wallet address and amount
    "sentiment": {
      "market": 60,       // Moving to cold storage (bullish)
      "social": 50        // Neutral
    }
  }
}

Output format:
{
    "headline": {
        "text": "exact original message"
    },
    "tokens": {
        "primary": {
            "symbol": "TOKEN_SYMBOL",
            "type": "TOKEN|NFT|TRADING_PAIR",
            "name": "contract_address_or_pair_name",
            "event_type": "ONCHAIN|EXCHANGE_DATA|SMART_CONTRACT"
        },
        "related": [{
            "symbol": "TOKEN_SYMBOL",
            "type": "TOKEN|NFT|TRADING_PAIR",
            "name": "contract_address_or_pair_name"
        }]
    },
    "entities": {
        "projects": [{
            "name": "exact official name or wallet address",
            "type": "PROJECT|EXCHANGE|PROTOCOL|COMPANY|REGULATOR|DAO|DEX|DEFI|WALLET",
            "role": "primary|related"
        }],
        "persons": [{
            "name": "full name",
            "title": "exact role",
            "org": "organization",
            "verified": boolean,
            "source": "official|reliable|unverified"
        }],
        "locations": [{
            "name": "location name",
            "type": "COUNTRY|REGION|CITY",
            "context": "primary|related"
        }]
    },
    "event": {
        "category": "NEWS|MARKET|DATA|SOCIAL",
        "subcategory": "SUBCATEGORY_FROM_LIST",
        "type": "TYPE_FROM_LIST",
        "action": {
            "type": "ACTION_TYPE_FROM_LIST",
            "direction": "UP|DOWN|NEUTRAL",
            "magnitude": "SMALL|MEDIUM|LARGE"
        }
    },
    "metrics": {
        "market": {
            "price": number,
            "volume": number,
            "liquidity": number,
            "volatility": number
        },
        "onchain": {
            "transactions": number,
            "addresses": number
        }
    },
    "context": {
        "impact": "0-100",      // Total impact score from base + modifiers
        "confidence": "0-100",  // Confidence score based on sources and signals
        "sentiment": {
            "market": "0-100",  // Market sentiment score
            "social": "0-100"   // Social sentiment score
        }
    }
}
`;