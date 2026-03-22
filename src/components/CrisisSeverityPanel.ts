import { Panel } from './Panel';
import type { BrandwatchSnapshot } from '@/services/brandwatch/engine';
import { getThreatColor } from '@/services/threat-classifier';
import { h, replaceChildren } from '@/utils/dom-utils';

type CrisisLevel = 'CALM' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

const LEVEL_COLORS: Record<CrisisLevel, string> = {
  CALM: '#22c55e',
  ELEVATED: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

function computeCrisisLevel(snapshot: BrandwatchSnapshot): CrisisLevel {
  const criticalCount = snapshot.alerts.filter(a => a.severity === 'critical').length;
  const highCount = snapshot.alerts.filter(a => a.severity === 'high').length;
  const weakSignalCritical = snapshot.weakSignals.filter(s => s.severity === 'critical').length;

  if (criticalCount >= 2 || weakSignalCritical >= 1) return 'CRITICAL';
  if (criticalCount >= 1 || highCount >= 3) return 'HIGH';
  if (highCount >= 1 || snapshot.alerts.length >= 5) return 'ELEVATED';
  return 'CALM';
}

function getCategoryBreakdown(snapshot: BrandwatchSnapshot): Map<string, { count: number; maxSeverity: string }> {
  const categories = new Map<string, { count: number; maxSeverity: string }>();
  const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  for (const alert of snapshot.alerts) {
    const cat = alert.theme ?? 'general';
    const existing = categories.get(cat);
    if (!existing) {
      categories.set(cat, { count: 1, maxSeverity: alert.severity });
    } else {
      existing.count++;
      if ((severityRank[alert.severity] ?? 0) > (severityRank[existing.maxSeverity] ?? 0)) {
        existing.maxSeverity = alert.severity;
      }
    }
  }

  return categories;
}

export class CrisisSeverityPanel extends Panel {
  constructor() {
    super({ id: 'crisis-severity', title: 'Crisis Level' });
  }

  update(snapshot: BrandwatchSnapshot): void {
    if (snapshot.alerts.length === 0 && snapshot.weakSignals.length === 0) {
      replaceChildren(
        this.content,
        h('div', { style: 'text-align:center; padding:20px 0;' },
          h('div', { style: 'font-size:28px; font-weight:700; color:#22c55e; letter-spacing:0.1em;' }, 'CALM'),
          h('div', { style: 'font-size:11px; color:var(--text-dim); margin-top:6px;' }, 'No active threats detected'),
        ),
      );
      return;
    }

    const level = computeCrisisLevel(snapshot);
    const levelColor = LEVEL_COLORS[level];
    const categories = getCategoryBreakdown(snapshot);

    // Sort categories by count descending
    const sortedCategories = [...categories.entries()]
      .sort((a, b) => b[1].count - a[1].count);

    // Top threats
    const topThreats = snapshot.alerts
      .slice(0, 5);

    replaceChildren(
      this.content,
      // Crisis level indicator
      h('div', { style: 'text-align:center; padding:12px 0; border-bottom:1px solid var(--border-color, #333); margin-bottom:10px;' },
        h('div', { style: `font-size:28px; font-weight:700; color:${levelColor}; letter-spacing:0.1em;` }, level),
        h('div', { style: 'font-size:11px; color:var(--text-dim); margin-top:4px;' },
          `${snapshot.alerts.length} alerts · ${snapshot.weakSignals.length} weak signals`,
        ),
      ),
      // Category breakdown
      h('div', { style: 'margin-bottom:10px;' },
        h('div', { style: 'font-size:10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;' }, 'By Category'),
        ...sortedCategories.slice(0, 8).map(([cat, data]) =>
          h('div', { style: 'display:flex; align-items:center; gap:8px; padding:3px 0; font-size:11px;' },
            h('span', { style: `width:6px; height:6px; border-radius:50%; background:${getThreatColor(data.maxSeverity)}; flex-shrink:0;` }),
            h('span', { style: 'flex:1; color:var(--text); text-transform:capitalize;' }, cat),
            h('span', { style: 'color:var(--text-dim);' }, String(data.count)),
            h('div', { style: `width:40px; height:4px; background:var(--border-color, #333); border-radius:2px; overflow:hidden;` },
              h('div', { style: `width:${Math.min(100, data.count * 20)}%; height:100%; background:${getThreatColor(data.maxSeverity)}; border-radius:2px;` }),
            ),
          ),
        ),
      ),
      // Top threats
      h('div', null,
        h('div', { style: 'font-size:10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px; border-top:1px solid var(--border-color, #333); padding-top:8px;' }, 'Top Threats'),
        ...topThreats.map(alert =>
          h('div', { style: `border-left:3px solid ${getThreatColor(alert.severity)}; padding-left:8px; margin-bottom:8px;` },
            h('div', { style: 'display:flex; gap:6px; align-items:center;' },
              h('span', { style: 'font-size:11px; font-weight:500; color:var(--text);' }, alert.subject),
              h('span', { style: `font-size:9px; text-transform:uppercase; color:${getThreatColor(alert.severity)};` }, alert.severity),
            ),
            h('div', { style: 'font-size:10px; color:var(--text-dim); margin-top:2px;' },
              `${alert.matchCount} mentions`,
            ),
          ),
        ),
      ),
    );
  }
}
