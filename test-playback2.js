require('dotenv').config();
const jwt = require('jsonwebtoken');
const axios = require('axios');

async function test() {
    try {
        const token = jwt.sign({ email: 'test@example.com' }, process.env.JWT_SECRET || 'changeme_use_env', { expiresIn: '1h' });
        
        const res = await axios.get(`http://localhost:3000/api/anime/anime-name/episode/1?url=${encodeURIComponent('https://animepahe.ru/play/26d25bf4-f6df-d9a2-da02-5e43a6d7db54/d0ce5c31e9c52fc9949bd50f14631317424b917b2b6ab0c946eaf745cc90b8f3')}`);
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
    }
}
test();
