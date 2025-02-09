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
            message: text,  // This replaces {{message}} in template
            author: authorInfo.author || 'none',
            rtAuthor: authorInfo.rtAuthor || ''
        });

        // Log LLM response before parsing
        console.log('\n=== Raw LLM Response ===');
        console.log(response.choices[0].message.content);

        // Parse JSON from LLM response
        try {
            const content = response.choices[0].message.content;
            // Match valid JSON object, non-greedy to avoid capturing text between multiple objects
            const jsonMatch = content.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON object found in response');
            }
            const json = jsonMatch[0].trim();
            // Verify it's the only JSON object
            const allMatches = content.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g);
            if (allMatches && allMatches.length > 1) {
                throw new Error('Multiple JSON objects found in response');
            }
            return JSON.parse(json);
        } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError.message);
            throw new Error('Failed to parse LLM response');
        }

    } catch (error) {
        console.error('Entity extraction error:', error.message);
        throw error;
    }
}