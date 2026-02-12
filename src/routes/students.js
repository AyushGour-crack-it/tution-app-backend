import express from "express";
import Student from "../models/Student.js";
import User from "../models/User.js";
import StudentBadge from "../models/StudentBadge.js";
import BadgeRequest from "../models/BadgeRequest.js";
import BadgeDefinition from "../models/BadgeDefinition.js";
import Attendance from "../models/Attendance.js";
import Mark from "../models/Mark.js";
import Fee from "../models/Fee.js";
import Receipt from "../models/Receipt.js";
import Invoice from "../models/Invoice.js";
import Notification from "../models/Notification.js";
import Message from "../models/Message.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { calculateLevelProgress } from "../utils/gamification.js";
import { emitLeaderboardUpdated, emitStudentsUpdated } from "../utils/realtime.js";

const router = express.Router();

const mapDirectoryItem = ({
  user,
  profile,
  earned,
  definitionMap,
  viewerUserId
}) => {
  const totalXp = earned.reduce((sum, badge) => sum + (badge.xpValueSnapshot || 0), 0);
  const level = calculateLevelProgress(totalXp);
  return {
    userId: user._id.toString(),
    name: user.name || "",
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    studentProfileId: user.studentId ? user.studentId.toString() : "",
    rollNumber: profile?.rollNumber || "",
    grade: profile?.grade || "",
    level,
    totalXp,
    likesCount: Array.isArray(user.profileLikedBy) ? user.profileLikedBy.length : 0,
    likedByMe: Array.isArray(user.profileLikedBy)
      ? user.profileLikedBy.some((likedUserId) => likedUserId.toString() === viewerUserId)
      : false,
    badges: earned
      .map((badge) => {
        const definition = definitionMap[badge.badgeKey];
        return {
          key: badge.badgeKey,
          title: definition?.title || badge.titleSnapshot,
          category: definition?.category || "",
          rarity: definition?.rarity || badge.raritySnapshot,
          xpValue: badge.xpValueSnapshot || definition?.xpValue || 0,
          imageUrl: definition?.imageUrl || ""
        };
      })
      .sort((a, b) => {
        const xpDelta = (Number(a?.xpValue) || 0) - (Number(b?.xpValue) || 0);
        if (xpDelta !== 0) return xpDelta;
        return String(a?.title || "").localeCompare(String(b?.title || ""));
      })
  };
};

router.get("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const items = await Student.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Student.create(req.body);
  emitStudentsUpdated({ action: "created", studentId: created._id?.toString() || "" });
  res.status(201).json(created);
});

