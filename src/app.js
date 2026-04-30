// src/app.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const webhookRoutes = require('./routes/webhookRoutes');


const app = express();
app.set('trust proxy', 1);
app.set('etag', false);

// Compress all responses (60-80% smaller JSON payloads)
app.use(compression());

// Security middleware
app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

// Enable CORS — respect ALLOWED_ORIGINS env var, fallback to * for dev
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : '*';

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Range', 'Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
}));

// Ensure all responses have correct CORS + CORP headers for cross-origin media
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    next();
});

// Logging
app.use(morgan('dev'));

// Stripe Webhook MUST be registered before body-parsing so sig-verification works
app.use('/api/webhooks/stripe', webhookRoutes);

// Body parsing — Increased limit for base64 profile images (20MB)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Apply rate limiting to all API routes except /ad
app.use('/api', (req, res, next) => {
    if (req.path === '/anime/ad') return next(); // skip rate limit for ad video
    rateLimiter(req, res, next);
});

// Mount all routes under /api
app.use('/api', routes);


// Root route - serve the documentation
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler - MUST be after all other routes
app.use('*', (req, res) => {
    // Check if the request accepts HTML (browser request)
    if (req.accepts('html')) {
        res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
    } else {
        // API request - return JSON
        res.status(404).json({
            success: false,
            error: `Cannot ${req.method} ${req.originalUrl}`
        });
    }
});

// Global error handler
app.use(errorHandler);

module.exports = app;