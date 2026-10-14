/**
 * 应用装配：依赖注入（DB → 仓储 → 服务）、插件、钩子、路由。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import fs from 'node:fs';

import type { AppConfig } from './config/env.js';
import { loggerOptions } from './logger.js';
import { openDb, type Db } from './db/client.js';
import { runMigrations, type MigrateResult } from './db/migrations.js';
import { UserRepository } from './db/repositories/userRepository.js';
import { SettingsRepository } from './db/repositories/settingsRepository.js';
import { AuditRepository } from './db/repositories/auditRepository.js';
import { CourseRepository } from './db/repositories/courseRepository.js';
import { LessonRepository } from './db/repositories/lessonRepository.js';
import { ProgressRepository } from './db/repositories/progressRepository.js';
import { BankRepository } from './db/repositories/bankRepository.js';
import { QuestionRepository } from './db/repositories/questionRepository.js';
import { QuestionConflictRepository } from './db/repositories/questionConflictRepository.js';
import { AttemptRepository, WrongQuestionRepository } from './db/repositories/attemptRepository.js';
import { ExamRepository } from './db/repositories/examRepository.js';
import { QuestionStatsRepository } from './db/repositories/questionStatsRepository.js';
import { AnalyticsRepository } from './db/repositories/analyticsRepository.js';
import { AnalyticsService } from './services/analyticsService.js';
import { NoteRepository, StatsRepository } from './db/repositories/noteRepository.js';
import { WatchIntervalRepository } from './db/repositories/watchIntervalRepository.js';
import { SessionSigner } from './security/session.js';
import { AuthService } from './services/authService.js';
import { CourseService } from './services/courseService.js';
import { LessonService } from './services/lessonService.js';
import { MediaRootService } from './services/mediaRootService.js';
import { StorageService } from './services/storageService.js';
import { QuestionMediaStore } from './services/questionMediaStore.js';
import { BankService } from './services/bankService.js';
import { QuestionConflictService } from './services/questionConflictService.js';
import { DifficultyService } from './services/difficultyService.js';
import { QuizService } from './services/quizService.js';
import { ExamService } from './services/examService.js';
import { StatsService } from './services/statsService.js';
import { NoteService } from './services/noteService.js';
import { MediaProbeService } from './services/mediaProbeService.js';
import path from 'node:path';
import { registerAuth } from './http/guards.js';
import { registerOriginCheck } from './http/csrf.js';
import { registerErrorHandler, registerRequestContext } from './http/errors.js';
import { registerRoutes } from './routes/index.js';

export interface Deps {
  config: AppConfig;
  db: Db;
  users: UserRepository;
  settings: SettingsRepository;
  audit: AuditRepository;
  courses: CourseRepository;
  lessons: LessonRepository;
  progress: ProgressRepository;
  banks: BankRepository;
  questions: QuestionRepository;
  attempts: AttemptRepository;
  wrongs: WrongQuestionRepository;
  signer: SessionSigner;
  auth: AuthService;
  courseService: CourseService;
  lessonService: LessonService;
  bankService: BankService;
  conflictService: QuestionConflictService;
  difficultyService: DifficultyService;
  quizService: QuizService;
  examService: ExamService;
  /** 组卷工作台的挑题/细目表要直接读仓储（筛选条件组合很多，放服务里只是一层转发） */
  exams: ExamRepository;
  /** 易错题挑题：每题错误率（从作答 JSON 聚合，带 5 分钟缓存） */
  questionStats: QuestionStatsRepository;
  /** 学情分析（机构视角的作答数据聚合） */
  analyticsService: AnalyticsService;
  statsService: StatsService;
  noteService: NoteService;
  watchIntervals: WatchIntervalRepository;
  probe: MediaProbeService;
  media: MediaRootService;
  storage: StorageService;
  /** 题目图片仓库（内容寻址，题干/选项/解析里的内联图都走它） */
  questionMedia: QuestionMediaStore;
}

export interface BuiltApp {
  app: FastifyInstance;
  deps: Deps;
  migrations: MigrateResult;
}

export function buildDeps(config: AppConfig, db: Db): Deps {
  const users = new UserRepository(db);
  const settings = new SettingsRepository(db);
  const audit = new AuditRepository(db);
  const courses = new CourseRepository(db);
  const lessons = new LessonRepository(db);
  const progress = new ProgressRepository(db);
  const banks = new BankRepository(db);
  const questions = new QuestionRepository(db);
  const questionConflicts = new QuestionConflictRepository(db);
  const attempts = new AttemptRepository(db);
  const wrongs = new WrongQuestionRepository(db);
  const exams = new ExamRepository(db);
  const notes = new NoteRepository(db);
  const stats = new StatsRepository(db);
  const watchIntervals = new WatchIntervalRepository(db);
  const probe = new MediaProbeService({
    coversDir: path.join(config.dataDir, 'uploads', 'covers'),
    ...(config.ffprobePath ? { ffprobePath: config.ffprobePath } : {}),
    ...(config.ffmpegPath ? { ffmpegPath: config.ffmpegPath } : {}),
  });
  const signer = new SessionSigner(config.sessionSecret, config.dataDir);
  const media = new MediaRootService(settings, process.cwd());
  const storage = new StorageService(config.dataDir);
  const questionMedia = new QuestionMediaStore(config.dataDir);
  const auth = new AuthService(users, settings, audit, signer);
  const courseService = new CourseService(courses, audit);
  const lessonService = new LessonService(lessons, progress, media, audit, storage, courses, watchIntervals, probe);
  const difficultyService = new DifficultyService(questions, settings, audit);
  const bankService = new BankService(banks, questions, lessons, audit, storage, questionMedia, difficultyService);
  const conflictService = new QuestionConflictService(questionConflicts, questions, audit);
  const quizService = new QuizService(questions, attempts, wrongs, lessons, progress, lessonService);
  const questionStats = new QuestionStatsRepository(db);
  const analyticsService = new AnalyticsService(new AnalyticsRepository(db));
  const examService = new ExamService(exams, courses, audit, questions, questionMedia);
  const statsService = new StatsService(stats, lessons, courses, exams);
  const noteService = new NoteService(notes, lessons);
  return {
    config,
    db,
    users,
    settings,
    audit,
    courses,
    lessons,
    progress,
    banks,
    questions,
    attempts,
    wrongs,
    signer,
    auth,
    courseService,
    lessonService,
    bankService,
    conflictService,
    difficultyService,
    quizService,
    examService,
    exams,
    questionStats,
    analyticsService,
    statsService,
    noteService,
    watchIntervals,
    probe,
    media,
    storage,
    questionMedia,
  };
}

