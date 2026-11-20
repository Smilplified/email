/**
 * Vercel serverless entry point.
 *
 * Vercel routes all requests here (see vercel.json).
 * server.js loads dotenv from backend/.env on startup.
 * On Vercel, dotenv finds no file and is silent; env vars
 * come from Vercel's project environment settings instead.
 *
 * app.listen() is NOT called: the require.main guard in server.js
 * ensures it only runs during local `npm run dev`.
 */

const app = require('../backend/server');

module.exports = app;
