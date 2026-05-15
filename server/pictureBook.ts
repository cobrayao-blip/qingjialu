import { requireDashScope, requireDashScopeImage, requireDashScopeTts } from './llmConfig';
import { getLlmConfig } from './db';
import { dashscopeChatJson, dashscopeTextToImage } from './llm/dashscope';
import type { PictureBookPage } from './types';
import { generatePictureBookSpeech } from './tts';

/** 角色行：有/无参考时都放在最前，便于模型建立身份 */
const SCRIPT_ROLE_LINE = '你是一位精通古代苏州民俗的专业儿童绘本作家。';

/**
 * 总体风格 + 文字构思 + JSON 输出说明（无参考时前面会再接一句「根据用户主题创作…」）
 */
const SCRIPT_STYLE_AND_FORMAT = `总体风格要求：
1. 故事氛围要温柔、诗意，适合亲子共读，带一点古典书卷气。
2. 场景围绕古代苏州节令习俗展开，体现江南水乡的意境，例如白墙黛瓦、小桥流水、柳树成荫、荷花盛开等。
3. 旁白气质与插图一致：偏传统水墨/工笔意境，古色古香，色彩柔和不压抑。
4. 三页须是一条连续故事线，有起承转合，避免写成三张互不相关的「风俗明信片」。

文字构思与内容细节（非常重要）：
1. 默认以苏州本地孩童的第一人称或紧贴孩子的视角（「我」与家人、邻里、伙伴），三页同一主角。
2. 每一页的 "description" 为该页 1～2 句中文旁白，**两句合计**约 40～120 字，上口、有节奏，适合朗读。
3. 叙事弧线建议：首页点出节令/习俗与孩童的期待或疑惑；次页写参与或目睹的具体活动（高潮或小波折）；末页温情收束（家人、邻里或心里的一点明白）。可根据摘录灵活调整，但须保持因果连贯。
4. 感官细节：三页中**至少两页**各写一种可感细节（**声音、气味或触觉**择一即可，不必页页都有）。若上文有《清嘉录》摘录，优先从摘录中的器物、饮食、环境里取；禁止为凑条而写时代不符或明显现代的物象。
5. 时节与城市场景随情节自然带出即可；人物身份、动作、情绪不必在每一页机械凑齐「时间＋地点＋身份＋动作＋情绪」。
6. 语体：现代白话为主，可点缀少量古意词与四字格；忌生僻文言与论文腔。**不要用括号或「即……」向读者解释词源**，说明应融进故事。
7. 关于「讲解」与「具体」：
   - **无**《清嘉录》摘录：用场景与细节带出民俗气氛即可，勿写成百科条目。
   - **有**摘录：不做考证口吻，但应**自然带出**摘录中的习俗称呼、器物与做法；可保留一两处原文说法以增强辨识度。
8. 朗读感：善用逗号分节；**末页**最后一句宜落在具体画面或动作上，少用空洞感叹收束。

输出格式与结构要求：
1. 只输出**一个 JSON 对象**（不要 markdown、注释或额外文字），包含字段 "characterLockEn" 与 "pages"。
2. "characterLockEn"：字符串，**一段英文**，锁定全书主角的**长相与发型结构**（年龄、脸型、双髻与发饰、肤色与眼睛）及**基础装束色调**（如袄裙色系、布鞋）；三页须是同一女孩。若故事明显处于**不同季节**，可在此说明「冬暖夏简」：允许外搭棉袄、比甲、斗篷或夏日减层，但须仍是同一人物、同一套色彩体系，禁止每页换一张脸或换成现代装。
3. "pages"：数组，长度必须为 3，三页组成完整短篇故事。每项字段：
   - "title": 该页标题，简短有力，富有古意。
   - "description": 1～2 句中文旁白，符合上文文字构思要求。
   - "imagePrompt"：**仅英文**，写本页的**场景、动作、镜头、环境、光影、时节或天气**（如 midwinter snow、dog days of summer）与配角；**不要**细写主角发型或衣料颜色（避免与锁定块冲突）；若需体现寒暑，用环境与活动暗示即可。须与当页 description 同一习俗动作与时代氛围，并体现 ancient Suzhou、traditional Chinese painting style。**禁止**空调、汽车、塑料玩具、现代泳装派对等；画面无文字。

JSON 结构示意（禁止照搬占位情节；若有《清嘉录》摘录须服从摘录）：
{"characterLockEn":"Same 6-year-old Suzhou girl throughout: same face and twin loop buns with red silk bands; base outfit apricot jacket and indigo skirt; winter panels may add plain padded vest, summer may show lighter sleeves — still one girl, one palette.","pages":[
  {"title":"…","description":"…","imagePrompt":"camera, action, setting, season or weather, lighting; same protagonist as characterLockEn"},
  {"title":"…","description":"…","imagePrompt":"…"},
  {"title":"…","description":"…","imagePrompt":"…"}
]}`;

