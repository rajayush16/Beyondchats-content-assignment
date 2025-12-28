const express = require("express");

const Article = require("../models/Article");
const { scrapeOldestArticles } = require("../scraper/scrapeBeyondChats");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const articles = await Article.find().sort({ publishedAt: 1, createdAt: 1 });
    res.json(articles);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const article = await Article.create(req.body);
    res.status(201).json(article);
  } catch (error) {
    next(error);
  }
});

router.post("/scrape", async (req, res, next) => {
  try {
    const scraped = await scrapeOldestArticles(5);
    const saved = await Promise.all(
      scraped.map((article) =>
        Article.findOneAndUpdate(
          { url: article.url },
          { $set: article },
          { upsert: true, new: true, runValidators: true }
        )
      )
    );

    res.json({ count: saved.length, articles: saved });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }
    res.json(article);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const article = await Article.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }
    res.json(article);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const article = await Article.findByIdAndDelete(req.params.id);
    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
