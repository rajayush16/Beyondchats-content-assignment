const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://beyondchats.com/blogs/";

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BeyondChatsScraper/1.0)",
    },
  });

  return response.data;
}

function extractLastPageUrl(html) {
  const $ = cheerio.load(html);
  let maxPage = 1;
  let lastUrl = BASE_URL;

  $(".page-numbers").each((_, element) => {
    const href = $(element).attr("href");
    const text = $(element).text().trim();
    let pageNumber = Number.parseInt(text, 10);

    if (Number.isNaN(pageNumber) && href) {
      const match = href.match(/\/page\/(\d+)/);
      if (match) {
        pageNumber = Number.parseInt(match[1], 10);
      }
    }

    if (!Number.isNaN(pageNumber) && pageNumber >= maxPage) {
      maxPage = pageNumber;
      if (href) {
        lastUrl = href;
      } else {
        lastUrl = `${BASE_URL}page/${pageNumber}/`;
      }
    }
  });

  return lastUrl;
}

function parseArticles(html) {
  const $ = cheerio.load(html);
  const articles = [];

  $(".entry-card").each((_, element) => {
    const title = normalizeText($(element).find("h2.entry-title a").text());
    const url = $(element).find("h2.entry-title a").attr("href");

    if (!title || !url) {
      return;
    }

    const author = normalizeText(
      $(element)
        .find(".meta-author .ct-meta-element-author span, .meta-author .ct-meta-element-author")
        .first()
        .text()
    );

    const dateText =
      $(element).find("time.ct-meta-element-date").attr("datetime") ||
      $(element).find("time.ct-meta-element-date").text();
    const publishedAt = dateText ? new Date(dateText) : null;

    const excerptText = normalizeText($(element).find(".entry-excerpt").text());

    articles.push({
      title,
      url,
      author: author || undefined,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      excerpt: excerptText || undefined,
    });
  });

  return articles;
}

async function scrapeOldestArticles(limit = 5) {
  const firstPageHtml = await fetchHtml(BASE_URL);
  const lastPageUrl = extractLastPageUrl(firstPageHtml);
  const lastPageHtml = await fetchHtml(lastPageUrl);

  const articles = parseArticles(lastPageHtml);
  const sorted = articles.sort((a, b) => {
    const aTime = a.publishedAt ? a.publishedAt.getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.publishedAt ? b.publishedAt.getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return sorted.slice(0, limit);
}

module.exports = {
  scrapeOldestArticles,
};