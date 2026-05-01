import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 将 `docs/qingjialu/清嘉录正文.md` 中的结构化小标题，自动加上 Markdown 标题标记。
 *
 * 规则：
 * - 第一行完全是「清嘉录」 => `# 清嘉录`
 * - 形如「卷一 正月」「卷二 二月」等 => `## 卷一 正月`
 * - 其它小标题（如「行春」「打春」「拜春」「拜牌」等）：
 *   - 本行不含标点符号与空格
 *   - 本行长度不超过 8 个字符
 *   - 下一行存在，且包含句号/顿号等正文标点
 *   => 加 `### `
 *
 * 为避免误伤，已是以 `#` 开头的行会被跳过。
 */

const INPUT_REL = 'docs/qingjialu/清嘉录正文.md';
const OUTPUT_REL = 'docs/qingjialu/清嘉录正文-带标题.md';

function main() {
  const inputPath = resolve(process.cwd(), INPUT_REL);
  const outputPath = resolve(process.cwd(), OUTPUT_REL);

  const raw = readFileSync(inputPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const punctPattern = /[，。、：；？！“”‘’《》…\s]/;
  const nextLineBodyPattern = /[。；？！：]/;

  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // 已经是标题，直接保留
    if (trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }

    // 第一行「清嘉录」
    if (i === 0 && trimmed === '清嘉录') {
      out.push('# 清嘉录');
      continue;
    }

    // 卷标题：卷一 正月 / 卷二 二月 / ...
    if (/^卷[一二三四五六七八九十]+(\s+.+)?$/.test(trimmed)) {
      out.push(`## ${trimmed}`);
      continue;
    }

    // 可能是小节标题（如「行春」「打春」「岁朝」等）
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const looksLikeSectionTitle =
      trimmed.length > 0 &&
      trimmed.length <= 8 &&
      !punctPattern.test(trimmed) &&
      next.length > 0 &&
      nextLineBodyPattern.test(next);

    if (looksLikeSectionTitle) {
      out.push(`### ${trimmed}`);
      continue;
    }

    // 其它行原样输出
    out.push(line);
  }

  writeFileSync(outputPath, out.join('\n'), 'utf8');
  // 简单控制台提示，方便在终端查看
  // eslint-disable-next-line no-console
  console.log(`已生成带标题版本：${OUTPUT_REL}`);
}

main();

