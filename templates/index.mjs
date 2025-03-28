import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';
import { extractBestJSON } from '../utils/json-parser.mjs';

export async function loadTemplates() {
    return {
        cryptoTemplate
    };
}

export async function extractEntities(text, _, authorInfo = {}) {
    try {
        // Skip if no text
        if (!text) {
            console.log('❌ Skipping: No text to process');
            return null;
        }

        // Check for messages that only contain tweet links with no actual content
        const tweetLinkRegex = /^\s*\[.*?\]\s*\(\s*https?:\/\/twitter\.com\/[^\/]+\/status\/\d+\s*\)\s*$/;
        if (tweetLinkRegex.test(text)) {
            console.log('❌ Skipping: Message only contains a tweet link without content');
            return {
                headline: "Tweet link without content",
                context: { impact: 0 },
                event: { category: "IGNORED" }
            };
        }

        // Skip if content too short (after removing URLs)
        const textWithoutUrls = text.replace(/https?:\/\/\S+/g, '').trim();
        if (textWithoutUrls.length < 15) {
            console.log('❌ Skipping: Message content too short after removing URLs');
            return {
                headline: "Insufficient content",
                context: { impact: 0 },
                event: { category: "IGNORED" }
            };
        }

        // Log what we're sending to template
        console.log('\n=== Sending to Template ===');
        console.log('Text:', text);
        console.log('Author:', authorInfo.author);
        console.log('RT:', authorInfo.rtAuthor);

        // Get LLM to parse content
        const response = await getLLMResponse(cryptoTemplate, {
            message: text,
            author: authorInfo.author || 'none',
            rtAuthor: authorInfo.rtAuthor || ''
        });

        // Log raw response
        console.log('\n=== Raw LLM Response ===');
        console.log(response.choices[0].message.content);

        // Get raw response and clean it
        let rawContent = response.choices[0].message.content;
        
        // Check if the LLM is asking for text that was already provided
        if (rawContent.includes('provide the text to analyze') || 
            rawContent.includes('Please provide') || 
            (rawContent.length < 50 && !rawContent.includes('{'))) {
            
            console.log('⚠️ LLM responded as if no input was provided. Retrying...');
            
            // Create enhanced template with explicit instructions
            const enhancedTemplate = cryptoTemplate + 
                `\n\nIMPORTANT: You MUST process this text: "${text}"\nDo NOT ask for the text - it is already provided above. Return ONLY JSON.`;
            
            // Retry with enhanced template
            const retryResponse = await getLLMResponse(enhancedTemplate, {
                message: text,
                author: authorInfo.author || 'none',
                rtAuthor: authorInfo.rtAuthor || ''
            });
            
            console.log('\n=== Retry LLM Response ===');
            console.log(retryResponse.choices[0].message.content);
            
            // Use retry content instead
            rawContent = retryResponse.choices[0].message.content;
        }
        
        // Skip if content too short
        if (!rawContent || rawContent.length < 10) {
            console.error('Invalid LLM response: content too short or empty');
            return null;
        }
        
        // Use extractBestJSON function from utils/json-parser.mjs to find the JSON object in the response
        const parsed = extractBestJSON(rawContent);
        
        if (!parsed) {
            console.error('Could not parse response even with recovery methods');
            return null;
        }
        
        // Validate required fields
        const requiredFields = ['headline', 'tokens', 'event', 'action', 'entities', 'metrics', 'context'];
        const missingFields = requiredFields.filter(field => !parsed[field]);
        
        if (missingFields.length > 0) {
            console.warn(`Missing required fields: ${missingFields.join(', ')}`);
            // Don't throw an error, let the normalization function handle defaults
        }
        
        // Check for hallucinated placeholder content
        if (parsed.headline === "Content of the Tweet" || 
            /^Content of (the|this) (Tweet|Message|Post)$/i.test(parsed.headline)) {
            console.log('❌ Detected placeholder headline - likely hallucinated content');
            return {
                headline: "Unprocessable content",
                context: { impact: 0 },
                event: { category: "IGNORED" }
            };
        }
        
        // Log the parsed result
        console.log('\n=== Parsed Result ===');
        console.log(JSON.stringify(parsed, null, 2));
        
        return parsed;

    } catch (error) {
        console.error('Entity extraction error:', error.message);
        // For debugging, log the stack trace
        console.error(error.stack);
        return null;  // Return null instead of throwing to allow processing to continue
    }
}