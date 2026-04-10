// Entry point - starts the server
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./src/app');
const connectDB = require('./src/db/mongo');
const redisClient = require('./src/db/redisClient');
const { startWorkers } = require('./src/workers/scraperWorker');

const PORT = process.env.PORT || 3000;

// Serve files from the project root so ad MP4 is accessible
app.use(express.static(path.join(__dirname)));

// ─── Health check endpoint (used by Render to verify the app is alive) ────────
app.get('/api/health', async (req, res) => {
    const mongoState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const mongoose = require('mongoose');
    let redisOk = false;
    try {
        await redisClient.ping();
        redisOk = true;
    } catch { /* redis not available */ }

    res.json({
        status: 'ok',
        mongo: mongoState[mongoose.connection.readyState] || 'unknown',
        redis: redisOk ? 'connected' : 'unavailable',
        uptime: Math.floor(process.uptime()) + 's',
        env: process.env.NODE_ENV || 'development'
    });
});

// Connect to MongoDB and start server
connectDB().then(async () => {
    // Attempt Redis connection
    try {
        await redisClient.connect();
        console.log('✅ Redis connected successfully');

        // Only start workers if Redis is available
        startWorkers();
        console.log('🏁 Workers status: Active');
    } catch (err) {
        console.warn('⚠️ Redis not available - caching and background workers disabled.');
        console.warn('💡 Set REDIS_URL in your environment variables to enable Redis.');
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📦 DB Mode: MongoDB Atlas`);
    });
});