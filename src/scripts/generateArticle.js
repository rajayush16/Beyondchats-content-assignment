const axios = require("axios");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const fs = require("fs");
const https = require("https");
const tls = require("tls");

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const GOOGLE_PROVIDER = process.env.GOOGLE_PROVIDER || "serpapi";
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EXTRA_CA_CERTS_PATH = process.env.EXTRA_CA_CERTS_PATH || process.env.NODE_EXTRA_CA_CERTS;

function loadExtraCa(path) {
  const raw = fs.readFileSync(path);
  const text = raw.toString("utf8");
  if (text.includes("BEGIN CERTIFICATE")) {
    return text;
  }

  const b64 = raw.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

let httpsAgent;
if (EXTRA_CA_CERTS_PATH) {
  try {
    const extraCa = loadExtraCa(EXTRA_CA_CERTS_PATH);
    const combinedCa = tls.rootCertificates.concat(extraCa);
    httpsAgent = new https.Agent({ ca: combinedCa });
  } catch (error) {
    console.warn(`Failed to load extra CA certs from ${EXTRA_CA_CERTS_PATH}: ${error.message}`);
  }
}

const httpClient = axios.create(httpsAgent ? { httpsAgent } : {});

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

async function fetchArticles() {
  const response = await httpClient.get(`${API_BASE_URL}/api/articles`);
  return response.data;
}

async function fetchSearchResults(query) {
  if (GOOGLE_PROVIDER === "serpapi") {
    if (!SERPAPI_KEY) {
      throw new Error("SERPAPI_KEY is required for serpapi provider");
    }

    const response = await httpClient.get("https://serpapi.com/search.json", {
      params: {
        engine: "google",
        q: query,
        api_key: SERPAPI_KEY,
      },
    });

    return (response.data.organic_results || []).map((item) => ({
      title: item.title,
      url: item.link,
    }));
  }

  if (GOOGLE_PROVIDER === "cse") {
    if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) {
      throw new Error("GOOGLE_CSE_KEY and GOOGLE_CSE_CX are required for cse provider");
    }

    const response = await httpClient.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        key: GOOGLE_CSE_KEY,
        cx: GOOGLE_CSE_CX,
        q: query,
      },
    });

    return (response.data.items || []).map((item) => ({
      title: item.title,
      url: item.link,
    }));
  }

  throw new Error(`Unsupported GOOGLE_PROVIDER: ${GOOGLE_PROVIDER}`);
}

function isArticleUrl(url) {
  return /\/(blog|blogs|article|news|posts)\//i.test(url);
}

function filterReferenceLinks(results) {
  const references = [];
  const seen = new Set();

  for (const item of results) {
    if (!item.url || !item.title) {
      continue;
    }

    const url = item.url;
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }

    if (url.includes("beyondchats.com")) {
      continue;
    }

    if (seen.has(url)) {
      continue;
    }

    if (!isArticleUrl(url)) {
      continue;
    }

    seen.add(url);
    references.push(item);

    if (references.length >= 2) {
      break;
    }
  }

  if (references.length < 2) {
    for (const item of results) {
      if (!item.url || seen.has(item.url) || item.url.includes("beyondchats.com")) {
        continue;
      }
      seen.add(item.url);
      references.push(item);
      if (references.length >= 2) {
        break;
      }
    }
  }

  return references.slice(0, 2);
}

async function fetchHtml(url) {
  const response = await httpClient.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BeyondChatsScraper/1.0)",
    },
  });

  return response.data;
}

function extractMainContent(html) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe").remove();

  const candidates = ["article", "main", ".post-content", ".entry-content", "body"];
  let text = "";

  for (const selector of candidates) {
    const element = $(selector).first();
    if (element.length) {
      const paragraphs = element
        .find("p")
        .map((_, el) => normalizeText($(el).text()))
        .get()
        .filter(Boolean);

      if (paragraphs.length) {
        text = paragraphs.join("\n\n");
        break;
      }
    }
  }

  if (!text) {
    text = normalizeText($("body").text());
  }

  return text.slice(0, 4000);
}

async function scrapeContent(url) {
  const html = await fetchHtml(url);
  return extractMainContent(html);
}

async function callLlm({ title, originalContent, references }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for LLM calls");
  }

  const referenceSummaries = references
    .map((ref, index) => `Reference ${index + 1}: ${ref.title}\n${ref.content}`)
    .join("\n\n");

  const prompt = `You are rewriting a blog post.\n\nOriginal title: ${title}\n\nOriginal content:\n${originalContent}\n\nReference articles:\n${referenceSummaries}\n\nRewrite the original article so that its formatting and content style is similar to the reference articles, while preserving the core topic. Return JSON with keys "title" and "content". The content should be in HTML with headings and paragraphs.`;

  const response = await httpClient.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  const message = response.data.choices?.[0]?.message?.content || "";

  try {
    return JSON.parse(message);
  } catch (error) {
    return { title, content: message };
  }
}

function appendReferences(content, references) {
  const list = references
    .map((ref) => `<li><a href="${ref.url}" target="_blank" rel="noopener noreferrer">${ref.title}</a></li>`)
    .join("");

  return `${content}\n\n<h3>References</h3>\n<ul>${list}</ul>`;
}

async function publishArticle({ title, content, references }) {
  const slug = slugify(title);
  const url = `generated://${slug}-${Date.now()}`;

  const payload = {
    title,
    url,
    content,
    references,
    source: "generated",
    author: "auto",
    publishedAt: new Date().toISOString(),
  };

  const response = await httpClient.post(`${API_BASE_URL}/api/articles`, payload);
  return response.data;
}

async function run() {
  const articles = await fetchArticles();
  if (!articles.length) {
    throw new Error("No articles found. Run the scrape endpoint first.");
  }

  const [article] = articles;
  const originalContent = await scrapeContent(article.url);
  if (!originalContent) {
    throw new Error("Failed to extract original article content.");
  }

  const searchResults = await fetchSearchResults(article.title);
  const references = filterReferenceLinks(searchResults);
  if (references.length < 2) {
    throw new Error("Could not find two reference articles from search results.");
  }

  const enrichedReferences = [];
  for (const ref of references) {
    const content = await scrapeContent(ref.url);
    enrichedReferences.push({ ...ref, content });
  }

  const llmResult = await callLlm({
    title: article.title,
    originalContent,
    references: enrichedReferences,
  });

  const updatedTitle = llmResult.title || article.title;
  const updatedContent = appendReferences(
    llmResult.content || originalContent,
    references
  );

  const published = await publishArticle({
    title: updatedTitle,
    content: updatedContent,
    references,
  });

  console.log(`Published generated article: ${published._id}`);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
