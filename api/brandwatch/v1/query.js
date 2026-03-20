import { getCorsHeaders, isDisallowedOrigin } from '../../_cors.js';
import { jsonResponse } from '../../_json-response.js';
import { getRelayBaseUrl, getRelayHeaders } from '../../_relay.js';

export const config = { runtime: 'edge' };

const FIELD_SQL = {
  text: 'searchable_text',
  theme: 'searchable_theme',
  org: 'searchable_org',
  person: 'searchable_person',
  location: 'searchable_location',
};

const FIELD_ALIASES = {
  text: 'text',
  theme: 'theme',
  themes: 'theme',
  org: 'org',
  orgs: 'org',
  organization: 'org',
  organisations: 'org',
  person: 'person',
  people: 'person',
  persons: 'person',
  location: 'location',
  locations: 'location',
  loc: 'location',
};

function tokenize(query) {
  const tokens = [];
  let i = 0;
  while (i < query.length) {
    const char = query[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === '(') { tokens.push({ type: 'LPAREN' }); i += 1; continue; }
    if (char === ')') { tokens.push({ type: 'RPAREN' }); i += 1; continue; }
    if (char === '"') {
      let j = i + 1;
      let value = '';
      while (j < query.length) {
        const next = query[j];
        if (next === '\\' && j + 1 < query.length) {
          value += query[j + 1];
          j += 2;
          continue;
        }
        if (next === '"') break;
        value += next;
        j += 1;
      }
      if (j >= query.length || query[j] !== '"') throw new Error('Unterminated quoted phrase in boolean query.');
      tokens.push({ type: 'TERM', value: `"${value}"` });
      i = j + 1;
      continue;
    }
    let j = i;
    let inQuotes = false;
    while (j < query.length) {
      const next = query[j];
      if (inQuotes) {
        if (next === '\\' && j + 1 < query.length) {
          j += 2;
          continue;
        }
        if (next === '"') inQuotes = false;
        j += 1;
        continue;
      }
      if (next === '"') {
        inQuotes = true;
        j += 1;
        continue;
      }
      if (/\s/.test(next) || next === '(' || next === ')') break;
      j += 1;
    }
    if (inQuotes) throw new Error('Unterminated quoted phrase in boolean query.');
    const raw = query.slice(i, j);
    const upper = raw.toUpperCase();
    if (upper === 'AND' || upper === 'OR' || upper === 'NOT') tokens.push({ type: upper });
    else tokens.push({ type: 'TERM', value: raw });
    i = j;
  }
  return tokens;
}

function normalizeTermValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

function splitFieldTerm(raw) {
  const colonIndex = raw.indexOf(':');
  if (colonIndex <= 0) return { value: raw };
  const alias = raw.slice(0, colonIndex).toLowerCase();
  const field = FIELD_ALIASES[alias];
  if (!field) return { value: raw };
  return { field, value: raw.slice(colonIndex + 1) };
}

function parse(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) throw new Error('Boolean query cannot be empty.');
  let index = 0;

  const peek = () => tokens[index];
  const consume = () => {
    const token = tokens[index];
    if (!token) throw new Error('Unexpected end of boolean query.');
    index += 1;
    return token;
  };

  const parseTerm = (raw) => {
    const { field, value } = splitFieldTerm(raw);
    const normalized = normalizeTermValue(value);
    if (!normalized) throw new Error('Empty term in boolean query.');
    return { type: 'term', field, value: normalized };
  };

  const parsePrimary = () => {
    const token = consume();
    if (token.type === 'TERM') return parseTerm(token.value);
    if (token.type === 'LPAREN') {
      const expr = parseOr();
      const close = peek();
      if (!close || close.type !== 'RPAREN') throw new Error('Expected closing parenthesis in boolean query.');
      consume();
      return expr;
    }
    if (token.type === 'NOT') return { type: 'not', child: parsePrimary() };
    throw new Error(`Unexpected token ${token.type} in boolean query.`);
  };

  const parseAnd = () => {
    let node = parsePrimary();
    for (;;) {
      const token = peek();
      if (!token) break;
      if (token.type === 'AND') {
        consume();
        node = { type: 'and', left: node, right: parsePrimary() };
        continue;
      }
      if (token.type === 'TERM' || token.type === 'LPAREN' || token.type === 'NOT') {
        node = { type: 'and', left: node, right: parsePrimary() };
        continue;
      }
      break;
    }
    return node;
  };

  const parseOr = () => {
    let node = parseAnd();
    while (peek() && peek().type === 'OR') {
      consume();
      node = { type: 'or', left: node, right: parseAnd() };
    }
    return node;
  };

  const result = parseOr();
  if (index !== tokens.length) throw new Error('Unexpected trailing tokens in boolean query.');
  return result;
}

function precedence(node) {
  if (node.type === 'term') return 4;
  if (node.type === 'not') return 3;
  if (node.type === 'and') return 2;
  return 1;
}

function normalize(node) {
  if (node.type === 'term') {
    const formatted = /\s/.test(node.value) ? `"${node.value}"` : node.value;
    return node.field ? `${node.field}:${formatted}` : formatted;
  }
  if (node.type === 'not') {
    const child = normalize(node.child);
    return node.child.type === 'term' || node.child.type === 'not' ? `NOT ${child}` : `NOT (${child})`;
  }
  const op = node.type === 'and' ? 'AND' : 'OR';
  const left = normalize(node.left);
  const right = normalize(node.right);
  return `${precedence(node.left) < precedence(node) ? `(${left})` : left} ${op} ${precedence(node.right) < precedence(node) ? `(${right})` : right}`;
}

