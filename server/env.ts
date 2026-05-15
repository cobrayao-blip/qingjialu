import 'dotenv/config';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量: ${name}`);
  return v;
}

/** Windows 下 `localhost` 可能优先解析到 ::1，而本机 PostgreSQL 只监听 127.0.0.1，导致连接被拒绝。 */
function normalizePgHost(host: string): string {
  const h = host.trim();
  if (process.platform === 'win32' && (h === 'localhost' || h === '::1')) {
    return '127.0.0.1';
  }
  return h;
}

function nonEmptyOr(defaultVal: string, raw: string | undefined): string {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : defaultVal;
}

export const env = {
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || '',
  /** JWT 签名密钥（生产环境必须配置强随机串；勿设为仅空格，否则 trim 后为空会致 jwt.sign 抛错→登录 500） */
  JWT_SECRET: nonEmptyOr('dev-jwt-secret-change-me', process.env.JWT_SECRET),
  /** 首次初始化管理员账号（可选） */
  ADMIN_USERNAME: (process.env.ADMIN_USERNAME || '').trim(),
  ADMIN_PASSWORD: (process.env.ADMIN_PASSWORD || '').trim(),
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  PG_HOST: normalizePgHost(process.env.PG_HOST || 'localhost'),
  PG_PORT: parseInt(process.env.PG_PORT || '5432', 10),
  PG_USER: process.env.PG_USER || 'qingjialu',
  PG_PASSWORD: process.env.PG_PASSWORD || 'qingjialu',
  PG_DATABASE: process.env.PG_DATABASE || 'qingjialu',
};

