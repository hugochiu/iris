import { Hono } from 'hono';
import { summaryHandler } from './summary.js';
import { timeseriesHandler } from './timeseries.js';
import { byModelHandler } from './by-model.js';
import { logsListHandler, logDetailHandler } from './logs.js';

export const statsRoutes = new Hono();

statsRoutes.get('/stats/summary', summaryHandler);
statsRoutes.get('/stats/timeseries', timeseriesHandler);
statsRoutes.get('/stats/by-model', byModelHandler);
statsRoutes.get('/logs', logsListHandler);
statsRoutes.get('/logs/:requestId', logDetailHandler);
