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

// Check similarity with vector search
async function findSimilarMessages(db, embedding, channelTable) {
    try {
        const query = `
            SELECT content, type,
                   1 - (embedding <-> $1::vector) as vector_similarity
            FROM ${channelTable}
            WHERE type IN ('raw', 'post')
            AND "createdAt" > NOW() - INTERVAL '48 hours'
            AND 1 - (embedding <-> $1::vector) > 0.65
            ORDER BY vector_similarity DESC
        `;

        const result = await db.query(query, [
            `[${embedding.join(',')}]`  // Format as PostgreSQL array
        ]);

        if (result.rows.length > 0) {
            console.log('Similar content found:', {
                matches: result.rows.map(row => ({
                    content: row.content.substring(0, 100) + '...',
                    type: row.type,
                    vector_sim: (row.vector_similarity * 100).toFixed(2) + '%'
                }))
            });
        }

        return result.rows;
    } catch (error) {
        console.error('Error checking similarity:', error);
        throw error;
    }
}

export async function processMessage({ message, db, channelMapping }) {
    // Add to single global queue
    return messageQueue.add(async () => {
        try {
            // Log start
            console.log('\n' + '='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE START');
            console.log('='.repeat(80));
            console.log('📝 Message Details:');
            console.log('  Channel:', channelMapping.table);
            console.log('  Message ID:', message.id);
            console.log('-'.repeat(80));

            // 1. Extract text first
            const contentData = extractDiscordText(message);
            if (!contentData) {
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'content_too_short' };
            }

            // 2. Generate embedding and check similarity BEFORE LLM
            let embedding;
            try {
                console.log('Generating embedding for text length:', contentData.original.length);
                embedding = await generateEmbedding(contentData.original);
                console.log('Embedding generated successfully:', {
                    model: 'text-embedding-3-small',
                    dimensions: embedding.length
                });
            } catch (error) {
                console.log('❌ Embedding Error:', error.message);
                return { skip: true, reason: 'embedding_error' };
            }
            
            // 3. Check similarity with existing messages
            try {
                const similar = await findSimilarMessages(db, embedding, channelMapping.table);
                if (similar && similar.length > 0) {
                    console.log('Found similar messages:', similar.length);
                    return { skip: true, reason: 'duplicate' };
                }
            } catch (error) {
                console.log('❌ Similarity Check Error:', error.message);
                return { skip: true, reason: 'similarity_error' };
            }

            // 4. Only if unique, process with LLM template
            let entities;
            try {
                console.log('🤖 Starting LLM processing for message:', message.id);
                entities = await extractEntities(contentData, channelMapping);
            } catch (error) {
                console.log('❌ LLM Processing Error:', error.message);
                return { skip: true, reason: 'llm_error' };
            }

            if (!entities) {
                return { skip: true, reason: 'no_entities' };
            }

            // 5. Save to DB with embedding
            try {
                await db.query(`
                    INSERT INTO ${channelMapping.table}
                    (id, "createdAt", type, "agentId", content, embedding)
                    VALUES ($1, $2, 'raw', $3, $4, $5::vector)
                `, [
                    uuidv4(),
                    new Date().toISOString(),
                    process.env.AGENT_ID,
                    JSON.stringify({
                        original: contentData.original,
                        entities,
                        type: 'raw',
                        author: contentData.author,
                        rt_author: contentData.rtAuthor
                    }),
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