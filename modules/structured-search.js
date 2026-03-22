/**
 * Structured Social Search Module
 * Provides LLM-friendly structured search results for social intel researchers.
 * 
 * Output format (per result):
 * {
 *   title, url, source, snippet, evidence, confidence
 * }
 * 
 * Usage:
 *   const { structuredSearch } = require('./structured-search.js');
 *   const results = await structuredSearch("query", { max: 5 });
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(
  process.env.OPENCLAW_HOME || path.join(process.env.HOME, '.openclaw'),
  'workspace', 'scripts', 'web-search-structured.sh'
);

/**
 * @param {string} query
 * @param {{ max?: number, mode?: string }} opts
 * @returns {Promise<{
 *   query: string,
 *   mode: string,
 *   fetch_mode: string,
 *   confidence: string,
 *   results: Array<{
 *     title: string,
 *     url: string,
 *     source: string,
 *     snippet: string,
 *     evidence: string,
 *     confidence: string
 *   }>
 * }>}
 */
function structuredSearch(query, opts = {}) {
  const max = opts.max || 5;
  const mode = opts.mode || 'auto';
  
  try {
    if (!fs.existsSync(SCRIPT)) {
      throw new Error(`structured search script missing: ${SCRIPT}`);
    }
    const raw = execFileSync('bash', [SCRIPT, String(query), String(max), String(mode)], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    return {
      query,
      mode: 'error',
      fetch_mode: 'unknown',
      confidence: 'low',
      error: error.message,
      results: [],
    };
  }
}

/**
 * Format results as readable text for agent context.
 * @param {ReturnType<typeof structuredSearch>} data
 * @returns {string}
 */
function formatResults(data) {
  if (!data.results || data.results.length === 0) {
    return `No results found for: ${data.query}\nFetch mode: ${data.fetch_mode}`;
  }
  
  const lines = [
    `查询: ${data.query}`,
    `抓取模式: ${data.fetch_mode} | 可信度: ${data.confidence}`,
    '',
    `共找到 ${data.results.length} 条结果:`,
    '',
  ];
  
  data.results.forEach((r, i) => {
    lines.push(`${i + 1}. [${r.source.toUpperCase()}] ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) {
      lines.push(`   摘要: ${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? '...' : ''}`);
    }
    lines.push(`   证据: ${r.evidence} (confidence: ${r.confidence})`);
    lines.push('');
  });
  
  return lines.join('\n');
}

module.exports = { structuredSearch, formatResults };
