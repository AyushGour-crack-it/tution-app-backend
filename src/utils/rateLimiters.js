import rateLimit from "express-rate-limit";

const resolveClientKey = (req) => {
  const userKey = req.user?.sub ? `u:${req.user.sub}` : null;
  const ipKey = req.ip || "unknown";
  return userKey ? `${userKey}|ip:${ipKey}` : `ip:${ipKey}`;
};

const buildLimiter = ({ windowMs, max, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: resolveClientKey,
    skipSuccessfulRequests,
    message: { message }
  });

export const loginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please try again later."
});

export const registerLimiter = buildLimiter({
  windowMs: 30 * 60 * 1000,
  max: 8,
  message: "Too many registration attempts. Please try again later."
});

export const otpRequestLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many OTP requests. Please try again later."
});

export const otpVerifyLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many OTP attempts. Please try again later."
});

export const chatMessageLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 25,
  message: "Too many chat messages. Slow down a bit."
});

export const chatReactionLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many reactions. Please wait a moment."
});

export const chatUploadLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many uploads. Please try again later."
});

export const paymentLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many payment requests. Please try again later."
});

export const teacherBroadcastLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many notifications. Please wait before sending more."
});

export const popupImageUploadLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many popup image uploads. Please try again later."
});
