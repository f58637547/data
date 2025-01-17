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

export async function processMessage({ message, db, channelMapping }) {
    // Add to queue and return promise
    return messageQueue.add(async () => {
        try {
            // Log original message
            console.log('\n=== Processing New Message ===');
            console.log('Channel:', channelMapping.table);
            console.log('Message ID:', message.id);
            
            // 1. Get plain text from Discord - combine text from related messages
            let rawText = '';
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

            rawText = rawText.trim();
            if (!rawText) {
                return { skip: true, reason: 'no_content' };
            }

            let author = null;
            let rtAuthor = null;

            // Extract usernames from URLs
            if (message.content) {
                const urls = message.content.match(/https:\/\/twitter\.com\/[^\s]+/g) || [];
                if (urls.length > 0) {
                    author = extractTwitterUsername(urls[0]);   
                    if (urls.length > 1) {
                        rtAuthor = extractTwitterUsername(urls[1]);
                    }
                }
            } else if (message.embeds?.length > 0) {
                // If no direct URLs, try to get from embed
                const twitterEmbed = message.embeds.find(e => e.data?.url?.includes('twitter.com'));
                if (twitterEmbed) {
                    author = extractTwitterUsername(twitterEmbed.data.url);  // Will get 'WatcherGuru'
                }
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

            if (cleanText.length < 10) {
                return { skip: true, reason: 'no_content' };
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
                channelMapping.table,
                {
                    message: originalText,
                    author: author || 'none',
                    rtAuthor: rtAuthor || ''
                }
            );
            console.log('\n=== Parsed Content ===');
            console.log(JSON.stringify(parsedContent, null, 2));

            // Add logging for channelMapping
            console.log('\n=== Channel Mapping ===');
            console.log('Mapping:', channelMapping);

            // Validate event type
            const validEventTypes = {
                crypto: [
                    // Platform Events
                    'LISTING',        // New exchange/platform listings
                    'DELISTING',      // Removals
                    'INTEGRATION',    // Platform integrations
                    'DEX',           // Decentralized exchanges
                    'DEX_POOL',      // DEX pools
                    'LIQUIDITY_POOL', // Liquidity pools
                    
                    // Protocol Events
                    'DEVELOPMENT',    // Code updates
                    'UPGRADE',        // Protocol changes
                    'FORK',          // Chain splits
                    'BRIDGE',        // Cross-chain
                    'DEFI',          // Decentralized finance
                    
                    // Market Events
                    'MARKET_MOVE',    // General market movement
                    'WHALE_MOVE',     // Large transactions
                    'FUND_FLOW',      // Institutional money
                    'VOLUME_SPIKE',   // Trading volume spikes
                    'PRICE_ALERT',    // Price movements
                    'ACCUMULATION',   // Buying zones
                    'DISTRIBUTION',   // Selling zones
                    
                    // Security Events
                    'HACK',          // Breaches
                    'EXPLOIT',       // Vulnerabilities
                    'RUGPULL',       // Scams
                    
                    // Business Events
                    'PARTNERSHIP',    // Deals
                    'ACQUISITION',    // Mergers
                    'REGULATION',     // Legal updates
                    'FUNDING',       // Investment rounds, raises
                    
                    // Token Events
                    'AIRDROP',       // Token distributions
                    'TOKENOMICS',    // Supply changes
                    'DELEGATE',      // Staking
                    'REBASE',        // Price rebalancing
                    'UPDATE'         // General updates
                ],
                trades: [
                    // Trade Entry Events
                    'SPOT_ENTRY',     // Spot buys
                    'FUTURES_ENTRY',  // Futures positions
                    'LEVERAGE_ENTRY', // Margin trades
                    
                    // Trade Exit Events
                    'TAKE_PROFIT',    // Profit targets
                    'STOP_LOSS',      // Stop hits
                    'POSITION_EXIT',  // General exits
                    
                    // Technical Analysis Events
                    'BREAKOUT',       // Pattern breaks (triangles, ranges)
                    'REVERSAL',       // Trend changes
                    'ACCUMULATION',   // Buying zone identified
                    'DISTRIBUTION',   // Selling zone identified
                    
                    // Market Analysis Events
                    'MARKET_MOVE',    // General price movement
                    'WHALE_MOVE',     // Large wallet transactions
                    'FUND_FLOW',      // Institutional money flow
                    'VOLUME_SPIKE',   // Unusual trading volume
                    'PRICE_ALERT'     // Significant price levels
                ]
            };

            // Log validation
            console.log('\n=== Event Type Validation ===');
            console.log('Type:', parsedContent.event?.type);
            console.log('Channel Type:', channelMapping.table);
            console.log('Valid Types:', validEventTypes[channelMapping.table]);

            // Add type validation
            if (!validEventTypes[channelMapping.table]) {
                console.error('Invalid channel type for event validation:', channelMapping.table);
                return { skip: true, reason: 'invalid_channel_type' };
            }

            // Then check if event type is valid
            if (parsedContent.event?.type === 'NONE') {
                console.log('Skipping: Content marked as NONE type');
                return { skip: true, reason: 'none_type' };
            }

            if (!validEventTypes[channelMapping.table].includes(parsedContent.event?.type)) {
                console.log('Skipping: Invalid event type:', parsedContent.event?.type);
                return { skip: true, reason: 'invalid_event_type' };
            }

            // After event type validation, add impact check
            if (parsedContent.metrics.impact < 40) {  // 40 is our LOW IMPACT threshold
                console.log('Skipping: Low impact score:', parsedContent.metrics.impact);
                return { skip: true, reason: 'low_impact' };
            }

            // Or more detailed version:
            const impactThresholds = {
                crypto: {
                    // Platform Events
                    LISTING: 70,      // Major listings need high impact
                    DEX: 60,         // DEX launches are significant
                    
                    // Protocol Events
                    DEVELOPMENT: 50,  // Code updates
                    UPGRADE: 60,     // Major upgrades
                    INTEGRATION: 40,  // Allow integrations
                    
                    // Market Events
                    MARKET_MOVE: 40,  // Allow market opinions
                    FUND_FLOW: 50,   // Institutional flows
                    WHALE_MOVE: 50,  // Large transactions
                    
                    // Security Events
                    HACK: 80,        // Critical security
                    EXPLOIT: 70,     // Vulnerabilities
                    RUGPULL: 70,     // Scams
                    
                    // Business Events
                    PARTNERSHIP: 40,  // Allow partnerships/collaborations
                    ACQUISITION: 60,  // Major deals
                    REGULATION: 60,   // Regulatory impact
                    FUNDING: 60,      // Investment rounds
                    
                    default: 40      // Lower base threshold
                },
                trades: {
                    // Market Analysis
                    MARKET_MOVE: 40,    // Allow general market commentary
                    PRICE_ALERT: 50,    // Price targets/levels
                    WHALE_MOVE: 60,     // Large wallet activity
                    FUND_FLOW: 60,      // Institutional activity
                    VOLUME_SPIKE: 50,   // Volume analysis
                    
                    // Trade Entry/Exit (existing)
                    SPOT_ENTRY: 50,
                    FUTURES_ENTRY: 60,
                    LEVERAGE_ENTRY: 70,
                    TAKE_PROFIT: 60,
                    STOP_LOSS: 60,
                    
                    // Technical Analysis
                    BREAKOUT: 60,
                    REVERSAL: 60,
                    
                    default: 40
                }
            };

            const minImpact = impactThresholds[channelMapping.table][parsedContent.event.type] || 
                             impactThresholds[channelMapping.table].default;

            if (parsedContent.metrics.impact < minImpact) {
                console.log(`Skipping: Impact ${parsedContent.metrics.impact} below threshold ${minImpact} for ${parsedContent.event.type}`);
                return { skip: true, reason: 'low_impact' };
            }

            // Add before embedding generation
            console.log('\n=== Starting Embedding Generation ===');

            // 3. THEN generate embedding
            const newEmbedding = await generateEmbedding(cleanText);

            // Add before similarity check
            console.log('\n=== Starting Similarity Check ===');

            // 4. THEN do similarity check
            console.log('Running similarity checks...');
            const similarityCheck = await db.query(`
                SELECT 
                    content->>'original' as text,
                    type,
                    1 - (embedding <-> $1::vector) as vector_similarity
                FROM ${channelMapping.table}
                WHERE type = 'post'
                AND "createdAt" > NOW() - INTERVAL '48 hours'
                AND 1 - (embedding <-> $1::vector) > 0.85
                ORDER BY vector_similarity DESC
            `, [
                `[${newEmbedding.join(',')}]`  // Format as PostgreSQL array
            ]);

            if (similarityCheck.rows.length > 0) {
                console.log('Similar content found:', {
                    new_text: cleanText.substring(0, 100) + '...',
                    similar_count: similarityCheck.rows.length,
                    matches: similarityCheck.rows.map(row => ({
                        text: row.text.substring(0, 100) + '...',
                        type: row.type,
                        vector_sim: (row.vector_similarity * 100).toFixed(2) + '%',
                        text_sim: (row.text_similarity * 100).toFixed(2) + '%',
                        token_sim: row.token_similarity ? 
                            (row.token_similarity * 100).toFixed(2) + '%' : 'N/A'
                    }))
                });
                return { skip: true, reason: 'similar_content' };
            }

            // Add before final save
            console.log('\n=== Starting Save Operation ===');

            // 5. Process and save unique content
            await db.query(`
                INSERT INTO ${channelMapping.table}
                (id, "createdAt", type, "agentId", content, embedding)
                VALUES ($1, $2, 'raw', $3, $4, $5::vector)
            `, [
                uuidv4(),
                new Date(),
                process.env.AGENT_ID,
                JSON.stringify({
                    original: originalText,
                    entities: parsedContent,
                    type: 'raw',
                    author: author || 'none',
                    rt_author: rtAuthor || null
                }),
                `[${newEmbedding.join(',')}]`  // Format as PostgreSQL array
            ]);

            console.log('Saved new content:', {
                type: channelMapping.table,
                preview: cleanText.substring(0, 100) + '...'
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
