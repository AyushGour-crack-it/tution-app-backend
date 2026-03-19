import express from "express";
import multer from "multer";
import { Readable } from "stream";
import mongoose from "mongoose";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import ConversationMessage from "../models/ConversationMessage.js";
import ChatReport from "../models/ChatReport.js";
import cloudinary from "../utils/cloudinary.js";
import { requireAuth } from "../utils/auth.js";
import {
  chatMessageLimiter,
  chatReactionLimiter,
  chatUploadLimiter
} from "../utils/rateLimiters.js";
import {
  emitChatConversationCreated,
  emitChatConversationUpdated,
  emitChatMessageCreated,
  emitChatMessageUpdated,
  emitChatReportCreated,
  emitChatReportUpdated
} from "../utils/realtime.js";
import { sendPushToUsers } from "../utils/pushNotifications.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 80;

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

const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "")) ? new mongoose.Types.ObjectId(String(value)) : null;

const isActiveMember = (conversation, userId) =>
  (conversation?.members || []).some(
    (member) => String(member?.userId || "") === String(userId || "") && !member?.leftAt
  );

const getActiveMembers = (conversation) =>
  (conversation?.members || []).filter((member) => !member?.leftAt);

const getActiveMemberIds = (conversation) =>
  getActiveMembers(conversation).map((member) => String(member.userId || ""));

const getMemberMeta = (conversation, userId) =>
  (conversation?.members || []).find(
    (member) => String(member?.userId || "") === String(userId || "") && !member?.leftAt
  );

const directParticipantKey = (userA, userB) =>
  [String(userA || ""), String(userB || "")].sort().join(":");

const summarizeMessage = (message) => {
  if (!message) return "";
  if (message.deletedAt) return "Message deleted";
  if (message.type === "image" || message.type === "gif" || message.type === "meme") return "Photo";
  if (message.type === "video") return "Video";
  if (message.type === "audio") return "Audio";
  if (message.type === "file" || message.type === "document") return "Document";
  const content = String(message.content || "").trim();
  if (!content) return "Message";
  return content.length > 90 ? `${content.slice(0, 87)}...` : content;
};

const sanitizeText = (value, max = 500) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const sanitizeUrl = (value) => {
  const raw = sanitizeText(value, 500);
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "";
};

const canManageGroup = (conversation, userId) =>
  conversation?.type === "group" &&
  (conversation?.members || []).some(
    (member) =>
      String(member?.userId || "") === String(userId || "") &&
      !member?.leftAt &&
      member?.role === "admin"
  );

const canTeacherModerateConversation = (conversation, user) => {
  if (user?.role !== "teacher") return false;
  if (conversation?.type === "direct") return true;
  return isActiveMember(conversation, user?.sub);
};

const findApprovedUsersByIds = async (userIds = []) => {
  const ids = userIds.map((id) => toObjectId(id)).filter(Boolean);
  if (!ids.length) return [];
  return User.find({
    _id: { $in: ids },
    $or: [{ role: "teacher" }, { role: "student", studentApprovalStatus: "approved" }]
  })
    .select("_id name role avatarUrl")
    .lean();
};

const buildInboxRows = async (conversations, meId) => {
  const uniqueUserIds = new Set();
  conversations.forEach((conversation) => {
    (conversation.members || []).forEach((member) => {
      if (!member?.leftAt) uniqueUserIds.add(String(member.userId || ""));
    });
  });
  const users = await User.find({ _id: { $in: Array.from(uniqueUserIds) } })
    .select("_id name avatarUrl role isOnline lastSeenAt")
    .lean();
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  const rows = await Promise.all(
    conversations.map(async (conversation) => {
      const meMember = getMemberMeta(conversation, meId);
      const meReadAt = meMember?.lastReadAt ? new Date(meMember.lastReadAt) : null;
      const unreadCount = await ConversationMessage.countDocuments({
        conversationId: conversation._id,
        senderId: { $ne: toObjectId(meId) },
        deletedAt: null,
        ...(meReadAt ? { createdAt: { $gt: meReadAt } } : {})
      });

      const activeMembers = getActiveMembers(conversation);
      let displayName = conversation.title || "Conversation";
      let displayImage = conversation.imageUrl || "";
      let counterpart = null;
      if (conversation.type === "direct") {
        const other = activeMembers.find((member) => String(member.userId || "") !== String(meId));
        const otherUser = other ? userMap.get(String(other.userId || "")) : null;
        displayName = otherUser?.name || "Direct chat";
        displayImage = otherUser?.avatarUrl || "";
        counterpart = otherUser
          ? {
              userId: String(otherUser._id),
              name: otherUser.name || "",
              role: otherUser.role || "",
              avatarUrl: otherUser.avatarUrl || "",
              isOnline: Boolean(otherUser.isOnline),
              lastSeenAt: otherUser.lastSeenAt || null
            }
          : null;
      }

      return {
        _id: conversation._id,
        type: conversation.type,
        title: displayName,
        imageUrl: displayImage,
        counterpart,
        members: activeMembers.map((member) => {
          const info = userMap.get(String(member.userId || ""));
          return {
            userId: String(member.userId || ""),
            role: member.role || "member",
            name: info?.name || "User",
            avatarUrl: info?.avatarUrl || "",
            isOnline: Boolean(info?.isOnline)
          };
        }),
        lastMessageAt: conversation.lastMessageAt || null,
        lastMessagePreview: conversation.lastMessagePreview || "",
        lastMessageSenderName: conversation.lastMessageSenderName || "",
        unreadCount
      };
    })
  );

  return rows.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
};

