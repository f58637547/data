import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';
import PQueue from 'p-queue';

// ONE global queue - process one message at a time from any channel
const messageQueue = new PQueue({concurrency: 1});

// Add queue event listeners
messageQueue.on('active', () => {
    console.log(`Queue size: ${messageQueue.size}`);
});

messageQueue.on('idle', () => {
    console.log('Queue is empty');
});

// Discord message text extraction
function extractDiscordText(message) {
    try {
        // Get raw text (with URLs)
        const rawText = getRawMessageText(message);
        
        // Get clean text (no URLs)
        const cleanText = getMessageText(message);
        
        // Skip if content too short
        if (!rawText || rawText.length < 10 || cleanText.length < 5) {
            console.log('❌ Skipping: Content too short or empty');
            console.log('Raw text:', rawText);
            console.log('Clean text:', cleanText);
            return null;
        }

        // Log extracted text
        console.log('📄 Original Text:');
        console.log(rawText);
        console.log('-'.repeat(80));
        console.log('📄 Clean Text:');
        console.log(cleanText);
        console.log('-'.repeat(80));

        // Extract author from URLs if present
        let author = null;
        let rtAuthor = null;
        if (message.content) {
            const urls = message.content.match(/https:\/\/twitter\.com\/([^\s\/]+)/g) || [];
            if (urls.length > 0) {
                author = extractTwitterUsername(urls[0]);
                if (urls.length > 1) {
                    rtAuthor = extractTwitterUsername(urls[1]);
                }
            }
        }

        return {
            original: rawText,
            clean: cleanText,
            author: author || message.author?.username || 'unknown',
            rtAuthor
        };
    } catch (error) {
        console.error('Discord text extraction error:', {
            error: error.message,
            messageType: typeof message,
            hasContent: !!message.content,
            embedCount: message.embeds?.length
        });

        return {
            text: null,
            author: null,
            rtAuthor: null,
            error: 'Failed to extract text from Discord message'
        };
    }
}

// Get raw text from message (for headlines)
function getRawMessageText(message) {
    let textParts = [];
    
    if (message.content) {
        textParts.push(message.content);
    }

    if (message.embeds?.length > 0) {
        for (const embed of message.embeds) {
            if (embed.description) {
                textParts.push(embed.description);
            }
            if (embed.title) {
                textParts.push(embed.title);
            }
        }
    }

    const text = textParts.join('\n').trim();

    // Check if text is ONLY an image markdown link with no other content
    const imageUrlRegex = /^\[.*?\]\(https?:\/\/.*?\.(png|jpg|jpeg|gif|webp)\)$/i;
    if (imageUrlRegex.test(text)) {
        console.log('❌ Skipping: Content is only an image link');
        console.log('Text:', text);
        return null;
    }
    
    // Check if text is ONLY a tweet link with no actual content
    const tweetOnlyRegex = /^\s*\[.*?\]\s*\(\s*https?:\/\/twitter\.com\/[^\/]+\/status\/\d+\s*\)\s*$/;
    if (tweetOnlyRegex.test(text)) {
        // Extract the tweet URL to log it
        const urlMatch = text.match(/https?:\/\/twitter\.com\/[^\/]+\/status\/\d+/);
        const tweetUrl = urlMatch ? urlMatch[0] : "unknown";
        console.log('❌ Skipping: Content is only a tweet link without content');
        console.log('Tweet URL:', tweetUrl);
        return null;
    }

    return text;
}

// Get cleaned text from message (for content processing)
function getMessageText(message) {
    try {
        // Handle null/undefined message
        if (!message) {
            console.log('❌ Skipping: Message is null/undefined');
            return null;
        }

        let text = '';

        // Get text from content
        if (message.content) {
            text += message.content;
        }

        // Get text from embeds
        if (message.embeds?.length > 0) {
            for (const embed of message.embeds) {
                if (embed.description) {
                    text += '\n' + embed.description;
                }
            }
        }

        // If no text found, return null
        if (!text.trim()) {
            console.log('❌ Skipping: No text content found');
            return null;
        }

        return text
            .replace(/https?:\/\/\S+/g, '')  // Remove URLs
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')  // Remove markdown links but keep text
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .trim();
    } catch (error) {
        console.error('Error cleaning message text:', error);
        return null;
    }
}

// Extract Twitter username from text
function extractTwitterUsername(text) {
    // Extract username from Twitter URL
    const twitterUrlRegex = /twitter\.com\/([^\/]+)\/status/;
    const match = text.match(twitterUrlRegex);
    if (match && match[1]) {
        // Get just the username part, remove any query params or extra stuff
        const username = match[1].split('?')[0];  // Remove query params if any
        return username;   
    }
    return null;
}

// Check similarity with vector search across all relevant tables
async function findSimilarMessages(db, embedding, contentText, category) {
    try {
        // Query to check similarity only in the crypto table
        const query = `
            WITH combined_results AS (
                SELECT content::text, type, 'crypto' as table_name,
                       1 - (embedding <-> $1::vector) as vector_similarity
                FROM crypto
                WHERE "createdAt" > NOW() - INTERVAL '24 hours'
                AND 1 - (embedding <-> $1::vector) > 0.65
            )
            SELECT * FROM combined_results
            ORDER BY vector_similarity DESC
            LIMIT 5
        `;

        // Log the query and params for debugging
        console.log('Running similarity query with params:');
        console.log('Embedding:', embedding.length, 'dimensions');

        const result = await db.query(query, [
            `[${embedding.join(',')}]`
        ]);

        if (result.rows.length > 0) {
            console.log('\n=== Similar Content Found ===');
            for (const row of result.rows) {
                try {
                    // Handle both string and object content
                    let content = row.content;
                    if (typeof content === 'string') {
                        try {
                            content = JSON.parse(content);
                        } catch (parseError) {
                            // If can't parse, use as is
                            console.log(`Table: ${row.table_name}`);
                            console.log(`Similarity: ${(row.vector_similarity * 100).toFixed(2)}%`);
                            console.log(`Content: ${content.substring(0, 100)}...`);
                            continue;
                        }
                    }

                    // Now content is definitely an object
                    console.log(`Table: ${row.table_name}`);
                    console.log(`Similarity: ${(row.vector_similarity * 100).toFixed(2)}%`);
                    
                    // Try to get displayable content
                    const displayContent = content.original || content.headline || 
                        (typeof content === 'string' ? content : JSON.stringify(content));
                    console.log(`Content: ${displayContent.substring(0, 100)}...`);
                    
                } catch (e) {
                    // Last resort fallback
                    console.log(`Table: ${row.table_name}`);
                    console.log(`Similarity: ${(row.vector_similarity * 100).toFixed(2)}%`);
                    console.log(`Content: [Failed to parse content]`);
                }
                console.log('-'.repeat(80));
            }
            
            // Higher similarity threshold for DATA category content
            // Use a high threshold (92%) for DATA category content, 65% for all other content
            const similarityThreshold = category === 'DATA' ? 0.92 : 0.65;
            
            // Log the decision process
            if (category === 'DATA') {
                console.log(`📊 DATA category detected - using higher similarity threshold (92%)`);
            }
            
            // If very similar content found (based on type-specific threshold)
            const hasVerySimilar = result.rows.some(row => row.vector_similarity > similarityThreshold);
            
            if (hasVerySimilar) {
                console.log(`❌ REJECTED - Nearly identical content found (>${similarityThreshold*100}% similarity)`);
                return { isDuplicate: true, matches: result.rows };
            } else if (category === 'DATA' && result.rows.some(row => row.vector_similarity > 0.65)) {
                console.log('✅ Similar DATA content found but below threshold - allowing this message');
            }
        } else {
            console.log('✅ No similar content found');
        }

        return { isDuplicate: false, matches: result.rows };
    } catch (error) {
        console.error('Error checking similarity:', error);
        throw error;
    }
}

