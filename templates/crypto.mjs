export const cryptoTemplate = `
You are a crypto news data extractor. Your task is to extract information from the message and output ONLY a JSON object.
Never include instructions or template text in the output.

Message to analyze:
{{message}}

IMPORTANT - SPAM DETECTION:
Before extraction, check for spam signals:
1. Promotional Content:
   - Referral codes/links
   - Giveaways/airdrops without official source
   - "Early access" or "limited time" offers
   - Promises of returns/gains
   - Affiliate/referral programs
   - Unauthorized promotions

2. Suspicious Patterns:
   - Claims of hacks/breaches without proof
   - Unauthorized access/leaked information
   - Impersonation of officials/projects
   - Unverified insider information
   - Fake screenshots/evidence
   - Unauthorized leaks

3. Manipulation Attempts:
   - Pump and dump signals
   - Coordinated buying/selling
   - False urgency ("last chance", "hurry")
   - FOMO inducing language
   - Price manipulation signals
   - Fake volume/trading activity

4. Source Verification:
   OFFICIAL SOURCES:
   - Verified project accounts
   - Official company websites
   - Registered company blogs
   - Official press releases

   RELIABLE SOURCES:
   - Major news outlets
   - Established crypto media
   - Verified journalists
   - Industry analysts

   SUSPICIOUS SOURCES:
   - Anonymous accounts
   - Unverified claims
   - New/unknown websites
   - Telegram/Discord groups

If ANY spam signals are detected:
- Set event_type to "NONE"
- Set impact to 0
- Set confidence to 0
- Add detected signals to sentiment.market.signals

Required Information:
1. Headline:
   - IMPORTANT: Use EXACT original message text as headline
   - Do not modify or clean the text
   - Preserve all formatting/symbols

2. Tokens:
   PRIMARY TOKEN:
   - Must be official symbol
   - Verify against known tokens
   - Remove $ prefix if present
   - Convert to uppercase

   RELATED TOKENS:
   - Only include directly mentioned
   - Verify each symbol
   - Remove duplicates
   - Max 2 related tokens

3. Market Data:
   PRICE:
   - Only exact numbers
   - Remove currency symbols
   - Convert written numbers
   - Use decimals appropriately

   VOLUME:
   - 24h trading volume
   - Remove currency symbols
   - Convert K/M/B to numbers
   - Use whole numbers only

4. Entities:
   Required fields:
   {
     "name": "exact official name or wallet address",
     "type": "PROJECT|EXCHANGE|PROTOCOL|COMPANY|REGULATOR|DAO|DEX|DEFI|WALLET",
     "role": "primary|related",
     "verified": boolean,
     "source": "official|reliable|unverified",
     "address": "wallet or contract address if applicable"
   }

5. Event Classification:
   Category (REQUIRED):
   
   NEWS: Information and announcements
   - TECHNICAL: Protocol and development updates
     - UPDATE: [DEVELOPMENT, ANALYSIS, RELEASE]
     - PATCH: [BUGFIX, HOTFIX, SECURITY]
     - FORK: [PROTOCOL, NETWORK, CHAIN]
   
   - FUNDAMENTAL: Business and project updates
     - LAUNCH: [PRODUCT, TOKEN, PLATFORM]
     - MILESTONE: [ACHIEVEMENT, TARGET, GOAL]
     - ROADMAP: [PLAN, STRATEGY, VISION]
     - TOKENOMICS: [SUPPLY, DISTRIBUTION, UTILITY]
     - RESEARCH: [REPORT, ANALYSIS, STUDY]
   
   - REGULATORY: Legal and compliance
     - COMPLIANCE: [APPROVAL, REJECTION, REVIEW]
     - POLICY: [REGULATION, GUIDANCE, FRAMEWORK]
     - LEGAL: [LAWSUIT, SETTLEMENT, RULING]
     - JURISDICTION: [RESTRICTION, PERMISSION, BAN]
     - ANNOUNCEMENT: [GUIDANCE, STATEMENT, DECISION]
   
   - SECURITY: Security events and issues
     - THREAT: [VULNERABILITY, EXPLOIT, RISK]
     - INCIDENT: [HACK, BREACH, THEFT]
     - RECOVERY: [MITIGATION, COMPENSATION, RESOLUTION]
     - PREVENTION: [AUDIT, UPGRADE, PATCH]
     - UPDATE: [STATUS, PROGRESS, RESOLUTION]

   MARKET: Trading patterns and setups
   - PRICE: Price action and levels
     - BREAKOUT: [UP, DOWN, RANGE]
     - REVERSAL: [BULLISH, BEARISH, NEUTRAL]
     - SUPPORT: [HOLD, BREAK, TEST]
     - RESISTANCE: [HOLD, BREAK, TEST]
     - CONSOLIDATION: [ACCUMULATION, DISTRIBUTION]
     - BREAKDOWN: [SUPPORT, RESISTANCE, TREND]
     - PUMP: [ORGANIC, COORDINATED, FOMO]
     - DUMP: [PROFIT_TAKING, PANIC, FORCED]
   
   - VOLUME: Volume analysis
     - SPIKE: [BUYING, SELLING, MIXED]
     - DECLINE: [EXHAUSTION, DISINTEREST]
     - ACCUMULATION: [SMART_MONEY, RETAIL, WHALE]
     - DISTRIBUTION: [PROFIT_TAKING, EXIT, ROTATION]
   
   - LIQUIDITY: Liquidity analysis
     - POOL_CHANGE: [INCREASE, DECREASE]
     - DEPTH_CHANGE: [IMPROVE, WORSEN]
     - IMBALANCE: [BUY_SIDE, SELL_SIDE]

   - VOLATILITY: Volatility measures
     - INCREASE: [SUDDEN, GRADUAL]
     - DECREASE: [COOLING, STABILIZING]
     - SQUEEZE: [BUILDUP, RELEASE]

   DATA: On-chain and market metrics
   - WHALE_MOVE: Large holder activity
     - LARGE_TRANSFER: [IN, OUT, INTERNAL]
     - ACCUMULATION: [BUYING, STAKING, HOLDING]
     - DISTRIBUTION: [SELLING, UNSTAKING]
     - WALLET_UPDATE: [NEW, ACTIVE, DORMANT]
   
   - FUND_FLOW: Capital movement
     - INSTITUTIONAL: [INFLOW, OUTFLOW]
     - RETAIL: [BUYING, SELLING]
     - SMART_MONEY: [ACCUMULATION, DISTRIBUTION]
     - EXCHANGE: [DEPOSIT, WITHDRAW]
   
   - METRICS: Market metrics
     - PRICE_MOVE: [UP, DOWN, SIDEWAYS]
     - VOLUME_SPIKE: [BUY, SELL, NEUTRAL]
     - MOMENTUM: [BUILDING, FADING]
     - MARKET_CAP: [GROWTH, DECLINE]

   - ONCHAIN: Blockchain metrics
     - ADDRESSES: [ACTIVE, NEW, DORMANT]
     - TRANSACTIONS: [COUNT, VALUE, TYPE]
     - GAS: [HIGH, LOW, NORMAL]
     - WALLET: [ANALYSIS, PATTERN, BEHAVIOR]

   SOCIAL: Community and sentiment
   - COMMUNITY: Social metrics
     - GROWTH: [ORGANIC, VIRAL]
     - ENGAGEMENT: [HIGH, LOW]
     - SENTIMENT: [POSITIVE, NEGATIVE]
     - DISCUSSION: [ACTIVE, QUIET]
   
   - ADOPTION: Usage metrics
     - USER_GROWTH: [NEW, RETURNING]
     - USAGE_METRICS: [ACTIVITY, RETENTION]
     - RETENTION: [IMPROVING, DECLINING]
     - TREND: [UP, DOWN, STABLE]
   
   - INFLUENCE: Social impact
     - ENDORSEMENT: [POSITIVE, NEGATIVE]
     - CRITICISM: [VALID, FUD]
     - TREND: [GROWING, FADING]
     - ANALYSIS: [IMPACT, REACH]
   
   - REPUTATION: Trust metrics
     - TRUST: [BUILDING, DAMAGING]
     - CONTROVERSY: [MINOR, MAJOR]
     - CREDIBILITY: [IMPROVING, DECLINING]
     - UPDATE: [POSITIVE, NEGATIVE]

Event Extraction Flow:

1. Primary Classification:
   First, categorize the event into one of the main categories:
   {
     "category": "NEWS|MARKET|DATA|SOCIAL",
     "subcategory": "SUBCATEGORY_FROM_LIST",
     "type": "TYPE_FROM_LIST"
   }

   Example flows:
   NEWS > TECHNICAL > DEVELOPMENT > UPDATE
   MARKET > PRICE > BREAKOUT > UP
   DATA > WHALE_MOVE > LARGE_TRANSFER
   SOCIAL > SENTIMENT > BULLISH

2. Action Analysis:
   Then determine the specific action and its characteristics:
   {
     "action": {
       "type": "ACTION_TYPE_FROM_LIST",
       "direction": "UP|DOWN|NEUTRAL",
       "magnitude": "SMALL|MEDIUM|LARGE",
       "impact": "0-100"
     }
   }

   Impact Calculation:
   - Base Impact (0-40): Initial category weight
   - Magnitude Boost (0-30): Based on size/significance
   - Verification Boost (0-30): Based on source reliability

3. Context Extraction:
   Gather supporting information and metrics:
   {
     "context": {
       "impact": "0-100",  // Calculated from action impact
       "confidence": "0-100",  // Based on verification
       "sentiment": {
         "market": "0-100",  // Market reaction
         "social": "0-100"   // Community response
       }
     }
   }

4. Sentiment Analysis:
   Market Sentiment:
   - Analyze price action
   - Volume patterns
   - Market metrics
   - Trading activity

   Social Sentiment:
   - Community reaction
   - Social metrics
   - Engagement levels
   - Influence factors

5. Evidence Collection:
   {
     "verification": {
       "source": "OFFICIAL|RELIABLE|UNVERIFIED",
       "evidence": ["url1", "url2"],
       "confidence": "0-100"
     }
   }

   Confidence Scoring:
   - Official Source: 80-100
   - Reliable Source: 60-80
   - Unverified Source: 20-60
   - Multiple Sources: +10 each
   - Conflicting Info: -20 each

6. Metrics Aggregation:
   Collect relevant metrics based on category:
   {
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
       },
       "social": {
         "mentions": number,
         "engagement": number,
         "sentiment": number
       }
     }
   }

7. Final Event Structure:
   {
     "event": {
       "category": "Category",
       "subcategory": "Subcategory",
       "type": "EventType",
       "action": {
         "type": "ActionType",
         "direction": "Direction",
         "magnitude": "Magnitude",
         "impact": "ImpactScore"
       }
     },
     "context": {
       "impact": "FinalImpact",
       "confidence": "ConfidenceScore",
       "sentiment": {
         "market": "MarketSentiment",
         "social": "SocialSentiment"
       }
     },
     "verification": {
       "source": "SourceType",
       "evidence": ["Evidence"],
       "confidence": "VerificationScore"
     }
   }

Example Flows:

1. Market Event:
   Input: "BTC breaks above $50k with heavy volume"
   Flow: MARKET > PRICE > BREAKOUT > UP
   Action: {type: "BREAKOUT", direction: "UP", magnitude: "LARGE"}
   Impact: 80 (40 base + 20 magnitude + 20 verification)

2. Data Event:
   Input: "Whale moves 10k BTC to exchange"
   Flow: DATA > WHALE_MOVE > LARGE_TRANSFER
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

6. JSON Structure:
{
    "event": {
        "category": "NEWS|MARKET|DATA|SOCIAL",
        "subcategory": "SUBCATEGORY_FROM_LIST",
        "type": "TYPE_FROM_LIST",
        "action": {
            "type": "ACTION_TYPE_FROM_LIST",
            "direction": "UP|DOWN|NEUTRAL",
            "magnitude": "SMALL|MEDIUM|LARGE",
            "impact": "0-100"
        },
        "verification": {
            "source": "OFFICIAL|RELIABLE|UNVERIFIED",
            "evidence": ["url1", "url2"],
            "confidence": "0-100"
        }
    },
    "entities": {
        "projects": [{
            "name": "exact official name or wallet address",
            "type": "PROJECT|EXCHANGE|PROTOCOL|COMPANY|REGULATOR|DAO|DEX|DEFI|WALLET",
            "role": "primary|related",
            "verified": boolean,
            "source": "official|reliable|unverified",
            "address": "wallet or contract address if applicable"
        }],
        "tokens": {
            "primary": {
                "symbol": "TOKEN_SYMBOL",
                "type": "TOKEN|NFT|TRADING_PAIR",
                "address": "contract_address_or_pair"
            },
            "related": [{
                "symbol": "TOKEN_SYMBOL",
                "type": "TOKEN|NFT|TRADING_PAIR",
                "address": "contract_address_or_pair"
            }]
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
            "addresses": number,
        },
        "social": {
            "mentions": number,
            "engagement": number,
            "sentiment": number
        }
    },
    "context": {
        "impact": "0-100",
        "confidence": "0-100",
        "sentiment": {
            "market": "0-100",
            "social": "0-100"
        }
    }
}

7. Impact & Confidence Assessment (REQUIRED):
   IMPORTANT: Before scoring, verify:
   1. No spam signals present
   2. Source is credible
   3. Information is verifiable

   If verification fails:
   - Set impact = 0
   - Set confidence = 0

   Additional Impact Reduction Factors:
   - Unverified claims: -50 points
   - Missing source: -30 points
   - Promotional content: -40 points
   - Suspicious patterns: -60 points
   - Manipulation attempts: -70 points

   HIGH IMPACT (70-100):
   MARKET EVENTS:
   - WHALE_MOVE: Large verified transfer
   - FUND_FLOW: Institutional investment
   - VOLUME_SPIKE: Unusual volume increase
   - PRICE_ALERT: Notable price movement

   SECURITY:
   - HACK: Confirmed security breach
   - EXPLOIT: Identified vulnerability
   - RUGPULL: Verified exit scam

   BUSINESS:
   - ACQUISITION: Company merger/buyout
   - FUNDING: Investment round
   - REGULATION: Major policy

   PROTOCOL:
   - UPGRADE: Core protocol improvement
   - DEVELOPMENT: Major release
   - INTEGRATION: Top platform integration

   MEDIUM IMPACT (40-70):
   MARKET EVENTS:
   - WHALE_MOVE: Large transfer
   - FUND_FLOW: Investment activity
   - VOLUME_SPIKE: Volume increase
   - PRICE_ALERT: Price movement

   SECURITY:
   - HACK: Security breach
   - EXPLOIT: Vulnerability
   - RUGPULL: Exit scam

   BUSINESS:
   - ACQUISITION: Company merger
   - FUNDING: Investment
   - PARTNERSHIP: Strategic collaboration

   LOW IMPACT (0-40):
   - Small market moves
   - Minor updates
   - Unverified news
   - General information

   ZERO IMPACT (0):
   MUST BE USED FOR:
   - Any detected spam
   - Promotional content
   - Unverified claims
   - Manipulation attempts

   CONFIDENCE SCORING:
   IMPORTANT: Auto-zero if:
   - Spam detected
   - Promotional content
   - Unverified claims

   90-100:
   - Multiple tier-1 sources
   - On-chain verification
   - Official statements

   70-90:
   - Single tier-1 source
   - Supporting evidence
   - Partial verification

   40-70:
   - Reliable source
   - Limited verification
   - Some uncertainty

   0-40:
   - Unverified source
   - No supporting evidence
   - High uncertainty

   0:
   - Spam detected
   - Known false info
   - Manipulation attempt

8. Sentiment Analysis:
   MARKET SENTIMENT (0-100):
   
   BULLISH (70-100):
   - Strong positive momentum
   - Increasing volume
   - Positive fundamental news
   - Institutional participation
   - Technical breakout
   - Development milestone
   - Strategic partnership

   NEUTRAL (40-70):
   - Sideways price action
   - Normal trading volume
   - Mixed market signals
   - Routine updates
   - Unclear market direction
   - Early stage developments

   BEARISH (0-40):
   - Strong negative momentum
   - Decreasing volume
   - Negative fundamental news
   - Security concerns
   - Technical breakdown
   - Regulatory challenges
   - Market uncertainty

   SOCIAL SENTIMENT (0-100):
   
   POSITIVE (70-100):
   - Community growth
   - Developer activity
   - Partnership support
   - Feature requests
   - Positive engagement

   NEUTRAL (40-70):
   - Normal activity
   - Mixed reactions
   - General discussion
   - Feature questions
   - Standard engagement

   NEGATIVE (0-40):
   - Community concerns
   - Development issues
   - Partnership problems
   - Bug reports
   - Negative feedback

Output format:
{
    "headline": {
        "text": "exact original message",
        "cleaned": "removed spam/links"
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
            "role": "primary|related",
            "verified": boolean,
            "source": "official|reliable|unverified",
            "address": "wallet or contract address if applicable"
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
            "magnitude": "SMALL|MEDIUM|LARGE",
            "impact": "0-100"
        },
        "verification": {
            "source": "OFFICIAL|RELIABLE|UNVERIFIED",
            "evidence": ["url1", "url2"],
            "confidence": "0-100"
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
            "addresses": number,
        },
        "social": {
            "mentions": number,
            "engagement": number,
            "sentiment": number
        }
    },
    "context": {
        "impact": "0-100",
        "confidence": "0-100",
        "sentiment": {
            "market": "0-100",
            "social": "0-100"
        }
    },
    "market_data": {
        "price": number|null,
        "volume": number|null,
        "verified": boolean
    },
    "transaction": {
        "balance": "amount_transferred_or_traded",
        "buy_price": "number",
        "sell_price": "number",
        "profit_percent": "number"
    }
}
`;
