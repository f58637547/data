import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

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
        const rawContent = response.choices[0].message.content;
        
        // Skip if content too short
        if (!rawContent || rawContent.length < 10) {
            console.error('Invalid LLM response: content too short or empty');
            return null;
        }
        
        // Find the JSON object - try multiple approaches
        let jsonStr = '';
        
        // First attempt: extract text between first { and last }
        const fullMatch = rawContent.match(/\{[\s\S]*\}/);
        if (fullMatch) {
            jsonStr = fullMatch[0];
        } 
        // Second attempt: if we don't have a complete object, look for partial JSON
        else {
            // If there's an opening brace but no closing, try to extract and fix
            const openBraceIndex = rawContent.indexOf('{');
            if (openBraceIndex !== -1) {
                jsonStr = rawContent.substring(openBraceIndex);
                // We'll let safeParseJSON handle the missing closing braces
            } else {
                console.error('No JSON object structure found in response');
                console.error('Raw content:', rawContent);
                return null;
            }
        }

        // Clean up the JSON string
        jsonStr = jsonStr
            .replace(/\/\/[^\n]*/g, '')  // Remove comments
            .replace(/,\s*([}\]])/g, '$1')  // Remove trailing commas
            .replace(/\n\s*/g, ' ')  // Replace newlines
            .replace(/\s+/g, ' ')  // Normalize spaces
            .trim();

        // Parse the JSON using the safe parser
        const parsed = safeParseJSON(jsonStr);
        
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