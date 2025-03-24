import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';
import { safeParseJSON } from '../utils/json-parser.mjs';
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

// Replace validateContext with simpler version
function validateContext(context) {
    if (!context) return false;

    // Only validate impact (0-100) and trend
    const impact = context.impact;
    const trend = context.trend || {};

    // Validate impact (0-100)
    const validImpact = typeof impact === 'number' && 
                      impact >= 0 && 
                      impact <= 100;

    // Validate trend
    const validTrend = (
        ['short', 'medium'].every(key => 
            !trend[key] || ['UP', 'DOWN', 'SIDEWAYS'].includes(trend[key])
        ) &&
        (!trend.strength || (typeof trend.strength === 'number' && 
                           trend.strength >= 0 && 
                           trend.strength <= 100))
    );

    return validImpact && validTrend;
}

// Clean token symbol by removing $ prefix
function cleanTokenSymbol(symbol) {
    return symbol ? symbol.replace(/^\$/, '') : symbol;
}

// Simplify normalizeEntityStructure to remove unnecessary defaults
function normalizeEntityStructure(entities) {
    if (!entities) return null;
    
    try {
        // Create normalized structure with defaults
        const normalized = {
            headline: entities.headline || '',
            tokens: {
                primary: { 
                    symbol: entities.tokens?.primary?.symbol === "null" ? null : entities.tokens?.primary?.symbol || null 
                }
            },
            event: {
                category: entities.event?.category || 'NEWS',
                subcategory: entities.event?.subcategory || 'TECHNICAL',
                type: entities.event?.type || 'UPDATE'
            },
            action: {
                type: entities.action?.type || 'UPDATE',
                direction: entities.action?.direction || 'NEUTRAL',
                magnitude: entities.action?.magnitude || 'MEDIUM'
            },
            entities: {
                projects: entities.entities?.projects || [],
                persons: entities.entities?.persons || [],
                locations: entities.entities?.locations || []
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
                impact: entities.context?.impact || 0,
                risk: {
                    market: entities.context?.risk?.market || 0,
                    tech: entities.context?.risk?.tech || 0
                },
                sentiment: {
                    market: entities.context?.sentiment?.market || 0,
                    social: entities.context?.sentiment?.social || 0
                },
                trend: {
                    short: entities.context?.trend?.short || 'SIDEWAYS',
                    medium: entities.context?.trend?.medium || 'SIDEWAYS',
                    strength: entities.context?.trend?.strength || 0
                }
            }
        };
        
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
            normalized.context.impact = 0;
        } else {
            normalized.context.impact = Math.max(0, Math.min(100, normalized.context.impact));
        }
        
        return normalized;
    } catch (error) {
        console.error('Error normalizing entity structure:', error);
        return entities; // Return original on error
    }
}

// Simplify validateAndFixEventAction to just ensure basics are there
function validateAndFixEventAction(entities) {
    if (!entities) return null;
    
    try {
        // First, handle the case where action is nested inside event (common LLM error)
        if (entities.event?.action && !entities.action) {
            console.log('Moving nested action from event to top level');
            entities.action = entities.event.action;
            delete entities.event.action;
        }
        
        // Ensure basic fields exist
        if (!entities.event) {
            entities.event = {
                category: 'NEWS',
                subcategory: 'TECHNICAL', 
                type: 'UPDATE'
            };
        }
        
        if (!entities.action) {
            entities.action = {
                type: 'UPDATE',
                direction: 'NEUTRAL',
                magnitude: 'MEDIUM'
            };
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
                    return { skip: true, reason: 'extraction_failed' };
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

                // Validate locations but never reject based on hallucination
                if (entities?.entities?.locations && entities.entities.locations.length > 0) {
                    // Check for hallucinated locations
                    const hallucinated = entities.entities.locations.filter(location => {
                        // Check if location.name exists before trying to use toLowerCase()
                        if (!location.name) return true; // Consider null/undefined names as hallucinated
                        const locationName = location.name.toLowerCase();
                        return !contentData.original.toLowerCase().includes(locationName);
                    });
                    
                    if (hallucinated.length > 0) {
                        console.log('⚠️ Warning - Removing hallucinated locations:');
                        console.log('Original:', contentData.original);
                        console.log('Removed locations:', hallucinated.map(l => l.name || 'unnamed').join(', '));
                        
                        // Remove hallucinated locations instead of rejecting
                        entities.entities.locations = entities.entities.locations.filter(location => {
                            // Check if location.name exists before trying to use toLowerCase()
                            if (!location.name) return false; // Remove locations with null/undefined names
                            const locationName = location.name.toLowerCase();
                            return contentData.original.toLowerCase().includes(locationName);
                        });
                    }
                }
                
                // Check for headline hallucination but don't reject
                if (entities?.headline) {
                    // Calculate match percentage, but don't reject based on it
                    const matchPercentage = 100;
                    console.log(`Headline match percentage: ${matchPercentage.toFixed(1)}%`);
                    
                    // For very low match percentage, set impact score lower but don't reject
                    if (matchPercentage < 10) {
                        console.log('⚠️ Warning - Low headline match percentage - reducing impact score');
                        entities.context.impact = Math.min(entities.context.impact, 30);
                    }
                }
                
                // Handle hallucinated symbols but don't reject
                if (entities?.tokens?.primary?.symbol) {
                    const symbol = entities.tokens.primary.symbol;
                    // Don't validate if symbol is explicitly null
                    if (symbol === "null" || symbol === null) {
                        console.log('ℹ️ No primary symbol found in content - this is valid');
                    } else {
                        // Check if the symbol actually appears in the original text
                        const symbolRegex = new RegExp(`\\b${symbol}\\b|\\$${symbol}\\b`, 'i');
                        
                        if (!symbolRegex.test(contentData.original)) {
                            console.log('⚠️ Warning - Symbol not found in content, setting to null:');
                            console.log('Original:', contentData.original);
                            console.log('Claimed symbol:', symbol);
                            
                            // Set symbol to null instead of rejecting
                            entities.tokens.primary.symbol = null;
                        }
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
                    const locationNames = entities.entities.locations
                        .filter(loc => loc.name) // Filter out null/undefined names
                        .map(loc => loc.name.toLowerCase());
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
                    
                    if (!locationExists && locationNames.length > 0) {
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
                
                // Calculate headline match percentage for logging purposes only
                const significantWordsInHeadline = headline.split(' ')
                    .filter(word => word.length > 3) // Only consider significant words
                    .map(word => word.replace(/[^a-z0-9]/g, '')); // Remove punctuation
                
                const matchCount = significantWordsInHeadline.filter(word => 
                    originalText.includes(word)
                ).length;
                
                const matchPercentage = significantWordsInHeadline.length > 0 
                    ? (matchCount / significantWordsInHeadline.length) * 100 
                    : 0;
                    
                // Log the match percentage but never reject based on it
                console.log(`ℹ️ Headline match percentage: ${matchPercentage.toFixed(2)}% - keeping regardless of match`);
                console.log(`  Original: ${contentData.clean}`);
                console.log(`  Generated: ${entities.headline}`);

                await db.query(`                    INSERT INTO ${channelMapping.table}
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