function escapeSqlLiteral(value) {
  return value
    .replace(/'/g, "''")
    .toLowerCase();
}

function compileWhere(node) {
  if (node.type === 'term') {
    const field = node.field || 'text';
    return `STRPOS(${FIELD_SQL[field]}, '${escapeSqlLiteral(node.value)}') > 0`;
  }
  if (node.type === 'not') return `NOT (${compileWhere(node.child)})`;
  const op = node.type === 'and' ? 'AND' : 'OR';
  return `(${compileWhere(node.left)} ${op} ${compileWhere(node.right)})`;
}

function collectTerms(node, acc = []) {
  if (node.type === 'term') {
    acc.push(node.value);
    return acc;
  }
  if (node.type === 'not') return collectTerms(node.child, acc);
  collectTerms(node.left, acc);
  collectTerms(node.right, acc);
  return acc;
}

function collectFields(node, acc = new Set()) {
  if (node.type === 'term') {
    acc.add(node.field || 'text');
    return acc;
  }
  if (node.type === 'not') return collectFields(node.child, acc);
  collectFields(node.left, acc);
  collectFields(node.right, acc);
  return acc;
}

function buildSql(whereClause, days) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 7;
  return [
    'WITH source AS (',
    '  SELECT',
    '    DATE(_PARTITIONTIME) AS bucket,',
    `    LOWER(CONCAT(IFNULL(V2Themes, ''), ' ', IFNULL(V2Organizations, ''), ' ', IFNULL(V2Persons, ''), ' ', IFNULL(V2Locations, ''))) AS ${FIELD_SQL.text},`,
    `    LOWER(IFNULL(V2Themes, '')) AS ${FIELD_SQL.theme},`,
    `    LOWER(IFNULL(V2Organizations, '')) AS ${FIELD_SQL.org},`,
    `    LOWER(IFNULL(V2Persons, '')) AS ${FIELD_SQL.person},`,
    `    LOWER(IFNULL(V2Locations, '')) AS ${FIELD_SQL.location}`,
    '  FROM `gdelt-bq.gdeltv2.gkg_partitioned`',
    `  WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${safeDays} DAY)`,
    ')',
    'SELECT',
    '  bucket,',
    '  COUNT(*) AS mentions',
    'FROM source',
    `WHERE ${whereClause}`,
    'GROUP BY bucket',
    'ORDER BY bucket DESC',
    'LIMIT 90',
  ].join('\n');
}

async function parsePayload(req) {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    return {
      query: url.searchParams.get('query') || '',
      mode: url.searchParams.get('mode') || 'compile',
      days: Number(url.searchParams.get('days') || '7'),
      execute: url.searchParams.get('execute') === 'true',
    };
  }
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export default async function handler(req) {
  if (isDisallowedOrigin(req)) {
    return new Response('Forbidden', { status: 403 });
  }

  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const payload = await parsePayload(req);
  const query = String(payload.query || '').trim();
  const queryMode = String(payload.queryMode || 'boolean').toLowerCase() === 'sql' ? 'sql' : 'boolean';
  const mode = String(payload.mode || 'compile');
  const days = Number(payload.days || 7);
  const execute = Boolean(payload.execute);

  if (!query && !payload.bigQuerySql) {
    return jsonResponse({ error: 'query is required' }, 400, cors);
  }

  try {
    let normalizedQuery = query;
    let bigQueryWhere = '';
    let bigQuerySql = String(payload.bigQuerySql || '').trim();
    let referencedFields = [];
    let terms = [];

    if (queryMode === 'sql') {
      if (!bigQuerySql) {
        bigQuerySql = query;
      }
      if (!/^\s*(WITH\b|SELECT\b)/i.test(bigQuerySql)) {
        throw new Error('SQL query must start with WITH or SELECT.');
      }
      if (!/FROM\s+`gdelt-bq\.gdeltv2\.gkg_partitioned`/i.test(bigQuerySql)) {
        throw new Error('SQL query must target `gdelt-bq.gdeltv2.gkg_partitioned`.');
      }
    } else {
      const ast = parse(query);
      normalizedQuery = normalize(ast);
      bigQueryWhere = compileWhere(ast);
      bigQuerySql = buildSql(bigQueryWhere, days);
      referencedFields = [...collectFields(ast)];
      terms = collectTerms(ast);
    }

    const response = {
      normalizedQuery,
      bigQueryWhere,
      bigQuerySql,
      referencedFields,
      terms,
      mode,
      queryMode,
      relayAvailable: Boolean(getRelayBaseUrl()),
      relayExecuted: false,
      relayData: null,
    };

    if (execute) {
      const relayBase = getRelayBaseUrl();
      if (!relayBase) {
        return jsonResponse(response, 200, cors);
      }

      try {
        const relayResponse = await fetch(`${relayBase}/brandwatch/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getRelayHeaders({}),
          },
          body: JSON.stringify({
            query: normalizedQuery,
            bigQueryWhere,
            bigQuerySql,
            days,
            mode,
          }),
        });

        if (relayResponse.ok) {
          response.relayExecuted = true;
          response.relayData = await relayResponse.json();
        } else {
          let relayPayload = null;
          try {
            relayPayload = await relayResponse.json();
          } catch {
            try {
              relayPayload = { error: await relayResponse.text() };
            } catch {
              relayPayload = { error: `Relay request failed (${relayResponse.status})` };
            }
          }
          response.relayData = {
            status: relayResponse.status,
            ...(relayPayload || { error: `Relay request failed (${relayResponse.status})` }),
          };
        }
      } catch (error) {
        // Relay execution is best-effort. Compilation still succeeds without it.
        response.relayData = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return jsonResponse(response, 200, cors);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
      cors,
    );
  }
}
