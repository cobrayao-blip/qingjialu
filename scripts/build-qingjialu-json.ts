import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 从 `docs/qingjialu/清嘉录正文-带标题.md` 生成结构化 JSON：
 * - 以 `## 卷X 某月` 作为卷 / 月份
 * - 以 `### 小标题` 作为一个 section
 * - section 的内容为该小标题到下一个标题（`##` 或 `###`）之间的正文
 *
 * 输出文件：`docs/qingjialu/sections.json`
 */

interface QingJiaLuSection {
  id: string;
  juan: string;
  month?: string;
  title: string;
  content: string;
}

const INPUT_MD = 'docs/qingjialu/清嘉录正文-带标题.md';
const OUTPUT_JSON = 'docs/qingjialu/sections.json';

function slugifyChinese(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\-]/g, '')
    .toLowerCase();
}

function main() {
  const inputPath = resolve(process.cwd(), INPUT_MD);
  const outputPath = resolve(process.cwd(), OUTPUT_JSON);

  const raw = readFileSync(inputPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const sections: QingJiaLuSection[] = [];

  let currentJuan = '';
  let currentMonth: string | undefined;

  let currentTitle: string | null = null;
  let currentContentLines: string[] = [];

  const flushSection = () => {
    if (!currentTitle) return;
    const baseIdParts = [];
    if (currentJuan) baseIdParts.push(slugifyChinese(currentJuan));
    if (currentMonth) baseIdParts.push(slugifyChinese(currentMonth));
    baseIdParts.push(slugifyChinese(currentTitle));
    const id = baseIdParts.filter(Boolean).join('__') || slugifyChinese(currentTitle);

    const content = currentContentLines.join('\n').trim();
    sections.push({
      id,
      juan: currentJuan,
      month: currentMonth,
      title: currentTitle,
      content,
    });

    currentTitle = null;
    currentContentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // 卷标题：## 卷一 正月
    if (trimmed.startsWith('## ')) {
      flushSection();
      const juanText = trimmed.replace(/^##\s*/, '').trim();
      currentJuan = juanText;

      // 从卷标题中尝试提取月份（卷一 正月 / 卷二 二月）
      const m = juanText.match(/^卷[一二三四五六七八九十百零两]+\s+(.+)$/);
      currentMonth = m ? m[1].trim() : undefined;
      continue;
    }

    // 小节标题：### 行春
    if (trimmed.startsWith('### ')) {
      flushSection();
      currentTitle = trimmed.replace(/^###\s*/, '').trim();
      currentContentLines = [];
      continue;
    }

    // 其它行：正文，归入当前 section
    if (currentTitle) {
      currentContentLines.push(line);
    }
  }

  // 文件结束，冲刷最后一个 section
  flushSection();

  writeFileSync(outputPath, JSON.stringify(sections, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`已生成 ${sections.length} 条节选到 ${OUTPUT_JSON}`);
}

main();

