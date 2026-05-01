import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import api, { handleRegeneratePictureBookPageImage, requireApiAdmin, requireApiUser } from './routes/api';
import { getDashScopeApiKeyImage } from './llmConfig';
import { getLlmConfig, initDb } from './db';
import { dashscopeTextToImage } from './llm/dashscope';

const app = express();
app.use(cors());
// 绘本保存含多页 base64 图，需放宽 body 限制；若仍 413，请检查前置 Nginx/负载均衡的 client_max_body_size
app.use(express.json({ limit: '100mb' }));

// 图像大模型连接测试：在入口直接注册，避免 404（GET 便于浏览器直接验证）
app.get('/api/config/llm/testimage', (req, res) => {
  if (!requireApiAdmin(req, res)) return;
  res.json({ ok: true, message: 'image test endpoint, use POST to test' });
});
app.post('/api/config/llm/testimage', async (req, res) => {
  if (!requireApiAdmin(req, res)) return;
  try {
    const { apiKey, modelImage: bodyModel, url: bodyUrl } = req.body || {};
    const keyToTest = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getDashScopeApiKeyImage();
    if (!keyToTest) {
      return res.status(400).json({ ok: false, error: '请先填写 API Key 或保存后再测试' });
    }
    const cfg = getLlmConfig();
    const model = (typeof bodyModel === 'string' && bodyModel.trim()) ? bodyModel.trim() : (cfg?.model_image ?? '');
    const imageApiUrl = (typeof bodyUrl === 'string' && bodyUrl.trim()) ? bodyUrl.trim() : (cfg?.url_image?.trim() ?? '');
    if (!imageApiUrl) return res.status(400).json({ ok: false, error: '请先配置图像模型的 URL' });
    if (!model) return res.status(400).json({ ok: false, error: '请先配置图像模型名称' });
    await dashscopeTextToImage(keyToTest, '一只小猫', { size: '1024*1024', n: 1, model, imageApiUrl });
    res.json({ ok: true, message: '连接成功' });
  } catch (e) {
    console.error('LLM image test error:', e);
    res.status(200).json({
      ok: false,
      error: e instanceof Error ? e.message : '连接失败',
    });
  }
});

// 绘本单页插图重生成：挂在 app 根上，确保 POST 一定命中（与 router 内路由并存，行为一致）
app.post('/api/picture-book/regenerate-page-image', (req, res) => {
  if (!requireApiUser(req, res)) return;
  return handleRegeneratePictureBookPageImage(req, res);
});
app.post('/api/picture-book/page-image', (req, res) => {
  if (!requireApiUser(req, res)) return;
  return handleRegeneratePictureBookPageImage(req, res);
});

app.use('/api', api);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// 未匹配时的 404，便于确认请求是否到达以及路径
app.use((req, res) => {
  console.log('[server] 404', req.method, req.originalUrl || req.url);
  res.status(404).json({ error: 'Not found', path: req.originalUrl || req.url, method: req.method });
});

initDb()
  .then(() => {
    app.listen(env.PORT, '0.0.0.0', () => {
      console.log(`[server] http://0.0.0.0:${env.PORT}`);
      console.log('[server] POST /api/config/llm/testimage registered (v2)');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
