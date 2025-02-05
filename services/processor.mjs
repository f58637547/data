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

            // 1. Check if we have valid event structure
            if (!parsedContent.event?.category || !parsedContent.event?.subcategory || !parsedContent.event?.type) {
                console.log('Missing event category structure');
                return { skip: true, reason: 'invalid_event_structure' };
            }

            // 2. Check if we have impact score and if it's high enough
            if (!parsedContent.metrics?.impact) {
                console.log('Missing impact score');
                return { skip: true, reason: 'missing_impact' };
            }

            // Base impact thresholds
            const minImpact = {
                NEWS: 60,      // Important news only
                MARKET: 70,    // Significant market moves
                DATA: 75,      // Strong on-chain signals
                SOCIAL: 80     // Very strong social signals
            }[parsedContent.event.category] || 70; // Default to 70 if category not found

            if (parsedContent.metrics.impact < minImpact) {
                console.log(`Skipping: Impact ${parsedContent.metrics.impact} below threshold ${minImpact}`);
                return { skip: true, reason: 'low_impact' };
            }

            // 3. If we got here, prepare the data for saving
            const row = {
                id: uuidv4(),
                channel: channelMapping.table,
                message_id: message.id,
                text: parsedContent.headline.text,
                text_cleaned: parsedContent.headline.cleaned,
                author,
                rt_author: rtAuthor,
                tokens: parsedContent.tokens || {},
                entities: parsedContent.entities || {},
                event: parsedContent.event,
                metrics: parsedContent.metrics || {},
                context: {
                    impact: parsedContent.context?.impact || 50,
                    confidence: parsedContent.context?.confidence || 50,
                    sentiment: {
                        market: parsedContent.context?.sentiment?.market || 50,
                        social: parsedContent.context?.sentiment?.social || 50
                    }
                },
                embedding: null,
                created_at: new Date().toISOString()
            };

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