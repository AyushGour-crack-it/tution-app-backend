import express from "express";
import mongoose from "mongoose";
import BadgeDefinition from "../models/BadgeDefinition.js";
import BadgeRequest from "../models/BadgeRequest.js";
import StudentBadge from "../models/StudentBadge.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { calculateLevelProgress } from "../utils/gamification.js";
import { sanitizeText } from "../utils/validators.js";

const router = express.Router();

const toPublicBadgeCard = (badge, unlocked) => {
  if (badge.hidden && !unlocked) {
    return {
      key: badge.key,
      title: "Hidden Badge",
      description: "Unlock to reveal this badge.",
      category: badge.category,
      rarity: badge.rarity,
      xpValue: badge.xpValue,
      imageUrl: badge.imageUrl || "",
      hidden: true,
      unlocked: false
    };
  }
  return {
    key: badge.key,
    title: badge.title,
    description: badge.description,
    category: badge.category,
    rarity: badge.rarity,
    xpValue: badge.xpValue,
    imageUrl: badge.imageUrl || "",
    hidden: Boolean(badge.hidden),
    unlocked
  };
};

const loadStudentXp = async (studentUserId) => {
  const earned = await StudentBadge.find({ studentUserId }).lean();
  const totalXp = earned.reduce((sum, badge) => sum + (badge.xpValueSnapshot || 0), 0);
  return { earned, totalXp, levelProgress: calculateLevelProgress(totalXp) };
};

router.get("/catalog", requireAuth, async (req, res) => {
  const badges = await BadgeDefinition.find({ active: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  if (req.user.role !== "student") {
    return res.json(badges);
  }

  const studentUserId = req.user.sub;
  const earned = await StudentBadge.find({ studentUserId }).select("badgeKey").lean();
  const unlockedSet = new Set(earned.map((item) => item.badgeKey));
  const formatted = badges.map((badge) => toPublicBadgeCard(badge, unlockedSet.has(badge.key)));
  return res.json(formatted);
});

router.get("/me", requireAuth, requireRole("student"), async (req, res) => {
  const studentUserId = req.user.sub;
  const { earned, totalXp, levelProgress } = await loadStudentXp(studentUserId);
  const badgeCatalog = await BadgeDefinition.find({ active: true }).lean();
  const catalogByKey = Object.fromEntries(badgeCatalog.map((badge) => [badge.key, badge]));

  const earnedWithMeta = earned
    .map((entry) => {
      const source = catalogByKey[entry.badgeKey];
      return {
        key: entry.badgeKey,
        title: source?.title || entry.titleSnapshot,
        description: source?.description || "",
        category: source?.category || "academic",
        rarity: source?.rarity || entry.raritySnapshot,
        xpValue: entry.xpValueSnapshot || source?.xpValue || 0,
        imageUrl: source?.imageUrl || "",
        awardedAt: entry.awardedAt
      };
    })
    .sort((a, b) => {
      const xpDelta = (Number(a?.xpValue) || 0) - (Number(b?.xpValue) || 0);
      if (xpDelta !== 0) return xpDelta;
      return String(a?.title || "").localeCompare(String(b?.title || ""));
    });

  const pending = await BadgeRequest.find({
    studentUserId,
    status: "pending"
  })
    .select("badgeKey createdAt")
    .lean();

  const pendingSet = new Set(pending.map((item) => item.badgeKey));

  return res.json({
    level: levelProgress,
    totalXp,
    earned: earnedWithMeta,
    pendingBadgeKeys: [...pendingSet]
  });
});

router.get("/requests/mine", requireAuth, requireRole("student"), async (req, res) => {
  const items = await BadgeRequest.find({ studentUserId: req.user.sub })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(items);
});

router.post("/requests", requireAuth, requireRole("student"), async (req, res) => {
  const badgeKey = sanitizeText(req.body.badgeKey, 80);
  const requestMessage = sanitizeText(req.body.requestMessage, 400);
  if (!badgeKey) {
    return res.status(400).json({ message: "badgeKey is required" });
  }
  const badge = await BadgeDefinition.findOne({ key: badgeKey, active: true });
  if (!badge) {
    return res.status(404).json({ message: "Badge not found" });
  }
  const alreadyEarned = await StudentBadge.findOne({
    studentUserId: req.user.sub,
    badgeKey
  });
  if (alreadyEarned) {
    return res.status(409).json({ message: "Badge already unlocked" });
  }
  const pending = await BadgeRequest.findOne({
    studentUserId: req.user.sub,
    badgeKey,
    status: "pending"
  });
  if (pending) {
    return res.status(409).json({ message: "Request already pending" });
  }

  const created = await BadgeRequest.create({
    studentUserId: req.user.sub,
    badgeKey,
    requestMessage
  });

  await Notification.create({
    title: "New Badge Request",
    message: `${req.user.name} requested "${badge.title}".`,
    target: "teacher"
  });

  return res.status(201).json(created);
});

router.get("/requests", requireAuth, requireRole("teacher"), async (req, res) => {
  const status = sanitizeText(req.query.status || "pending", 20);
  const query = ["pending", "approved", "rejected"].includes(status) ? { status } : {};
  const items = await BadgeRequest.find(query)
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  const userIds = [...new Set(items.map((item) => item.studentUserId?.toString()).filter(Boolean))];
  const badgeKeys = [...new Set(items.map((item) => item.badgeKey))];
  const [users, badges] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name studentId avatarUrl").lean(),
    BadgeDefinition.find({ key: { $in: badgeKeys } }).lean()
  ]);
  const userMap = Object.fromEntries(users.map((user) => [user._id.toString(), user]));
  const badgeMap = Object.fromEntries(badges.map((badge) => [badge.key, badge]));

  const enriched = items.map((item) => ({
    ...item,
    student: userMap[item.studentUserId?.toString()] || null,
    badge: badgeMap[item.badgeKey] || null
  }));
  return res.json(enriched);
});

