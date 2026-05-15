import type { Response } from 'express';

/** 避免 res.json 因 BigInt 等不可序列化值抛错导致 500 空体或截断响应 */
export function sendJsonSafe(res: Response, status: number, body: unknown): void {
  if (res.headersSent) return;
  try {
    const serialized = JSON.stringify(body, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(serialized);
  } catch (err) {
    if (res.headersSent) return;
    const msg = err instanceof Error ? err.message : String(err);
    res
      .status(500)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ error: '服务器错误', detail: `JSON 序列化失败: ${msg}` }));
  }
}
