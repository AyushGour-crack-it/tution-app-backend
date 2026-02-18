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
  emitChatMessageDeleted,
  emitChatMessageUpdated
} from "../utils/realtime.js";
import { sendPushToUsers } from "../utils/pushNotifications.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const canAccessMessage = (message, user) => {
  if (user.role === "teacher") return true;
  const me = String(user.sub);
  return (
    !message.recipientUserId ||
    String(message.senderId) === me ||
    String(message.recipientUserId) === me
  );
};

const toPushBody = (message) => {
  const content = String(message?.content || "").trim();
  if (!content) return "New message";
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
};

const sendChatPush = async ({ created, senderRole, senderId }) => {
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

  const targetRole = senderRole === "teacher" ? "student" : "teacher";
  const recipients = await User.find({ role: targetRole }).select("_id").lean();
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
  const query =
    req.user.role === "teacher"
      ? {}
      : {
          $or: [
            { recipientUserId: null },
            { senderId: req.user.sub },
            { recipientUserId: req.user.sub }
          ]
        };
  const items = await Message.find(query)
    .sort({ createdAt: 1 })
    .limit(500)
    .lean();
  res.json(items);
});

router.post("/messages", requireAuth, chatMessageLimiter, async (req, res) => {
  const { type, content, fileName, mimeType, replyTo, recipientStudentId } = req.body;
  const clientMessageId = String(req.body.clientMessageId || "").trim().slice(0, 80);
  if (!type || !content) {
    return res.status(400).json({ message: "Missing message content" });
  }
  if (type === "announcement" && req.user.role !== "teacher") {
    return res.status(403).json({ message: "Only teachers can send announcements" });
  }
  let recipientUserId = null;
  let resolvedRecipientStudentId = null;
  let recipientName = "";
  if (recipientStudentId) {
    if (req.user.role !== "teacher") {
      return res.status(403).json({ message: "Only teachers can message specific students" });
    }
    const studentUser = await User.findOne({ role: "student", studentId: recipientStudentId });
    if (!studentUser) {
      return res.status(400).json({ message: "Student account not found for selected student" });
    }
    recipientUserId = studentUser._id;
    resolvedRecipientStudentId = studentUser.studentId;
    recipientName = studentUser.name;
  }
  const created = await Message.create({
    senderId: req.user.sub,
    senderName: req.user.name,
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
  sendChatPush({ created, senderRole: req.user.role, senderId: req.user.sub }).catch(() => {});
  return res.status(201).json(created);
});

router.post("/messages/read", requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const visibilityQuery =
    req.user.role === "teacher"
      ? {}
      : {
          $or: [{ recipientUserId: null }, { recipientUserId: userId }]
        };

  const unread = await Message.find({
    ...visibilityQuery,
    senderId: { $ne: userId },
    readBy: { $ne: userId }
  })
    .select("_id senderId senderName role clientMessageId recipientUserId recipientStudentId recipientName type content fileName mimeType replyTo reactions readBy editedAt createdAt updatedAt")
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

router.put("/messages/:id", requireAuth, async (req, res) => {
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
  if (message.type !== "text" && message.type !== "announcement") {
    return res.status(400).json({ message: "Only text/announcement messages can be edited" });
  }
  message.content = content || message.content;
  message.editedAt = new Date();
  await message.save();
  emitChatMessageUpdated(message);
  return res.json(message);
});

router.delete("/messages/:id", requireAuth, async (req, res) => {
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
  const senderId = message.senderId ? String(message.senderId) : "";
  const recipientUserId = message.recipientUserId ? String(message.recipientUserId) : "";
  const messageId = String(message._id || "");
  await message.deleteOne();
  emitChatMessageDeleted({ messageId, senderId, recipientUserId });
  return res.json({ message: "Deleted" });
});

router.post("/messages/:id/reactions", requireAuth, chatReactionLimiter, async (req, res) => {
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
