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

// Check similarity with vector search across all relevant tables
async function findSimilarMessages(db, embedding, channelTable) {
    try {
        // Query to check similarity in both tables
        const query = `
            WITH combined_results AS (
                SELECT content, type, table_name,
                       1 - (embedding <-> $1::vector) as vector_similarity
                FROM (
                    SELECT content, type, 'crypto' as table_name, embedding
                    FROM crypto
                    WHERE "createdAt" > NOW() - INTERVAL '24 hours'
                    UNION ALL
                    SELECT content, type, 'trades' as table_name, embedding
                    FROM trades 
                    WHERE "createdAt" > NOW() - INTERVAL '24 hours'
                    UNION ALL
                    SELECT content, type, $2 as table_name, embedding
                    FROM ${channelTable}
                    WHERE "createdAt" > NOW() - INTERVAL '24 hours'
                ) combined
                WHERE 1 - (embedding <-> $1::vector) > 0.85
            )
            SELECT * FROM combined_results
            ORDER BY vector_similarity DESC
            LIMIT 5
        `;

        const result = await db.query(query, [
            `[${embedding.join(',')}]`,
            channelTable
        ]);

        if (result.rows.length > 0) {
            console.log('\n=== Similar Content Found ===');
            for (const row of result.rows) {
                try {
                    const content = JSON.parse(row.content);
                    console.log(`Table: ${row.table_name}`);
                    console.log(`Similarity: ${(row.vector_similarity * 100).toFixed(2)}%`);
                    console.log(`Content: ${content.original?.substring(0, 100) || content.headline?.substring(0, 100)}...`);
                    console.log('-'.repeat(80));
                } catch (e) {
                    console.log(`Table: ${row.table_name}`);
                    console.log(`Similarity: ${(row.vector_similarity * 100).toFixed(2)}%`);
                    console.log(`Content: ${row.content.substring(0, 100)}...`);
                    console.log('-'.repeat(80));
                }
            }
            
            // If very similar content found (>90% similarity)
            const hasVerySimilar = result.rows.some(row => row.vector_similarity > 0.90);
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

// Goal status transitions
const GOAL_STATUS = {
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

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

    // Validate impact (0-100)
    const validImpact = typeof context.impact === 'number' && 
                       context.impact >= 0 && 
                       context.impact <= 100;

    // Validate sentiment
    const sentiment = context.sentiment || {};
    const validSentiment = ['market', 'social'].every(key => 
        sentiment[key] === null || 
        (typeof sentiment[key] === 'number' && 
         sentiment[key] >= 0 && 
         sentiment[key] <= 100)
    );

    return validImpact && validSentiment;
}

// Create or update goal based on message content
async function processGoal(db, entities, channelMapping) {
    try {
        // Check required fields for goal name
        const symbol = entities.tokens?.primary?.symbol;
        const category = entities.event?.category;
        const type = entities.event?.type;

        if (!symbol || !category || !type) {
            console.log('⚠️ Missing required fields for goal name, skipping:', { symbol, category, type });
            return;
        }

        // Create unique goal name
        const goalName = `${symbol}_${category}_${type}`.toUpperCase();
        
        // Extract optional fields
        const {
            action,
            entities: { projects = [], persons = [] } = {},
            metrics = {},
            context = {}
        } = entities;

        // Find existing goal
        const existingGoal = await db.query(`
            SELECT id, objectives, status
            FROM goals 
            WHERE name = $1 AND status = $2
            LIMIT 1
        `, [goalName, GOAL_STATUS.IN_PROGRESS]);

        // Prepare objective from current message
        const newObjective = {
            timestamp: new Date().toISOString(),
            symbol,
            category,
            type,
            action,
            projects,
            persons,
            metrics,
            context
        };

        if (existingGoal.rows.length > 0) {
            const goal = existingGoal.rows[0];
            
            // Don't update completed or cancelled goals
            if (goal.status !== GOAL_STATUS.IN_PROGRESS) {
                console.log('⚠️ Goal is not in progress:', goalName);
                return;
            }

            const objectives = JSON.parse(goal.objectives);
            objectives.push(newObjective);

            // Check if goal should be completed based on metrics/context
            const shouldComplete = objectives.length >= 5 && 
                                 objectives.some(obj => obj.metrics?.market?.price) &&
                                 objectives.some(obj => obj.context?.impact >= 80);

            await db.query(`
                UPDATE goals 
                SET objectives = $1,
                    status = $2,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [
                JSON.stringify(objectives),
                shouldComplete ? GOAL_STATUS.COMPLETED : GOAL_STATUS.IN_PROGRESS,
                goal.id
            ]);

            console.log(`✅ Updated goal: ${goalName} (${shouldComplete ? 'Completed' : 'In Progress'})`);
        } else {
            // Create new goal
            const description = `Tracking ${symbol} ${category.toLowerCase()} ${type.toLowerCase()} events`;
            
            await db.query(`
                INSERT INTO goals (
                    id,
                    name,
                    status,
                    description,
                    objectives,
                    "roomId"
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                uuidv4(),
                goalName,
                GOAL_STATUS.IN_PROGRESS,
                description,
                JSON.stringify([newObjective]),
                channelMapping.roomId
            ]);

            console.log('✅ Created new goal:', goalName);
        }

    } catch (error) {
        console.error('Error processing goal:', error);
        // Don't throw - we don't want to fail message processing if goal fails
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

            // Extract text and get content data
            const contentData = extractDiscordText(message);
            if (!contentData?.original) {
                return { skip: true, reason: 'no_content' };
            }

            // Generate embedding and check similarity early
            console.log('\n=== Checking Uniqueness ===');
            let embedding;
            try {
                embedding = await generateEmbedding(contentData.original);
                
                // Check for similar content before processing
                const similarityResult = await findSimilarMessages(db, embedding, channelMapping.table);
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
                entities = await extractEntities(
                    contentData.original,
                    null,
                    {
                        message: contentData.original,
                        author: contentData.author || 'none',
                        rtAuthor: contentData.rtAuthor || ''
                    }
                );

                // Log what template got
                console.log('\n=== Template Input ===');
                console.log('Text:', contentData.original);
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

            // Store the embedding with the processed message
            entities.embedding = embedding;

            // 1.1 Validate required fields after template
            console.log('\n=== Validating Required Fields ===');
            if (!entities?.event?.category) {
                console.log('❌ REJECTED - Missing Category:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline?.text);
                return { skip: true, reason: 'missing_category' };
            }

            if (!entities?.context?.impact || entities.context.impact <= 30) {
                console.log('❌ REJECTED - Low Impact:');
                console.log('Original:', contentData.original);
                console.log('Processed:', entities?.headline?.text);
                console.log('Impact Score:', entities?.context?.impact);
                console.log('Category:', entities?.event?.category);
                return { skip: true, reason: 'low_impact' };
            }

            console.log('✅ Validation passed:');
            console.log('Impact Score:', entities.context.impact);
            console.log('Category:', entities.event.category);

            // 4. Save to DB with embedding
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

                // Process goal after saving message
                await processGoal(db, entities, channelMapping);

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