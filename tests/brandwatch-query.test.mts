import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileBrandwatchQuery,
  evaluateBooleanQuery,
  normalizeBooleanQuery,
  parseBooleanQuery,
  validateBrandwatchSql,
} from '../src/services/brandwatch/query.ts';

describe('brandwatch boolean query parser', () => {
  it('preserves AND precedence over OR', () => {
    const ast = parseBooleanQuery('Renault OR Dacia AND strike');
    assert.equal(normalizeBooleanQuery(ast), 'Renault OR Dacia AND strike');

    assert.equal(evaluateBooleanQuery(ast, { text: 'Renault launches a new EV platform' }), true);
    assert.equal(evaluateBooleanQuery(ast, { text: 'Dacia workers announce strike action' }), true);
    assert.equal(evaluateBooleanQuery(ast, { text: 'Dacia expands dealer network' }), false);
  });

  it('supports implicit AND and nested boolean groups', () => {
    const ast = parseBooleanQuery('(Renault OR Dacia) (strike OR walkout) NOT rumor');
    assert.equal(normalizeBooleanQuery(ast), '(Renault OR Dacia) AND (strike OR walkout) AND NOT rumor');

    assert.equal(evaluateBooleanQuery(ast, { text: 'Renault strike spreads to supplier park' }), true);
    assert.equal(evaluateBooleanQuery(ast, { text: 'Dacia walkout rumor circulates online' }), false);
  });

  it('supports quoted phrases and field-scoped terms', () => {
    const ast = parseBooleanQuery('org:Renault AND person:"Luca de Meo" AND theme:"supply chain"');
    assert.equal(normalizeBooleanQuery(ast), 'org:Renault AND person:"Luca de Meo" AND theme:"supply chain"');

    assert.equal(evaluateBooleanQuery(ast, {
      org: ['Renault Group', 'Ampere'],
      person: ['Luca de Meo'],
      theme: ['supply chain disruption', 'logistics'],
    }), true);
    assert.equal(evaluateBooleanQuery(ast, {
      org: ['Renault Group'],
      person: ['Jean-Dominique Senard'],
      theme: ['supply chain disruption'],
    }), false);
  });

  it('rejects invalid boolean expressions', () => {
    assert.throws(() => parseBooleanQuery(''), /cannot be empty/i);
    assert.throws(() => parseBooleanQuery('"unterminated'), /unterminated/i);
    assert.throws(() => parseBooleanQuery('(Renault OR Dacia'), /closing parenthesis/i);
    assert.throws(() => parseBooleanQuery('Renault AND )'), /unexpected token/i);
  });
});

describe('brandwatch bigquery compiler', () => {
  it('maps semantic fields to the expected GDELT columns', () => {
    const compiled = compileBrandwatchQuery('org:Renault AND person:"Luca de Meo" AND location:France AND theme:strike');

    assert.deepStrictEqual(
      [...compiled.referencedFields].sort(),
      ['location', 'org', 'person', 'theme'],
    );
    assert.match(compiled.bigQueryWhere, /STRPOS\(searchable_org, 'renault'\) > 0/);
    assert.match(compiled.bigQueryWhere, /STRPOS\(searchable_person, 'luca de meo'\) > 0/);
    assert.match(compiled.bigQueryWhere, /STRPOS\(searchable_location, 'france'\) > 0/);
    assert.match(compiled.bigQueryWhere, /STRPOS\(searchable_theme, 'strike'\) > 0/);
    assert.match(compiled.bigQuerySql, /FROM `gdelt-bq\.gdeltv2\.gkg_partitioned`/);
    assert.match(compiled.bigQuerySql, /WITH source AS \(/);
    assert.match(compiled.bigQuerySql, /LOWER\(IFNULL\(V2Organizations, ''\)\) AS searchable_org/);
  });

  it('escapes apostrophes in SQL LIKE patterns', () => {
    const compiled = compileBrandwatchQuery(`text:"CEO's scandal"`);
    assert.match(compiled.bigQueryWhere, /ceo''s scandal/);
  });

  it('keeps evaluation behavior aligned with compiled frontend semantics', () => {
    const query = '(org:Renault OR org:Dacia) AND (theme:strike OR text:walkout) AND NOT location:Russia';
    const ast = parseBooleanQuery(query);

    assert.equal(evaluateBooleanQuery(ast, {
      org: ['Renault', 'Ampere'],
      theme: ['labor strike'],
      location: ['France'],
      text: 'Renault strike widens in northern France',
    }), true);

    assert.equal(evaluateBooleanQuery(ast, {
      org: ['Dacia'],
      theme: ['labor strike'],
      location: ['Russia'],
      text: 'Dacia strike in Russia',
    }), false);
  });

  it('accepts manual SQL mode for direct GDELT queries', () => {
    const sql = validateBrandwatchSql(`WITH source AS (
  SELECT DATE(_PARTITIONTIME) AS bucket
  FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`
)
SELECT bucket, COUNT(*) AS mentions
FROM source
GROUP BY bucket`);

    assert.match(sql, /^WITH source AS \(/);
  });

  it('rejects SQL that targets another table', () => {
    assert.throws(
      () => validateBrandwatchSql('SELECT * FROM `other.project.table`'),
      /gdelt-bq\.gdeltv2\.gkg_partitioned/i,
    );
  });
});
