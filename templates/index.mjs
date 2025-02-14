import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

export async function loadTemplates() {
    return {
        cryptoTemplate
    };
}

export async function extractEntities(text, _, authorInfo = {}) {
    try {
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

        // Clean up the JSON string - replace newlines and normalize spaces
        const jsonStr = match[0]
            .replace(/\n\s*/g, ' ')  // Replace newlines and following spaces with a single space
            .replace(/\s+/g, ' ')    // Normalize multiple spaces to single space
            .trim();                 // Remove leading/trailing whitespace

        try {
            const parsed = JSON.parse(jsonStr);
            
            // Log the parsed result
            console.log('\n=== Parsed Result ===');
            console.log(JSON.stringify(parsed, null, 2));
            
            return parsed;
        } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError.message);
            console.error('Raw content:', rawContent);
            console.error('Cleaned JSON:', jsonStr);
            throw new Error('Failed to parse LLM response');
        }

    } catch (error) {
        console.error('Entity extraction error:', error.message);
        throw error;
    }
}