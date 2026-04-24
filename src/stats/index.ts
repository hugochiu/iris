import { Hono } from 'hono';
import { summaryHandler } from './summary.js';
import { timeseriesHandler } from './timeseries.js';
import { byModelHandler } from './by-model.js';
import { logsListHandler, logDetailHandler } from './logs.js';
import { sessionsListHandler, sessionDetailHandler } from './sessions.js';
import {
  getModelsHandler,
  updateModelsHandler,
  listOpenRouterModelsHandler,
  getProviderRoutingHandler,
  updateProviderRoutingHandler,
  listOpenRouterProvidersHandler,
} from './settings.js';

export const statsRoutes = new Hono();

statsRoutes.get('/stats/summary', summaryHandler);
statsRoutes.get('/stats/timeseries', timeseriesHandler);
statsRoutes.get('/stats/by-model', byModelHandler);
statsRoutes.get('/stats/sessions', sessionsListHandler);
statsRoutes.get('/stats/sessions/:sessionId', sessionDetailHandler);
statsRoutes.get('/logs', logsListHandler);
statsRoutes.get('/logs/:requestId', logDetailHandler);
statsRoutes.get('/settings/models', getModelsHandler);
statsRoutes.post('/settings/models', updateModelsHandler);
statsRoutes.get('/settings/openrouter-models', listOpenRouterModelsHandler);
statsRoutes.get('/settings/provider-routing', getProviderRoutingHandler);
statsRoutes.post('/settings/provider-routing', updateProviderRoutingHandler);
statsRoutes.get('/settings/openrouter-providers', listOpenRouterProvidersHandler);
