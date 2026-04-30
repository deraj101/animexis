const aniListService = require('../src/services/aniListService');

async function testSearch() {
  const titles = ['One Piece', 'Naruto Shippuden', 'Chainsaw Man'];
  for (const title of titles) {
    console.log(`\nSearching for: ${title}...`);
    const media = await aniListService._searchAniList(title);
    if (media) {
      console.log(`Found: ${media.title.english || media.title.romaji}`);
      console.log(`Trailer:`, media.trailer);
    } else {
      console.log(`No results for: ${title}`);
    }
  }
}

testSearch();
