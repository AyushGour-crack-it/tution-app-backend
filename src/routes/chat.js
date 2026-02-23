import express from "express";
import Message from "../models/Message.js";
import User from "../models/User.js";
import cloudinary from "../utils/cloudinary.js";
import multer from "multer";
import { Readable } from "stream";
import { requireAuth } from "../utils/auth.js";
import {
  chatMessageLimiter,
  chatReactionLimiter,
  chatUploadLimiter
} from "../utils/rateLimiters.js";
import {
  emitChatMessageCreated,
  emitChatMessageUpdated
} from "../utils/realtime.js";
import { sendPushToUsers } from "../utils/pushNotifications.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const DEFAULT_MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGE_SIZE = 200;

const parsePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseDateSafe = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const canAccessMessage = (message, user) => {
  const me = String(user.sub);
  return (
    !message.recipientUserId ||
    String(message.senderId) === me ||
    String(message.recipientUserId) === me
  );
};

const isDeletedMessage = (message) => Boolean(message?.deletedAt);

const toPushBody = (message) => {
  const content = String(message?.content || "").trim();
  if (!content) return "New message";
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
};

const sendChatPush = async ({ created, senderId }) => {
  const senderUserId = String(senderId || "");
  const recipientUserId = created?.recipientUserId ? String(created.recipientUserId) : "";
  const senderName = String(created?.senderName || "Someone");
  const title = `New message from ${senderName}`;
  const body = toPushBody(created);

  if (recipientUserId) {
    await sendPushToUsers({
      userIds: [recipientUserId],
      title,
      body,
      data: {
        type: "chat",
        messageId: String(created?._id || ""),
        clickAction: "/chat"
      }
    });
    return;
  }

  const recipients = await User.find({
    $or: [{ role: "teacher" }, { role: "student", studentApprovalStatus: "approved" }]
  })
    .select("_id")
    .lean();
  const recipientIds = recipients
    .map((user) => String(user?._id || ""))
    .filter((id) => id && id !== senderUserId);

  if (!recipientIds.length) return;
  await sendPushToUsers({
    userIds: recipientIds,
    title,
    body,
    data: {
      type: "chat",
      messageId: String(created?._id || ""),
      clickAction: "/chat"
    }
  });
};

router.get("/messages", requireAuth, async (req, res) => {
  const limit = parsePositiveInt(req.query.limit, DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);
  const before = parseDateSafe(req.query.before);
  const after = parseDateSafe(req.query.after);
  const query = {
    $or: [
      { recipientUserId: null },
      { senderId: req.user.sub },
      { recipientUserId: req.user.sub }
    ]
  };

  if (before) {
    query.createdAt = { ...(query.createdAt || {}), $lt: before };
  }
  if (after) {
    query.createdAt = { ...(query.createdAt || {}), $gt: after };
  }

  const itemsDesc = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const items = [...itemsDesc].reverse();
  const oldest = items[0]?.createdAt ? new Date(items[0].createdAt).toISOString() : null;

  res.json({
    items,
    hasMore: itemsDesc.length === limit,
    nextBefore: oldest,
    serverTime: new Date().toISOString()
  });
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const query = {
    $or: [{ recipientUserId: null }, { recipientUserId: userId }],
    senderId: { $ne: userId },
    readBy: { $ne: userId },
    deletedAt: null
  };
  const count = await Message.countDocuments(query);
  res.json({ count });
});

router.get("/users", requireAuth, async (req, res) => {
  const users = await User.find({
    $or: [{ role: "teacher" }, { role: "student", studentApprovalStatus: "approved" }]
  })
    .select("_id name role avatarUrl isOnline lastSeenAt")
    .sort({ role: 1, name: 1 })
    .lean();

  res.json(users);
});

router.post("/messages", requireAuth, chatMessageLimiter, async (req, res) => {
  const { type, content, fileName, mimeType, replyTo } = req.body;
  const clientMessageId = String(req.body.clientMessageId || "").trim().slice(0, 80);
  const incomingRecipientUserId = String(req.body.recipientUserId || "").trim();
  const recipientStudentId = String(req.body.recipientStudentId || "").trim();
  if (!type || !content) {
    return res.status(400).json({ message: "Missing message content" });
  }
  if (type === "announcement" && req.user.role !== "teacher") {
    return res.status(403).json({ message: "Only teachers can send announcements" });
  }
  let recipientUserId = null;
  let resolvedRecipientStudentId = null;
  let recipientName = "";

  if (incomingRecipientUserId) {
    const targetUser = await User.findById(incomingRecipientUserId)
      .select("_id role name studentId studentApprovalStatus")
      .lean();
    if (!targetUser) {
      return res.status(400).json({ message: "Recipient account not found" });
    }
    if (String(targetUser._id) === String(req.user.sub)) {
      return res.status(400).json({ message: "Cannot message yourself" });
    }
    if (targetUser.role === "student" && targetUser.studentApprovalStatus !== "approved") {
      return res.status(400).json({ message: "Recipient account is not approved yet" });
    }
    recipientUserId = targetUser._id;
    resolvedRecipientStudentId = targetUser.studentId || null;
    recipientName = targetUser.name || "";
  } else if (recipientStudentId) {
    const studentUser = await User.findOne({
      role: "student",
      studentId: recipientStudentId,
      studentApprovalStatus: "approved"
    });
    if (!studentUser) {
      return res.status(400).json({ message: "Recipient account not found" });
    }
    recipientUserId = studentUser._id;
    resolvedRecipientStudentId = studentUser.studentId;
    recipientName = studentUser.name;
  }
  const created = await Message.create({
    senderId: req.user.sub,
    senderName: req.user.name,
    senderAvatar: req.user.avatarUrl || "",
    role: req.user.role,
    clientMessageId,
    recipientUserId,
    recipientStudentId: resolvedRecipientStudentId,
    recipientName,
    type,
    content,
    fileName: fileName || "",
    mimeType: mimeType || "",
    replyTo: replyTo || null,
    readBy: [req.user.sub]
  });
  emitChatMessageCreated(created);
  sendChatPush({ created, senderId: req.user.sub }).catch(() => {});
  return res.status(201).json(created);
});