const serializeMessage = (message, conversation) => {
  const msg = message?.toObject ? message.toObject() : message;
  const members = getActiveMembers(conversation);
  const createdAt = msg?.createdAt ? new Date(msg.createdAt).getTime() : 0;
  const seenBy = members
    .filter((member) => String(member.userId || "") !== String(msg?.senderId || ""))
    .filter((member) => {
      const seenAt = member?.lastReadAt ? new Date(member.lastReadAt).getTime() : 0;
      return seenAt >= createdAt;
    })
    .map((member) => String(member.userId || ""));

  return {
    ...msg,
    seenBy,
    seenCount: seenBy.length
  };
};

router.get("/search-users", requireAuth, async (req, res) => {
  const q = sanitizeText(req.query.q, 80);
  if (!q) return res.json([]);
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const items = await User.find({
    _id: { $ne: req.user.sub },
    $or: [{ role: "teacher" }, { role: "student", studentApprovalStatus: "approved" }],
    name: regex
  })
    .select("_id name role avatarUrl isOnline lastSeenAt")
    .sort({ name: 1 })
    .limit(20)
    .lean();
  res.json(
    items.map((item) => ({
      userId: String(item._id),
      name: item.name || "User",
      role: item.role || "student",
      avatarUrl: item.avatarUrl || "",
      isOnline: Boolean(item.isOnline),
      lastSeenAt: item.lastSeenAt || null
    }))
  );
});

router.post("/direct", requireAuth, async (req, res) => {
  const targetUserId = sanitizeText(req.body.userId, 80);
  const targetObjectId = toObjectId(targetUserId);
  if (!targetObjectId) {
    return res.status(400).json({ message: "Invalid target user." });
  }
  if (String(targetObjectId) === String(req.user.sub)) {
    return res.status(400).json({ message: "Cannot start chat with yourself." });
  }
  const targetUser = await User.findOne({
    _id: targetObjectId,
    $or: [{ role: "teacher" }, { role: "student", studentApprovalStatus: "approved" }]
  })
    .select("_id name")
    .lean();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found or not approved." });
  }

  const participantKey = directParticipantKey(req.user.sub, targetObjectId);
  let conversation = await Conversation.findOne({ type: "direct", participantKey });
  if (!conversation) {
    conversation = await Conversation.create({
      type: "direct",
      participantKey,
      createdBy: req.user.sub,
      members: [
        {
          userId: req.user.sub,
          role: "member",
          joinedAt: new Date(),
          lastReadAt: new Date(),
          leftAt: null
        },
        {
          userId: targetObjectId,
          role: "member",
          joinedAt: new Date(),
          lastReadAt: null,
          leftAt: null
        }
      ]
    });
  } else {
    conversation.members = (conversation.members || []).map((member) => {
      if (
        String(member.userId || "") === String(req.user.sub) ||
        String(member.userId || "") === String(targetObjectId)
      ) {
        return { ...member.toObject(), leftAt: null };
      }
      return member;
    });
    await conversation.save();
  }

  emitChatConversationCreated({
    conversation,
    userIds: getActiveMemberIds(conversation)
  });
  res.status(201).json({ conversationId: String(conversation._id) });
});

