import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';
import PQueue from 'p-queue';

// Create message queue with concurrency of 1
const messageQueue = new PQueue({concurrency: 1});

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

// Discord message text extraction
function extractDiscordText(message) {
    let rawText = '';
    let lastValidText = '';
    let author = null;
    let rtAuthor = null;

    try {
        // 1. Handle direct message content
        if (typeof message.content === 'string' && message.content.trim()) {
            rawText = message.content.trim();
        }

        // 2. Handle embeds array
        if (Array.isArray(message.embeds)) {
            const embedTexts = message.embeds.map(embed => {
                // Safety check for embed object
                if (!embed || typeof embed !== 'object') return null;

                // Handle rich embeds (tweets, etc)
                if (embed.data?.type === 'rich' && embed.data?.description) {
                    lastValidText = embed.data.description;
                    
                    // Extract author from URL if present
                    if (embed.data?.url?.includes('twitter.com')) {
                        author = extractTwitterUsername(embed.data.url);
                    }
                    
                    return embed.data.description;
                }

                // Handle image embeds with alt text
                if (embed.data?.type === 'image' && embed.data?.description) {
                    return embed.data.description;
                }

                // Handle title + description combos
                if (embed.data?.title && embed.data?.description) {
                    return `${embed.data.title} ${embed.data.description}`;
                }

                return null;
            })
            .filter(Boolean)  // Remove nulls
            .join(' ');

            if (embedTexts) {
                rawText = rawText ? `${rawText} ${embedTexts}` : embedTexts;
            }
        }

        // 3. Fallback to last valid text if current is empty
        if (!rawText && lastValidText) {
            rawText = lastValidText;
        }

        // 4. Clean and validate
        rawText = rawText.trim()
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .replace(/[^\S\r\n]+/g, ' '); // Remove multiple spaces

        return {
            text: rawText || null,
            author,
            rtAuthor,
            error: null
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

export async function processMessage({ message, db, channelMapping }) {
    // Add to queue and return promise
    return messageQueue.add(async () => {
        try {
            // Log original message
            console.log('\n=== Processing New Message ===');
            console.log('Channel:', channelMapping.table);
            console.log('Message ID:', message.id);
            
            // 1. First try extractDiscordText
            const extractedText = extractDiscordText(message);
            let rawText = extractedText.text;
            let author = extractedText.author;
            let rtAuthor = extractedText.rtAuthor;

            // 2. If that fails, try direct processing
            if (!rawText) {
                rawText = '';
                let lastValidText = '';  // Store last valid text

                // Get text from main message content
                if (message.content) {
                    rawText = message.content;
                }

                // Get text from embeds
                if (message.embeds?.length > 0) {
                    const embedText = message.embeds
                        .map(embed => {
                            // Get text from rich embeds (tweets)
                            if (embed.data?.type === 'rich' && embed.data?.description) {
                                lastValidText = embed.data.description;  // Store valid text
                                return embed.data.description;
                            }
                            // Get text from image embeds if they have alt text
                            if (embed.data?.type === 'image' && embed.data?.description) {
                                return embed.data.description;
                            }
                            return null;
                        })
                        .filter(Boolean)
                        .join(' ');

                    // Combine with existing text
                    if (embedText) {
                        rawText = rawText ? `${rawText} ${embedText}` : embedText;
                    }
                }

                // If current message is just media, use last valid text
                if (!rawText && message.embeds?.length > 0 && 
                    message.embeds[0].data?.type === 'image' && lastValidText) {
                    rawText = lastValidText;
                }

                // Extract usernames from URLs if not already found
                if (!author && message.content) {
                    const urls = message.content.match(/https:\/\/twitter.com\/[^\s]+/g) || [];
                    if (urls.length > 0) {
                        author = extractTwitterUsername(urls[0]);   
                        if (urls.length > 1) {
                            rtAuthor = extractTwitterUsername(urls[1]);
                        }
                    }
                } else if (!author && message.embeds?.length > 0) {
                    // If no direct URLs, try to get from embed
                    const twitterEmbed = message.embeds.find(e => e.data?.url?.includes('twitter.com'));
                    if (twitterEmbed) {
                        author = extractTwitterUsername(twitterEmbed.data.url);
                    }
                }
            }

            rawText = rawText.trim();
            if (!rawText) {
                return { skip: true, reason: 'no_content' };
            }

            // Never default to 'Twitter'
            author = author || 'none';
            rtAuthor = rtAuthor || null;

            // Clean text but keep important stuff
            const cleanText = rawText
                .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, '') // Remove emojis
                .replace(/<:[^>]+>/g, '') // Remove Discord emotes
                .replace(/https?:\/\/\S+/g, '') // Remove URLs
                .replace(/\n+/g, ' ') // Replace newlines with spaces
                .trim();

            // Keep the original text with tickers
            const originalText = cleanText;  // Save before further cleaning

            if (!cleanText || cleanText.length < 10) {
                console.log('Skipping: Content too short or empty');
                return { skip: true, reason: 'invalid_content' };
            }

            // Only keep the basic channel mapping validation
            if (!channelMapping || !channelMapping.table) {
                console.error('Invalid channel mapping:', channelMapping);
                return { skip: true, reason: 'invalid_channel_mapping' };
            }

            // Log cleaned text
            console.log('\n=== Cleaned Text ===');
            console.log(cleanText);

            // Parse content with author info
            const parsedContent = await extractEntities(
                originalText,  // Use original text with tickers
                null,
                {
                    message: originalText,
                    author: author || 'none',
                    rtAuthor: rtAuthor || ''
                }
            ).catch(error => {
                // Log the full error for debugging
                console.log('Entity extraction error:', {
                    error: error.message,
                    type: error.type || 'unknown',
                    text: originalText.substring(0, 100)
                });

                // Handle specific error types
                if (error.message.includes('Failed to parse LLM response')) {
                    // Try parsing again with cleaned text
                    return extractEntities(
                        cleanText,
                        null,
                        {
                            message: cleanText,
                            author: author || 'none',
                            rtAuthor: rtAuthor || ''
                        }
                    ).catch(retryError => {
                        console.log('Retry failed:', retryError.message);
                        return null;
                    });
                }

                // Only throw if it's not a known error type
                if (!error.message.includes('Not a trade message') && 
                    !error.message.includes('Not a crypto update')) {
                    throw error;
                }
                
                return null;
            });

            if (!parsedContent) {
                console.log('Skipping: Could not parse content');
                return { skip: true, reason: 'parse_failed' };
            }

            console.log('\n=== Parsed Content ===');
            console.log(JSON.stringify(parsedContent, null, 2));

            // Add logging for channelMapping
            console.log('\n=== Channel Mapping ===');
            console.log('Mapping:', channelMapping);

            // Validate event structure
            if (!parsedContent.event?.category || !parsedContent.event?.subcategory || !parsedContent.event?.type) {
                console.log('Missing event category structure');
                return { skip: true, reason: 'invalid_event_structure' };
            }

            // Additional categories from template
            const additionalEventTypes = {
                INFLUENCE: ['ENDORSEMENT', 'CRITICISM', 'TREND'],
                REPUTATION: ['TRUST', 'CONTROVERSY', 'CREDIBILITY'],
                SENTIMENT: ['BULLISH', 'BEARISH', 'NEUTRAL'],
                METRICS: ['MENTIONS', 'ENGAGEMENT', 'REACH']
            };

            // Add to validEventTypes
            const validEventTypes = {
                NEWS: {
                    REGULATORY: [
                        'GOV_ADOPTION',    // Government adoption/acceptance
                        'POLICY_UPDATE',   // Policy changes
                        'REGULATION',      // New regulations
                        'COMPLIANCE'       // Compliance updates
                    ],
                    BUSINESS: [
                        'PARTNERSHIP',     // New partnerships
                        'ACQUISITION',     // Company acquisitions
                        'FUNDING',         // Funding rounds
                        'EXPANSION',       // Business expansion
                        'LAUNCH',          // New product/service
                        'INTEGRATION'      // Platform integrations
                    ],
                    TECHNOLOGY: [
                        'DEVELOPMENT',     // Development updates
                        'UPGRADE',         // Protocol upgrades
                        'SECURITY',        // Security updates
                        'INNOVATION'       // New tech features
                    ]
                },
                
                // MARKET Category
                MARKET: {
                    PRICE: [
                        'BREAKOUT',        // Price breakouts
                        'REVERSAL',        // Trend reversals
                        'SUPPORT',         // Support levels
                        'RESISTANCE',      // Resistance levels
                        'PRICE_DISCOVERY'  // New price levels
                    ],
                    TRADING: [
                        'VOLUME_SPIKE',    // Volume increases
                        'LIQUIDATION',     // Large liquidations
                        'ACCUMULATION',    // Buying pressure
                        'DISTRIBUTION',    // Selling pressure
                        'MOMENTUM'         // Trend strength
                    ],
                    DERIVATIVES: [
                        'FUTURES_BASIS',   // Futures premiums
                        'OPTIONS_FLOW',    // Options activity
                        'LEVERAGE_RATIO',  // Leverage levels
                        'OPEN_INTEREST'    // Contract interest
                    ]
                },
                
                // DATA Category
                DATA: {
                    ONCHAIN: [
                        'WHALE_MOVE',      // Large transfers
                        'FUND_FLOW',       // Exchange flows
                        'WALLET_ANALYSIS', // Wallet activity
                        'NETWORK_USAGE'    // Chain metrics
                    ],
                    DEFI: [
                        'TVL_CHANGE',      // TVL updates
                        'YIELD_UPDATE',    // Yield changes
                        'PROTOCOL_METRIC', // Protocol stats
                        'DEX_VOLUME'       // DEX activity
                    ],
                    METRICS: [
                        'MARKET_CAP',      // Cap changes
                        'SUPPLY_CHANGE',   // Supply metrics
                        'CORRELATION',     // Asset correlations
                        'DOMINANCE'        // BTC dominance
                    ]
                },
                
                // SOCIAL Category
                SOCIAL: {
                    SENTIMENT: [
                        'FEAR_GREED',      // Market sentiment
                        'SOCIAL_VOLUME',    // Discussion volume
                        'TREND_GAUGE',      // Trend sentiment
                        'HYPE_INDEX'        // Social hype
                    ],
                    COMMUNITY: [
                        'GITHUB_ACTIVITY',  // Dev activity
                        'SOCIAL_GROWTH',    // Community growth
                        'INFLUENCER_TAKE',  // Key opinions
                        'ADOPTION_METRIC'   // Usage growth
                    ]
                },
                INFLUENCE: {
                    SOCIAL: additionalEventTypes.INFLUENCE
                },
                REPUTATION: {
                    SOCIAL: additionalEventTypes.REPUTATION
                },
                SENTIMENT: {
                    MARKET: additionalEventTypes.SENTIMENT
                },
                METRICS: {
                    SOCIAL: additionalEventTypes.METRICS
                }
            };

            // Check if category and subcategory exist
            if (!validEventTypes[parsedContent.event.category]?.[parsedContent.event.subcategory]) {
                console.log('Invalid category/subcategory combination');
                return { skip: true, reason: 'invalid_category' };
            }

            // Validate source and confidence
            if (!parsedContent.verification?.source || !parsedContent.verification?.confidence) {
                console.log('Missing source verification');
                return { skip: true, reason: 'missing_verification' };
            }

            // Source confidence thresholds
            const confidenceThresholds = {
                OFFICIAL: 80,
                RELIABLE: 60,
                UNVERIFIED: 20
            };

            const minConfidence = confidenceThresholds[parsedContent.verification.source] || confidenceThresholds.UNVERIFIED;
            if (parsedContent.verification.confidence < minConfidence) {
                console.log(`Confidence ${parsedContent.verification.confidence} below threshold ${minConfidence}`);
                return { skip: true, reason: 'low_confidence' };
            }

            // Validate action analysis
            if (!parsedContent.action?.type || !parsedContent.action?.direction || !parsedContent.action?.magnitude) {
                console.log('Missing action analysis');
                return { skip: true, reason: 'missing_action' };
            }

            // Validate metrics based on category
            if (parsedContent.event.category === 'MARKET' && (!parsedContent.metrics?.market?.price || !parsedContent.metrics?.market?.volume)) {
                console.log('Missing required market metrics');
                return { skip: true, reason: 'missing_market_metrics' };
            }

            if (parsedContent.event.category === 'DATA' && (!parsedContent.metrics?.onchain?.transactions || !parsedContent.metrics?.onchain?.addresses)) {
                console.log('Missing required onchain metrics');
                return { skip: true, reason: 'missing_onchain_metrics' };
            }

            if (parsedContent.event.category === 'SOCIAL' && (!parsedContent.metrics?.social?.mentions || !parsedContent.metrics?.social?.engagement)) {
                console.log('Missing required social metrics');
                return { skip: true, reason: 'missing_social_metrics' };
            }

            // Check for spam signals
            if (parsedContent.spam_signals && parsedContent.spam_signals.length > 0) {
                console.log('Spam signals detected:', parsedContent.spam_signals);
                return { skip: true, reason: 'spam_detected' };
            }

            // Impact thresholds based on category and type
            const impactThresholds = {
                NEWS: {
                    REGULATORY: 70,    // High impact for regulatory news
                    BUSINESS: 60,      // Significant for business updates
                    TECHNOLOGY: 50     // Medium for tech updates
                },
                MARKET: {
                    PRICE: 40,         // Lower for price movements
                    TRADING: 50,       // Medium for trading activity
                    DERIVATIVES: 60    // Higher for derivative impacts
                },
                DATA: {
                    ONCHAIN: 60,       // Important on-chain movements
                    DEFI: 50,         // Medium for DeFi updates
                    METRICS: 40       // Lower for regular metrics
                },
                SOCIAL: {
                    SENTIMENT: 30,     // Lower for sentiment
                    COMMUNITY: 40      // Medium for community
                },
                default: 40           // Base threshold
            };

            // Get threshold based on category/subcategory
            const minImpact = impactThresholds[parsedContent.event.category]?.[parsedContent.event.subcategory] || 
                            impactThresholds[parsedContent.event.category] || 
                            impactThresholds.default;

            // Check impact score
            if (!parsedContent.metrics?.impact) {
                console.log('Missing impact score');
                return { skip: true, reason: 'missing_impact' };
            }

            if (parsedContent.metrics.impact < minImpact) {
                console.log(`Skipping: Impact ${parsedContent.metrics.impact} below threshold ${minImpact}`);
                return { skip: true, reason: 'low_impact' };
            }

            // Add before embedding generation
            console.log('\n=== Starting Embedding Generation ===');

            // Generate embedding from full content data
            const contentData = {
                original: originalText,
                entities: parsedContent,
                type: 'raw',
                author: author || 'none',
                rt_author: rtAuthor || null
            };

            // Generate embedding from full JSON content
            const newEmbedding = await generateEmbedding(JSON.stringify(contentData));

            // Add before similarity check
            console.log('\n=== Starting Similarity Check ===');

            // 4. THEN do similarity check with full content embeddings
            console.log('Running similarity checks...');
            const similarityCheck = await db.query(`
                SELECT 
                    content,
                    type,
                    1 - (embedding <-> $1::vector) as vector_similarity
                FROM ${channelMapping.table}
                WHERE type IN ('raw', 'post')
                AND "createdAt" > NOW() - INTERVAL '48 hours'
                AND 1 - (embedding <-> $1::vector) > 0.65
                ORDER BY vector_similarity DESC
            `, [
                `[${newEmbedding.join(',')}]`  // Format as PostgreSQL array
            ]);

            if (similarityCheck.rows.length > 0) {
                console.log('Similar content found:', {
                    new_content: JSON.stringify(contentData).substring(0, 100) + '...',
                    similar_count: similarityCheck.rows.length,
                    matches: similarityCheck.rows.map(row => ({
                        content: row.content.substring(0, 100) + '...',
                        type: row.type,
                        vector_sim: (row.vector_similarity * 100).toFixed(2) + '%'
                    }))
                });
                return { skip: true, reason: 'similar_content' };
            }

            // Add before final save
            console.log('\n=== Starting Save Operation ===');

            // 5. Save with same content data used for embedding
            await db.query(`
                INSERT INTO ${channelMapping.table}
                (id, "createdAt", type, "agentId", content, embedding)
                VALUES ($1, $2, 'raw', $3, $4, $5::vector)
            `, [
                uuidv4(),
                new Date(),
                process.env.AGENT_ID,
                JSON.stringify(contentData),  // Use same content data
                `[${newEmbedding.join(',')}]`
            ]);

            console.log('Saved new content:', {
                type: channelMapping.table,
                preview: originalText.substring(0, 100) + '...'
            });

            // Add after successful save
            console.log('\n=== Operation Complete ===');
            console.log('Status: Success');
            console.log('Channel:', channelMapping.table);
            console.log('Event Type:', parsedContent.event?.type);
            console.log('Impact Score:', parsedContent.metrics.impact);

            return { success: true };

        } catch (error) {
            console.error('Processing error:', {
                error: error.message,
                preview: message.content?.substring(0, 100) || 
                        message.embeds?.[0]?.description?.substring(0, 100) || 
                        'No preview available'
            });
            return { skip: true, reason: 'processing_error' };
        }
    });
}

// Add queue event listeners
messageQueue.on('active', () => {
    console.log(`Queue size: ${messageQueue.size}`);
});

messageQueue.on('idle', () => {
    console.log('Queue is empty');
});