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

        // Extract info from URLs before cleaning
        if (message.content) {
            const urls = message.content.match(/https:\/\/twitter\.com\/([^\s\/]+)/g) || [];
            if (urls.length > 0) {
                author = extractTwitterUsername(urls[0]);
                if (urls.length > 1) {
                    rtAuthor = extractTwitterUsername(urls[1]);
                }
            }
        }

        // Clean text but preserve important stuff
        const cleanText = rawText
            // Keep important emojis, remove others
            .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, (match) => {
                // Keep important signal emojis
                const keepEmojis = ['🚨', '📈', '📉', '🔥', '⚡', '💥', '🎯', '🔴', '🟢'];
                return keepEmojis.includes(match) ? match : '';
            })
            // Remove Discord emotes (UI decoration)
            .replace(/<:[^>]+>/g, '')
            // Extract username from URL then remove it
            .replace(/https:\/\/twitter\.com\/([^\s\/]+)\/status\/\d+/g, (match, username) => {
                // Store author if not already found
                if (!author) author = username;
                return '';
            })
            // Remove other URLs
            .replace(/https?:\/\/\S+/g, '')
            // Collapse multiple newlines, keep single ones
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Only check if empty or too short AFTER removing noise
        if (!cleanText || cleanText.length < 10) {
            console.log('❌ Skipping: Content too short or empty');
            console.log('Raw text:', rawText);
            console.log('Clean text:', cleanText);
            console.log('='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE END\n');
            return { skip: true, reason: 'invalid_content' };
        }

        // Keep both raw and clean versions
        const messageText = {
            raw: rawText,               // Original with all formatting
            clean: cleanText            // Cleaned but keeping important signals
        };

        return {
            text: messageText.clean,
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
            console.log('\n' + '='.repeat(80));
            console.log('🔄 PROCESSING MESSAGE START');
            console.log('='.repeat(80));
            console.log('📝 Message Details:');
            console.log('  Channel:', channelMapping.table);
            console.log('  Message ID:', message.id);
            console.log('-'.repeat(80));

            // Get text from main message content
            let rawText = '';
            let author = null;
            let rtAuthor = null;

            if (message.content) {
                rawText = message.content.trim();
            }

            // Add embed content - it might have important info
            if (message.embeds?.length > 0) {
                const embedTexts = message.embeds
                    .map(embed => {
                        // Get text from rich embeds (tweets, etc)
                        if (embed.data?.type === 'rich' && embed.data?.description) {
                            // Get author from URL if present
                            if (embed.data?.url?.includes('twitter.com')) {
                                author = extractTwitterUsername(embed.data.url);
                            }
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

                // Combine with message content if we have both
                if (embedTexts) {
                    rawText = rawText ? `${rawText}\n${embedTexts}` : embedTexts;
                }
            }

            rawText = rawText.trim();
            if (!rawText) {
                console.log('❌ Skipping: No content');
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'no_content' };
            }

            // Never default to 'Twitter'
            author = author || 'none';
            rtAuthor = rtAuthor || null;

            // Extract info from URLs before cleaning
            if (message.content) {
                const urls = message.content.match(/https:\/\/twitter\.com\/([^\s\/]+)/g) || [];
                if (urls.length > 0) {
                    author = extractTwitterUsername(urls[0]);
                    if (urls.length > 1) {
                        rtAuthor = extractTwitterUsername(urls[1]);
                    }
                }
            }

            // Clean text but preserve important stuff
            const cleanText = rawText
                // Keep important emojis, remove others
                .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu, (match) => {
                    // Keep important signal emojis
                    const keepEmojis = ['🚨', '📈', '📉', '🔥', '⚡', '💥', '🎯', '🔴', '🟢'];
                    return keepEmojis.includes(match) ? match : '';
                })
                // Remove Discord emotes (UI decoration)
                .replace(/<:[^>]+>/g, '')
                // Extract username from URL then remove it
                .replace(/https:\/\/twitter\.com\/([^\s\/]+)\/status\/\d+/g, (match, username) => {
                    // Store author if not already found
                    if (!author) author = username;
                    return '';
                })
                // Remove other URLs
                .replace(/https?:\/\/\S+/g, '')
                // Collapse multiple newlines, keep single ones
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            // Only check if empty or too short AFTER removing noise
            if (!cleanText || cleanText.length < 10) {
                console.log('❌ Skipping: Content too short or empty');
                console.log('Raw text:', rawText);
                console.log('Clean text:', cleanText);
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'invalid_content' };
            }

            console.log('📄 Original Text:');
            console.log(rawText);  // Show raw text in logs
            console.log('-'.repeat(80));

            // Only keep the basic channel mapping validation
            if (!channelMapping || !channelMapping.table) {
                console.error('Invalid channel mapping:', channelMapping);
                console.log('❌ Skipping: Invalid channel mapping');
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'invalid_channel_mapping' };
            }

            // Parse content with author info
            const contentData = {
                type: 'raw',
                author: author || 'none',
                rt_author: rtAuthor,
                original: rawText,     // Use raw for original
                entities: {
                    headline: {
                        text: rawText  // Use raw for headline
                    }
                }
            };

            const parsedContent = await extractEntities(
                contentData,
                channelMapping,
                {
                    message: cleanText,  // Use clean for processing
                    author: author || 'none',
                    rtAuthor: rtAuthor || ''
                }
            );

            if (!parsedContent) {
                console.log('❌ Parse Failed:');
                console.log('  Could not parse content');
                console.log('='.repeat(80));
                console.log('🔄 PROCESSING MESSAGE END\n');
                return { skip: true, reason: 'parse_failed' };
            }

            // Update content data with parsed entities
            contentData.entities = parsedContent;

            console.log('✅ Parsed Content:');
            console.log(JSON.stringify(contentData, null, 2));
            console.log('-'.repeat(80));

            // Add logging for channelMapping
            console.log('📊 Channel Info:');
            console.log('  Mapping:', channelMapping);
            console.log('-'.repeat(80));

            console.log('\n=== Starting Content Processing ===');

            // 1. Check event structure from LLM
            const event = contentData.entities.event;
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
            const impact = contentData.entities.context?.impact || 0;
            
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
            const newEmbedding = await generateEmbedding(JSON.stringify(contentData));
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
                text: contentData.entities.headline.text,
                author,
                rt_author: rtAuthor,
                tokens: contentData.entities.tokens || {},
                entities: contentData.entities.entities || {},
                event: contentData.entities.event,
                metrics: contentData.entities.metrics || {},
                context: {
                    impact: contentData.entities.context?.impact || 50,
                    confidence: contentData.entities.context?.confidence || 50,
                    sentiment: {
                        market: contentData.entities.context?.sentiment?.market || 50,
                        social: contentData.entities.context?.sentiment?.social || 50
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
                JSON.stringify(contentData),  // Use same content data
                `[${newEmbedding.join(',')}]`
            ]);

            console.log('✅ Operation Complete:');
            console.log('  Status: Success');
            console.log('  Channel:', channelMapping.table);
            console.log('  Event Type:', contentData.entities.event?.type);
            console.log('  Impact Score:', contentData.entities.context.impact);
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

// Add queue event listeners
messageQueue.on('active', () => {
    console.log(`Queue size: ${messageQueue.size}`);
});

messageQueue.on('idle', () => {
    console.log('Queue is empty');
});