// Validation rules for metrics and context
function validateMetrics(metrics) {
    if (!metrics) return false;
    
    // Validate market metrics
    const market = metrics.market || {};
    const validMarketMetrics = ['price', 'volume', 'liquidity', 'volatility']
        .every(key => market[key] === null || market[key] === 0 || typeof market[key] === 'number');

    // Validate onchain metrics
    const onchain = metrics.onchain || {};
    const validOnchainMetrics = ['transactions', 'addresses']
        .every(key => onchain[key] === null || onchain[key] === 0 || typeof onchain[key] === 'number');

    if (!validMarketMetrics || !validOnchainMetrics) {
        console.warn('Invalid metrics:', { market, onchain });
    }

    return validMarketMetrics && validOnchainMetrics;
}

function validateContext(context) {
    if (!context) return false;

    const impact = context.impact;
    const sentiment = context.sentiment || {};
    const risk = context.risk || {};
    const trend = context.trend || {};

    // Validate impact (0-100)
    const validImpact = typeof impact === 'number' && 
                      impact >= 0 && 
                      impact <= 100;

    // Validate sentiment
    const validSentiment = ['market', 'social'].every(key => {
        const value = sentiment[key];
        return typeof value === 'number' && value >= 0 && value <= 100;
    });

    // Validate risk
    const validRisk = ['market', 'tech'].every(key => {
        const value = risk[key];
        return typeof value === 'number' && value >= 0 && value <= 100;
    });

    // Validate trend
    const validTrend = (
        ['short', 'medium'].every(key => 
            !trend[key] || ['UP', 'DOWN', 'SIDEWAYS'].includes(trend[key])
        ) &&
        (!trend.strength || (typeof trend.strength === 'number' && 
                           trend.strength >= 0 && 
                           trend.strength <= 100))
    );

    return validImpact && validSentiment && validRisk && validTrend;
}

// Clean token symbol by removing $ prefix
function cleanTokenSymbol(symbol) {
    return symbol ? symbol.replace(/^\$/, '') : symbol;
}