/** 无《清嘉录》摘录时的完整用户侧说明 */
const SCRIPT_PROMPT_FREE_TOPIC = `${SCRIPT_ROLE_LINE}

根据用户的一句话主题，创作一部关于古代苏州民间风俗的儿童绘本故事。

${SCRIPT_STYLE_AND_FORMAT}`;

/** 有摘录时：流程与摘录置于角色之后、风格条款之前 */
const SCRIPT_REFERENCE_INTRO = `【写作流程】
请先完整阅读下文《清嘉录》原文摘录，再撰写恰好三页的绘本故事。摘录中的民俗事实、专名与核心做法为剧情的最高优先级，优于任何文学套式或泛化节令描写。

【《清嘉录》原文摘录】`;

const SCRIPT_ANCHOR_WHEN_REFERENCE = `【关于上文摘录的硬约束（优先于下文「文字构思」中与之冲突的表述）】
1. 三页须围绕摘录中的民俗事实、人物行为、器物与专有称呼展开；允许儿童化、口语化，不得改写成与摘录明显矛盾的情节。
2. 若摘录含多条：三页须有机串联或分承，分别体现不同摘录的要点；禁止只选其中最泛化的一条，再用与摘录无关的套路（例如仅写「夏天乘凉消暑」）敷衍其余条目。
3. 摘录未写到的情节与器物，不要随意冒充「文献如此记载」；若作生活化虚构，须与摘录时代、地域氛围相容。
4. 三页 description 合起来，须自然体现至少 3～5 个来自摘录的具体信息点（专名、饮食、活动、器物、俗语说法等）；语义须与摘录一致，可改为儿童能懂的白话，禁止整体偷换为摘录未写的另一套习俗。
5. 若摘录在逻辑上只对应一条核心习俗：三页都应让读者感到与这一条紧密相关（起承转合可设计孩童视角与对话，但事件骨架不得架空为无关节令）。
6. 重申：禁止用泛泛的夏日纳凉、冷饮贪凉、空调式联想等占据某一页的主体，除非摘录明确出现类似内容。`;

function buildScriptPrompt(topic: string, folkloreContext?: string): string {
  const fc = folkloreContext?.trim();
  const topicLine = `用户的一句话（主题/灵感）：${topic}`;
  if (fc) {
    return [
      SCRIPT_ROLE_LINE,
      '',
      SCRIPT_REFERENCE_INTRO,
      fc,
      '',
      SCRIPT_ANCHOR_WHEN_REFERENCE,
      '',
      SCRIPT_STYLE_AND_FORMAT,
      '',
      topicLine,
      '请根据摘录与以上全部要求，只输出符合格式的 JSON 对象（含 characterLockEn 与 pages）：',
    ].join('\n');
  }
  return `${SCRIPT_PROMPT_FREE_TOPIC}\n\n${topicLine}\n请根据以上主题，只输出符合格式的 JSON 对象（含 characterLockEn 与 pages）：`;
}

// 统一的图像风格前缀，融合中英文描述，借鉴 szmshb 的增强 prompt
const IMAGE_STYLE =
  '中国传统水墨画或工笔画风格，中国风绘本插画，柔和色彩，适合儿童，古典苏州民俗场景，无文字。' +
  '苏州民居请画成白墙黛瓦、小桥流水的江南风格，不要画成粉色或彩色外墙。' +
  '\n' +
  'Traditional Chinese painting style, ancient Suzhou scenery, white walls and dark grey tiles (Jiangnan water town style), small bridges and flowing water, delicate brushwork, soft colors, elegant atmosphere, high quality, masterpiece. Do NOT paint pink walls or brightly colored facades.';

/** 三页插图共用的主角视觉锚定（英文）；与 characterLockEn 合并使用，减轻「每页一张脸」漂移 */
const FIXED_PROTAGONIST_VISUAL_ANCHOR_EN = `The SAME child protagonist identity in every panel — do not change age, facial structure, eye shape, or hairstyle layout (two symmetrical looped buns with thin red silk cords; late-imperial Jiangnan children's look, not modern cosplay): a Chinese girl about 6–7 years old, soft round face, warm natural skin tone, dark almond-shaped eyes, neat dark hair, simple cloth shoes, very light jewelry if any.

Season and weather: Inner silhouette and base palette stay one coherent character (soft warm neutrals with muted indigo or grey-blue skirt accents). You MAY add or remove outer layers logically per panel when the story implies cold, heat, or rain — e.g. plain padded short coat or collar wrap in winter, lighter sleeves or rolled cuffs in summer, thin cloak in drizzle — but do NOT turn her into a different person, randomize unrelated colors each page, or use modern clothing. Pose, expression, and background may always change.`;