router.post("/groups", requireAuth, async (req, res) => {
  const title = sanitizeText(req.body.title, 100);
  const imageUrl = sanitizeUrl(req.body.imageUrl);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  if (!title) return res.status(400).json({ message: "Group title is required." });

  const normalized = new Set(memberIds.map((id) => sanitizeText(id, 80)).filter(Boolean));
  normalized.add(String(req.user.sub));
  const approvedUsers = await findApprovedUsersByIds(Array.from(normalized));
  if (approvedUsers.length < 2) {
    return res.status(400).json({ message: "Group needs at least 2 approved members." });
  }
  const validIds = new Set(approvedUsers.map((user) => String(user._id)));
  const members = Array.from(validIds).map((id) => ({
    userId: id,
    role: String(id) === String(req.user.sub) ? "admin" : "member",
    joinedAt: new Date(),
    lastReadAt: String(id) === String(req.user.sub) ? new Date() : null,
    leftAt: null
  }));

  const conversation = await Conversation.create({
    type: "group",
    title,
    imageUrl,
    createdBy: req.user.sub,
    members
  });

  emitChatConversationCreated({
    conversation,
    userIds: getActiveMemberIds(conversation)
  });
  res.status(201).json({ conversationId: String(conversation._id) });
});

router.get("/inbox", requireAuth, async (req, res) => {
  const rows = await Conversation.find({
    members: {
      $elemMatch: { userId: req.user.sub, leftAt: null }
    }
  })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(120)
    .lean();

  const data = await buildInboxRows(rows, req.user.sub);
  res.json(data);
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const rows = await Conversation.find({
    members: { $elemMatch: { userId: req.user.sub, leftAt: null } }
  })
    .select("_id members")
    .lean();
  let total = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const me = getMemberMeta(row, req.user.sub);
    const readAt = me?.lastReadAt ? new Date(me.lastReadAt) : null;
    // eslint-disable-next-line no-await-in-loop
    const count = await ConversationMessage.countDocuments({
      conversationId: row._id,
      senderId: { $ne: toObjectId(req.user.sub) },
      deletedAt: null,
      ...(readAt ? { createdAt: { $gt: readAt } } : {})
    });
    total += count;
  }
  res.json({ count: total });
});

router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const conversationId = toObjectId(req.params.id);
  if (!conversationId) return res.status(400).json({ message: "Invalid conversation id." });
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(404).json({ message: "Conversation not found." });
  }
  const limit = parsePositiveInt(req.query.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const before = parseDateSafe(req.query.before);
  const query = {
    conversationId,
    ...(before ? { createdAt: { $lt: before } } : {})
  };

  const itemsDesc = await ConversationMessage.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  const items = [...itemsDesc].reverse().map((item) => serializeMessage(item, conversation));
  const oldest = items[0]?.createdAt ? new Date(items[0].createdAt).toISOString() : null;

  res.json({
    items,
    hasMore: itemsDesc.length === limit,
    nextBefore: oldest
  });
});

router.post("/conversations/:id/read", requireAuth, async (req, res) => {
  const conversationId = toObjectId(req.params.id);
  if (!conversationId) return res.status(400).json({ message: "Invalid conversation id." });
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(404).json({ message: "Conversation not found." });
  }
  conversation.members = (conversation.members || []).map((member) => {
    if (String(member.userId || "") === String(req.user.sub) && !member.leftAt) {
      return { ...member.toObject(), lastReadAt: new Date() };
    }
    return member;
  });
  await conversation.save();
  emitChatConversationUpdated({
    conversation,
    userIds: getActiveMemberIds(conversation)
  });
  res.json({ message: "Read state updated." });
});

