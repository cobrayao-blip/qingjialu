import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type { PictureBookPage } from './types';

interface ExportOptions {
  title: string;
  pages: PictureBookPage[];
  width?: number;
  height?: number;
  fallbackSeconds?: number;
}

// 与前端阅读器保持一致：翻页动画 800ms + 额外缓冲 400ms
const PAGE_TURN_LEAD_MS = 1200;
const FLIP_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2047/2047-preview.mp3';

let cachedFfmpegBin: string | null = null;

function resolveFfmpegBinary(): string {
  if (cachedFfmpegBin) return cachedFfmpegBin;
  const candidates: string[] = ['ffmpeg'];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(
      join(
        localAppData,
        'Microsoft',
        'WinGet',
        'Packages',
        'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'ffmpeg-8.1-full_build',
        'bin',
        'ffmpeg.exe'
      )
    );
  }

  const extras = (process.env.FFMPEG_PATH || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of extras) candidates.push(p);

  for (const c of candidates) {
    if (existsSync(c)) {
      cachedFfmpegBin = c;
      return c;
    }
  }
  return 'ffmpeg';
}

function decodeData(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

function normalizeFileName(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'picture-book';
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = resolveFfmpegBinary();
    const proc = spawn(ffmpegBin, ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function writePageAssets(workDir: string, page: PictureBookPage, index: number): Promise<{
  imagePath: string;
  audioPath: string | null;
}> {
  if (!page.imageBase64?.trim()) {
    throw new Error(`第 ${index + 1} 页缺少图片，无法导出 MP4`);
  }
  const imagePath = join(workDir, `page-${index + 1}.png`);
  await fs.writeFile(imagePath, decodeData(page.imageBase64.trim()));

  let audioPath: string | null = null;
  if (page.audioBase64?.trim()) {
    audioPath = join(workDir, `page-${index + 1}.wav`);
    await fs.writeFile(audioPath, decodeData(page.audioBase64.trim()));
  }
  return { imagePath, audioPath };
}

async function createPageSegment(
  imagePath: string,
  audioPath: string | null,
  flipSoundPath: string | null,
  segmentPath: string,
  width: number,
  height: number,
  fallbackSeconds: number,
  pageIndex: number
): Promise<void> {
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`;
  const needsPageTurnLead = pageIndex > 0;
  const narrationDelayMs = needsPageTurnLead ? PAGE_TURN_LEAD_MS : 0;

  if (audioPath) {
    if (needsPageTurnLead) {
      const inputArgs = ['-loop', '1', '-i', imagePath, '-i', audioPath];
      const hasFlipSound = !!flipSoundPath;
      if (hasFlipSound && flipSoundPath) {
        inputArgs.push('-i', flipSoundPath);
      }
      const delayedNarration = `[1:a]adelay=${narrationDelayMs}|${narrationDelayMs}[narr]`;
      const mixChain = hasFlipSound
        ? `${delayedNarration};[2:a]atrim=0:${(PAGE_TURN_LEAD_MS / 1000).toFixed(3)},volume=0.45[flip];[narr][flip]amix=inputs=2:duration=longest:dropout_transition=0[aout]`
        : `${delayedNarration};[narr]anull[aout]`;
      await runFfmpeg([
        ...inputArgs,
        '-filter_complex', mixChain,
        '-map', '0:v:0',
        '-map', '[aout]',
        '-shortest',
        '-vf', scalePad,
        '-r', '30',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-ar', '44100',
        '-movflags', '+faststart',
        segmentPath,
      ]);
      return;
    }

    await runFfmpeg([
      '-loop', '1',
      '-i', imagePath,
      '-i', audioPath,
      '-shortest',
      '-vf', scalePad,
      '-r', '30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-ar', '44100',
      '-movflags', '+faststart',
      segmentPath,
    ]);
    return;
  }

  const silentDuration = fallbackSeconds + (needsPageTurnLead ? PAGE_TURN_LEAD_MS / 1000 : 0);
  await runFfmpeg([
    '-loop', '1',
    '-i', imagePath,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(silentDuration),
    '-shortest',
    '-vf', scalePad,
    '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '44100',
    '-movflags', '+faststart',
    segmentPath,
  ]);
}

export async function exportPictureBookMp4(options: ExportOptions): Promise<{
  filename: string;
  videoBuffer: Buffer;
}> {
  const title = options.title?.trim() || '绘本';
  const pages = options.pages ?? [];
  if (!pages.length) {
    throw new Error('绘本为空，无法导出 MP4');
  }
  const width = options.width && options.width > 0 ? options.width : 1080;
  const height = options.height && options.height > 0 ? options.height : 1920;
  const fallbackSeconds = options.fallbackSeconds && options.fallbackSeconds > 0 ? options.fallbackSeconds : 6;

  const workDir = join(tmpdir(), `pb-export-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    let flipSoundPath: string | null = null;
    try {
      const flipAudioRes = await fetch(FLIP_SOUND_URL);
      if (flipAudioRes.ok) {
        const audioBuf = Buffer.from(await flipAudioRes.arrayBuffer());
        flipSoundPath = join(workDir, 'page-flip.mp3');
        await fs.writeFile(flipSoundPath, audioBuf);
      }
    } catch {
      // 翻页音效下载失败时，降级为仅延时，不中断导出
      flipSoundPath = null;
    }

    const segmentPaths: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const assets = await writePageAssets(workDir, pages[i], i);
      const segmentPath = join(workDir, `segment-${i + 1}.mp4`);
      await createPageSegment(
        assets.imagePath,
        assets.audioPath,
        flipSoundPath,
        segmentPath,
        width,
        height,
        fallbackSeconds,
        i
      );
      segmentPaths.push(segmentPath);
    }

    const concatListPath = join(workDir, 'concat.txt');
    const concatText = segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await fs.writeFile(concatListPath, concatText, 'utf8');

    const outPath = join(workDir, 'output.mp4');
    await runFfmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-r', '30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-ar', '44100',
      '-movflags', '+faststart',
      outPath,
    ]);

    const videoBuffer = await fs.readFile(outPath);
    return {
      filename: `${normalizeFileName(title)}.mp4`,
      videoBuffer,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'MP4 导出失败';
    if (/ENOENT/i.test(msg) || /ffmpeg/i.test(msg)) {
      throw new Error('未检测到 ffmpeg。请先安装 ffmpeg 并确保命令行可执行后再试。');
    }
    throw e;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
