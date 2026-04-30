import axios from 'axios';

async function test() {
    try {
        console.log("Fetching episode info...");
        // This is the episode URL for Slime from the previous test
        const url = 'https://animepahe.ru/play/26d25bf4-f6df-d9a2-da02-5e43a6d7db54/d0ce5c31e9c52fc9949bd50f14631317424b917b2b6ab0c946eaf745cc90b8f3';
        
        const res = await axios.get(`http://localhost:3000/api/anime/episode-info?url=${encodeURIComponent(url)}`);
        
        console.log("--- RESULTS ---");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}

test();
