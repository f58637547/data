import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

// Single template for all content
export async function loadTemplates() {
    return {
        cryptoTemplate
    };
}

export async function extractEntities(text, _, authorInfo = {}) {
    try {
        // Get LLM to parse content
        const response = await getLLMResponse(cryptoTemplate, {
            message: text,
            author: authorInfo.author || 'none',
            rtAuthor: authorInfo.rtAuthor || ''
        });

        // Parse JSON from LLM response
        try {
            const content = response.choices[0].message.content;
            const jsonMatch = content.match(/```(?:json)?\n?(.*?)\n?```/s);
            const jsonString = jsonMatch ? jsonMatch[1] : content;
            return JSON.parse(jsonString.trim());
        } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError.message);
            throw new Error('Failed to parse LLM response');
        }

    } catch (error) {
        console.error('Entity extraction error:', error.message);
        throw error;
    }
}