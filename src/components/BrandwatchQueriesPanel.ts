import { Panel } from './Panel';
import { RENAULT_QUERY_TEMPLATES } from '@/config/renault-watch';
import type { BrandwatchExecutionState } from '@/services/brandwatch/gdelt';
import { compileBrandwatchQuery, validateBrandwatchSql } from '@/services/brandwatch/query';
import {
  loadBrandwatchQueries,
  removeBrandwatchQuery,
  toggleBrandwatchQuery,
  upsertBrandwatchQuery,
} from '@/services/brandwatch/store';
import type { BrandwatchQuery } from '@/types';
import { h, replaceChildren } from '@/utils/dom-utils';

export class BrandwatchQueriesPanel extends Panel {
  private queries: BrandwatchQuery[] = loadBrandwatchQueries();
  private draftName = 'Factory Signal';
  private draftQuery = RENAULT_QUERY_TEMPLATES[0]?.query ?? '';
  private draftMode: 'boolean' | 'sql' = 'boolean';
  private draftColor = RENAULT_QUERY_TEMPLATES[0]?.color ?? '#ef4444';
  private errorMessage = '';
  private onQueriesChange?: () => void;
  private executionState: BrandwatchExecutionState = {
    pending: false,
    relayAvailable: true,
    executedCount: 0,
    updatedAt: null,
    queryCounts: {},
    trendPoints: [],
    documentItems: [],
    errors: {},
  };

  constructor() {
    super({ id: 'brandwatch-queries', title: 'Query Builder' });
    this.renderPanel();
  }

  onChanged(callback: () => void): void {
    this.onQueriesChange = callback;
  }

  setExecutionState(state: BrandwatchExecutionState): void {
    this.executionState = state;
    this.renderPanel();
  }

  private commit(): void {
    this.queries = loadBrandwatchQueries();
    this.onQueriesChange?.();
    this.renderPanel();
  }

