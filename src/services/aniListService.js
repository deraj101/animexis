const axios = require('axios');
const Mapping = require('../db/models/mappingModel');

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    idMal
    title {
      romaji
      english
      native
    }
    coverImage {
      extraLarge
      large
      medium
      color
    }
    bannerImage
    description
    averageScore
    genres
    tags {
      name
    }
    status
    season
    seasonYear
    duration
    format
    studios {
      nodes {
        name
        isAnimationStudio
      }
    }
    trailer {
      id
      site
      thumbnail
    }
  }
}
`;

/**
 * Service to handle metadata enrichment from AniList.
 */
class AniListService {
  /**
   * Enrich a list of anime (from scraper) with AniList data.
   */
  async enrichAnimeList(animeList) {
    if (!animeList || !animeList.length) return animeList;

    const enriched = await Promise.all(
      animeList.map(async (anime) => {
        try {
          const mapping = await this.getMapping(anime.slug || anime.title);
          if (mapping) {
            // ONLY overwrite with AniList if it's actually found/exists 📸
            const hdImage = mapping.coverImage?.extraLarge || mapping.coverImage?.large;
            return {
              ...anime,
              image: hdImage || anime.image, // Prefer HD, fallback to native 🖼️
              poster: hdImage || anime.image,
              background: mapping.bannerImage || anime.banner || null,
              banner: mapping.bannerImage || anime.banner || null,
              genres: mapping.genres && mapping.genres.length ? mapping.genres : (anime.genres || []),
              duration: mapping.duration ? `${mapping.duration} min` : (anime.duration || null),
              studios: mapping.studios && mapping.studios.length ? mapping.studios : (anime.studios || []),
              category: (anime.category && anime.category !== "TV") ? anime.category : (mapping.format || anime.category || "TV"),
              anilistId: mapping.anilistId,
              trailer: mapping.trailer
            };
          }
          return anime;
        } catch (err) {
          console.warn(`[anilist] enrich skip: ${anime.title}`, err.message);
          return anime;
        }
      })
    );

    return enriched;
  }

  /**
   * Get or create a mapping for a GogoAnime slug/title.
   */
  async getMapping(identifier) {
    const slug = identifier.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    // 1. Check local DB cache
    let mapping = await Mapping.findOne({ gogoSlug: slug });
    if (mapping && mapping.trailer?.id) return mapping;

    // 2. Fetch from AniList
    try {
      // Clean title for better matching (remove (Sub), (Dub), Episode counts, Season tags etc)
      const cleanTitle = identifier
        .replace(/\(Sub\)|\(Dub\)|\(TV\)|\(Movie\)|\(ONA\)|\(OVA\)/gi, '')
        .replace(/Episode \d+/gi, '')
        .replace(/(Season \d+|Part \d+|\d+(st|nd|rd|th) Season)/gi, '')
        .replace(/(Uncensored|Censored|TV-Rip|BD-Rip)/gi, '')
        .replace(/-+/g, ' ')
        .trim();

      // 2. Fetch from AniList (Stage 1: Cleaned Title)
      let media = await this._searchAniList(cleanTitle);

      // Stage 2: Super Clean (Remove all Season/Dub info and non-alphanumeric at ends)
      if (!media) {
          const superClean = cleanTitle.replace(/\s+/g, ' ').split(':')[0].trim();
          if (superClean !== cleanTitle) {
              console.log(`[anilist] 🔄 Stage 2 Retry: "${superClean}"`);
              media = await this._searchAniList(superClean);
          }
      }

      // Stage 3: First Two Words (Broad search)
      if (!media) {
          const words = cleanTitle.split(' ');
          if (words.length > 2) {
              const base = words.slice(0, 2).join(' ');
              console.log(`[anilist] 🔄 Stage 3 Retry: "${base}"`);
              media = await this._searchAniList(base);
          }
      }
      
      // Stage 4: Search by Slug (Cleanest Identifier) 🚀
      if (!media && slug) {
          const slugTitle = slug.split('-').join(' ').trim();
          if (slugTitle !== cleanTitle) {
              console.log(`[anilist] 🔄 Stage 4 Slug Retry: "${slugTitle}"`);
              media = await this._searchAniList(slugTitle);
          }
      }

      if (!media) return null;

      // 3. Create/Update mapping
      mapping = await Mapping.findOneAndUpdate(
        { gogoSlug: slug },
        {
          anilistId: media.id,
          malId: media.idMal,
          title: media.title,
          coverImage: media.coverImage,
          bannerImage: media.bannerImage,
          averageScore: media.averageScore,
          description: media.description,
          genres: [
            ...(media.genres || []),
            ...(media.tags ? media.tags.map(t => t.name) : [])
          ].slice(0, 12),
          status: media.status,
          season: media.season,
          seasonYear: media.seasonYear,
          duration: media.duration,
          studios: media.studios?.nodes?.filter(s => s.isAnimationStudio).map(s => s.name) || [],
          format: media.format,
          trailer: media.trailer,
          lastSync: new Date()
        },
        { new: true, upsert: true }
      );

      console.log(`[anilist] ✅ mapped: ${identifier} -> ${media.id}`);
      return mapping;
    } catch (err) {
      console.error(`[anilist] ❌ error matching: ${identifier}`, err.message);
      return null;
    }
  }

  /**
   * Internal search helper 🛰️
   */
  async _searchAniList(search) {
      if (!search || search.length < 3) return null;
      try {
          const response = await axios.post(ANILIST_GRAPHQL_URL, {
              query: SEARCH_QUERY,
              variables: { search }
          }, { timeout: 8000 });
          return response.data?.data?.Media || null;
      } catch (err) {
          console.warn(`[anilist] 🛰️ Search fail: "${search}"`, err.message);
          return null;
      }
  }
}

module.exports = new AniListService();
