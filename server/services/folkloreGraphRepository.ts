import { createHash } from 'crypto';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { CanonicalGraph } from '../../src/graph/folkloreGraphModel';

const GRAPH_DATA_FILE = 'server/data/folklore-graph.v1.json';

export type FolkloreGraphBundleMeta = {
  schemaVersion: 1;
  /** 相对仓库根目录的数据文件路径（便于 Docker/部署对照） */
  dataFile: string;
  /** 原始 JSON 文件的 SHA-256（完整 64 位 hex，供版本对齐与审计） */
  contentSha256: string;
  fileMtimeMs: number;
  entityCount: number;
  relationCount: number;
};

type Cache = { graph: CanonicalGraph; meta: FolkloreGraphBundleMeta };

let cache: Cache | null = null;

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

function loadGraphFromDisk(): Cache {
  const filePath = resolve(process.cwd(), GRAPH_DATA_FILE);
  const raw = readFileSync(filePath, 'utf8');
  const stat = statSync(filePath);
  const contentSha256 = createHash('sha256').update(raw, 'utf8').digest('hex');
  const data = JSON.parse(raw) as CanonicalGraph;
  const graph = normalizeGraphEvidence(data);
  return {
    graph,
    meta: {
      schemaVersion: 1,
      dataFile: GRAPH_DATA_FILE,
      contentSha256,
      fileMtimeMs: Math.floor(stat.mtimeMs),
      entityCount: graph.entities.length,
      relationCount: graph.relations.length,
    },
  };
}

function ensureCache(): Cache {
  if (!cache) cache = loadGraphFromDisk();
  return cache;
}

/** 丢弃内存缓存，下次读取时从磁盘重新加载（更新 JSON 后无需重启进程） */
export function reloadFolkloreGraphCache(): FolkloreGraphBundleMeta {
  cache = null;
  return ensureCache().meta;
}

/** 将 canonical 图写回磁盘并清空缓存（下次读取时重新规范化 evidence） */
export function writeFolkloreGraphFile(graph: CanonicalGraph): FolkloreGraphBundleMeta {
  const filePath = resolve(process.cwd(), GRAPH_DATA_FILE);
  writeFileSync(filePath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  cache = null;
  return ensureCache().meta;
}

export function getFolkloreGraphMeta(): FolkloreGraphBundleMeta {
  return ensureCache().meta;
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
  return ensureCache().graph;
}