const CHARACTER_LOCK_MARKER = 'CHARACTER CONSISTENCY';

function buildCharacterLockParagraph(characterLockEn?: string): string {
  const extra = (characterLockEn || '').trim();
  if (extra) {
    return `${CHARACTER_LOCK_MARKER} — ${FIXED_PROTAGONIST_VISUAL_ANCHOR_EN}\nStory-specific protagonist details (must still match above): ${extra}`;
  }
  return `${CHARACTER_LOCK_MARKER} — ${FIXED_PROTAGONIST_VISUAL_ANCHOR_EN}`;
}

/** 存入 page.imagePrompt 的完整英文插图主体（不含 IMAGE_STYLE），含锁定 + 本页场景 */
export function wrapScenePromptWithCharacterLock(sceneImagePrompt: string, characterLockEn?: string): string {
  const scene = sceneImagePrompt.trim();
  const lock = buildCharacterLockParagraph(characterLockEn);
  if (!scene) return lock;
  return `${lock}\n\nScene (this page only; same protagonist as above): ${scene}`;
}

/**
 * 拼最终文生图 user 文案：旧绘本可能只存了「场景」英文，自动补上主角锁定块，避免重绘时漂移更大。
 */
export function buildPictureBookImageApiPrompt(storedImagePromptFragment: string): string {
  const raw = (storedImagePromptFragment || '').trim();
  const body = raw.includes(CHARACTER_LOCK_MARKER)
    ? raw
    : wrapScenePromptWithCharacterLock(raw, undefined);
  return `${IMAGE_STYLE}\n${body}`;
}

export interface GeneratePictureBookParams {
  topic: string;
  generateImage?: boolean;
  /** 民俗参考文案（如月份概要+习俗），用于丰富剧本依据 */
  folkloreContext?: string;
}

interface ScriptPage {
  title: string;
  description: string;
  imagePrompt: string;
}

function normalizeScriptPages(rawPages: unknown): ScriptPage[] {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new Error('剧本格式错误，请重试');
  }
  const normalized: ScriptPage[] = rawPages.slice(0, 3).map((s) => {
    const raw = (s || {}) as Record<string, unknown>;
    const description =
      typeof raw.description === 'string'
        ? raw.description
        : typeof raw.text === 'string'
          ? raw.text
          : '';
    return {
      title: typeof raw.title === 'string' ? raw.title : '',
      description,
      imagePrompt: typeof raw.imagePrompt === 'string' ? raw.imagePrompt : '',
    };
  });
  return normalized.filter((p) => p.description && p.description.trim().length > 0);
}

function parseScriptJsonPayload(raw: unknown): { characterLockEn?: string; pages: ScriptPage[] } {
  if (Array.isArray(raw)) {
    return { pages: normalizeScriptPages(raw) };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const pagesRaw = o.pages;
    if (Array.isArray(pagesRaw)) {
      let cl = typeof o.characterLockEn === 'string' ? o.characterLockEn.trim() : '';
      if (cl.length > 480) cl = `${cl.slice(0, 480)}…`;
      return {
        characterLockEn: cl || undefined,
        pages: normalizeScriptPages(pagesRaw),
      };
    }
  }
  throw new Error('剧本格式错误，请重试');
}

export async function generatePictureBookScript(
  topic: string,
  folkloreContext?: string,
): Promise<{ characterLockEn?: string; pages: ScriptPage[] }> {
  const apiKey = requireDashScope();
  const llm = getLlmConfig();
  const modelText = llm?.model_text?.trim() ?? '';
  const rawUrlText = llm?.url_text?.trim() ?? '';
  // 与其他接口保持一致：URL 为空时默认走 DashScope OpenAI 兼容模式
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (!urlText || !modelText) {
    throw new Error('请先在「大模型配置」→ 文本模型中填写模型名称与 API Key（文本模型用于生成绘本剧本）。');
  }
  const hasReference = Boolean(folkloreContext?.trim());
  const scriptSystem = hasReference
    ? '你只输出合法 JSON：优先为对象，含字符串字段 characterLockEn 与数组 pages（3 项）；每项含 title、description、imagePrompt 字符串。不要 markdown。若用户消息含《清嘉录》摘录，三页中文须与摘录一致。兼容：若只能输出数组，则输出 3 项页对象（无 characterLockEn）。'
    : '你只输出合法 JSON：优先为对象，含 characterLockEn 与 pages（长度 3）；每项含 title、description、imagePrompt。不要 markdown。兼容：可仅输出 3 项页组成的数组。';
  const scriptRaw = await dashscopeChatJson<unknown>(
    apiKey,
    scriptSystem,
    buildScriptPrompt(topic, folkloreContext),
    modelText,
    urlText
  );
  const parsed = parseScriptJsonPayload(scriptRaw);
  if (parsed.pages.length !== 3) {
    throw new Error('剧本格式错误，请重试（需要正好 3 页内容）');
  }
  return parsed;
}

