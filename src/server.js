import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createServer } from "http";
import { readFileSync } from "fs";
import { readFile } from "fs/promises";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

import studentRoutes from "./routes/students.js";
import classRoutes from "./routes/classes.js";
import homeworkRoutes from "./routes/homeworks.js";
import syllabusRoutes from "./routes/syllabus.js";
import attendanceRoutes from "./routes/attendance.js";
import holidayRoutes from "./routes/holidays.js";
import feeRoutes from "./routes/fees.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import announcementRoutes from "./routes/announcements.js";
import overviewRoutes from "./routes/overview.js";
import marksRoutes from "./routes/marks.js";
import notificationRoutes from "./routes/notifications.js";
import invoiceRoutes from "./routes/invoices.js";
import receiptRoutes from "./routes/receipts.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import badgeRoutes from "./routes/badges.js";
import quizRoutes from "./routes/quizRoutes.js";
import popupCampaignRoutes from "./routes/popupCampaigns.js";
import Notification from "./models/Notification.js";
import SystemState from "./models/SystemState.js";
import BadgeDefinition from "./models/BadgeDefinition.js";
import User from "./models/User.js";
import Conversation from "./models/Conversation.js";
import Question from "./models/Question.js";
import { badgeCatalogSeed } from "./data/badgeCatalog.js";
import { xpForRarity } from "./utils/gamification.js";
import { emitChatTyping, emitUserPresenceUpdated, setRealtimeServer } from "./utils/realtime.js";


dotenv.config();

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 5000;
const rawClientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowVercelWildcard = process.env.ALLOW_VERCEL_WILDCARD !== "false";

const normalizeOrigin = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
};

const allowedOrigins = rawClientOrigin
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  if (allowedOrigins.includes(normalized)) return true;
  // Vercel preview/production domains can change by deployment hash.
  if (allowVercelWildcard && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized)) return true;
  return false;
};

const packageVersion = (() => {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    return JSON.parse(raw).version || "1.0.0";
  } catch {
    return "1.0.0";
  }
})();

