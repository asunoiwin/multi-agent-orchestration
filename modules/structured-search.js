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

const LEGACY_SCRIPT = path.join(
  process.env.OPENCLAW_HOME || path.join(process.env.HOME, '.openclaw'),
  'workspace', 'scripts', 'web-search-structured.sh'
);
const ORCHESTRATOR = path.join(
  process.env.OPENCLAW_HOME || path.join(process.env.HOME, '.openclaw'),
  'extensions', 'openclaw-search-orchestrator', 'scripts', 'search_orchestrator.py'
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
    if (fs.existsSync(ORCHESTRATOR)) {
      const raw = execFileSync('python3', [ORCHESTRATOR, 'research', JSON.stringify({
        query: String(query),
        intent: opts.intent || 'auto',
        max_results: max,
        max_deep_results: Math.min(max, 4),
        max_refine_rounds: 1,
      })], {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const parsed = JSON.parse(raw);
      return {
        query: parsed.query,
        mode: 'orchestrated',
        fetch_mode: 'deep',
        confidence: parsed.quality || 'medium',
        coverage: parsed.coverage || null,
        followup_queries: parsed.followup_queries || [],
        results: (parsed.results || []).map((item) => ({
          title: item.title,
          url: item.url,
          source: item.engine,
          snippet: item.extraction?.summary?.join(' ') || item.snippet || '',
          evidence: `query_variant=${item.query_variant}; site_focus=${item.site_focus}; fetch_mode=${item.extraction?.fetch_mode || 'direct'}`,
          confidence: item.extraction?.quality || parsed.quality || 'medium',
        })),
      };
    }

    if (!fs.existsSync(LEGACY_SCRIPT)) {
      throw new Error(`structured search script missing: ${LEGACY_SCRIPT}`);
    }
    const raw = execFileSync('bash', [LEGACY_SCRIPT, String(query), String(max), String(mode)], {
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