export async function generatePictureBook(params: GeneratePictureBookParams): Promise<{
  title: string;
  topic: string;
  pages: PictureBookPage[];
}> {
  const llm = getLlmConfig();
  const modelText = llm?.model_text?.trim() ?? '';
  const rawUrlText = llm?.url_text?.trim() ?? '';
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelImage = llm?.model_image?.trim() ?? '';
  const imageApiUrl = llm?.url_image?.trim() ?? '';

  if (!urlText || !modelText) {
    throw new Error('生成绘本需要先配置「文本模型」（用于写剧本）。请打开「大模型配置」→ 文本模型，填写 URL 与模型名称。');
  }
  if (params.generateImage !== false && (!modelImage || !imageApiUrl)) {
    throw new Error('生成绘本需要先配置「图像模型」（用于插图）。请打开「大模型配置」→ 图像模型，填写 URL 与模型名称。');
  }

  const imageApiKey =
    params.generateImage !== false && modelImage && imageApiUrl ? requireDashScopeImage() : '';
  const ttsApiKey = requireDashScopeTts();
  const { characterLockEn, pages: scriptPages } = await generatePictureBookScript(
    params.topic,
    params.folkloreContext,
  );
  const pages: PictureBookPage[] = [];

  for (let i = 0; i < scriptPages.length; i++) {
    const page = scriptPages[i];
    const text = (page?.description ?? '').trim();
    let imageBase64: string | undefined;
    let audioBase64: string | undefined;
    const title = (page?.title ?? '').trim();
    const sceneEn =
      (page?.imagePrompt && page.imagePrompt.trim()) || `${params.topic} ${text.slice(0, 40)}`;
    const storedImageBody = wrapScenePromptWithCharacterLock(sceneEn, characterLockEn);

    if (params.generateImage !== false && modelImage && imageApiUrl && imageApiKey) {
      try {
        const prompt = buildPictureBookImageApiPrompt(storedImageBody);
        imageBase64 = await dashscopeTextToImage(imageApiKey, prompt, {
          size: '1024*1024',
          n: 1,
          model: modelImage,
          imageApiUrl,
        });
      } catch (e) {
        console.warn('该页插图生成失败，将仅保留文字:', e);
      }
    }

    // 语音合成（按页生成并入库），失败不影响文字和图片
    try {
      const modelTts = llm?.model_tts?.trim() ?? '';
      const urlTts = llm?.url_tts?.trim() ?? '';
      const voiceTts = llm?.voice_tts?.trim() ?? '';
      if (urlTts && ttsApiKey) {
        const defaultInstructions =
          '请使用一种温润、细腻、亲切的女性嗓音进行朗读，语速稍慢，吐字清晰，停顿自然。整体气质要带有江南水乡的典雅与柔和，情感饱满但克制，不夸张、不煽情，仿佛一位温柔的大姐姐在枕畔给孩子轻声讲故事。';
        const result = await generatePictureBookSpeech(text, {
          url: urlTts,
          model: modelTts || 'qwen3-tts-instruct-flash',
          apiKey: ttsApiKey,
          instructions: voiceTts || defaultInstructions,
        });
        if (result?.audioBase64) {
          audioBase64 = result.audioBase64;
        }
      }
    } catch (e) {
      console.warn('该页语音合成失败，将仅保留文字与图片:', e);
    }
    pages.push({
      text,
      imageBase64,
      title,
      imagePrompt: storedImageBody,
      audioBase64,
    });
  }

  const title = `《清嘉录》· ${params.topic}`;
  return { title, topic: params.topic, pages };
}

/** 为单页重新生成插图（提示词拼装与整本生成循环内逻辑一致） */
export async function generatePictureBookPageImage(params: {
  topic: string;
  text: string;
  imagePrompt?: string;
}): Promise<string> {
  const llm = getLlmConfig();
  const modelImage = llm?.model_image?.trim() ?? '';
  const imageApiUrl = llm?.url_image?.trim() ?? '';
  if (!modelImage || !imageApiUrl) {
    throw new Error('请先在「大模型配置」→ 图像模型中填写 URL 与模型名称。');
  }
  const imageApiKey = requireDashScopeImage();
  const text = params.text.trim();
  const basePrompt =
    (params.imagePrompt && params.imagePrompt.trim()) ||
    `${params.topic} ${text.slice(0, 40)}`;
  const prompt = buildPictureBookImageApiPrompt(basePrompt);
  return dashscopeTextToImage(imageApiKey, prompt, {
    size: '1024*1024',
    n: 1,
    model: modelImage,
    imageApiUrl,
  });
}
