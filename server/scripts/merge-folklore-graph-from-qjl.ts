/**
 * 命令行：将《清嘉录》全本小节合并进图谱 JSON。
 * npm run graph:merge-from-qjl -- --dry-run
 * npm run graph:merge-from-qjl -- --apply
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { CanonicalGraph } from '../../src/graph/folkloreGraphModel';
import { getAllSections } from '../qingjialuSource';
import { mergeQjlSectionsIntoGraph } from '../services/folkloreGraphMerge';
import { writeFolkloreGraphFile } from '../services/folkloreGraphRepository';

const root = resolve(import.meta.dirname, '../..');
const graphPath = resolve(root, 'server/data/folklore-graph.v1.json');

const args = process.argv.slice(2);
const wantsApply = args.includes('--apply');

const raw = readFileSync(graphPath, 'utf8');
const base = JSON.parse(raw) as CanonicalGraph;
const sections = getAllSections();
const { graph: merged, addedPractices, skippedNoMonth, skippedNoTimeNode } = mergeQjlSectionsIntoGraph(
  base,
  sections
);

console.log('原文小节:', sections.length);
console.log('新增活动节点:', addedPractices);
console.log('跳过（无月份）:', skippedNoMonth);
console.log('跳过（缺对应时令节点）:', skippedNoTimeNode);
console.log('合并后 entities:', merged.entities.length, 'relations:', merged.relations.length);

if (!wantsApply) {
  console.log('\n未写入磁盘。若要写入请执行: npm run graph:merge-from-qjl -- --apply');
  process.exit(0);
}

writeFolkloreGraphFile(merged);
console.log('\n已写入', graphPath);
process.exit(0);
