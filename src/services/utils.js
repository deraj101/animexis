// src/services/utils.js
const crypto = require('crypto');

/**
 * Extract text from an element with fallback
 */
function extractText($element, selector, fallback = '') {
    if (!$element || !$element.find) return fallback;
    const found = $element.find(selector);
    return found.length ? found.text().trim() : fallback;
}

/**
 * Extract attribute from an element
 */
function extractAttr($element, selector, attr, baseUrl = '', fallback = null) {
    if (!$element || !$element.find) return fallback;
    const found = $element.find(selector);
    if (!found.length) return fallback;
    
    let value = found.attr(attr);
    if (!value) return fallback;
    
    // Handle relative URLs
    if (baseUrl && value.startsWith('/')) {
        value = baseUrl + value;
    }
    
    return value;
}

/**
 * Extract all matching elements
 */
function extractAll($element, selector, attr = null, baseUrl = '') {
    const results = [];
    $element.find(selector).each((i, el) => {
        const $el = $(el);
        if (attr) {
            let value = $el.attr(attr);
            if (value && baseUrl && value.startsWith('/')) {
                value = baseUrl + value;
            }
            results.push(value);
        } else {
            results.push($el.text().trim());
        }
    });
    return results;
}

/**
 * Delay execution (prevents rate limiting)
 */
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a slug from text
 */
function generateSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .trim();
}

/**
 * Extract video ID from URL
 */
function extractVideoId(url) {
    const patterns = [
        /(?:v|embed|watch\?v)=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /\/v\/([a-zA-Z0-9_-]{11})/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Decode encrypted video URLs (common in anime sites)
 */
function decodeVideoUrl(encoded, key = null) {
    try {
        // Many sites use base64 encoding
        if (encoded.includes('%')) {
            encoded = decodeURIComponent(encoded);
        }
        
        // Try base64 decode
        if (/^[A-Za-z0-9+/=]+$/.test(encoded)) {
            const buffer = Buffer.from(encoded, 'base64');
            return buffer.toString('utf8');
        }
        
        return encoded;
    } catch (error) {
        console.error('Error decoding URL:', error);
        return encoded;
    }
}

/**
 * Clean HTML text
 */
function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

module.exports = {
    extractText,
    extractAttr,
    extractAll,
    delay,
    generateSlug,
    extractVideoId,
    decodeVideoUrl,
    cleanText
};