router.post("/requests/:id/review", requireAuth, requireRole("teacher"), async (req, res) => {
  const action = sanitizeText(req.body.action, 20);
  const teacherMessage = sanitizeText(req.body.teacherMessage, 400);
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "action must be approve or reject" });
  }

  const request = await BadgeRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({ message: "Request not found" });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ message: "Request already reviewed" });
  }

  const badge = await BadgeDefinition.findOne({ key: request.badgeKey, active: true });
  if (!badge) {
    return res.status(404).json({ message: "Badge definition not found" });
  }
  const studentUser = await User.findById(request.studentUserId);
  if (!studentUser) {
    return res.status(404).json({ message: "Student user not found" });
  }

  if (action === "reject" && !teacherMessage) {
    return res.status(400).json({ message: "Rejection reason is required" });
  }

  if (action === "approve") {
    if (badge.annualCap && badge.annualCap > 0) {
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);
      const thisYearCount = await StudentBadge.countDocuments({
        badgeKey: badge.key,
        awardedAt: { $gte: yearStart, $lt: yearEnd }
      });
      if (thisYearCount >= badge.annualCap) {
        return res
          .status(400)
          .json({ message: `Annual cap reached for "${badge.title}" (${badge.annualCap}/year)` });
      }
    }
  }

  request.status = action === "approve" ? "approved" : "rejected";
  request.teacherMessage = teacherMessage;
  request.reviewedBy = new mongoose.Types.ObjectId(req.user.sub);
  request.reviewedAt = new Date();
  await request.save();

  if (action === "approve") {
    const existing = await StudentBadge.findOne({
      studentUserId: request.studentUserId,
      badgeKey: request.badgeKey
    });
    if (!existing) {
      await StudentBadge.create({
        studentUserId: request.studentUserId,
        badgeKey: request.badgeKey,
        titleSnapshot: badge.title,
        raritySnapshot: badge.rarity,
        xpValueSnapshot: badge.xpValue,
        awardedBy: req.user.sub,
        awardedAt: new Date()
      });
    }
    await Notification.create({
      title: "Badge Approved",
      message: `You unlocked "${badge.title}" (+${badge.xpValue} XP).`,
      target: "student",
      studentId: studentUser.studentId || null
    });
    if (badge.xpValue >= 1000) {
      await Notification.create({
        title: "Ultra Badge Unlocked",
        message: `${studentUser.name} unlocked "${badge.title}"!`,
        target: "all"
      });
    }
  } else {
    await Notification.create({
      title: "Badge Request Rejected",
      message: `Your request for "${badge.title}" was rejected. ${teacherMessage}`,
      target: "student",
      studentId: studentUser.studentId || null
    });
  }

  return res.json({ message: `Request ${request.status}` });
});

export default router;