router.get("/directory", requireAuth, async (req, res) => {
  const users = await User.find({ role: "student" })
    .select("name avatarUrl bio studentId profileLikedBy")
    .lean();

  const studentIds = users
    .map((user) => user.studentId)
    .filter(Boolean);

  const studentProfiles = await Student.find({ _id: { $in: studentIds } })
    .select("rollNumber grade")
    .lean();
  const studentUserIds = users.map((user) => user._id);
  const [earnedBadges, badgeDefinitions] = await Promise.all([
    StudentBadge.find({ studentUserId: { $in: studentUserIds } }).lean(),
    BadgeDefinition.find({ active: true }).lean()
  ]);
  const definitionMap = Object.fromEntries(
    badgeDefinitions.map((definition) => [definition.key, definition])
  );
  const earnedByUserId = earnedBadges.reduce((acc, badge) => {
    const key = badge.studentUserId.toString();
    if (!acc[key]) acc[key] = [];
    acc[key].push(badge);
    return acc;
  }, {});

  const profileLookup = Object.fromEntries(
    studentProfiles.map((profile) => [profile._id.toString(), profile])
  );

  const directory = users
    .map((user) => {
      const profileId = user.studentId ? user.studentId.toString() : "";
      const profile = profileLookup[profileId] || null;
      const earned = earnedByUserId[user._id.toString()] || [];
      return mapDirectoryItem({
        user,
        profile,
        earned,
        definitionMap,
        viewerUserId: req.user.sub
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(directory);
});

router.get("/directory/:userId", requireAuth, async (req, res) => {
  const targetUser = await User.findOne({ _id: req.params.userId, role: "student" })
    .select("name avatarUrl bio studentId profileLikedBy")
    .lean();
  if (!targetUser) {
    return res.status(404).json({ message: "Student not found" });
  }

  const [profile, earned, badgeDefinitions] = await Promise.all([
    targetUser.studentId ? Student.findById(targetUser.studentId).select("rollNumber grade").lean() : null,
    StudentBadge.find({ studentUserId: targetUser._id }).lean(),
    BadgeDefinition.find({ active: true }).lean()
  ]);

  const definitionMap = Object.fromEntries(
    badgeDefinitions.map((definition) => [definition.key, definition])
  );

  const item = mapDirectoryItem({
    user: targetUser,
    profile,
    earned,
    definitionMap,
    viewerUserId: req.user.sub
  });
  return res.json(item);
});

router.post("/:userId/like", requireAuth, requireRole("student"), async (req, res) => {
  const currentUserId = req.user.sub;
  const targetUserId = String(req.params.userId || "");

  if (!targetUserId) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  if (currentUserId === targetUserId) {
    return res.status(400).json({ message: "You cannot like your own profile" });
  }

  const target = await User.findOne({ _id: targetUserId, role: "student" }).select("profileLikedBy");
  if (!target) {
    return res.status(404).json({ message: "Student not found" });
  }

  const currentlyLiked = (target.profileLikedBy || []).some(
    (likedUserId) => likedUserId.toString() === currentUserId
  );

  if (currentlyLiked) {
    await User.updateOne(
      { _id: targetUserId },
      { $pull: { profileLikedBy: currentUserId } }
    );
  } else {
    await User.updateOne(
      { _id: targetUserId },
      { $addToSet: { profileLikedBy: currentUserId } }
    );
  }

  const updated = await User.findById(targetUserId).select("profileLikedBy").lean();
  const likesCount = Array.isArray(updated?.profileLikedBy) ? updated.profileLikedBy.length : 0;
  emitStudentsUpdated({ action: "liked", userId: targetUserId });
  return res.json({
    liked: !currentlyLiked,
    likesCount
  });
});

router.get("/me", requireAuth, requireRole("student"), async (req, res) => {
  if (!req.user.studentId) {
    return res.status(404).json({ message: "Student profile not linked" });
  }
  const item = await Student.findById(req.user.studentId);
  if (!item) {
    return res.status(404).json({ message: "Student not found" });
  }
  return res.json(item);
});

router.get("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const item = await Student.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Student not found" });
  }
  return res.json(item);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Student not found" });
  }
  emitStudentsUpdated({ action: "updated", studentId: updated._id?.toString() || "" });
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Student.findById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Student not found" });
  }

  const linkedUsers = await User.find({
    role: "student",
    studentId: deleted._id
  })
    .select("_id")
    .lean();
  const linkedUserIds = linkedUsers.map((item) => item._id);

  await Promise.all([
    Student.findByIdAndDelete(deleted._id),
    User.deleteMany({ _id: { $in: linkedUserIds } }),
    User.updateMany(
      { profileLikedBy: { $in: linkedUserIds } },
      { $pull: { profileLikedBy: { $in: linkedUserIds } } }
    ),
    StudentBadge.deleteMany({ studentUserId: { $in: linkedUserIds } }),
    BadgeRequest.deleteMany({ studentUserId: { $in: linkedUserIds } }),
    Attendance.deleteMany({ studentId: deleted._id }),
    Mark.deleteMany({ studentId: deleted._id }),
    Fee.deleteMany({ studentId: deleted._id }),
    Receipt.deleteMany({ studentId: deleted._id }),
    Invoice.deleteMany({ studentId: deleted._id }),
    Notification.deleteMany({ studentId: deleted._id }),
    Notification.updateMany(
      { readBy: { $in: linkedUserIds } },
      { $pull: { readBy: { $in: linkedUserIds } } }
    ),
    Notification.updateMany(
      { dismissedBy: { $in: linkedUserIds } },
      { $pull: { dismissedBy: { $in: linkedUserIds } } }
    ),
    Message.deleteMany({
      $or: [
        { senderId: { $in: linkedUserIds } },
        { recipientUserId: { $in: linkedUserIds } },
        { recipientStudentId: deleted._id }
      ]
    })
  ]);

  emitStudentsUpdated({ action: "deleted", studentId: deleted._id?.toString() || "" });
  emitLeaderboardUpdated({ source: "students" });

  return res.json({ message: "Student deleted" });
});

export default router;
