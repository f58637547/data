import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

// Safely parse JSON with error recovery
function safeParseJSON(text) {
    try {
        // Try direct parsing first
        return JSON.parse(text);
    } catch (error) {
        console.log('Failed to parse LLM response: ' + error.message);
        console.log('Raw content: ' + text);
        
        // Attempt to clean and fix common issues
        try {
            // Remove any markdown code block markers
            let cleaned = text.replace(/```json|```/g, '').trim();
            
            // Fix unescaped quotes in strings (common LLM error)
            cleaned = cleaned.replace(/(\w+)(?<!\\)"/g, '$1\\"');
            
            // Remove trailing commas before closing brackets (common LLM error)
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
            
            // Try to balance brackets if unbalanced
            let openBraces = (cleaned.match(/{/g) || []).length;
            let closeBraces = (cleaned.match(/}/g) || []).length;
            while (openBraces > closeBraces) {
                cleaned += '}';
                closeBraces++;
            }
            
            console.log('Cleaned JSON: ' + cleaned);
            return JSON.parse(cleaned);
        } catch (secondError) {
            console.error('Entity extraction error: Failed to parse LLM response');
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
        
        // Find the JSON object
        const match = rawContent.match(/\{[\s\S]*\}/);
        if (!match) {
            console.error('Raw content:', rawContent);
            throw new Error('No JSON object found in response');
        }

        // Clean up the JSON string
        const jsonStr = match[0]
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
        
        // Log the parsed result
        console.log('\n=== Parsed Result ===');
        console.log(JSON.stringify(parsed, null, 2));
        
        return parsed;

    } catch (error) {
        console.error('Entity extraction error:', error.message);
        return null;  // Return null instead of throwing to allow processing to continue
    }
}