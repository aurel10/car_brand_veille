import type {
  BooleanQueryNode,
  BrandwatchCompilation,
  BrandwatchQueryField,
} from '@/types';

type Token =
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'AND' | 'OR' | 'NOT' }
  | { type: 'TERM'; value: string };

const FIELD_ALIASES: Record<string, BrandwatchQueryField> = {
  text: 'text',
  theme: 'theme',
  themes: 'theme',
  org: 'org',
  orgs: 'org',
  organization: 'org',
  organisations: 'org',
  organization_s: 'org',
  person: 'person',
  people: 'person',
  persons: 'person',
  location: 'location',
  locations: 'location',
  loc: 'location',
};

const FIELD_SQL: Record<BrandwatchQueryField, string> = {
  text: 'searchable_text',
  theme: 'searchable_theme',
  org: 'searchable_org',
  person: 'searchable_person',
  location: 'searchable_location',
};

function isBooleanKeyword(value: string): 'AND' | 'OR' | 'NOT' | null {
  const upper = value.toUpperCase();
  if (upper === 'AND' || upper === 'OR' || upper === 'NOT') return upper;
  return null;
}

export function tokenizeBooleanQuery(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < query.length) {
    const char = query[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'LPAREN' });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN' });
      i += 1;
      continue;
    }
    if (char === '"') {
      let j = i + 1;
      let value = '';
      while (j < query.length) {
        const next = query[j]!;
        if (next === '\\' && j + 1 < query.length) {
          value += query[j + 1]!;
          j += 2;
          continue;
        }
        if (next === '"') break;
        value += next;
        j += 1;
      }
      if (j >= query.length || query[j] !== '"') {
        throw new Error('Unterminated quoted phrase in boolean query.');
      }
      tokens.push({ type: 'TERM', value: `"${value}"` });
      i = j + 1;
      continue;
    }

    let j = i;
    let inQuotes = false;
    while (j < query.length) {
      const next = query[j]!;
      if (inQuotes) {
        if (next === '\\' && j + 1 < query.length) {
          j += 2;
          continue;
        }
        if (next === '"') {
          inQuotes = false;
        }
        j += 1;
        continue;
      }
      if (next === '"') {
        inQuotes = true;
        j += 1;
        continue;
      }
      if (/\s/.test(next) || next === '(' || next === ')') {
        break;
      }
      j += 1;
    }
    if (inQuotes) {
      throw new Error('Unterminated quoted phrase in boolean query.');
    }
    const raw = query.slice(i, j);
    const keyword = isBooleanKeyword(raw);
    if (keyword) {
      tokens.push({ type: keyword });
    } else {
      tokens.push({ type: 'TERM', value: raw });
    }
    i = j;
  }

  return tokens;
}

function splitFieldTerm(raw: string): { field?: BrandwatchQueryField; value: string } {
  const colonIndex = raw.indexOf(':');
  if (colonIndex <= 0) {
    return { value: raw };
  }

  const maybeField = raw.slice(0, colonIndex).toLowerCase();
  const field = FIELD_ALIASES[maybeField];
  if (!field) {
    return { value: raw };
  }
  return {
    field,
    value: raw.slice(colonIndex + 1),
  };
}

function normalizeTermValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTerm(raw: string): BooleanQueryNode {
  const { field, value } = splitFieldTerm(raw);
  const normalized = normalizeTermValue(value);
  if (!normalized) {
    throw new Error('Empty term in boolean query.');
  }
  return { type: 'term', field, value: normalized };
}