router.post("/messages", requireAuth, chatMessageLimiter, async (req, res) => {
  const conversationId = toObjectId(req.body.conversationId);
  const type = sanitizeText(req.body.type, 20);
  const content = String(req.body.content || "").trim();
  const fileName = sanitizeText(req.body.fileName, 200);
  const mimeType = sanitizeText(req.body.mimeType, 120);
  const clientMessageId = sanitizeText(req.body.clientMessageId, 80);
  const replyTo = toObjectId(req.body.replyTo);

  if (!conversationId || !type || !content) {
    return res.status(400).json({ message: "Missing message content." });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(404).json({ message: "Conversation not found." });
  }
  if (type === "announcement" && req.user.role !== "teacher") {
    return res.status(403).json({ message: "Only teachers can send announcements." });
  }

  const created = await ConversationMessage.create({
    conversationId,
    senderId: req.user.sub,
    senderName: req.user.name,
    senderAvatar: req.user.avatarUrl || "",
    senderRole: req.user.role,
    clientMessageId,
    type,
    content,
    fileName,
    mimeType,
    replyTo: replyTo || null
  });

  conversation.lastMessageAt = created.createdAt || new Date();
  conversation.lastMessagePreview = summarizeMessage(created);
  conversation.lastMessageSenderId = req.user.sub;
  conversation.lastMessageSenderName = req.user.name;
  conversation.members = (conversation.members || []).map((member) => {
    if (String(member.userId || "") === String(req.user.sub) && !member.leftAt) {
      return { ...member.toObject(), lastReadAt: new Date() };
    }
    return member;
  });
  await conversation.save();

  const activeMemberIds = getActiveMemberIds(conversation);
  emitChatMessageCreated({
    message: serializeMessage(created, conversation),
    conversationId: String(conversation._id),
    userIds: activeMemberIds
  });
  emitChatConversationUpdated({
    conversation,
    userIds: activeMemberIds
  });

  const recipientIds = activeMemberIds.filter((id) => String(id) !== String(req.user.sub));
  if (recipientIds.length) {
    sendPushToUsers({
      userIds: recipientIds,
      title: `New message from ${req.user.name}`,
      body: summarizeMessage(created),
      data: {
        type: "chat",
        conversationId: String(conversation._id),
        clickAction: "/chat"
      }
    }).catch(() => {});
  }

  return res.status(201).json(serializeMessage(created, conversation));
});

router.put("/messages/:id([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const message = await ConversationMessage.findById(req.params.id);
  if (!message) return res.status(404).json({ message: "Message not found." });
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Forbidden for this message." });
  }
  if (String(message.senderId || "") !== String(req.user.sub)) {
    return res.status(403).json({ message: "Can only edit your own message." });
  }
  if (message.deletedAt) return res.status(400).json({ message: "Deleted messages cannot be edited." });
  if (message.type !== "text" && message.type !== "announcement") {
    return res.status(400).json({ message: "Only text/announcement messages can be edited." });
  }
  const nextContent = String(req.body.content || "").trim();
  if (!nextContent) return res.status(400).json({ message: "Message cannot be empty." });

  message.content = nextContent;
  message.editedAt = new Date();
  await message.save();

  if (String(conversation.lastMessageSenderId || "") === String(req.user.sub)) {
    conversation.lastMessagePreview = summarizeMessage(message);
    await conversation.save();
    emitChatConversationUpdated({ conversation, userIds: getActiveMemberIds(conversation) });
  }
  emitChatMessageUpdated({
    message: serializeMessage(message, conversation),
    conversationId: String(conversation._id),
    userIds: getActiveMemberIds(conversation)
  });
  res.json(serializeMessage(message, conversation));
});

router.delete("/messages/:id([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const message = await ConversationMessage.findById(req.params.id);
  if (!message) return res.status(404).json({ message: "Message not found." });
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Forbidden for this message." });
  }
  if (String(message.senderId || "") !== String(req.user.sub)) {
    return res.status(403).json({ message: "Can only delete your own message." });
  }
  if (!message.deletedAt) {
    message.deletedAt = new Date();
    message.deletedBy = req.user.sub;
    message.editedAt = null;
    message.content = "";
    message.fileName = "";
    message.mimeType = "";
    message.reactions = [];
    await message.save();
  }

  if (String(conversation.lastMessageSenderId || "") === String(req.user.sub)) {
    const latest = await ConversationMessage.findOne({
      conversationId: conversation._id
    })
      .sort({ createdAt: -1 })
      .lean();
    conversation.lastMessageAt = latest?.createdAt || null;
    conversation.lastMessagePreview = latest ? summarizeMessage(latest) : "";
    conversation.lastMessageSenderId = latest?.senderId || null;
    conversation.lastMessageSenderName = latest?.senderName || "";
    await conversation.save();
    emitChatConversationUpdated({ conversation, userIds: getActiveMemberIds(conversation) });
  }
  emitChatMessageUpdated({
    message: serializeMessage(message, conversation),
    conversationId: String(conversation._id),
    userIds: getActiveMemberIds(conversation)
  });
  res.json(serializeMessage(message, conversation));
});

