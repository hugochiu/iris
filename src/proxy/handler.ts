import type { Context } from 'hono';
import { runProxy } from './pipeline.js';
import { anthropicAdapter } from './formats/anthropic.js';

export { setLogCallback, setPayloadCallback } from './pipeline.js';
export type { RequestLogData, PayloadLogData } from './pipeline.js';

export function proxyHandler(c: Context) {
  return runProxy(c, anthropicAdapter);
}
