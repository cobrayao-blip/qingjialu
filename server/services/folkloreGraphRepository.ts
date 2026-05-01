import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { CanonicalGraph } from '../../src/graph/folkloreGraphModel';

let cachedGraph: CanonicalGraph | null = null;

export type FolkloreEvidenceStats = {
  totalRelations: number;
  requiredRelations: number;
  withEvidence: number;
  pending: number;
  coverage: number;
};

function normalizeGraphEvidence(graph: CanonicalGraph): CanonicalGraph {
  const relations = (Array.isArray(graph.relations) ? graph.relations : []).map((r) => {
    const rawEvidence = typeof r.evidence === 'string' ? r.evidence.trim() : '';
    if (r.relationType === 'related_to') {
      return rawEvidence ? { ...r, evidence: rawEvidence } : { ...r };
    }
    // 非 related_to 关系必须可追溯；若缺失证据，统一标为“待考”
    return { ...r, evidence: rawEvidence || '待考' };
  });
  return {
    entities: Array.isArray(graph.entities) ? graph.entities : [],
    relations,
  };
}

function loadGraphFromDisk(): CanonicalGraph {
  const filePath = resolve(process.cwd(), 'server/data/folklore-graph.v1.json');
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw) as CanonicalGraph;
  return normalizeGraphEvidence(data);
}

export function getFolkloreEvidenceStats(graph: CanonicalGraph): FolkloreEvidenceStats {
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const required = relations.filter((r) => r.relationType !== 'related_to');
  const withEvidence = required.filter((r) => (r.evidence || '').trim() && (r.evidence || '').trim() !== '待考').length;
  const pending = required.length - withEvidence;
  return {
    totalRelations: relations.length,
    requiredRelations: required.length,
    withEvidence,
    pending,
    coverage: required.length > 0 ? Number((withEvidence / required.length).toFixed(4)) : 1,
  };
}

export function getFolkloreGraph(): CanonicalGraph {
  if (!cachedGraph) cachedGraph = loadGraphFromDisk();
  return cachedGraph;
}

