import React, { useCallback, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

function stripHtml(value) {
  if (!value) return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ArticleCard({ article, tone }) {
  const snippet = stripHtml(article.content || article.excerpt).slice(0, 220);
  const publishedAt = formatDate(article.publishedAt);
  const isExternal = article.url?.startsWith("http");

  return (
    <article className={`card card--${tone}`}>
      <div className="card__header">
        <span className="badge">{article.source || "article"}</span>
        {publishedAt ? <span className="meta">{publishedAt}</span> : null}
      </div>
      <h3 className="card__title">{article.title}</h3>
      <p className="card__meta">{article.author ? `By ${article.author}` : ""}</p>
      <p className="card__snippet">
        {snippet || "No summary available yet."}
        {snippet.length >= 220 ? "…" : ""}
      </p>
      {article.references?.length ? (
        <div className="card__refs">
          <span className="meta">References</span>
          <ul>
            {article.references.map((ref) => (
              <li key={ref.url || ref.title}>
                <a href={ref.url} target="_blank" rel="noopener noreferrer">
                  {ref.title || ref.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="card__footer">
        {isExternal ? (
          <a className="card__link" href={article.url} target="_blank" rel="noopener noreferrer">
            Read source
          </a>
        ) : (
          <span className="card__link card__link--disabled">Internal draft</span>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchArticles = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/articles`);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    const data = await response.json();
    setArticles(Array.isArray(data) ? data : []);
  }, []);

  const refreshFeed = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      await fetch(`${API_BASE}/api/articles/scrape`, { method: "POST" });
      await fetchArticles();
      setLastUpdated(new Date());
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err.message || "Failed to load articles");
    }
  }, [fetchArticles]);

  React.useEffect(() => {
    refreshFeed();
  }, [refreshFeed]);

  const originals = useMemo(
    () => articles.filter((article) => article.source !== "generated"),
    [articles]
  );

  const generated = useMemo(
    () => articles.filter((article) => article.source === "generated" || article.references?.length),
    [articles]
  );

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">BeyondChats Content Studio</p>
          <h1>Article Monitor</h1>
          <p className="subtitle">
            Track original BeyondChats posts alongside AI-refined versions inspired by top-ranked
            references.
          </p>
        </div>
        <div className="hero__panel">
          <div className="stat">
            <span className="stat__label">Original articles</span>
            <span className="stat__value">{originals.length}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Updated versions</span>
            <span className="stat__value">{generated.length}</span>
          </div>
          <button className="refresh" onClick={refreshFeed} disabled={status === "loading"}>
            {status === "loading" ? "Refreshing…" : "Refresh feed"}
          </button>
          {lastUpdated ? (
            <span className="meta">Updated {lastUpdated.toLocaleTimeString()}</span>
          ) : null}
        </div>
      </header>

      {status === "error" ? <div className="error">{error}</div> : null}

      <section className="section">
        <div className="section__title">
          <h2>Original Articles</h2>
          <p>Scraped from BeyondChats blogs.</p>
        </div>
        <div className="card-grid">
          {status === "loading" && originals.length === 0
            ? Array.from({ length: 3 }).map((_, index) => (
                <div className="card card--skeleton" key={`original-skeleton-${index}`} />
              ))
            : originals.map((article) => (
                <ArticleCard article={article} tone="original" key={article._id} />
              ))}
        </div>
      </section>

      <section className="section">
        <div className="section__title">
          <h2>Updated Versions</h2>
          <p>LLM-enhanced articles with cited reference sources.</p>
        </div>
        <div className="card-grid">
          {status === "loading" && generated.length === 0
            ? Array.from({ length: 2 }).map((_, index) => (
                <div className="card card--skeleton" key={`generated-skeleton-${index}`} />
              ))
            : generated.map((article) => (
                <ArticleCard article={article} tone="generated" key={article._id} />
              ))}
        </div>
      </section>
    </div>
  );
}