// Safely parse JSON with error recovery
function safeParseJSON(text) {
    // If text is already an object, just return it
    if (typeof text === 'object' && text !== null) {
        return text;
    }
    
    // If text is undefined or null, return null
    if (!text) {
        console.log('Empty content provided to safeParseJSON');
        return null;
    }

    try {
        // Try direct parsing first
        return JSON.parse(text);
    } catch (error) {
        console.log('Failed to parse JSON: ' + error.message);
        console.log('Attempting to recover...');
        
        // Attempt to clean and fix common issues
        try {
            // Remove any markdown code block markers
            let cleaned = text.replace(/```json|```/g, '').trim();
            
            // Fix double quotes in headline values (common LLM error)
            cleaned = cleaned.replace(/"headline":""([^"]+)/g, '"headline":"$1');
            
            // Fix malformed hashtags like #[#Symbol]
            cleaned = cleaned.replace(/#\[#([^\]]+)\]/g, '#$1');
            
            // Check if the JSON is incomplete (missing closing braces)
            let openBraces = (cleaned.match(/{/g) || []).length;
            let closeBraces = (cleaned.match(/}/g) || []).length;
            if (openBraces > closeBraces) {
                console.log(`JSON is incomplete: ${openBraces} opening braces, ${closeBraces} closing braces`);
                // Add missing closing braces
                while (openBraces > closeBraces) {
                    cleaned += '}';
                    closeBraces++;
                }
            }
            
            // Check if the JSON is incomplete (missing closing brackets)
            let openBrackets = (cleaned.match(/\[/g) || []).length;
            let closeBrackets = (cleaned.match(/\]/g) || []).length;
            if (openBrackets > closeBrackets) {
                console.log(`JSON is incomplete: ${openBrackets} opening brackets, ${closeBrackets} closing brackets`);
                // Add missing closing brackets
                while (openBrackets > closeBrackets) {
                    cleaned += ']';
                    closeBrackets++;
                }
            }
            
            // Remove trailing commas before closing brackets (common LLM error)
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
            
            // Fix any invalid escaping in the JSON
            // DO NOT add backslashes to property names - this was causing issues
            // Only handle specific escape sequences that are commonly problematic
            
            // Try to parse the cleaned JSON
            console.log('Attempting to parse cleaned JSON');
            const result = JSON.parse(cleaned);
            console.log('Successfully recovered and parsed JSON');
            return result;
        } catch (secondError) {
            console.error('JSON recovery failed: ' + secondError.message);
            console.error('Original error: ' + error.message);
            console.error('Original text: ' + text.substring(0, 200) + (text.length > 200 ? '...' : ''));
            return null;
        }
    }
}

// Normalize and validate entity structure
function normalizeEntityStructure(entities) {
    if (!entities) return null;
    
    try {
        // Create normalized structure with defaults
        const normalized = {
            headline: entities.headline || '',
            tokens: {
                primary: { 
                    symbol: entities.tokens?.primary?.symbol === "null" ? null : entities.tokens?.primary?.symbol || null 
                },
                related: []
            },
            event: {
                category: entities.event?.category || 'NEWS',
                subcategory: entities.event?.subcategory || 'TECHNICAL',
                type: entities.event?.type || 'UPDATE'
            },
            action: {
                type: entities.action?.type || 'UPDATE',
                direction: 'NEUTRAL',
                magnitude: 'MEDIUM'
            },
            entities: {
                projects: [],
                persons: [],
                locations: []
            },
            metrics: {
                market: {
                    price: null,
                    volume: null,
                    liquidity: null,
                    volatility: null
                },
                onchain: {
                    transactions: null,
                    addresses: null
                }
            },
            context: {
                // Apply smart default impact scores based on category
                impact: getDefaultImpactScore(entities),
                risk: {
                    market: entities.context?.risk?.market || 0,
                    tech: entities.context?.risk?.tech || 0
                },
                sentiment: {
                    market: entities.context?.sentiment?.market || 0,
                    social: entities.context?.sentiment?.social || 0
                },
                trend: {
                    short: 'SIDEWAYS',
                    medium: 'SIDEWAYS',
                    strength: entities.context?.trend?.strength || 0
                }
            }
        };

        // Handle backwards compatibility with old format or common AI errors
        
        // Fix tokens.related structure
        if (entities.tokens?.primary?.related && Array.isArray(entities.tokens.primary.related)) {
            normalized.tokens.related = entities.tokens.primary.related;
        } else if (entities.tokens?.related && Array.isArray(entities.tokens.related)) {
            normalized.tokens.related = entities.tokens.related;
        }
        
        // Fix entities structure
        if (Array.isArray(entities.entities)) {
            // Convert the old array format to the new object format
            for (const entity of entities.entities) {
                if (entity.type === 'PERSON') {
                    normalized.entities.persons.push({
                        name: entity.name,
                        title: entity.title || '',
                        org: entity.org || ''
                    });
                } else if (['PROJECT', 'EXCHANGE', 'PROTOCOL', 'COMPANY', 'REGULATOR', 'DAO', 'DEX', 'DEFI', 'WALLET'].includes(entity.type)) {
                    normalized.entities.projects.push({
                        name: entity.name,
                        type: entity.type,
                        role: entity.role || 'primary'
                    });
                } else if (['COUNTRY', 'REGION', 'CITY', 'LOCATION'].includes(entity.type)) {
                    normalized.entities.locations.push({
                        name: entity.name,
                        type: entity.type === 'LOCATION' ? 'COUNTRY' : entity.type,
                        context: entity.context || 'primary'
                    });
                }
            }
        } else if (entities.entities) {
            // Use provided entity objects if they exist
            if (Array.isArray(entities.entities.projects)) {
                normalized.entities.projects = entities.entities.projects;
            }
            if (Array.isArray(entities.entities.persons)) {
                normalized.entities.persons = entities.entities.persons;
            }
            if (Array.isArray(entities.entities.locations)) {
                normalized.entities.locations = entities.entities.locations;
            }
        }
        
        // Normalize direction
        if (normalized.action.direction) {
            const direction = normalized.action.direction.toUpperCase();
            if (['UP', 'DOWN', 'NEUTRAL'].includes(direction)) {
                normalized.action.direction = direction;
            } else {
                normalized.action.direction = 'NEUTRAL';
            }
        }
        
        // Normalize magnitude
        if (normalized.action.magnitude) {
            const magnitude = normalized.action.magnitude.toUpperCase();
            if (['SMALL', 'MEDIUM', 'LARGE'].includes(magnitude)) {
                normalized.action.magnitude = magnitude;
            } else {
                normalized.action.magnitude = 'MEDIUM';
            }
        } else {
            normalized.action.magnitude = 'MEDIUM';
        }
        
        // Normalize trend values
        if (normalized.context.trend.short) {
            const short = normalized.context.trend.short.toUpperCase();
            if (['UP', 'DOWN', 'SIDEWAYS'].includes(short)) {
                normalized.context.trend.short = short;
            } else {
                normalized.context.trend.short = 'SIDEWAYS';
            }
        }
        
        if (normalized.context.trend.medium) {
            const medium = normalized.context.trend.medium.toUpperCase();
            if (['UP', 'DOWN', 'SIDEWAYS'].includes(medium)) {
                normalized.context.trend.medium = medium;
            } else {
                normalized.context.trend.medium = 'SIDEWAYS';
            }
        }
        
        // Ensure impact score is a number between 0-100
        if (normalized.context.impact === null || isNaN(normalized.context.impact)) {
            // Apply smart default scoring if null or NaN
            normalized.context.impact = getDefaultImpactScore(normalized);
        } else {
            normalized.context.impact = Math.max(0, Math.min(100, normalized.context.impact));
        }
        
        return normalized;
    } catch (error) {
        console.error('Error normalizing entity structure:', error);
        return entities; // Return original on error
    }
}

// Helper function to determine default impact score based on category
function getDefaultImpactScore(entities) {
    // If impact was explicitly set to 0, respect that
    if (entities.context?.impact === 0) return 0;
    
    // If impact is provided and not null/NaN, use it
    if (entities.context?.impact && !isNaN(entities.context.impact)) {
        return Math.max(0, Math.min(100, entities.context.impact));
    }
    
    const category = entities.event?.category || 'IGNORED';
    const subcategory = entities.event?.subcategory || '';
    const type = entities.event?.type || '';
    const headline = entities.headline || '';
    
    // Apply category-based scoring based on template guidelines
    
    // NEWS event scoring - more moderate defaults
    if (category === 'NEWS') {
        // Special case for Bitcoin reserve news
        if (subcategory === 'REGULATORY' && headline.toLowerCase().includes('bitcoin reserve')) {
            return 70; // High impact for Bitcoin reserve regulatory news
        }
        // Regulatory/Legal news
        else if (subcategory === 'REGULATORY') {
            // Give impact score 0 to regulatory talks, roundtables, discussions, and policy forums
            const zeroImpactRegex = /roundtable|discussion|panel|talk|forum|meeting|consider|review|workshop|conversation|dialogue|comment period|feedback|q&a|seminar|session|public comment|hearing|testimony|deliberation/i;
            if (zeroImpactRegex.test(headline.toLowerCase())) {
                console.log('⚠️ Setting impact to 0 for regulatory discussion/roundtable');
                return 0; // Zero impact for regulatory discussions, roundtables
            }
            
            // Low impact for other routine regulatory news
            const routine = headline.toLowerCase().match(/consideration|propose|inquiry|oversight|framework|guidance/);
            if (routine) {
                return 25; // Below threshold for routine regulatory news
            }
            
            // Policy-related content without concrete action
            if (type === 'POLICY' && !headline.toLowerCase().match(/approve|reject|sign|implement|enforce|finalize|publish|issue|adopt|enact/)) {
                console.log('⚠️ Setting impact to 0 for vague policy content without concrete action');
                return 0; // Zero impact for vague policy discussions
            }
            
            return 40; // Reduce impact for most regulatory news
        }
        // Business/Adoption news
        else if (subcategory === 'FUNDAMENTAL' || subcategory === 'BUSINESS') {
            // Lower impact for launches that aren't major
            if (type === 'LAUNCH' && !headline.toLowerCase().match(/major|significant|revolutionary|first-ever/)) {
                return 25; // Below threshold for routine launches
            }
            return 40; // Reduced impact for business/adoption news
        }
        // Technical/Development news
        else if (subcategory === 'TECHNICAL') {
            // Lower impact for updates and minor releases
            if (type === 'UPDATE' || type === 'RELEASE') {
                return 25; // Below threshold for routine updates
            }
            return 35; // Reduced impact for technical/dev news
        }
        // Security-related news
        else if (subcategory === 'SECURITY') {
            return 55; // Keep medium-high impact for security news
        }
        // Political news
        else if (subcategory === 'POLITICAL') {
            // Check if directly related to markets
            const marketRelated = headline.toLowerCase().match(/crypto|market|exchange|token|bitcoin|ethereum|regulation|ban|approve/);
            if (!marketRelated) {
                return 25; // Below threshold for non-market political news
            }
            return 35; // Low-medium impact for political news
        }
        // Default NEWS impact - just above threshold
        return 31;
    }
    
    // MARKET event scoring
    else if (category === 'MARKET') {
        if (subcategory === 'PRICE' && ['BREAKOUT', 'REVERSAL'].includes(type)) {
            return 50; // Medium-high impact for significant price movements
        }
        else if (subcategory === 'VOLUME' && ['SPIKE', 'SURGE'].includes(type)) {
            return 45; // Medium impact for volume events
        }
        else if (subcategory === 'TRADE' || subcategory === 'POSITION') {
            return 40; // Medium-low for trade signals
        }
        // Default MARKET impact
        return 35;
    }
    
    // DATA event scoring
    else if (category === 'DATA') {
        if (subcategory === 'WHALE_MOVE') {
            return 45; // Medium impact for whale movements
        }
        else if (subcategory === 'FUND_FLOW') {
            return 40; // Medium-low impact for fund flows
        }
        else if (subcategory === 'ONCHAIN') {
            // Lower impact for trend-related data that isn't dramatic
            if (type === 'NETWORK_METRICS' || type === 'GAS_METRICS') {
                return 25; // Below threshold for routine metrics
            }
            return 32; // Just above threshold for on-chain metrics
        }
        // Default DATA impact
        return 31;
    }
    
    // Default for all other categories
    return 0;
}

// Define valid category-subcategory-action mappings based on the template
const VALID_CATEGORY_MAPPINGS = {
    'MARKET': {
        'PRICE': {
            eventTypes: ['BREAKOUT', 'REVERSAL', 'SUPPORT', 'RESISTANCE', 'CONSOLIDATION', 'TREND', 'DIVERGENCE'],
            actionTypes: ['BREAK_UP', 'BREAK_DOWN', 'BOUNCE', 'RANGE', 'RECORD', 'DROP', 'RISE']
        },
        'VOLUME': {
            eventTypes: ['SPIKE', 'DECLINE', 'ACCUMULATION', 'DISTRIBUTION', 'IMBALANCE'],
            actionTypes: ['INCREASE', 'DECREASE', 'SURGE', 'DUMP']
        },
        'TRADE': {
            eventTypes: ['SPOT_ENTRY', 'FUTURES_ENTRY', 'LEVERAGE_ENTRY', 'HEDGE_POSITION', 'ARBITRAGE'],
            actionTypes: ['BUY', 'SELL', 'HOLD', 'ENTRY', 'EXIT', 'LIQUIDATE']
        },
        'POSITION': {
            eventTypes: ['TAKE_PROFIT', 'STOP_LOSS', 'POSITION_EXIT', 'LIQUIDATION'],
            actionTypes: ['OPEN', 'CLOSE', 'MODIFY', 'LIQUIDATE']
        }
    },
    'DATA': {
        'WHALE_MOVE': {
            eventTypes: ['LARGE_TRANSFER', 'ACCUMULATION', 'DISTRIBUTION'],
            actionTypes: ['DEPOSIT', 'WITHDRAW', 'TRANSFER']
        },
        'FUND_FLOW': {
            eventTypes: ['EXCHANGE_FLOW', 'BRIDGE_FLOW', 'PROTOCOL_FLOW'],
            actionTypes: ['INFLOW', 'OUTFLOW', 'BRIDGE', 'STAKE']
        },
        'ONCHAIN': {
            eventTypes: ['DEX_POOL', 'LIQUIDITY_POOL', 'NETWORK_METRICS', 'GAS_METRICS'],
            actionTypes: ['MINT', 'BURN', 'SWAP', 'UPGRADE', 'EXPLOIT']
        }
    },
    'NEWS': {
        'TECHNICAL': {
            eventTypes: ['DEVELOPMENT', 'INFRASTRUCTURE', 'PROTOCOL', 'SECURITY', 'SCALING'],
            actionTypes: ['UPDATE', 'UPGRADE', 'RELEASE', 'FORK', 'OPTIMIZE', 'SECURE']
        },
        'FUNDAMENTAL': {
            eventTypes: ['LAUNCH', 'ETF_FILING', 'LISTING', 'DELISTING', 'INTEGRATION'],
            actionTypes: ['LAUNCH', 'EXPAND', 'ACQUIRE', 'INVEST', 'COLLABORATE', 'INTEGRATE']
        },
        'REGULATORY': {
            eventTypes: ['COMPLIANCE', 'POLICY', 'LEGAL', 'INVESTIGATION', 'LICENSE'],
            actionTypes: ['APPROVE', 'REJECT', 'INVESTIGATE', 'REGULATE', 'BAN', 'PERMIT']
        },
        'SECURITY': {
            eventTypes: ['HACK', 'EXPLOIT', 'RUGPULL', 'SCAM', 'VULNERABILITY'],
            actionTypes: ['HACK', 'EXPLOIT', 'MITIGATE', 'PATCH', 'RECOVER', 'COMPENSATE']
        },
        'BUSINESS': {
            eventTypes: ['IPO', 'LISTING', 'MERGER', 'ADOPTION', 'PRODUCT'],
            actionTypes: ['EXPAND', 'ACQUIRE', 'INVEST', 'COLLABORATE', 'INTEGRATE', 'LAUNCH']
        },
        'POLITICAL': {
            eventTypes: ['POLICY', 'GOVERNMENT', 'INTERNATIONAL', 'STATEMENT', 'ELECTION'],
            actionTypes: ['ANNOUNCE', 'DECLARE', 'PROPOSE', 'OPPOSE', 'COMMENT', 'ADDRESS']
        }
    }
};

// Default values for each category
const DEFAULT_VALUES = {
    'MARKET': {
        subcategory: 'PRICE',
        eventType: 'BREAKOUT',
        actionType: 'BREAK_UP'
    },
    'DATA': {
        subcategory: 'FUND_FLOW',
        eventType: 'EXCHANGE_FLOW',
        actionType: 'TRANSFER'
    },
    'NEWS': {
        subcategory: 'TECHNICAL',
        eventType: 'DEVELOPMENT',
        actionType: 'UPDATE'
    },
    'IGNORED': {
        subcategory: 'TECHNICAL',
        eventType: 'DEVELOPMENT',
        actionType: 'UPDATE'
    }
};

// Function to validate and fix event and action types
function validateAndFixEventAction(entities) {
    if (!entities) return null;
    
    try {
        // First, handle the case where action is nested inside event (common LLM error)
        if (entities.event?.action && !entities.action) {
            console.log('Moving nested action from event to top level');
            entities.action = entities.event.action;
            delete entities.event.action;
        }
        
        // Ensure we have an event category
        const category = entities.event?.category || 'NEWS';
        
        // If we don't have a subcategory, set a default based on category
        if (!entities.event.subcategory) {
            entities.event.subcategory = DEFAULT_VALUES[category].subcategory;
            console.log(`Setting default subcategory ${entities.event.subcategory} for category ${category}`);
        }
        
        const subcategory = entities.event.subcategory;
        
        // Check if this is a valid subcategory for this category
        if (!VALID_CATEGORY_MAPPINGS[category] || !VALID_CATEGORY_MAPPINGS[category][subcategory]) {
            console.log(`Invalid subcategory ${subcategory} for category ${category}, setting default`);
            entities.event.subcategory = DEFAULT_VALUES[category].subcategory;
        }
        
        // Now we have a valid category and subcategory
        const validSubcategory = entities.event.subcategory;
        
        // Validate event type
        if (!entities.event.type || 
            !VALID_CATEGORY_MAPPINGS[category][validSubcategory].eventTypes.includes(entities.event.type)) {
            console.log(`Invalid event type ${entities.event.type} for ${category}/${validSubcategory}, setting default`);
            entities.event.type = DEFAULT_VALUES[category].eventType;
        }
        
        // Ensure we have an action object
        if (!entities.action) {
            console.log('Missing action object, creating default');
            entities.action = {
                type: DEFAULT_VALUES[category].actionType,
                direction: 'NEUTRAL',
                magnitude: 'MEDIUM'
            };
        }
        
        // Validate action type
        if (!entities.action.type || 
            !VALID_CATEGORY_MAPPINGS[category][validSubcategory].actionTypes.includes(entities.action.type)) {
            console.log(`Invalid action type ${entities.action.type} for ${category}/${validSubcategory}, setting default`);
            entities.action.type = DEFAULT_VALUES[category].actionType;
        }
        
        // Validate direction
        if (!entities.action.direction || 
            !['UP', 'DOWN', 'NEUTRAL'].includes(entities.action.direction)) {
            console.log(`Invalid direction ${entities.action.direction}, setting default`);
            entities.action.direction = 'NEUTRAL';
        }
        
        // Validate magnitude
        if (!entities.action.magnitude || 
            !['SMALL', 'MEDIUM', 'LARGE'].includes(entities.action.magnitude)) {
            console.log(`Invalid magnitude ${entities.action.magnitude}, setting default`);
            entities.action.magnitude = 'MEDIUM';
        }
        
        return entities;
    } catch (error) {
        console.error('Error validating event/action:', error);
        return entities; // Return original on error
    }
}

// Modify the processMessage function to use the new validation
export async function processMessage({ message, db, channelMapping }) {
    // Add to single global queue
    return messageQueue.add(async () => {
        try {
            // Log start
            console.log('\n' + '='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE START');
            console.log('='.repeat(80));

            // Extract text and get content data
            const contentData = extractDiscordText(message);
            if (!contentData?.original) {
                return { skip: true, reason: 'no_content' };
            }

            // Check for tweet-only messages with no meaningful content
            const tweetOnlyRegex = /^\s*\[.*?\]\s*\(\s*https?:\/\/twitter\.com\/[^\/]+\/status\/\d+\s*\)\s*$/;
            if (tweetOnlyRegex.test(contentData.original)) {
                console.log('❌ REJECTED - Message only contains a tweet link without content');
                return { skip: true, reason: 'tweet_link_only' };
            }

            // Check for minimum meaningful content (after removing URLs)
            const contentWithoutUrls = contentData.clean.replace(/https?:\/\/\S+/g, '').trim();
            if (contentWithoutUrls.length < 15) {
                console.log('❌ REJECTED - Content too short after removing URLs');
                console.log('Clean content without URLs:', contentWithoutUrls);
                return { skip: true, reason: 'insufficient_content' };
            }

            // Special check for high-quality data events like whale alerts that should never be filtered as duplicates
            const originalTextLower = contentData.original.toLowerCase();
            const isImportantDataEvent = 
                // Detect Whale Alert patterns
                (originalTextLower.includes('whale alert') && originalTextLower.match(/\$\d+[,.]?\d*\s*(million|m\b)/i)) ||
                // Detect large transfers
                (originalTextLower.includes('transferred') && originalTextLower.match(/\$\d+[,.]?\d*\s*(million|m\b)/i) && originalTextLower.includes('to')) ||
                // Detect specific large transaction patterns
                (originalTextLower.includes('🚨') && originalTextLower.match(/\d{1,3}(,\d{3})*(\.\d+)?\s*[A-Z]{3,10}/));
            
            // Always process very large fund movements (>$50M) regardless of similarity
            const largeAmountMatch = originalTextLower.match(/\$(\d+)(\.\d+)?\s*(million|m\b)/i);
            const isVeryLargeTransfer = largeAmountMatch && parseFloat(largeAmountMatch[1]) >= 50;
            
            if (isVeryLargeTransfer) {
                console.log('💰 Very large transfer detected (>$50M) - bypassing duplicate check');
            }
            
            // Generate embedding and check similarity early
            console.log('\n=== Checking Uniqueness ===');
            let embedding;
            try {
                embedding = await generateEmbedding(contentData.original);
                
                // Check for similar content before processing (but skip for very large transfers)
                if (!isVeryLargeTransfer) {
                    // Process with LLM to get category first - this is needed to decide similarity threshold
                    console.log('🔍 Determining content category to set appropriate similarity threshold');
                    let tempCategory = null;
                    
                    // Quick analysis for DATA content without full LLM processing
                    if (originalTextLower.includes('whale alert') || 
                        originalTextLower.includes('transferred') || 
                        originalTextLower.includes('🚨') ||
                        (originalTextLower.includes('moved') && originalTextLower.match(/\$\d+|[0-9,]+\s*[A-Z]{3,}/))) {
                        tempCategory = 'DATA';
                        console.log('📊 Detected likely DATA category content');
                    }
                    
                    const similarityResult = await findSimilarMessages(db, embedding, contentData.clean, tempCategory);
                    if (similarityResult.isDuplicate) {
                        return { skip: true, reason: 'duplicate_content' };
                    }
                } else {
                    console.log('✅ Bypassing similarity check for very large transfer');
                }
            } catch (error) {
                console.error('Error generating embedding:', error);
                return { skip: true, reason: 'embedding_error' };
            }

            // Log extracted content
            console.log('\n📝 Message Details:');
            console.log('  Channel:', channelMapping.table);
            console.log('  Message ID:', message.id);
            console.log('-'.repeat(80));

            console.log('=== Extracted Text ===');
            console.log('Original:', contentData.original);
            console.log('Clean:', contentData.clean);
            console.log('Author:', contentData.author);
            console.log('RT Author:', contentData.rtAuthor);

            // Process with LLM template
            let entities;
            try {
                console.log('🤖 Starting LLM processing for message:', message.id);
                const rawEntities = await extractEntities(
                    contentData.clean,  // Use clean text for analysis
                    null,
                    {
                        message: contentData.clean,  // Pass clean text to template
                        author: contentData.author || 'none',
                        rtAuthor: contentData.rtAuthor || ''
                    }
                );
                
                // Check if extraction failed
                if (!rawEntities) {
                    console.log('❌ LLM extraction failed');
                    
                    // Emergency fallback for whale alerts to ensure important transactions are processed
                    const isWhaleAlert = contentData.author?.toLowerCase().includes('whale') ||
                                      contentData.original.toLowerCase().includes('whale alert') ||
                                      (contentData.original.includes('🚨') && contentData.original.toLowerCase().includes('transferred'));
                    
                    if (isWhaleAlert) {
                        console.log('🐋 Detected whale alert - attempting emergency fallback processing');
                        
                        // Extract likely transaction details
                        const amountMatch = contentData.original.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?) *#?([A-Z]{2,10})/);
                        if (amountMatch) {
                            const amount = amountMatch[1].replace(/,/g, '');
                            const symbol = amountMatch[2];
                            
                            // Create fallback entity structure
                            const fallbackEntities = {
                                headline: `${amount} ${symbol} Transferred in Large Whale Transaction`,
                                tokens: {
                                    primary: { symbol },
                                    related: []
                                },
                                event: {
                                    category: "DATA",
                                    subcategory: "FUND_FLOW",
                                    type: "EXCHANGE_FLOW"
                                },
                                action: {
                                    type: "TRANSFER",
                                    direction: "NEUTRAL",
                                    magnitude: "LARGE"
                                },
                                entities: {
                                    projects: [],
                                    persons: [],
                                    locations: []
                                },
                                metrics: {
                                    market: {
                                        price: null,
                                        volume: null,
                                        liquidity: null,
                                        volatility: null
                                    },
                                    onchain: {
                                        transactions: parseFloat(amount),
                                        addresses: null
                                    }
                                },
                                context: {
                                    impact: parseFloat(amount) >= 50000000 ? 80 : 65,
                                    risk: {
                                        market: 50,
                                        tech: 30
                                    },
                                    sentiment: {
                                        market: 50,
                                        social: 50
                                    },
                                    trend: {
                                        short: "SIDEWAYS",
                                        medium: "SIDEWAYS",
                                        strength: 45
                                    }
                                }
                            };
                            
                            // Detect transfer direction if possible
                            if (contentData.original.toLowerCase().includes('to exchange') || 
                                contentData.original.toLowerCase().includes('to #coinbase') ||
                                contentData.original.toLowerCase().includes('to binance')) {
                                fallbackEntities.action.type = "DEPOSIT";
                                fallbackEntities.event.type = "EXCHANGE_FLOW";
                            } 
                            else if (contentData.original.toLowerCase().includes('from exchange') ||
                                    contentData.original.toLowerCase().includes('from #coinbase') ||
                                    contentData.original.toLowerCase().includes('from binance')) {
                                fallbackEntities.action.type = "WITHDRAW";
                                fallbackEntities.event.type = "EXCHANGE_FLOW";
                            }
                            
                            console.log('✅ Created fallback entity structure for whale alert');
                            entities = fallbackEntities;
                        } else {
                            console.log('❌ Could not extract transaction details for fallback processing');
                            return { skip: true, reason: 'extraction_failed' };
                        }
                    } else {
                        return { skip: true, reason: 'extraction_failed' };
                    }
                } else {
                    // Normalize and validate the entity structure
                    entities = normalizeEntityStructure(rawEntities);
                    
                    if (!entities) {
                        console.log('❌ REJECTED - Entity normalization failed');
                        return { skip: true, reason: 'entity_normalization_failed' };
                    }
                    
                    // Validate and fix event and action types
                    entities = validateAndFixEventAction(entities);
                }

                // Double-check similarity with actual category if it's DATA
                if (entities.event?.category === 'DATA') {
                    console.log('📊 Confirmed DATA category - checking similarity with higher threshold');
                    const detailedSimilarityCheck = await findSimilarMessages(db, embedding, contentData.clean, 'DATA');
                    if (detailedSimilarityCheck.isDuplicate) {
                        console.log('❌ REJECTED - Duplicated DATA content detected after full processing');
                        return { skip: true, reason: 'duplicate_data_content' };
                    }
                }

                // Clean up entities before saving
                if (entities?.headline) {
                    // Replace newlines and normalize whitespace in headline
                    entities.headline = entities.headline
                        .replace(/\n/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }

                // Log what template got
                console.log('\n=== Template Input ===');
                console.log('Text:', contentData.clean);
                console.log('Author:', contentData.author || 'none');
                console.log('RT:', contentData.rtAuthor || '');

                // Log what template returned
                console.log('\n=== Template Output ===');
                console.log(JSON.stringify(entities, null, 2));

                // Check for hallucinated content by comparing the headline to original content
                if (entities?.headline) {
                    // Detect completely hallucinated content by checking if key terms from the headline appear in the original text
                    const headlineKeyTerms = entities.headline.toLowerCase().split(' ');
                    const significantTerms = headlineKeyTerms.filter(term => 
                        term.length > 4 && 
                        !['about', 'with', 'from', 'that', 'this', 'these', 'those', 'will', 'have', 'been', 'were', 'when', 'what', 'policy', 'update'].includes(term)
                    );
                    
                    // Calculate how many significant terms from the headline appear in the original content
                    const originalTextLower = contentData.original.toLowerCase();
                    const matchingTerms = significantTerms.filter(term => originalTextLower.includes(term));
                    const matchPercentage = matchingTerms.length / (significantTerms.length || 1);
                    
                    if (matchPercentage < 0.15 && significantTerms.length >= 3) {
                        console.log('❌ REJECTED - Likely hallucinated content:');
                        console.log('Original:', contentData.original);
                        console.log('Hallucinated headline:', entities.headline);
                        console.log('Matching terms:', matchingTerms.join(', '));
                        console.log('Match percentage:', (matchPercentage * 100).toFixed(1) + '%');
                        return { skip: true, reason: 'hallucinated_content' };
                    }
                    
                    // Extra check for "White House" hallucination which seems common
                    if (entities.headline.toLowerCase().includes('white house') && 
                        !contentData.original.toLowerCase().includes('white house') &&
                        !contentData.original.toLowerCase().includes('whitehouse')) {
                        
                        console.log('❌ REJECTED - White House hallucination detected:');
                        console.log('Original:', contentData.original);
                        console.log('Hallucinated headline:', entities.headline);
                        return { skip: true, reason: 'white_house_hallucination' };
                    }
                }

            } catch (error) {
                console.log('❌ LLM Processing Error:', error.message);
                return { skip: true, reason: 'llm_error' };
            }

            if (!entities) {
                return { skip: true, reason: 'no_entities' };
            }

            // Validate required fields after template
            console.log('\n=== Validating Required Fields ===');
            if (!entities?.event?.category) {
                console.log('❌ REJECTED - Missing Category:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline);
                return { skip: true, reason: 'missing_category' };
            }

            // Validate basic content alignment
            if (entities?.tokens?.primary?.symbol) {
                const symbol = entities.tokens.primary.symbol;
                // Don't validate if symbol is explicitly null
                if (symbol === "null" || symbol === null) {
                    console.log('ℹ️ No primary symbol found in content - this is valid');
                } else {
                    // Check if the symbol actually appears in the original text
                    const symbolRegex = new RegExp(`\\b${symbol}\\b|\\$${symbol}\\b`, 'i');
                    
                    if (!symbolRegex.test(contentData.original) && symbol !== 'BTC' && symbol !== 'ETH') {
                        console.log('❌ REJECTED - Hallucinated symbol:');
                        console.log('Original:', contentData.original);
                        console.log('Claimed symbol:', symbol);
                        return { skip: true, reason: 'hallucinated_symbol' };
                    }
                }
            }

            // Apply category-based impact scoring before validation
            if (entities.context.impact === 0) {
                // Special case for Bitcoin/crypto reserve news which should have high impact
                if (entities.event.category === 'NEWS' && 
                    entities.event.subcategory === 'REGULATORY' &&
                    entities.headline.toLowerCase().includes('bitcoin reserve')) {
                    
                    console.log('⚠️ Adjusting impact score for significant Bitcoin reserve news');
                    entities.context.impact = 80;
                }
                
                // Special case for cryptocurrency liquidations which should have high impact
                if (entities.event.category === 'MARKET' && 
                    contentData.clean.toLowerCase().includes('liquidat') &&
                    contentData.clean.toLowerCase().includes('cryptocurrency')) {
                    
                    console.log('⚠️ Adjusting impact score for cryptocurrency liquidation news');
                    entities.context.impact = 70;
                }
                
                // Special case for major exchange listings which should have medium impact
                if (entities.event.category === 'NEWS' && 
                    entities.event.subcategory === 'FUNDAMENTAL' &&
                    entities.event.type === 'LISTING' &&
                    entities.tokens?.primary?.symbol) {
                    
                    // Check if listing on major exchange
                    const majorExchange = contentData.clean.toLowerCase().match(/binance|coinbase|kraken|bitfinex|huobi|kucoin|okex|gemini/);
                    if (majorExchange) {
                        console.log('⚠️ Adjusting impact score for major exchange listing news');
                        entities.context.impact = 55;
                    }
                }
                
                // Special case for crypto businesses and exchanges
                if (entities.event.category === 'NEWS' && 
                    (entities.event.subcategory === 'BUSINESS' || entities.event.subcategory === 'FUNDAMENTAL')) {
                    
                    // Look for major crypto companies
                    const majorCryptoCompanies = contentData.clean.toLowerCase().match(/coinbase|binance|kraken|bakkt|robinhood|ftx|gemini|bitmex|uniswap|aave|metamask/i);
                    
                    if (majorCryptoCompanies) {
                        console.log('⚠️ Adjusting impact score for crypto business news');
                        // Set moderate impact for significant crypto company news
                        entities.context.impact = Math.max(entities.context.impact, 40);
                    }
                }
            }

            // Explicitly check for regulatory discussions and set impact to 0 regardless of what the LLM returned
            if (entities.event.category === 'NEWS' && entities.event.subcategory === 'REGULATORY') {
                // Verify locations actually exist in the original content
                if (entities.entities?.locations?.length > 0) {
                    const locationNames = entities.entities.locations.map(loc => loc.name.toLowerCase());
                    const contentLower = contentData.original.toLowerCase();
                    
                    // Check if any location mentioned actually appears in the content
                    const locationExists = locationNames.some(location => {
                        if (location === 'united states') {
                            return contentLower.includes('united states') || 
                                contentLower.includes('us ') || 
                                contentLower.includes('u.s.') || 
                                contentLower.includes('american') ||
                                contentLower.includes('america');
                        }
                        return contentLower.includes(location);
                    });
                    
                    if (!locationExists) {
                        console.log('❌ REJECTED - Hallucinated location in regulatory news:');
                        console.log('Original:', contentData.original);
                        console.log('Claimed locations:', locationNames.join(', '));
                        return { skip: true, reason: 'hallucinated_location' };
                    }
                }
                
                // Check for regulatory discussions and set impact to 0
                const regulatoryDiscussionTerms = /roundtable|discussion|panel|talk|forum|meeting|consider|review|workshop|conversation|dialogue|session|hearing|testimony|deliberation/i;
                
                if (regulatoryDiscussionTerms.test(contentData.original.toLowerCase()) || 
                    regulatoryDiscussionTerms.test(entities.headline.toLowerCase())) {
                    
                    console.log('❌ REJECTED - Regulatory discussion/roundtable without concrete action:');
                    console.log('Original:', contentData.original);
                    console.log('Headline:', entities.headline);
                    entities.context.impact = 0;
                    return { skip: true, reason: 'regulatory_discussion_no_action' };
                }
                
                // Check if "policy" is mentioned but there's no concrete regulatory action
                if (entities.event.type === 'POLICY') {
                    const concreteActionTerms = /approve|reject|sign|implement|enforce|finalize|publish|issue|adopt|enact|announce|release|introduce|launch/i;
                    const policyMentioned = contentData.original.toLowerCase().includes('policy') || 
                                          contentData.original.toLowerCase().includes('regulation') ||
                                          contentData.original.toLowerCase().includes('regulatory');
                    
                    // Strict policy news validation - must have the word "policy" in original text
                    if (!contentData.original.toLowerCase().includes('policy') && entities.event.type === 'POLICY') {
                        console.log('❌ REJECTED - Policy news hallucination - word "policy" not in original text:');
                        console.log('Original:', contentData.original);
                        console.log('Headline:', entities.headline);
                        return { skip: true, reason: 'policy_hallucination' };
                    }
                    
                    if (!concreteActionTerms.test(contentData.original.toLowerCase()) || !policyMentioned) {
                        console.log('❌ REJECTED - Policy mentioned without concrete action:');
                        console.log('Original:', contentData.original);
                        console.log('Headline:', entities.headline);
                        entities.context.impact = 0;
                        return { skip: true, reason: 'policy_without_action' };
                    }
                }
                
                // Additional validation for WHITE HOUSE mentions (common hallucination)
                if (entities.headline.toLowerCase().includes('white house')) {
                    const whiteHouseMentioned = contentData.original.toLowerCase().includes('white house') || 
                                              contentData.original.toLowerCase().includes('whitehouse');
                    
                    if (!whiteHouseMentioned) {
                        console.log('❌ REJECTED - White House hallucination:');
                        console.log('Original:', contentData.original);
                        console.log('Headline:', entities.headline);
                        return { skip: true, reason: 'white_house_hallucination' };
                    }
                }
                
                // Enforce impact score restrictions for various content types
                if (entities.event.category === 'NEWS' && entities.event.subcategory === 'REGULATORY') {
                    // Check if it's significant regulatory news affecting major tokens
                    const affectsMajorToken = contentData.original.toLowerCase().match(/bitcoin|btc|ethereum|eth|usdt|usdc/);
                    const majorAction = contentData.original.toLowerCase().match(/ban|approve|reject|legalize|illegalize|fine|penalize|enforce|sanction/);
                    
                    // Cap policy news impact unless it's truly significant
                    if (entities.event.type === 'POLICY') {
                        if (!affectsMajorToken || !majorAction) {
                            if (entities.context.impact > 50) {
                                console.log('⚠️ Reducing impact score for policy news without major token impact');
                                console.log('Original score:', entities.context.impact);
                                entities.context.impact = 45; // Cap at moderate impact
                            }
                        }
                    }
                    
                    // Specifically for news that contains OFAC or Treasury
                    if (contentData.original.toLowerCase().includes('treasury') || 
                        contentData.original.toLowerCase().includes('ofac')) {
                        
                        // If it's about sanctions or listing, it might be important
                        if (contentData.original.toLowerCase().match(/sanction|list|delist|ban/)) {
                            console.log('ℹ️ Moderate impact score for Treasury/OFAC news');
                            entities.context.impact = Math.min(entities.context.impact, 60);
                        } else {
                            // Other treasury news should be lower priority
                            console.log('⚠️ Reducing impact score for general Treasury/OFAC news');
                            entities.context.impact = Math.min(entities.context.impact, 40);
                        }
                    }
                }
            }

            // Filter out low impact news more aggressively
            if (!entities?.context?.impact || entities.context.impact <= 30) {
                console.log('❌ REJECTED - Low Impact:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline);
                console.log('Impact Score:', entities?.context?.impact);
                console.log('Category:', entities?.event?.category);
                return { skip: true, reason: 'low_impact' };
            }
            
            // Additional filtering for regulatory news that's not directly market-impacting
            if (entities.event.category === 'NEWS' && 
                entities.event.subcategory === 'REGULATORY' && 
                entities.context.impact < 45 &&
                !contentData.clean.toLowerCase().match(/bitcoin|ethereum|crypto|usdt|usdc|bnb|xrp|sol|ada/)) {
                
                console.log('❌ REJECTED - Low relevance regulatory news:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline);
                console.log('Impact Score:', entities?.context?.impact);
                return { skip: true, reason: 'low_relevance_regulatory' };
            }

            console.log('✅ Validation passed:');
            console.log('Impact Score:', entities.context.impact);
            console.log('Category:', entities.event.category);
            console.log('Subcategory:', entities.event.subcategory);
            console.log('Event Type:', entities.event.type);
            console.log('Action Type:', entities.action.type);

            // 4. Save to DB with embedding
            try {
                // Clean and prepare content for saving
                const contentToSave = {
                    original: contentData.original,
                    entities: {
                        ...entities,
                        headline: entities.headline
                    },
                    type: 'raw',
                    author: contentData.author,
                    rt_author: contentData.rtAuthor
                };

                // Validate JSON before saving
                const stringifiedContent = JSON.stringify(contentToSave);
                const parsedForValidation = safeParseJSON(stringifiedContent); // Test parse to ensure it's valid
                
                if (!parsedForValidation) {
                    console.log('❌ REJECTED - Invalid JSON structure for saving');
                    return { skip: true, reason: 'invalid_json_structure' };
                }

                // Detect severe hallucinations before saving
                const headline = entities.headline?.toLowerCase() || '';
                const originalText = contentData.clean?.toLowerCase() || '';
                
                // Check if headline mentions entities not in the original text
                const criticalTerms = ['white house', 'strategic', 'reserve', 'policy clarification'];
                const isSevereHallucination = criticalTerms.some(term => 
                    headline.includes(term) && !originalText.includes(term)
                );
                
                if (isSevereHallucination) {
                    console.log('❌ REJECTED - Severe hallucination detected in headline');
                    console.log('  Original:', contentData.clean);
                    console.log('  Hallucinated:', entities.headline);
                    return { skip: true, reason: 'severe_hallucination' };
                }
                
                // Check if the headline is almost completely different from the original
                const significantWordsInHeadline = headline.split(' ')
                    .filter(word => word.length > 3) // Only consider significant words
                    .map(word => word.replace(/[^a-z0-9]/g, '')); // Remove punctuation
                
                const matchCount = significantWordsInHeadline.filter(word => 
                    originalText.includes(word)
                ).length;
                
                const matchPercentage = significantWordsInHeadline.length > 0 
                    ? (matchCount / significantWordsInHeadline.length) * 100 
                    : 0;
                    
                if (matchPercentage < 15 && entities.context?.impact > 30) {
                    console.log('❌ REJECTED - Headline content differs too much from original text');
                    console.log('  Match percentage:', matchPercentage.toFixed(2) + '%');
                    console.log('  Original:', contentData.clean);
                    console.log('  Generated:', entities.headline);
                    return { skip: true, reason: 'headline_mismatch' };
                }

                await db.query(`
                    INSERT INTO ${channelMapping.table}
                    (id, "createdAt", type, "agentId", content, embedding)
                    VALUES ($1, $2, 'raw', $3, $4, $5::vector)
                `, [
                    uuidv4(),
                    new Date().toISOString(),
                    process.env.AGENT_ID,
                    stringifiedContent,
                    `[${embedding.join(',')}]`
                ]);

            } catch (error) {
                console.log('❌ Save Error:', error.message);
                return { skip: true, reason: 'save_error' };
            }

            console.log('✅ Success!');
            console.log('  Channel:', channelMapping.table);
            console.log('  Event Type:', entities.event?.type);
            console.log('  Impact Score:', entities.context?.impact);
            console.log('='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE END\n');

            return { success: true };

        } catch (error) {
            console.error('❌ Processing error:', error.message);
            return { skip: true, reason: 'processing_error' };
        }
    });
}