router.post("/messages/:id([0-9a-fA-F]{24})/reactions", requireAuth, chatReactionLimiter, async (req, res) => {
  const emoji = sanitizeText(req.body.emoji, 10);
  if (!emoji) return res.status(400).json({ message: "Missing emoji." });
  const message = await ConversationMessage.findById(req.params.id);
  if (!message) return res.status(404).json({ message: "Message not found." });
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Forbidden for this message." });
  }
  if (message.deletedAt) return res.status(400).json({ message: "Deleted messages cannot be reacted to." });

  const existing = (message.reactions || []).find((item) => String(item.userId || "") === String(req.user.sub));
  if (existing) {
    existing.emoji = emoji;
  } else {
    message.reactions.push({ userId: req.user.sub, emoji });
  }
  await message.save();

  emitChatMessageUpdated({
    message: serializeMessage(message, conversation),
    conversationId: String(conversation._id),
    userIds: getActiveMemberIds(conversation)
  });
  res.json(serializeMessage(message, conversation));
});

router.put("/groups/:id([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== "group") {
    return res.status(404).json({ message: "Group not found." });
  }
  if (!canManageGroup(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Only admins can update group details." });
  }
  const title = sanitizeText(req.body.title, 100);
  const imageUrl = sanitizeUrl(req.body.imageUrl);
  if (title) conversation.title = title;
  if (imageUrl || req.body.imageUrl === "") conversation.imageUrl = imageUrl;
  await conversation.save();

  emitChatConversationUpdated({
    conversation,
    userIds: getActiveMemberIds(conversation)
  });
  res.json({ message: "Group updated." });
});

router.post("/groups/:id([0-9a-fA-F]{24})/members", requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== "group") {
    return res.status(404).json({ message: "Group not found." });
  }
  if (!canManageGroup(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Only admins can add members." });
  }
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  const approvedUsers = await findApprovedUsersByIds(memberIds);
  if (!approvedUsers.length) return res.status(400).json({ message: "No valid users selected." });

  const current = new Map((conversation.members || []).map((member) => [String(member.userId || ""), member]));
  approvedUsers.forEach((user) => {
    const existing = current.get(String(user._id));
    if (existing) {
      existing.leftAt = null;
      if (!existing.joinedAt) existing.joinedAt = new Date();
      return;
    }
    conversation.members.push({
      userId: user._id,
      role: "member",
      joinedAt: new Date(),
      lastReadAt: null,
      leftAt: null
    });
  });
  await conversation.save();

  emitChatConversationUpdated({
    conversation,
    userIds: getActiveMemberIds(conversation)
  });
  res.json({ message: "Members added." });
});

router.delete("/groups/:id([0-9a-fA-F]{24})/members/:userId([0-9a-fA-F]{24})", requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== "group") {
    return res.status(404).json({ message: "Group not found." });
  }
  if (!canManageGroup(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Only admins can remove members." });
  }
  const targetId = String(req.params.userId);
  const adminCount = (conversation.members || []).filter((member) => !member.leftAt && member.role === "admin").length;
  conversation.members = (conversation.members || []).map((member) => {
    if (String(member.userId || "") === targetId && !member.leftAt) {
      if (member.role === "admin" && adminCount <= 1) {
        return member;
      }
      return { ...member.toObject(), leftAt: new Date() };
    }
    return member;
  });
  await conversation.save();
  emitChatConversationUpdated({
    conversation,
    userIds: getActiveMemberIds(conversation).concat([targetId])
  });
  res.json({ message: "Member removed." });
});

router.post("/groups/:id([0-9a-fA-F]{24})/leave", requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || conversation.type !== "group") {
    return res.status(404).json({ message: "Group not found." });
  }
  if (!isActiveMember(conversation, req.user.sub)) {
    return res.status(400).json({ message: "You are not an active member of this group." });
  }
  const myRole = getMemberMeta(conversation, req.user.sub)?.role || "member";
  const adminCount = (conversation.members || []).filter((member) => !member.leftAt && member.role === "admin").length;
  if (myRole === "admin" && adminCount <= 1) {
    return res.status(400).json({ message: "Transfer admin rights before leaving this group." });
  }
  conversation.members = (conversation.members || []).map((member) =>
    String(member.userId || "") === String(req.user.sub) && !member.leftAt
      ? { ...member.toObject(), leftAt: new Date() }
      : member
  );
  await conversation.save();
  emitChatConversationUpdated({
    conversation,
    userIds: getActiveMemberIds(conversation).concat([String(req.user.sub)])
  });
  res.json({ message: "Left group." });
});

