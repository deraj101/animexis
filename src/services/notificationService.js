const axios = require('axios');

/**
 * sendPushNotification
 * 
 * Sends a push notification using Expo's Push API.
 * 
 * @param {string[]} tokens - Array of Expo push tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Extra data to send with the notification
 */
async function sendPushNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return;

    // Filter out invalid/null tokens
    const validTokens = tokens.filter(t => t && t.startsWith('ExponentPushToken'));
    if (validTokens.length === 0) return;

    const messages = validTokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
      }));

    try {
        const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
        });
        
        console.log(`📲 Sent ${validTokens.length} push notifications via Expo.`);
        return response.data;
    } catch (err) {
        console.error('❌ Failed to send push notifications:', err.response?.data || err.message);
    }
}

module.exports = { sendPushNotification };
