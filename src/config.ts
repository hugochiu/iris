import 'dotenv/config';

export type UpstreamId = 'primary' | 'alt';

export interface Upstream {
  id: UpstreamId;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface Config {
  port: number;
  openRouterApiKey: string;
  openRouterBaseUrl: string;
  defaultModel: string;
  dbPath: string;
  logPayloads: boolean;
  upstreams: Upstream[];
}

const primaryKey = process.env.OPENROUTER_API_KEY;
if (!primaryKey) {
  throw new Error('OPENROUTER_API_KEY is required');
}
const primaryUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const upstreams: Upstream[] = [
  {
    id: 'primary',
    name: process.env.OPENROUTER_NAME || 'Primary',
    baseUrl: primaryUrl,
    apiKey: primaryKey,
  },
];

const altKey = process.env.OPENROUTER_ALT_API_KEY;
const altUrl = process.env.OPENROUTER_ALT_BASE_URL;
if (altKey && altUrl) {
  upstreams.push({
    id: 'alt',
    name: process.env.OPENROUTER_ALT_NAME || 'Alt',
    baseUrl: altUrl,
    apiKey: altKey,
  });
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  openRouterApiKey: primaryKey,
  openRouterBaseUrl: primaryUrl,
  defaultModel: process.env.DEFAULT_MODEL || 'anthropic/claude-opus-4.6',
  dbPath: process.env.DB_PATH || './data/iris.db',
  logPayloads: process.env.LOG_PAYLOADS !== 'false',
  upstreams,
};
