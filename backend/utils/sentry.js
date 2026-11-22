// backend/utils/sentry.js — Sentry Error Tracking & Compliance Scrubber
const Sentry = require('@sentry/node');
const { logger } = require('./logger');

let isSentryInitialized = false;

/**
 * GAP 2: tracesSampleRate wired directly from environment variable
 * Defaults to 0 when unset or invalid.
 */
function getTracesSampleRate() {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === null || raw.trim() === '') {
    return 0;
  }
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * GAP 2: Security & Compliance Scrubber for Sentry Events
 * Strips authentication headers, cookies, and payloads to prevent leaking enterprise SLA data.
 */
function sentryBeforeSend(event, hint) {
  if (event && event.request) {
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers['x-service-pass'];
    }
    if (event.request.cookies) {
      delete event.request.cookies;
    }
    if (event.request.data) {
      event.request.data = '[REDACTED]';
    }
  }
  return event;
}

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  const isTest = process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_SENTRY;

  if (!dsn || isTest) {
    logger.debug('[sentry] SENTRY_DSN not configured or running in test mode. Operating in mock mode.');
    isSentryInitialized = false;
    return;
  }

  const tracesSampleRate = getTracesSampleRate();

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      release: process.env.npm_package_version || '1.0.0',
      tracesSampleRate,
      beforeSend: sentryBeforeSend,
    });
    isSentryInitialized = true;
    logger.info({ tracesSampleRate }, '[sentry] Sentry error tracking successfully initialized.');
  } catch (err) {
    logger.error({ err }, '[sentry] Failed to initialize Sentry SDK. Operating in fallback mode.');
    isSentryInitialized = false;
  }
}

function captureException(err, context = {}) {
  // Always log error via structured logger
  logger.error({ err, ...context }, context.message || err?.message || 'Exception captured');

  if (!isSentryInitialized) {
    return null;
  }

  try {
    return Sentry.captureException(err, {
      tags: {
        tenantId: context.tenantId || 'unknown',
        module: context.module || 'unknown',
        jobId: context.jobId || 'none',
        ...context.tags,
      },
      extra: context.extra || context,
    });
  } catch (sentryErr) {
    logger.error({ err: sentryErr }, '[sentry] Failed to send exception to Sentry');
    return null;
  }
}

function sentryRequestHandler() {
  if (!isSentryInitialized) return (req, res, next) => next();
  return Sentry.Handlers?.requestHandler ? Sentry.Handlers.requestHandler() : (req, res, next) => next();
}

function sentryErrorHandler() {
  if (!isSentryInitialized) return (err, req, res, next) => next(err);
  return Sentry.Handlers?.errorHandler ? Sentry.Handlers.errorHandler() : (err, req, res, next) => next(err);
}

module.exports = {
  initSentry,
  captureException,
  sentryRequestHandler,
  sentryErrorHandler,
  sentryBeforeSend,
  getTracesSampleRate,
  isInitialized: () => isSentryInitialized,
};

