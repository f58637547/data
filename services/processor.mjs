import { v4 as uuidv4 } from 'uuid';
import { generateEmbedding } from './openai.mjs';
import { extractEntities } from '../templates/index.mjs';
import PQueue from 'p-queue';

// Create separate queues for each channel - these can run in parallel
const messageQueues = {
    crypto: new PQueue({concurrency: 1}),
    trades: new PQueue({concurrency: 1})
};

// Create single LLM queue - only one LLM call at a time across ALL channels
const llmQueue = new PQueue({concurrency: 1});

// Add queue event listeners
Object.entries(messageQueues).forEach(([channel, queue]) => {
    queue.on('active', () => {
        console.log(`${channel} queue size: ${queue.size}, LLM queue size: ${llmQueue.size}`);
    });
    
    queue.on('idle', () => {
        console.log(`${channel} queue is empty`);
    });
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
        }
    }

    return textParts.join('\n').trim();
}

// Get cleaned text from message (for content processing)
function getMessageText(message) {
    let text = getRawMessageText(message);
    
    // Clean the text for content processing:
    return text
        .replace(/https?:\/\/\S+/g, '')  // Remove URLs
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')  // Remove markdown links but keep text
        .replace(/\[\s*[↧⬇️]\s*\]\s*\(\s*\)/g, '')  // Remove empty markdown links with arrows
        .replace(/<:[^>]+>/g, '')  // Remove Discord emotes
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();
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

export async function processMessage({ message, db, channelMapping }) {
    // Get queue for this channel
    const queue = messageQueues[channelMapping.table];
    if (!queue) {
        console.error('Invalid channel:', channelMapping.table);
        return { skip: true, reason: 'invalid_channel' };
    }

    // Add to channel-specific queue
    return queue.add(async () => {
        try {
            // Log start
            console.log('\n' + '='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE START');
            console.log('='.repeat(80));
            console.log('📝 Message Details:');
            console.log('  Channel:', channelMapping.table);
            console.log('  Message ID:', message.id);
            console.log('-'.repeat(80));

            // Extract text content first - if too short, skip before LLM
            const contentData = extractDiscordText(message);
            if (!contentData) {
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'content_too_short' };
            }

            // Add to LLM queue for entity extraction
            let entities;
            try {
                entities = await llmQueue.add(async () => {
                    console.log('🤖 Starting LLM processing for message:', message.id);
                    return extractEntities(contentData, channelMapping);
                });
            } catch (error) {
                console.log('❌ LLM Processing Error:', error.message);
                return { skip: true, reason: 'llm_error' };
            }

            if (!entities) {
                return { skip: true, reason: 'no_entities' };
            }

            // Generate embedding for similarity check
            let embedding;
            try {
                embedding = await generateEmbedding(contentData.original);
            } catch (error) {
                console.log('❌ Embedding Error:', error.message);
                return { skip: true, reason: 'embedding_error' };
            }
            
            // Check similarity with existing messages
            try {
                const similar = await findSimilarMessages(db, embedding);
                if (similar && similar.length > 0) {
                    return { skip: true, reason: 'duplicate' };
                }
            } catch (error) {
                console.log('❌ Similarity Check Error:', error.message);
                return { skip: true, reason: 'similarity_error' };
            }

            // Only keep the basic channel mapping validation
            if (!channelMapping || !channelMapping.table) {
                console.error('Invalid channel mapping:', channelMapping);
                console.log('❌ Skipping: Invalid channel mapping');
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'invalid_channel_mapping' };
            }

            // Parse content with author info
            const parsedContent = {
                type: 'raw',
                author: contentData.author || 'none',
                rt_author: contentData.rtAuthor,
                original: contentData.original,     // Use raw text for original
                entities: {
                    headline: {
                        text: contentData.original  // Use raw text for headline
                    }
                }
            };

            // Update content data with parsed entities
            parsedContent.entities = entities;

            console.log('✅ Parsed Content:');
            console.log(JSON.stringify(parsedContent, null, 2));
            console.log('-'.repeat(80));

            // Add logging for channelMapping
            console.log('📊 Channel Info:');
            console.log('  Mapping:', channelMapping);
            console.log('-'.repeat(80));

            console.log('\n=== Starting Content Processing ===');

            // 1. Check event structure from LLM
            const event = parsedContent.entities.event;
            if (!event?.category || !event?.subcategory || !event?.type || !event?.action?.type) {
                console.log('❌ REJECTED: Invalid event structure');
                console.log('Missing fields:', {
                    category: event?.category,
                    subcategory: event?.subcategory,
                    type: event?.type,
                    action: event?.action?.type
                });
                console.log('='.repeat(80));
                return { skip: true, reason: 'invalid_event_structure' };
            }
            console.log('✅ Event structure valid');

            // 2. Check impact score from LLM
            const MIN_IMPACT_THRESHOLD = 20;  // Minimum impact to consider content valuable
            const impact = parsedContent.entities.context?.impact || 0;
            
            if (impact === 0) {
                console.log('❌ REJECTED: Zero impact (spam/personal content)');
                console.log('='.repeat(80));
                return { skip: true, reason: 'zero_impact' };
            }
            
            if (impact < MIN_IMPACT_THRESHOLD) {
                console.log(`❌ REJECTED: Low impact score (${impact} < ${MIN_IMPACT_THRESHOLD})`);
                console.log('='.repeat(80));
                return { skip: true, reason: 'low_impact' };
            }
            console.log(`✅ Impact score acceptable: ${impact}`);

            // 3. Generate embedding for similarity check
            console.log('\n=== Starting Similarity Check ===');
            const newEmbedding = await generateEmbedding(JSON.stringify(parsedContent));
            console.log('✅ Embedding generated');

            // 4. Check for similar content
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
                LIMIT 5
            `, [
                `[${newEmbedding.join(',')}]`
            ]);

            if (similarityCheck.rows.length > 0) {
                const topMatch = similarityCheck.rows[0];
                console.log('❌ REJECTED: Similar content found');
                console.log('Details:', {
                    similarity_score: (topMatch.vector_similarity * 100).toFixed(1) + '%',
                    similar_count: similarityCheck.rows.length,
                    original_impact: impact,
                    similar_content: JSON.parse(topMatch.content).entities.headline.text.substring(0, 100) + '...'
                });
                console.log('='.repeat(80));
                return { skip: true, reason: 'duplicate_content' };
            }
            console.log('✅ Content is unique');

            // 5. If we got here, content passed all checks
            console.log('\n=== Content Accepted ===');
            console.log('Summary:', {
                category: event.category,
                subcategory: event.subcategory,
                impact_score: impact,
                channel: channelMapping.table
            });

            // 6. Prepare row for saving
            const row = {
                id: uuidv4(),
                channel: channelMapping.table,
                message_id: message.id,
                text: parsedContent.entities.headline.text,
                author: parsedContent.author,
                rt_author: parsedContent.rt_author,
                tokens: parsedContent.entities.tokens || {},
                entities: parsedContent.entities.entities || {},
                event: parsedContent.entities.event,
                metrics: parsedContent.entities.metrics || {},
                context: {
                    impact: parsedContent.entities.context?.impact || 50,
                    confidence: parsedContent.entities.context?.confidence || 50,
                    sentiment: {
                        market: parsedContent.entities.context?.sentiment?.market || 50,
                        social: parsedContent.entities.context?.sentiment?.social || 50
                    }
                },
                embedding: newEmbedding,  // Use the embedding we already generated
                createdAt: new Date().toISOString()
            };

            // Add before final save
            console.log('\n=== Starting Save Operation ===');

            // 5. Save with same content data used for embedding
            await db.query(`
                INSERT INTO ${channelMapping.table}
                (id, "createdAt", type, "agentId", content, embedding)
                VALUES ($1, $2, 'raw', $3, $4, $5::vector)
            `, [
                uuidv4(),
                new Date().toISOString(),
                process.env.AGENT_ID,
                JSON.stringify(parsedContent),  // Use same content data
                `[${newEmbedding.join(',')}]`
            ]);

            console.log('✅ Operation Complete:');
            console.log('  Status: Success');
            console.log('  Channel:', channelMapping.table);
            console.log('  Event Type:', parsedContent.entities.event?.type);
            console.log('  Impact Score:', parsedContent.entities.context.impact);
            console.log('='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE END\n');

            return { status: 'success' };

        } catch (error) {
            console.log('❌ Error Processing:');
            console.log('  Error:', error.message);
            console.log('='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE END\n');
            return { skip: true, reason: 'processing_error' };
        }
    });
}