router.post("/messages/read", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const visibilityQuery = {
    $or: [
      { recipientUserId: null },
      { recipientUserId: userId },
      { senderId: userId }
    ]
  };

  const unread = await Message.find({
    ...visibilityQuery,
    senderId: { $ne: userId },
    readBy: { $ne: userId },
    deletedAt: null
  })
    .select("_id senderId senderName senderAvatar role clientMessageId recipientUserId recipientStudentId recipientName type content fileName mimeType replyTo reactions readBy editedAt deletedAt deletedBy createdAt updatedAt")
    .lean();

  if (unread.length) {
    const ids = unread.map((item) => item._id);
    await Message.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { readBy: userId } }
    );
    unread.forEach((item) => {
      emitChatMessageUpdated({
        ...item,
        readBy: [...(Array.isArray(item.readBy) ? item.readBy : []), userId]
      });
    });
  }

  return res.json({
    updatedCount: unread.length
  });
});

router.put("/messages/:id([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const { content } = req.body;
  const message = await Message.findById(req.params.id);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }
  if (!canAccessMessage(message, req.user)) {
    return res.status(403).json({ message: "Forbidden for this message" });
  }
  if (message.senderId.toString() !== req.user.sub) {
    return res.status(403).json({ message: "Can only edit your own message" });
  }
  if (isDeletedMessage(message)) {
    return res.status(400).json({ message: "Deleted messages cannot be edited" });
  }
  if (message.type !== "text" && message.type !== "announcement") {
    return res.status(400).json({ message: "Only text/announcement messages can be edited" });
  }
  message.content = content || message.content;
  message.editedAt = new Date();
  await message.save();
  emitChatMessageUpdated(message);
  return res.json(message);
});

router.delete("/messages/:id([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }
  if (!canAccessMessage(message, req.user)) {
    return res.status(403).json({ message: "Forbidden for this message" });
  }
  if (message.senderId.toString() !== req.user.sub) {
    return res.status(403).json({ message: "Can only delete your own message" });
  }
  if (!isDeletedMessage(message)) {
    message.deletedAt = new Date();
    message.deletedBy = req.user.sub;
    message.editedAt = null;
    message.content = "";
    message.fileName = "";
    message.mimeType = "";
    message.reactions = [];
    await message.save();
    emitChatMessageUpdated(message);
  }
  return res.json(message);
});

router.post("/messages/:id([0-9a-fA-F]{24})/reactions", requireAuth, chatReactionLimiter, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) {
    return res.status(400).json({ message: "Missing emoji" });
  }
  const message = await Message.findById(req.params.id);
  if (!message) {
    return res.status(404).json({ message: "Message not found" });
  }
  if (!canAccessMessage(message, req.user)) {
    return res.status(403).json({ message: "Forbidden for this message" });
  }
  if (isDeletedMessage(message)) {
    return res.status(400).json({ message: "Deleted messages cannot be reacted to" });
  }
  const existing = message.reactions.find((r) => r.userId.toString() === req.user.sub);
  if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ userId: req.user.sub, emoji });
  }
  await message.save();
  emitChatMessageUpdated(message);
  return res.json(message);
});

router.delete("/messages/clear", requireAuth, async (req, res) => {
  if (req.user.role === "teacher") {
    const deleted = await Message.deleteMany({});
    return res.json({ message: "Chat cleared", deletedCount: deleted.deletedCount || 0 });
  }
  const deleted = await Message.deleteMany({ senderId: req.user.sub });
  return res.json({ message: "Your messages cleared", deletedCount: deleted.deletedCount || 0 });
});

router.post("/upload", requireAuth, chatUploadLimiter, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Missing file" });
  }
  const allowedMimePrefixes = ["image/", "video/"];
  const isAllowedMime = allowedMimePrefixes.some((prefix) => file.mimetype.startsWith(prefix));
  if (!isAllowedMime) {
    return res.status(400).json({ message: "Only image and video files are allowed" });
  }
  const resourceType = file.mimetype.startsWith("video") || file.mimetype.startsWith("audio")
    ? "video"
    : "image";

  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: "ayush-chat" },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
    Readable.from(file.buffer).pipe(stream);
  });

  return res.json({
    url: uploadResult.secure_url,
    resourceType: uploadResult.resource_type,
    format: uploadResult.format
  });
});

export default router;