router.post("/reports", requireAuth, async (req, res) => {
  const messageId = toObjectId(req.body.messageId);
  const reason = sanitizeText(req.body.reason, 120);
  const note = sanitizeText(req.body.note, 500);
  if (!messageId || !reason) {
    return res.status(400).json({ message: "Message and reason are required." });
  }
  const message = await ConversationMessage.findById(messageId).lean();
  if (!message) return res.status(404).json({ message: "Message not found." });
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation || !isActiveMember(conversation, req.user.sub)) {
    return res.status(403).json({ message: "Cannot report this message." });
  }

  let report = null;
  try {
    report = await ChatReport.create({
      conversationId: conversation._id,
      messageId,
      reporterId: req.user.sub,
      reporterName: req.user.name || "",
      reason,
      note
    });
  } catch (error) {
    if (String(error?.code || "") === "11000") {
      return res.status(409).json({ message: "You already reported this message." });
    }
    throw error;
  }

  let teacherIds = [];
  if (conversation.type === "group") {
    teacherIds = getActiveMembers(conversation)
      .filter((member) => {
        const id = String(member.userId || "");
        return id && id !== String(req.user.sub);
      })
      .map((member) => String(member.userId || ""));
    if (teacherIds.length) {
      const teachers = await User.find({ _id: { $in: teacherIds }, role: "teacher" }).select("_id").lean();
      teacherIds = teachers.map((teacher) => String(teacher._id));
    }
  } else {
    const teachers = await User.find({ role: "teacher" }).select("_id").lean();
    teacherIds = teachers.map((teacher) => String(teacher._id));
  }

  if (teacherIds.length) {
    emitChatReportCreated({
      report,
      userIds: teacherIds
    });
    sendPushToUsers({
      userIds: teacherIds,
      title: "Chat report submitted",
      body: `${req.user.name} reported a message.`,
      data: {
        type: "chat_report",
        reportId: String(report._id),
        clickAction: "/chat"
      }
    }).catch(() => {});
  }
  res.status(201).json({ message: "Report submitted." });
});

router.get("/reports", requireAuth, async (req, res) => {
  if (req.user.role !== "teacher") {
    return res.status(403).json({ message: "Only teachers can review reports." });
  }
  const status = sanitizeText(req.query.status, 20) || "open";
  const rows = await ChatReport.find({ status })
    .sort({ createdAt: -1 })
    .limit(60)
    .lean();

  const result = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const conversation = await Conversation.findById(row.conversationId).lean();
    if (!conversation) continue;
    if (!canTeacherModerateConversation(conversation, req.user)) continue;
    const anchor = await ConversationMessage.findById(row.messageId).lean();
    if (!anchor) continue;

    const before = await ConversationMessage.find({
      conversationId: conversation._id,
      createdAt: { $lt: anchor.createdAt }
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const after = await ConversationMessage.find({
      conversationId: conversation._id,
      createdAt: { $gt: anchor.createdAt }
    })
      .sort({ createdAt: 1 })
      .limit(10)
      .lean();
    const context = [...before.reverse(), anchor, ...after];
    result.push({
      _id: row._id,
      status: row.status,
      reason: row.reason,
      note: row.note,
      reporterName: row.reporterName,
      reporterId: row.reporterId,
      createdAt: row.createdAt,
      handledAt: row.handledAt || null,
      resolutionNote: row.resolutionNote || "",
      conversation: {
        _id: conversation._id,
        type: conversation.type,
        title: conversation.title || ""
      },
      messageId: row.messageId,
      context
    });
  }
  res.json(result);
});

router.post("/reports/:id/resolve", requireAuth, async (req, res) => {
  if (req.user.role !== "teacher") {
    return res.status(403).json({ message: "Only teachers can resolve reports." });
  }
  const report = await ChatReport.findById(req.params.id);
  if (!report) return res.status(404).json({ message: "Report not found." });
  const conversation = await Conversation.findById(report.conversationId).lean();
  if (!conversation || !canTeacherModerateConversation(conversation, req.user)) {
    return res.status(403).json({ message: "Forbidden for this report." });
  }
  const action = sanitizeText(req.body.action, 20);
  report.status = action === "dismissed" ? "dismissed" : "resolved";
  report.resolutionNote = sanitizeText(req.body.resolutionNote, 500);
  report.handledBy = req.user.sub;
  report.handledAt = new Date();
  await report.save();

  emitChatReportUpdated({
    report,
    userIds: [String(report.reporterId || ""), String(req.user.sub)].filter(Boolean)
  });
  res.json({ message: "Report updated." });
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
  const resourceType =
    file.mimetype.startsWith("video") || file.mimetype.startsWith("audio") ? "video" : "image";

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
