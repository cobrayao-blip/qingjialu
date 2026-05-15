/**
 * 图谱模型与合并逻辑冒烟测试（无 Jest 依赖）
 * npm run test:graph
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sliceCanonicalGraphByMonthLabel,
  buildLegacyMonthCustomRoleView,
  listSourceCitationsForEntity,
} from '../../src/graph/folkloreGraphModel';
import { mergeQjlSectionsIntoGraph, collectSectionIdsFromGraph } from '../services/folkloreGraphMerge';

const root = resolve(import.meta.dirname, '../..');
const graphPath = resolve(root, 'server/data/folklore-graph.v1.json');
const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as import('../../src/graph/folkloreGraphModel').CanonicalGraph;

const sub = sliceCanonicalGraphByMonthLabel(graph, '正月');
assert.ok(sub.entities.length > 0, '正月子图应有实体');
const legacy = buildLegacyMonthCustomRoleView(sub);
assert.ok(legacy.nodes.length > 0, 'legacy 视图应有节点');

const ids = collectSectionIdsFromGraph(graph);
assert.ok(ids.size > 0, '应能收集到 sectionId');

const fakeSections = [
  { id: 'test-never-exists-__fake__', month: '正月', title: '测', content: '测。\n\n案：无。' },
];
const { addedPractices } = mergeQjlSectionsIntoGraph(graph, fakeSections);
assert.equal(addedPractices, 1, '应对新小节增加 1 个活动');

const c1 = listSourceCitationsForEntity(graph, 'c1');
assert.ok(Array.isArray(c1), 'c1 文献聚合应为数组');

console.log('graph-model-smoke: ok');