export async function buildApp(config: AppConfig, options?: { db?: Db }): Promise<BuiltApp> {
  const db = options?.db ?? openDb(config.dataDir);
  const migrations = runMigrations(db, config.migrationsDir);
  const deps = buildDeps(config, db);

  // 首次启动：引导管理员 + 播种媒体根目录设置 + 登记站内上传目录
  deps.auth.bootstrapAdmin(config.bootstrapAdminUser, config.bootstrapAdminPass);
  if (!deps.settings.get('media_roots') && config.mediaRoots.length > 0) {
    deps.settings.set('media_roots', JSON.stringify(config.mediaRoots));
  }
  deps.media.ensureUploadRoot(config.dataDir);

  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: config.maxUploadMb * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    // 同源托管时可用 MC_CSP=1 打开严格 CSP；反代若已下发 CSP 则保持关闭避免冲突
    contentSecurityPolicy: config.cspEnabled
      ? {
          directives: {
            defaultSrc: ["'self'"],
            // 前端构建产物无内联脚本；样式由 Vite 抽成独立文件
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            // 外部直链视频（video_kind=url）是 https 地址，必须放开，否则开了 CSP 就播不了
            mediaSrc: ["'self'", 'blob:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            // 外部链接/嵌入视频（video_kind=embed）需要放开 frame 源
            frameSrc: ["'self'", 'https:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    allowList: [],
  });
  await app.register(multipart, {
    /**
     * 文件数上限从 1 放宽到 500：
     * 「资料批量导入」一次请求要带整份资料的题图（数学卷常有上百张公式/插图），
     * 原先 files:1 会被 busboy 直接拒绝。multipart 路由都在登录后，属教师/管理员操作，
     * 真正的闸门交给各路由自己（如批量导入限 500 题 / 400 张图）。
     */
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 500, parts: 4000 },
  });

  // OpenAPI 3.1 文档：由路由 schema 自动生成，经 /api/v1/openapi.json 暴露
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: '微课堂 API',
        description:
          '轻量学习平台接口：账号与会话、课程/章节/课时、知识点与附件、题库与题目（含 CSV 导入导出）、' +
          '刷题判分与错题本、在线考试与成绩单、学习统计。所有接口挂载在 /api/v1 下，' +
          '除 /meta、/auth/*、/healthz、/readyz、/version 外均需登录会话 Cookie。',
        version: '2.0.0',
      },
      tags: [
        { name: 'system', description: '健康检查与站点元信息' },
        { name: 'auth', description: '登录、注册、会话' },
        { name: 'courses', description: '课程、分类、收藏' },
        { name: 'lessons', description: '课时、知识点、视频流' },
        { name: 'banks', description: '题库、题目、CSV 导入导出' },
        { name: 'quiz', description: '刷题、判分、错题本' },
        { name: 'exams', description: '考试、组卷、成绩' },
        { name: 'stats', description: '学习统计与导出' },
        { name: 'admin', description: '用户、媒体目录、审计与设置' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'microclass_sid' },
        },
      },
    },
  });

  registerRequestContext(app);
  registerOriginCheck(app, config);
  registerAuth(app, { signer: deps.signer, users: deps.users });
  registerErrorHandler(app);
  await registerRoutes(app, deps);

  // 托管前端构建产物（存在时）；SPA 回退由统一 404 处理器负责
  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
  }

  app.addHook('onClose', async () => {
    db.close();
  });

  /**
   * **启动预热**：容器刚起来时页缓存是空的，而「题库体检」要把全库统计跑一遍
   * （真机实测冷缓存 69 秒，用户看到的就是"卡死"；热缓存只要几百毫秒）。
   * 这里在服务就绪后**后台**算一次并写进内存缓存，让第一次点击体检的人直接命中缓存。
   * 预热失败不影响启动（只在日志里留一条）。
   */
  app.addHook('onReady', async () => {
    setTimeout(() => {
      try {
        const t0 = Date.now();
        deps.bankService.health(undefined, 20);
        app.log.info({ ms: Date.now() - t0 }, '题库体检预热完成');
      } catch (e) {
        app.log.warn({ err: e instanceof Error ? e.message : String(e) }, '题库体检预热失败（忽略）');
      }
    }, 1000).unref?.();
  });

  return { app, deps, migrations };
}
