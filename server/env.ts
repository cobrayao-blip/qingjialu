import 'dotenv/config';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量: ${name}`);
  return v;
}

export const env = {
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || '',
  /** JWT 签名密钥（生产环境必须配置强随机串） */
  JWT_SECRET: (process.env.JWT_SECRET || 'dev-jwt-secret-change-me').trim(),
  /** 首次初始化管理员账号（可选） */
  ADMIN_USERNAME: (process.env.ADMIN_USERNAME || '').trim(),
  ADMIN_PASSWORD: (process.env.ADMIN_PASSWORD || '').trim(),
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  PG_HOST: process.env.PG_HOST || 'localhost',
  PG_PORT: parseInt(process.env.PG_PORT || '5432', 10),
  PG_USER: process.env.PG_USER || 'qingjialu',
  PG_PASSWORD: process.env.PG_PASSWORD || 'qingjialu',
  PG_DATABASE: process.env.PG_DATABASE || 'qingjialu',
};

