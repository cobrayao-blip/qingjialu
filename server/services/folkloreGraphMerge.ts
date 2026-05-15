import { createHash } from 'crypto';
import type { CanonicalGraph, GraphEntity, GraphRelation } from '../../src/graph/folkloreGraphModel';

export type QjlSectionInput = { id: string; month?: string; title: string; content: string };

/** 与 hand-written folklore-graph.v1.json 中 time 节点 id 对齐 */
const MONTH_TO_TIME_ID: Record<string, string> = {
  正月: 'm1',
  二月: 'm2',
  三月: 'm3',
  四月: 'm4',
  五月: 'm5',
  六月: 'm6',
  七月: 'm7',
  八月: 'm8',
  九月: 'm9',
  十月: 'm10',
  十一月: 'm11',
  十二月: 'm12',
};

function shortHash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

function quoteFromContent(content: string, max: number): string {
  const t = (content.split('\n\n')[0] || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function collectSectionIdsFromGraph(graph: CanonicalGraph): Set<string> {
  const set = new Set<string>();
  for (const e of graph.entities) {
    if (e.type !== 'source') continue;
    const sid = typeof e.meta?.sectionId === 'string' ? e.meta.sectionId.trim() : '';
    if (sid) set.add(sid);
  }
  return set;
}

/**
 * 为每条尚未进入图谱的《清嘉录》小节补充：practice + source + occurs_in + documented_in。
 * 仅当对应月份已有 time 节点（m1–m12）时才创建，避免脏数据。
 */
export function mergeQjlSectionsIntoGraph(
  graph: CanonicalGraph,
  sections: QjlSectionInput[]
): { graph: CanonicalGraph; addedPractices: number; skippedNoMonth: number; skippedNoTimeNode: number } {
  const covered = collectSectionIdsFromGraph(graph);
  const entities: GraphEntity[] = [...graph.entities];
  const relations: GraphRelation[] = [...graph.relations];
  const entityIds = new Set(entities.map((e) => e.id));

  let addedPractices = 0;
  let skippedNoMonth = 0;
  let skippedNoTimeNode = 0;

  for (const sec of sections) {
    const sid = sec.id.trim();
    if (!sid || covered.has(sid)) continue;

    const month = typeof sec.month === 'string' ? sec.month.trim() : '';
    if (!month) {
      skippedNoMonth += 1;
      continue;
    }
    const timeId = MONTH_TO_TIME_ID[month];
    if (!timeId || !entityIds.has(timeId)) {
      skippedNoTimeNode += 1;
      continue;
    }

    const h = shortHash(sid);
    const prId = `qjlpr-${h}`;
    const srcId = `qjlsrc-${h}`;
    if (entityIds.has(prId) || entityIds.has(srcId)) {
      covered.add(sid);
      continue;
    }

    const title = (sec.title || '').trim() || sid;
    const practice: GraphEntity = {
      id: prId,
      label: title,
      type: 'practice',
      description: quoteFromContent(sec.content, 220),
    };
    const quote = quoteFromContent(sec.content, 160);
    const source: GraphEntity = {
      id: srcId,
      label: `《清嘉录》·${title}`,
      type: 'source',
      meta: {
        sectionId: sid,
        ...(quote ? { quote } : {}),
      },
    };

    const ev = quote ? `《清嘉录》引文：${quote}` : `《清嘉录》小节：${sid}`;

    entities.push(practice, source);
    entityIds.add(prId);
    entityIds.add(srcId);
    relations.push(
      { source: timeId, target: prId, relationType: 'occurs_in', evidence: ev },
      { source: prId, target: srcId, relationType: 'documented_in', evidence: ev }
    );
    covered.add(sid);
    addedPractices += 1;
  }

  return {
    graph: { entities, relations },
    addedPractices,
    skippedNoMonth,
    skippedNoTimeNode,
  };
}