export function parseBooleanQuery(query: string): BooleanQueryNode {
  const tokens = tokenizeBooleanQuery(query);
  if (tokens.length === 0) {
    throw new Error('Boolean query cannot be empty.');
  }

  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const consume = (): Token => {
    const token = tokens[index];
    if (!token) throw new Error('Unexpected end of boolean query.');
    index += 1;
    return token;
  };

  const parsePrimary = (): BooleanQueryNode => {
    const token = consume();
    if (token.type === 'TERM') return parseTerm(token.value);
    if (token.type === 'LPAREN') {
      const expr = parseOr();
      const next = peek();
      if (!next || next.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis in boolean query.');
      }
      consume();
      return expr;
    }
    if (token.type === 'NOT') {
      return { type: 'not', child: parsePrimary() };
    }
    throw new Error(`Unexpected token ${token.type} in boolean query.`);
  };

  const parseAnd = (): BooleanQueryNode => {
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

  const parseOr = (): BooleanQueryNode => {
    let node = parseAnd();
    while (peek()?.type === 'OR') {
      consume();
      node = { type: 'or', left: node, right: parseAnd() };
    }
    return node;
  };

  const result = parseOr();
  if (index !== tokens.length) {
    throw new Error('Unexpected trailing tokens in boolean query.');
  }
  return result;
}

function precedence(node: BooleanQueryNode): number {
  if (node.type === 'term') return 4;
  if (node.type === 'not') return 3;
  if (node.type === 'and') return 2;
  return 1;
}

export function normalizeBooleanQuery(node: BooleanQueryNode): string {
  if (node.type === 'term') {
    const formatted = /\s/.test(node.value) ? `"${node.value}"` : node.value;
    return node.field ? `${node.field}:${formatted}` : formatted;
  }
  if (node.type === 'not') {
    const child = normalizeBooleanQuery(node.child);
    return node.child.type === 'term' || node.child.type === 'not' ? `NOT ${child}` : `NOT (${child})`;
  }

  const op = node.type === 'and' ? 'AND' : 'OR';
  const left = normalizeBooleanQuery(node.left);
  const right = normalizeBooleanQuery(node.right);
  const leftWrapped = precedence(node.left) < precedence(node) ? `(${left})` : left;
  const rightWrapped = precedence(node.right) < precedence(node) ? `(${right})` : right;
  return `${leftWrapped} ${op} ${rightWrapped}`;
}

function escapeSqlLiteral(value: string): string {
  return value
    .replace(/'/g, "''")
    .toLowerCase();
}

function compileTerm(node: Extract<BooleanQueryNode, { type: 'term' }>): string {
  const field = node.field ?? 'text';
  const needle = escapeSqlLiteral(node.value);
  return `STRPOS(${FIELD_SQL[field]}, '${needle}') > 0`;
}

export function compileBooleanQueryToBigQueryWhere(node: BooleanQueryNode): string {
  if (node.type === 'term') return compileTerm(node);
  if (node.type === 'not') return `NOT (${compileBooleanQueryToBigQueryWhere(node.child)})`;
  const left = compileBooleanQueryToBigQueryWhere(node.left);
  const right = compileBooleanQueryToBigQueryWhere(node.right);
  const op = node.type === 'and' ? 'AND' : 'OR';
  return `(${left} ${op} ${right})`;
}

export function buildBigQuerySql(whereClause: string, days = 7): string {
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

export function buildBigQueryDocumentsSql(whereClause: string, days = 7, limit = 40): string {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(90, Math.floor(days)) : 7;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.floor(limit)) : 40;
  return [
    'WITH source AS (',
    '  SELECT',
    '    DATE(_PARTITIONTIME) AS bucket,',
    "    SAFE.PARSE_TIMESTAMP('%Y%m%d%H%M%S', CAST(`DATE` AS STRING)) AS document_timestamp,",
    '    DocumentIdentifier AS document_identifier,',
    `    LOWER(CONCAT(IFNULL(V2Themes, ''), ' ', IFNULL(V2Organizations, ''), ' ', IFNULL(V2Persons, ''), ' ', IFNULL(V2Locations, ''))) AS ${FIELD_SQL.text},`,
    `    LOWER(IFNULL(V2Themes, '')) AS ${FIELD_SQL.theme},`,
    `    LOWER(IFNULL(V2Organizations, '')) AS ${FIELD_SQL.org},`,
    `    LOWER(IFNULL(V2Persons, '')) AS ${FIELD_SQL.person},`,
    `    LOWER(IFNULL(V2Locations, '')) AS ${FIELD_SQL.location},`,
    "    IFNULL(V2Themes, '') AS themes,",
    "    IFNULL(V2Organizations, '') AS organizations,",
    "    IFNULL(V2Persons, '') AS persons,",
    "    IFNULL(V2Locations, '') AS locations",
    '  FROM `gdelt-bq.gdeltv2.gkg_partitioned`',
    `  WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${safeDays} DAY)`,
    ')',
    'SELECT',
    '  bucket,',
    '  document_timestamp,',
    '  document_identifier,',
    '  themes,',
    '  organizations,',
    '  persons,',
    '  locations',
    'FROM source',
    `WHERE ${whereClause}`,
    '  AND document_identifier IS NOT NULL',
    "  AND document_identifier != ''",
    'ORDER BY document_timestamp DESC NULLS LAST, bucket DESC, document_identifier DESC',
    `LIMIT ${safeLimit}`,
  ].join('\n');
}

export function extractBooleanQueryTerms(node: BooleanQueryNode): string[] {
  if (node.type === 'term') return [node.value];
  if (node.type === 'not') return extractBooleanQueryTerms(node.child);
  return [...extractBooleanQueryTerms(node.left), ...extractBooleanQueryTerms(node.right)];
}

export function extractBooleanQueryFields(node: BooleanQueryNode): BrandwatchQueryField[] {
  const fields = new Set<BrandwatchQueryField>();
  const visit = (current: BooleanQueryNode): void => {
    if (current.type === 'term') {
      fields.add(current.field ?? 'text');
      return;
    }
    if (current.type === 'not') {
      visit(current.child);
      return;
    }
    visit(current.left);
    visit(current.right);
  };
  visit(node);
  return [...fields];
}

function buildMatcher(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundarySafe = /^[\p{L}\p{N}-]+$/u.test(value);
  return new RegExp(boundarySafe ? `\\b${escaped}\\b` : escaped, 'iu');
}

function matchFieldValue(value: string, haystack: string | string[] | undefined): boolean {
  if (!haystack) return false;
  const matcher = buildMatcher(value);
  if (Array.isArray(haystack)) {
    return haystack.some(item => matcher.test(item.toLowerCase()));
  }
  return matcher.test(haystack.toLowerCase());
}

export function evaluateBooleanQuery(
  node: BooleanQueryNode,
  fields: Partial<Record<BrandwatchQueryField, string | string[]>>,
): boolean {
  if (node.type === 'term') {
    const field = node.field ?? 'text';
    if (field === 'text') {
      const combined = [
        fields.text,
        fields.theme,
        fields.org,
        fields.person,
        fields.location,
      ]
        .flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
        .join(' ');
      return matchFieldValue(node.value, combined);
    }
    return matchFieldValue(node.value, fields[field]);
  }
  if (node.type === 'not') {
    return !evaluateBooleanQuery(node.child, fields);
  }
  if (node.type === 'and') {
    return evaluateBooleanQuery(node.left, fields) && evaluateBooleanQuery(node.right, fields);
  }
  return evaluateBooleanQuery(node.left, fields) || evaluateBooleanQuery(node.right, fields);
}

export function compileBrandwatchQuery(query: string, days = 7): BrandwatchCompilation {
  const ast = parseBooleanQuery(query);
  const normalizedQuery = normalizeBooleanQuery(ast);
  const bigQueryWhere = compileBooleanQueryToBigQueryWhere(ast);
  return {
    normalizedQuery,
    bigQueryWhere,
    bigQuerySql: buildBigQuerySql(bigQueryWhere, days),
    bigQueryDocsSql: buildBigQueryDocumentsSql(bigQueryWhere, days),
    referencedFields: extractBooleanQueryFields(ast),
    terms: extractBooleanQueryTerms(ast),
  };
}

export function validateBrandwatchSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new Error('SQL query cannot be empty.');
  }
  if (!/^\s*(WITH\b|SELECT\b)/i.test(trimmed)) {
    throw new Error('SQL query must start with WITH or SELECT.');
  }
  if (trimmed.includes(';')) {
    throw new Error('SQL query must contain a single statement.');
  }
  if (!/FROM\s+`gdelt-bq\.gdeltv2\.gkg_partitioned`/i.test(trimmed)) {
    throw new Error('SQL query must target `gdelt-bq.gdeltv2.gkg_partitioned`.');
  }
  return trimmed;
}