const toSingleLine = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const notifyFeatureUpdateIfNeeded = async () => {
  const key = "feature_release_version";
  const currentVersion = process.env.APP_FEATURE_VERSION || packageVersion;
  const currentFeatureSummary = toSingleLine(
    process.env.APP_FEATURE_NOTE ||
      process.env.APP_FEATURE_SUMMARY ||
      "General performance and stability improvements."
  );
  const currentNote = `Added: ${currentFeatureSummary}`;

  const state = await SystemState.findOne({ key });
  if (state?.value === currentVersion) return;

  await Notification.create({
    title: `New Feature Update v${currentVersion}`,
    message: currentNote,
    target: "all"
  });

  await SystemState.findOneAndUpdate(
    { key },
    { value: currentVersion },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const ensureBadgeCatalog = async () => {
  for (let index = 0; index < badgeCatalogSeed.length; index += 1) {
    const item = badgeCatalogSeed[index];
    await BadgeDefinition.findOneAndUpdate(
      { key: item.key },
      {
        ...item,
        xpValue: item.xpValue || xpForRarity(item.rarity),
        sortOrder: index + 1
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
};

const quizFiles = [
  "class6/physics.json",
  "class6/chemistry.json",
  "class6/biology.json",
  "class6/english.json",
  "class6/french.json",
  "class6/history.json",
  "class6/geography.json",
  "class6/civics.json",
  "class7/physics.json",
  "class7/chemistry.json",
  "class7/biology.json",
  "class7/english.json",
  "class7/french.json",
  "class7/history.json",
  "class7/geography.json",
  "class7/civics.json",
  "class8/physics.json",
  "class8/chemistry.json",
  "class8/biology.json",
  "class8/english.json",
  "class8/french.json",
  "class8/history.json",
  "class8/geography.json",
  "class8/civics.json"
];

const ensureQuizBank = async () => {
  const count = await Question.estimatedDocumentCount();
  if (count > 0) return;

  let batch = [];
  for (let i = 0; i < quizFiles.length; i += 1) {
    const rel = quizFiles[i];
    const fileUrl = new URL(`../data/${rel}`, import.meta.url);
    const raw = await readFile(fileUrl, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) batch = batch.concat(parsed);
  }
  if (!batch.length) return;
  await Question.insertMany(batch, { ordered: false });
  // eslint-disable-next-line no-console
  console.log(`Quiz bank seeded with ${batch.length} questions`);
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin/non-browser requests (no Origin header).
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: false
  })
);
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(express.json({ limit: "2mb" }));
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth attempts. Please try again later." }
});
app.use("/api/auth", authLimiter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/students", studentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/homeworks", homeworkRoutes);
app.use("/api/syllabus", syllabusRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/overview", overviewRoutes);
app.use("/api/marks", marksRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/badges", badgeRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/popup-campaigns", popupCampaignRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (error?.message?.startsWith("CORS blocked for origin:")) {
    return res.status(403).json({ message: "CORS blocked" });
  }
  return next(error);
});

const validateSecurityConfig = () => {
  const jwtSecret = process.env.JWT_SECRET || "";
  const weakDefaults = new Set(["change_this_secret", "your_strong_secret", "dev_secret_change_me"]);
  if (!jwtSecret || jwtSecret.length < 32 || weakDefaults.has(jwtSecret)) {
    // Non-blocking to avoid production outage; keep warning visible in logs.
    // eslint-disable-next-line no-console
    console.warn("Security warning: JWT_SECRET should be set and at least 32 characters");
  }
};

const buildSocketServer = async () => {
  const activeConnections = new Map();
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      methods: ["GET", "POST"]
    }
  });

  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake?.auth?.token || "";
      const header = socket.handshake?.headers?.authorization || "";
      const tokenFromHeader = header.startsWith("Bearer ") ? header.slice(7) : "";
      const token = authToken || tokenFromHeader;
      if (!token) return next(new Error("Missing token"));
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error("JWT secret missing"));
      const payload = jwt.verify(token, secret);
      const user = await User.findById(payload.sub).select("_id role studentId name").lean();
      if (!user) return next(new Error("Session expired"));
      socket.data.user = {
        id: user._id.toString(),
        role: user.role,
        name: user.name || "",
        studentId: user.studentId ? user.studentId.toString() : null
      };
      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    if (!user?.id) return;
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);
    if (user.studentId) {
      socket.join(`student:${user.studentId}`);
    }

    const key = String(user.id);
    const nextCount = Number(activeConnections.get(key) || 0) + 1;
    activeConnections.set(key, nextCount);
    if (nextCount === 1) {
      User.updateOne(
        { _id: user.id },
        { $set: { isOnline: true, lastSeenAt: new Date() } }
      )
        .then(() => {
          emitUserPresenceUpdated({
            userId: key,
            isOnline: true,
            lastSeenAt: new Date().toISOString()
          });
        })
        .catch(() => {});
    }

    socket.on("chat:typing", async (payload = {}) => {
      try {
        const sender = socket.data.user;
        if (!sender?.id) return;
        const conversationId = String(payload?.conversationId || "").trim();
        if (!conversationId) return;
        const conversation = await Conversation.findById(conversationId).select("members").lean();
        if (!conversation) return;
        const activeMembers = (conversation.members || []).filter((member) => !member?.leftAt);
        const isMember = activeMembers.some((member) => String(member?.userId || "") === String(sender.id));
        if (!isMember) return;
        const recipientIds = activeMembers
          .map((member) => String(member?.userId || ""))
          .filter((id) => id && id !== String(sender.id));
        emitChatTyping({
          conversationId,
          senderId: sender.id,
          senderName: sender.name || (sender.role === "teacher" ? "Teacher" : "Student"),
          senderRole: sender.role,
          userIds: recipientIds
        });
      } catch {
        // typing indicator is best-effort
      }
    });

    socket.on("disconnect", () => {
      const current = Number(activeConnections.get(key) || 0);
      const remaining = Math.max(0, current - 1);
      if (remaining > 0) {
        activeConnections.set(key, remaining);
        return;
      }
      activeConnections.delete(key);
      const now = new Date();
      User.updateOne(
        { _id: key },
        { $set: { isOnline: false, lastSeenAt: now } }
      )
        .then(() => {
          emitUserPresenceUpdated({
            userId: key,
            isOnline: false,
            lastSeenAt: now.toISOString()
          });
        })
        .catch(() => {});
    });
  });

  const redisUrl = process.env.REDIS_URL || "";
  if (redisUrl) {
    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      // eslint-disable-next-line no-console
      console.log("Socket.IO Redis adapter enabled");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("Socket.IO Redis adapter init failed, falling back to in-memory adapter");
    }
  }

  setRealtimeServer(io);
};

const start = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }
  validateSecurityConfig();

  await mongoose.connect(mongoUri);
  await buildSocketServer();
  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });

  Promise.allSettled([
    ensureBadgeCatalog(),
    ensureQuizBank(),
    notifyFeatureUpdateIfNeeded()
  ]).then((results) => {
    results.forEach((result) => {
      if (result.status === "rejected") {
        // eslint-disable-next-line no-console
        console.warn("Background startup task failed:", result.reason?.message || result.reason);
      }
    });
  });
};

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
