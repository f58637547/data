/**
 * JSON parsing utilities with error recovery
 */

// Safely parse JSON with error recovery
export function safeParseJSON(text) {
    // If text is already an object, just return it
    if (typeof text === 'object' && text !== null) {
        return text;
    }
    
    // If text is undefined or null, return null
    if (!text) {
        console.log('🚫 Empty content provided to safeParseJSON');
        return null;
    }

    try {
        // Try direct parsing first
        return JSON.parse(text);
    } catch (error) {
        console.log('⚠️ JSON Parse Error:', error.message);
        console.log('⚠️ Error position:', error.message.match(/position (\d+)/)?.[1] || 'unknown');
        
        // Try to show the problematic part of the JSON
        if (error.message.includes('position')) {
            const position = parseInt(error.message.match(/position (\d+)/)[1]);
            const errorContext = text.substring(Math.max(0, position - 20), Math.min(text.length, position + 20));
            console.log(`⚠️ Error context: "...${errorContext}..." (around position ${position})`);
        }
        
        console.log('🔄 Attempting JSON recovery...');
        
        // Attempt to clean and fix common issues
        try {
            // Remove any markdown code block markers
            let cleaned = text.replace(/```json|```/g, '').trim();
            
            // Fix double quotes in headline values (common LLM error)
            cleaned = cleaned.replace(/"headline":""([^"]+)/g, '"headline":"$1');
            console.log('🔧 Applied fix: Corrected misformatted headline quotes');
            
            // Fix malformed hashtags like #[#Symbol]
            cleaned = cleaned.replace(/#\[#([^\]]+)\]/g, '#$1');
            
            // Fix malformed token fields - common pattern is "secondary","ETH" instead of "secondary":{"symbol":"ETH"}
            const tokenFixCount = (cleaned.match(/"(\w+)","([^"]+)"/g) || []).length;
            cleaned = cleaned.replace(/"(\w+)","([^"]+)"/g, '"$1":{"symbol":"$2"}');
            if (tokenFixCount > 0) {
                console.log(`🔧 Applied fix: Corrected ${tokenFixCount} malformed token fields`);
            }
            
            // Fix tokens with Chinese/non-Latin characters
            cleaned = cleaned.replace(/"symbol":"[^"]*[\u4e00-\u9fa5][^"]*"/g, '"symbol":"null"');
            
            // Check if the JSON is incomplete (missing closing braces)
            let openBraces = (cleaned.match(/{/g) || []).length;
            let closeBraces = (cleaned.match(/}/g) || []).length;
            if (openBraces > closeBraces) {
                console.log(`🔧 Applied fix: JSON has missing closing braces (${openBraces} open, ${closeBraces} close)`);
                // Add missing closing braces
                while (openBraces > closeBraces) {
                    cleaned += '}';
                    closeBraces++;
                }
                console.log(`   Added ${openBraces - closeBraces} closing braces`);
            }
            
            // Check if the JSON is incomplete (missing closing brackets)
            let openBrackets = (cleaned.match(/\[/g) || []).length;
            let closeBrackets = (cleaned.match(/\]/g) || []).length;
            if (openBrackets > closeBrackets) {
                console.log(`🔧 Applied fix: JSON has missing closing brackets (${openBrackets} open, ${closeBrackets} close)`);
                // Add missing closing brackets
                while (openBrackets > closeBrackets) {
                    cleaned += ']';
                    closeBrackets++;
                }
                console.log(`   Added ${openBrackets - closeBrackets} closing brackets`);
            }
            
            // Remove trailing commas before closing brackets (common LLM error)
            const trailingCommaCount = (cleaned.match(/,(\s*[}\]])/g) || []).length;
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
            if (trailingCommaCount > 0) {
                console.log(`🔧 Applied fix: Removed ${trailingCommaCount} trailing commas`);
            }
            
            // Try to parse the cleaned JSON
            console.log('🔄 Attempting to parse cleaned JSON...');
            try {
                const result = JSON.parse(cleaned);
                console.log('✅ Successfully recovered and parsed JSON!');
                return result;
            } catch (finalError) {
                console.error(`❌ Final parse attempt failed: ${finalError.message}`);
                // Show detailed context for the final error
                if (finalError.message.includes('position')) {
                    const position = parseInt(finalError.message.match(/position (\d+)/)[1]);
                    const errorContext = cleaned.substring(Math.max(0, position - 30), Math.min(cleaned.length, position + 30));
                    console.error(`❌ Final error context: "...${errorContext}..." (around position ${position})`);
                }
                throw finalError;
            }
        } catch (secondError) {
            console.error('❌ JSON recovery completely failed:');
            console.error('   Original error:', error.message);
            console.error('   Recovery error:', secondError.message);
            console.error('   Original text (first 200 chars):', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
            return null;
        }
    }
}

// Helper function to attempt JSON recovery for common LLM syntax errors
export function attemptJSONRecovery(jsonStr) {
    try {
        let cleaned = jsonStr.trim();
        let fixesApplied = 0;
        
        // Fix malformed token fields (common issue)
        // Fix "secondary","ETH" pattern to "secondary":{"symbol":"ETH"}
        const tokenFixCount = (cleaned.match(/"(\w+)","([^"]+)"/g) || []).length;
        cleaned = cleaned.replace(/"(\w+)","([^"]+)"/g, '"$1":{"symbol":"$2"}');
        if (tokenFixCount > 0) fixesApplied += tokenFixCount;
        
        // Fix double quotes in headline values
        const headlineFixCount = (cleaned.match(/"headline":""([^"]+)/g) || []).length;
        cleaned = cleaned.replace(/"headline":""([^"]+)/g, '"headline":"$1');
        if (headlineFixCount > 0) fixesApplied += headlineFixCount;
        
        // Fix malformed hashtags
        const hashtagFixCount = (cleaned.match(/#\[#([^\]]+)\]/g) || []).length;
        cleaned = cleaned.replace(/#\[#([^\]]+)\]/g, '#$1');
        if (hashtagFixCount > 0) fixesApplied += hashtagFixCount;
        
        // Fix tokens with Chinese/non-Latin characters
        const nonLatinFixCount = (cleaned.match(/"symbol":"[^"]*[\u4e00-\u9fa5][^"]*"/g) || []).length;
        cleaned = cleaned.replace(/"symbol":"[^"]*[\u4e00-\u9fa5][^"]*"/g, '"symbol":"null"');
        if (nonLatinFixCount > 0) fixesApplied += nonLatinFixCount;
        
        // Check if the JSON is incomplete (missing closing braces)
        let openBraces = (cleaned.match(/{/g) || []).length;
        let closeBraces = (cleaned.match(/}/g) || []).length;
        
        if (openBraces !== closeBraces) {
            console.log(`🔧 JSON has unbalanced braces: ${openBraces} opening, ${closeBraces} closing`);
            
            // Add missing closing braces if needed
            if (openBraces > closeBraces) {
                cleaned += '}'.repeat(openBraces - closeBraces);
                fixesApplied += (openBraces - closeBraces);
            }
        }
        
        // Fix trailing commas before closing braces (common issue)
        const commaFixCount = (cleaned.match(/,\s*\}/g) || []).length;
        cleaned = cleaned.replace(/,\s*\}/g, '}');
        if (commaFixCount > 0) fixesApplied += commaFixCount;

        if (fixesApplied > 0) {
            console.log(`🔧 Applied ${fixesApplied} fixes to JSON`);
        }
        
        return cleaned;
    } catch (error) {
        console.log('❌ Error during JSON recovery:', error);
        return jsonStr;
    }
}

// Extract JSON objects from text, returning the most complete one
export function extractBestJSON(rawContent) {
    if (!rawContent || typeof rawContent !== 'string') {
        console.log('❌ No content provided to extractBestJSON');
        return null;
    }
    
    // First try: treat the entire response as one potential JSON object
    try {
        const wholeResponse = rawContent.trim();
        // Check if it begins with { and ends with }
        if (wholeResponse.startsWith('{') && wholeResponse.endsWith('}')) {
            console.log('🔍 Treating entire response as JSON');
            const parsed = JSON.parse(wholeResponse);
            if (parsed && typeof parsed === 'object') {
                console.log('✅ Successfully parsed complete response as JSON');
                return parsed;
            }
        }
    } catch (e) {
        console.log('❌ Full response is not valid JSON, falling back to extraction');
    }
    
    // Extract complete JSON objects (largest first)
    const jsonRegex = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
    const jsonMatches = [...rawContent.matchAll(jsonRegex)]
        .sort((a, b) => b[0].length - a[0].length); // Sort by length (largest first)
    
    console.log(`🔍 Found ${jsonMatches.length} potential JSON objects in text`);
    
    // Check for required fields in the response
    const requiredKeys = ['headline', 'tokens', 'event', 'action', 'entities', 'metrics', 'context'];
    let bestMatch = null;
    let maxFieldsFound = 0;
    
    if (jsonMatches.length > 0) {
        // Try each match, looking for the most complete JSON object
        for (const match of jsonMatches) {
            try {
                const candidate = match[0];
                console.log(`🔍 Trying JSON candidate (${candidate.length} chars)`);
                const parsed = JSON.parse(candidate);
                
                // Count how many required fields we have
                const foundFields = requiredKeys.filter(key => key in parsed);
                console.log(`📊 Found ${foundFields.length}/${requiredKeys.length} required fields: ${foundFields.join(', ')}`);
                
                // If we found all fields, return immediately
                if (foundFields.length === requiredKeys.length) {
                    console.log('✅ Found valid JSON with ALL required fields!');
                    return parsed;
                }
                
                // Otherwise keep track of the best match so far
                if (foundFields.length > maxFieldsFound) {
                    maxFieldsFound = foundFields.length;
                    bestMatch = parsed;
                    console.log(`📌 New best match (${foundFields.length} fields)`);
                }
            } catch (e) {
                console.log(`❌ JSON candidate failed: ${e.message}`);
                // Continue to next candidate
            }
        }
        
        // If we found a partial match with some fields, return it
        if (bestMatch) {
            console.log(`✅ Using best JSON match with ${maxFieldsFound}/${requiredKeys.length} fields`);
            // Log which required fields are missing
            const missingFields = requiredKeys.filter(key => !(key in bestMatch));
            if (missingFields.length > 0) {
                console.log(`⚠️ Missing required fields: ${missingFields.join(', ')}`);
            }
            return bestMatch;
        }
    }
    
    // Fallback to more aggressive extraction if we still don't have a match
    const fullMatch = rawContent.match(/\{[\s\S]*\}/);
    if (fullMatch) {
        console.log('🔍 Using regex-extracted JSON');
        const jsonStr = fullMatch[0]
            .replace(/\/\/[^\n]*/g, '')  // Remove comments
            .replace(/,\s*([}\]])/g, '$1')  // Remove trailing commas
            .replace(/\n\s*/g, ' ')  // Replace newlines
            .replace(/\s+/g, ' ')  // Normalize spaces
            .trim();
            
        // Try to parse the cleaned JSON
        return safeParseJSON(jsonStr);
    }
    
    console.error('❌ No JSON object structure found in response');
    return null;
} 