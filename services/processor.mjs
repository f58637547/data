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
async function findSimilarMessages(db, embedding) {
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
            
            // If very similar content found (>90% similarity)
            const hasVerySimilar = result.rows.some(row => row.vector_similarity > 0.65);
            if (hasVerySimilar) {
                console.log('❌ REJECTED - Nearly identical content found');
                return { isDuplicate: true, matches: result.rows };
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
                    symbol: entities.tokens?.primary?.symbol || null 
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
        // Regular Regulatory/Legal news
        else if (subcategory === 'REGULATORY') {
            return 50; // Medium impact for regulatory news by default
        }
        // Business/Adoption news
        else if (subcategory === 'FUNDAMENTAL' || subcategory === 'BUSINESS') {
            return 45; // Medium impact for business/adoption news
        }
        // Technical/Development news
        else if (subcategory === 'TECHNICAL') {
            return 40; // Medium-low impact for technical/dev news
        }
        // Security-related news
        else if (subcategory === 'SECURITY') {
            return 55; // Medium-high impact for security news
        }
        // Political news
        else if (subcategory === 'POLITICAL') {
            return 35; // Low-medium impact for political news
        }
        // Default NEWS impact - just above threshold
        return 35;
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
            return 35; // Just above threshold for on-chain metrics
        }
        // Default DATA impact
        return 33;
    }
    
    // Default for all other categories
    return 0;
}

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

            // Generate embedding and check similarity early
            console.log('\n=== Checking Uniqueness ===');
            let embedding;
            try {
                embedding = await generateEmbedding(contentData.original);
                
                // Check for similar content before processing
                const similarityResult = await findSimilarMessages(db, embedding);
                if (similarityResult.isDuplicate) {
                    return { skip: true, reason: 'duplicate_content' };
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
                    console.log('❌ REJECTED - LLM extraction failed');
                    return { skip: true, reason: 'extraction_failed' };
                }
                
                // Normalize and validate the entity structure
                entities = normalizeEntityStructure(rawEntities);
                
                if (!entities) {
                    console.log('❌ REJECTED - Entity normalization failed');
                    return { skip: true, reason: 'entity_normalization_failed' };
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

            // Apply category-based impact scoring before validation
            // This is a safety net in case normalization didn't apply proper scores
            if (entities.context.impact === 0) {
                // Special case for Bitcoin/crypto reserve news which should have high impact
                if (entities.event.category === 'NEWS' && 
                    entities.event.subcategory === 'REGULATORY' &&
                    entities.headline.toLowerCase().includes('bitcoin reserve')) {
                    
                    console.log('⚠️ Adjusting impact score for significant Bitcoin reserve news');
                    entities.context.impact = 80;
                }
            }

            if (!entities?.context?.impact || entities.context.impact <= 30) {
                console.log('❌ REJECTED - Low Impact:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline);
                console.log('Impact Score:', entities?.context?.impact);
                console.log('Category:', entities?.event?.category);
                return { skip: true, reason: 'low_impact' };
            }

            console.log('✅ Validation passed:');
            console.log('Impact Score:', entities.context.impact);
            console.log('Category:', entities.event.category);

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
                safeParseJSON(stringifiedContent); // Test parse to ensure it's valid

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