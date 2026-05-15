/**
 * 校验 folklore-graph.v1.json 中文献节点 meta.sectionId 是否与 docs/qingjialu/sections.json 对齐。
 * 用法：npm run graph:validate-qjl
 * 退出码：存在「非 qjl- 前缀且不在原文库」的 sectionId 时为 1。
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

type QjlSection = { id: string; title?: string };
type GraphEntity = {
  id: string;
  type: string;
  label?: string;
  meta?: { sectionId?: string };
};

type GraphFile = { entities: GraphEntity[] };

const root = resolve(import.meta.dirname, '../..');
const sectionsPath = resolve(root, 'docs/qingjialu/sections.json');
const graphPath = resolve(root, 'server/data/folklore-graph.v1.json');

const sections = JSON.parse(readFileSync(sectionsPath, 'utf8')) as QjlSection[];
const sectionIdSet = new Set(sections.map((s) => s.id.trim()).filter(Boolean));

const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as GraphFile;

const legacy: { id: string; label: string; sectionId: string }[] = [];
const invalid: { id: string; label: string; sectionId: string }[] = [];
const ok: number[] = [];

for (const e of graph.entities || []) {
  if (e.type !== 'source') continue;
  const sid = typeof e.meta?.sectionId === 'string' ? e.meta.sectionId.trim() : '';
  if (!sid) continue;
  if (/^qjl-/i.test(sid)) {
    legacy.push({ id: e.id, label: e.label || '', sectionId: sid });
    continue;
  }
  if (sectionIdSet.has(sid)) {
    ok.push(1);
    continue;
  }
  invalid.push({ id: e.id, label: e.label || '', sectionId: sid });
}

console.log('《清嘉录》原文小节数:', sectionIdSet.size);
console.log('图谱 source 节点（含 meta.sectionId）:');
console.log('  与 sections.json 对齐:', ok.length);
console.log('  使用 qjl-* 旧式 slug（建议逐步改为真实小节 id）:', legacy.length);
console.log('  无法匹配原文 id（需修正）:', invalid.length);

if (legacy.length) {
  console.log('\n--- qjl-* 文献节点（示例最多 20 条）---');
  for (const row of legacy.slice(0, 20)) {
    console.log(`  ${row.id}\t${row.sectionId}\t${row.label}`);
  }
  if (legacy.length > 20) console.log(`  ... 共 ${legacy.length} 条`);
}

if (invalid.length) {
  console.log('\n--- 无效 sectionId ---');
  for (const row of invalid) {
    console.log(`  ${row.id}\t${row.sectionId}\t${row.label}`);
  }
}

process.exit(invalid.length > 0 ? 1 : 0);
