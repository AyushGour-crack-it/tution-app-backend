import express from "express";
import Message from "../models/Message.js";
import User from "../models/User.js";
import cloudinary from "../utils/cloudinary.js";
import multer from "multer";
import { Readable } from "stream";
import { requireAuth } from "../utils/auth.js";

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

router.post("/messages", requireAuth, async (req, res) => {
  const { type, content, fileName, mimeType, replyTo, recipientStudentId } = req.body;
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
    recipientUserId,
    recipientStudentId: resolvedRecipientStudentId,
    recipientName,
    type,
    content,
    fileName: fileName || "",
    mimeType: mimeType || "",
    replyTo: replyTo || null
  });
  return res.status(201).json(created);
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
  await message.deleteOne();
  return res.json({ message: "Deleted" });
});

router.post("/messages/:id/reactions", requireAuth, async (req, res) => {
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
  return res.json(message);
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Missing file" });
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
