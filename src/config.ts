import 'dotenv/config';

export interface Config {
  port: number;
  openRouterApiKey: string;
  openRouterBaseUrl: string;
  defaultModel: string;
  dbPath: string;
  logPayloads: boolean;
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error('OPENROUTER_API_KEY is required');
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  openRouterApiKey: apiKey,
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  defaultModel: process.env.DEFAULT_MODEL || 'anthropic/claude-opus-4.6',
  dbPath: process.env.DB_PATH || './data/iris.db',
  logPayloads: process.env.LOG_PAYLOADS !== 'false',
};
