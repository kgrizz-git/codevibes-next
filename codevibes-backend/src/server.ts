// ============================================================
// CodeVibes Backend - Main Server Entry Point
// ============================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import analysisRoutes from './routes/analysisRoutes.js';
import authRoutes from './routes/authRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { standardLimiter } from './middleware/rateLimiter.js';
import { logger } from './utils/logger.js';
import { APP_VERSION } from './version.js';

// Initialize database (creates tables if not exist)
import './utils/database.js';

// -------------------- Configuration --------------------

const PORT = parseInt(process.env.PORT || '3001', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:8080')
    .split(',')
    .map(origin => origin.trim());

// -------------------- App Setup --------------------

const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// -------------------- Middleware --------------------

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
            callback(null, true);
            return;
        }

        if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
            callback(null, true);
        } else {
            logger.warn('CORS blocked origin', { origin });
            callback(null, true); // Allow for development - tighten in production
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Cookie parser for auth
app.use(cookieParser());

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
    if (req.path !== '/api/health') {
        logger.debug('Incoming request', {
            method: req.method,
            path: req.path,
            ip: req.ip,
        });
    }
    next();
});

// Rate limiting
app.use('/api', standardLimiter);

// -------------------- Routes --------------------

// Auth routes (OAuth, login, logout)
app.use('/api/auth', authRoutes);

// History routes (save/get analysis history)
app.use('/api/history', historyRoutes);

// Analysis routes (existing)
app.use('/api', analysisRoutes);

// Root endpoint
app.get('/', (_req, res) => {
    res.json({
        name: 'CodeVibes API',
        version: APP_VERSION,
        description: 'Open-source code analysis using DeepSeek v3',
        endpoints: {
            health: 'GET /api/health',
            validateRepo: 'POST /api/validate-repo',
            estimate: 'GET /api/estimate?repoUrl=...',
            analyze: 'POST /api/analyze (SSE)',
        },
        docs: 'https://github.com/danish296/codevibes',
    });
});

// -------------------- Error Handling --------------------

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// -------------------- Server Start --------------------

app.listen(PORT, () => {
    logger.info('🚀 CodeVibes API started', {
        port: PORT,
        allowedOrigins: ALLOWED_ORIGINS,
        nodeVersion: process.version,
    });

    const buildDate = new Date().toISOString().split('T')[0];

    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   ██████╗ ██████╗ ██████╗ ███████╗██╗   ██╗██╗██████╗ ███████╗███████╗        ║
║  ██╔════╝██╔═══██╗██╔══██╗██╔════╝██║   ██║██║██╔══██╗██╔════╝██╔════╝        ║
║  ██║     ██║   ██║██║  ██║█████╗  ██║   ██║██║██████╔╝█████╗  ███████╗        ║
║  ██║     ██║   ██║██║  ██║██╔══╝  ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ╚════██║        ║
║  ╚██████╗╚██████╔╝██████╔╝███████╗ ╚████╔╝ ██║██████╔╝███████╗███████║        ║
║   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝╚═════╝ ╚══════╝╚══════╝        ║
║                                                                               ║
║   🔍 Open-Source Code Analysis API                                            ║
║   📡 Server: http://localhost:${PORT}                                           ║
║                                                                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║   👤 Developer: Danish Akhtar                                                 ║
║   🐙 GitHub: github.com/danish296                                             ║
║   📦 Version: ${APP_VERSION}-beta                                                      ║
║   📅 Build: ${buildDate}                                                      ║
╚═══════════════════════════════════════════════════════════════════════════════╝
  `);
});

export default app;