  private addQuery(): void {
    try {
      if (this.draftMode === 'sql') {
        validateBrandwatchSql(this.draftQuery);
      } else {
        compileBrandwatchQuery(this.draftQuery);
      }
      upsertBrandwatchQuery({
        name: this.draftName.trim() || 'Renault Query',
        query: this.draftQuery.trim(),
        mode: this.draftMode,
        color: this.draftColor,
      });
      this.errorMessage = '';
      this.draftName = 'Factory Signal';
      this.draftQuery = RENAULT_QUERY_TEMPLATES[0]?.query ?? '';
      this.draftMode = 'boolean';
      this.commit();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    this.queries = loadBrandwatchQueries();

    let previewSql = '';
    try {
      previewSql = this.draftMode === 'sql'
        ? validateBrandwatchSql(this.draftQuery)
        : compileBrandwatchQuery(this.draftQuery).bigQuerySql;
    } catch (error) {
      previewSql = error instanceof Error ? error.message : String(error);
    }

    const statusText = this.executionState.pending
      ? 'Syncing GDELT mention counts...'
      : this.executionState.updatedAt && this.executionState.executedCount > 0
        ? `GDELT synced for ${this.executionState.executedCount} ${this.executionState.executedCount === 1 ? 'query' : 'queries'}`
        : this.executionState.statusMessage || (!this.executionState.relayAvailable ? 'GDELT relay unavailable.' : '');

    replaceChildren(
      this.content,
      h('div', { style: 'display:flex; flex-direction:column; gap:10px;' },
        statusText
          ? h('div', { style: 'font-size:11px; color:var(--text-dim);' }, statusText)
          : false,
        h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' },
          ...RENAULT_QUERY_TEMPLATES.map((template) => h('button', {
            className: 'panel-mini-btn',
            style: `font-size:10px; padding:4px 8px; border-color:${template.color};`,
            onClick: () => {
              this.draftName = template.name;
              this.draftQuery = template.query;
              this.draftMode = 'boolean';
              this.draftColor = template.color;
              this.errorMessage = '';
              this.renderPanel();
            },
          }, template.name)),
        ),
        h('div', { style: 'display:flex; gap:6px; flex-wrap:wrap;' },
          ...(['boolean', 'sql'] as const).map((mode) => h('button', {
            className: 'panel-mini-btn',
            style: `font-size:10px; padding:4px 8px; ${this.draftMode === mode ? 'border-color:var(--accent); color:var(--accent);' : ''}`,
            onClick: () => {
              this.draftMode = mode;
              this.errorMessage = '';
              if (mode === 'sql' && this.draftQuery === (RENAULT_QUERY_TEMPLATES[0]?.query ?? '')) {
                this.draftQuery = `WITH source AS (
  SELECT
    DATE(_PARTITIONTIME) AS bucket,
    LOWER(CONCAT(IFNULL(V2Themes, ''), ' ', IFNULL(V2Organizations, ''), ' ', IFNULL(V2Persons, ''), ' ', IFNULL(V2Locations, ''))) AS searchable_text
  FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`
  WHERE DATE(_PARTITIONTIME) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
)
SELECT
  bucket,
  COUNT(*) AS mentions
FROM source
WHERE STRPOS(searchable_text, 'renault') > 0
GROUP BY bucket
ORDER BY bucket DESC
LIMIT 90`;
              }
              this.renderPanel();
            },
          }, mode === 'boolean' ? 'Boolean Mode' : 'SQL Mode')),
        ),
        h('input', {
          value: this.draftName,
          placeholder: this.draftMode === 'sql' ? 'SQL query name' : 'Query name',
          onInput: (event: Event) => {
            this.draftName = (event.target as HTMLInputElement).value;
          },
          onBlur: () => {
            this.renderPanel();
          },
        }),
        h('textarea', {
          rows: this.draftMode === 'sql' ? 10 : 4,
          style: 'width:100%; resize:vertical;',
          placeholder: this.draftMode === 'sql'
            ? 'WITH source AS (...) SELECT bucket, COUNT(*) AS mentions FROM source WHERE ...'
            : '(Renault OR Dacia) AND (strike OR walkout)',
          value: this.draftQuery,
          onInput: (event: Event) => {
            this.draftQuery = (event.target as HTMLTextAreaElement).value;
          },
          onBlur: () => {
            this.renderPanel();
          },
        }),
        this.draftMode === 'sql'
          ? h('div', { style: 'font-size:10px; color:var(--text-dim);' }, 'SQL mode runs directly against GDELT BigQuery and does not participate in local RSS matching.')
          : false,
        h('div', { style: 'display:flex; gap:8px; align-items:center;' },
          h('input', {
            type: 'color',
            value: this.draftColor,
            onInput: (event: Event) => {
              this.draftColor = (event.target as HTMLInputElement).value;
            },
          }),
          h('button', { className: 'monitor-add-btn', onClick: () => this.addQuery() }, 'Save query'),
        ),
        this.errorMessage
          ? h('div', { style: 'font-size:11px; color:var(--status-live);' }, this.errorMessage)
          : false,
        h('div', { style: 'font-size:10px; color:var(--text-dim);' }, 'BigQuery SQL preview'),
        h('pre', {
          style: 'margin:0; padding:8px; font-size:10px; white-space:pre-wrap; background:var(--panel-bg-secondary); border-radius:8px;',
        }, previewSql),
        h('div', { style: 'display:flex; flex-direction:column; gap:8px;' },
          ...this.queries.map((query) => h('div', {
            className: 'item',
            style: `border-left: 3px solid ${query.color}; padding-left: 10px;`,
          },
          h('div', { style: 'display:flex; justify-content:space-between; gap:8px; align-items:flex-start;' },
            h('div', null,
              h('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' },
                h('strong', null, query.name),
                h('span', {
                  style: 'font-size:10px; color:var(--text-dim); background:var(--panel-bg-secondary); border-radius:999px; padding:2px 8px;',
                }, query.mode === 'sql' ? 'SQL' : 'Boolean'),
                this.executionState.updatedAt && Number.isFinite(this.executionState.queryCounts[query.id])
                  ? h('span', {
                    style: 'font-size:10px; color:var(--text-dim); background:var(--panel-bg-secondary); border-radius:999px; padding:2px 8px;',
                  }, `GDELT ${this.executionState.queryCounts[query.id] ?? 0}`)
                  : false,
              ),
              h('div', { style: 'font-size:11px; color:var(--text-dim); margin-top:4px;' }, query.query),
              this.executionState.errors[query.id]
                ? h('div', { style: 'font-size:10px; color:var(--status-live); margin-top:4px;' }, this.executionState.errors[query.id])
                : false,
            ),
            h('div', { style: 'display:flex; gap:6px; align-items:center;' },
              h('label', { style: 'font-size:10px; color:var(--text-dim); display:flex; gap:4px; align-items:center;' },
                h('input', {
                  type: 'checkbox',
                  checked: query.enabled,
                  onChange: (event: Event) => {
                    toggleBrandwatchQuery(query.id, (event.target as HTMLInputElement).checked);
                    this.commit();
                  },
                }),
                'On',
              ),
              h('button', {
                className: 'panel-mini-btn',
                style: 'font-size:10px; padding:2px 6px;',
                onClick: () => {
                  removeBrandwatchQuery(query.id);
                  this.commit();
                },
              }, 'Delete'),
            ),
          )))
        ),
      ),
    );
  }
}
