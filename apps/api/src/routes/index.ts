/**
 * v1 路由注册：/api/v1/*
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { registerHealthRoutes } from './health.js';
import { registerAuthRoutes } from './auth.js';
import { registerCourseRoutes } from './courses.js';
import { registerLessonRoutes } from './lessons.js';
import { registerMediaRoutes } from './media.js';
import { registerUserRoutes } from './users.js';
import { registerProgressRoutes } from './progress.js';
import { registerBankRoutes } from './banks.js';
import { registerQuestionConflictRoutes } from './questionConflicts.js';
import { registerDifficultyRoutes } from './difficulty.js';
import { registerPaperRoutes } from './paper.js';
import { registerQuizRoutes } from './quiz.js';
import { registerExamRoutes } from './exams.js';
import { registerNoteRoutes, registerStatsRoutes } from './stats.js';
import { registerAnalyticsRoutes } from './analytics.js';

export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(
    async (v1) => {
      await registerHealthRoutes(v1, deps);
      await registerAuthRoutes(v1, deps);
      await registerCourseRoutes(v1, deps);
      await registerLessonRoutes(v1, deps);
      await registerMediaRoutes(v1, deps);
      await registerUserRoutes(v1, deps);
      await registerProgressRoutes(v1, deps);
      await registerBankRoutes(v1, deps);
      await registerQuestionConflictRoutes(v1, deps);
      await registerDifficultyRoutes(v1, deps);
      await registerPaperRoutes(v1, deps);
      await registerQuizRoutes(v1, deps);
      await registerExamRoutes(v1, deps);
      await registerStatsRoutes(v1, deps);
      await registerAnalyticsRoutes(v1, deps);
      await registerNoteRoutes(v1, deps);
    },
    { prefix: '/api/v1' },
  );
}
