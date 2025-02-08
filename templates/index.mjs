import { getLLMResponse } from '../services/openai.mjs';
import { cryptoTemplate } from './crypto.mjs';

// Single template for all messages
export async function loadTemplates() {
    return {
        cryptoTemplate  // One template to rule them all
    };
}

export async function extractEntities(contentData) {
    try {
        // Always use crypto template - it handles all content types
        const template = cryptoTemplate;
        
        // Get LLM to parse content
        const response = await getLLMResponse(template, { 
            message: contentData.clean,    // Clean text for processing
            author: contentData.author,
            rtAuthor: contentData.rtAuthor
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