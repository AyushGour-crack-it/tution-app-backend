import express from "express";
import multer from "multer";
import { Readable } from "stream";
import PopupCampaign from "../models/PopupCampaign.js";
import cloudinary from "../utils/cloudinary.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { emitPopupCampaignsUpdated } from "../utils/realtime.js";
import { popupImageUploadLimiter } from "../utils/rateLimiters.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 7 * 1024 * 1024 } });

const TEMPLATE_SET = new Set(["announcement", "celebration", "deadline", "festival", "achievement"]);

const sanitizeText = (value, maxLen) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);

const sanitizeUrl = (value) => {
  const raw = sanitizeText(value, 500);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
};

const buildCampaignStatus = (campaign, now = new Date()) => {
  if (!campaign?.isActive) return "inactive";
  if (campaign?.startAt && new Date(campaign.startAt).getTime() > now.getTime()) return "scheduled";
  if (campaign?.endAt && new Date(campaign.endAt).getTime() < now.getTime()) return "expired";
  return "live";
};

router.get("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const now = new Date();
  const items = await PopupCampaign.find()
    .sort({ createdAt: -1 })
    .limit(150)
    .lean();

  const mapped = items.map((item) => ({
    ...item,
    status: buildCampaignStatus(item, now)
  }));

  res.json(mapped);
});

router.get("/active", requireAuth, async (req, res) => {
  if (req.user.role !== "student") {
    return res.json([]);
  }
  const now = new Date();
  const studentId = req.user.studentId || null;
  const items = await PopupCampaign.find({
    isActive: true,
    startAt: { $lte: now },
    $and: [
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
      { $or: [{ target: "all_students" }, { target: "single_student", studentId }] }
    ]
  })
    .sort({ priority: -1, startAt: -1, createdAt: -1 })
    .limit(8)
    .lean();

  res.set("Cache-Control", "private, max-age=5");
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const title = sanitizeText(req.body.title, 120);
  const message = sanitizeText(req.body.message, 800);
  const templateRaw = sanitizeText(req.body.template, 30).toLowerCase();
  const template = TEMPLATE_SET.has(templateRaw) ? templateRaw : "announcement";
  const targetRaw = sanitizeText(req.body.target, 30).toLowerCase();
  const target = targetRaw === "single_student" ? "single_student" : "all_students";
  const studentId = target === "single_student" ? sanitizeText(req.body.studentId, 60) : "";
  const startAt = req.body.startAt ? new Date(req.body.startAt) : new Date();
  const endAt = req.body.endAt ? new Date(req.body.endAt) : null;
  const ctaLabel = sanitizeText(req.body.ctaLabel, 30);
  const ctaUrl = sanitizeUrl(req.body.ctaUrl);
  const imageUrl = sanitizeUrl(req.body.imageUrl);
  const showOncePerUser = req.body.showOncePerUser !== false;
  const isActive = req.body.isActive !== false;
  const priority = Math.max(0, Math.min(100, Number(req.body.priority) || 0));

  if (!title || !message) {
    return res.status(400).json({ message: "Title and message are required." });
  }
  if (Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ message: "Invalid start date/time." });
  }
  if (endAt && Number.isNaN(endAt.getTime())) {
    return res.status(400).json({ message: "Invalid end date/time." });
  }
  if (endAt && endAt.getTime() <= startAt.getTime()) {
    return res.status(400).json({ message: "End date/time must be after start date/time." });
  }
  if (target === "single_student" && !studentId) {
    return res.status(400).json({ message: "Please select a student for single-student targeting." });
  }

  const created = await PopupCampaign.create({
    title,
    message,
    template,
    target,
    studentId: target === "single_student" ? studentId : null,
    startAt,
    endAt,
    ctaLabel,
    ctaUrl,
    imageUrl,
    showOncePerUser,
    isActive,
    priority,
    createdBy: req.user.sub
  });

  emitPopupCampaignsUpdated({ action: "created", campaignId: created._id?.toString() || "" });
  res.status(201).json(created);
});

router.post(
  "/upload-image",
  requireAuth,
  requireRole("teacher"),
  popupImageUploadLimiter,
  upload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "Missing image file." });
    }
    if (!String(file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ message: "Only image files are allowed." });
    }
    try {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder: "ayush-popup-campaigns" },
          (error, result) => {
            if (error) return reject(error);
            return resolve(result);
          }
        );
        Readable.from(file.buffer).pipe(stream);
      });
      return res.json({ imageUrl: uploadResult.secure_url || "" });
    } catch {
      return res.status(400).json({ message: "Image upload failed. Check Cloudinary configuration." });
    }
  }
);

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const existing = await PopupCampaign.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ message: "Popup campaign not found." });
  }

  const title = sanitizeText(req.body.title, 120);
  const message = sanitizeText(req.body.message, 800);
  const templateRaw = sanitizeText(req.body.template, 30).toLowerCase();
  const template = TEMPLATE_SET.has(templateRaw) ? templateRaw : "announcement";
  const targetRaw = sanitizeText(req.body.target, 30).toLowerCase();
  const target = targetRaw === "single_student" ? "single_student" : "all_students";
  const studentId = target === "single_student" ? sanitizeText(req.body.studentId, 60) : "";
  const startAt = req.body.startAt ? new Date(req.body.startAt) : existing.startAt;
  const endAt = req.body.endAt ? new Date(req.body.endAt) : null;
  const ctaLabel = sanitizeText(req.body.ctaLabel, 30);
  const ctaUrl = sanitizeUrl(req.body.ctaUrl);
  const imageUrl = sanitizeUrl(req.body.imageUrl);
  const showOncePerUser = req.body.showOncePerUser !== false;
  const isActive = req.body.isActive !== false;
  const priority = Math.max(0, Math.min(100, Number(req.body.priority) || 0));

  if (!title || !message) {
    return res.status(400).json({ message: "Title and message are required." });
  }
  if (Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ message: "Invalid start date/time." });
  }
  if (endAt && Number.isNaN(endAt.getTime())) {
    return res.status(400).json({ message: "Invalid end date/time." });
  }
  if (endAt && endAt.getTime() <= startAt.getTime()) {
    return res.status(400).json({ message: "End date/time must be after start date/time." });
  }
  if (target === "single_student" && !studentId) {
    return res.status(400).json({ message: "Please select a student for single-student targeting." });
  }

  existing.title = title;
  existing.message = message;
  existing.template = template;
  existing.target = target;
  existing.studentId = target === "single_student" ? studentId : null;
  existing.startAt = startAt;
  existing.endAt = endAt;
  existing.ctaLabel = ctaLabel;
  existing.ctaUrl = ctaUrl;
  existing.imageUrl = imageUrl;
  existing.showOncePerUser = showOncePerUser;
  existing.isActive = isActive;
  existing.priority = priority;
  await existing.save();

  emitPopupCampaignsUpdated({ action: "updated", campaignId: existing._id?.toString() || "" });
  res.json(existing);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await PopupCampaign.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Popup campaign not found." });
  }
  emitPopupCampaignsUpdated({ action: "deleted", campaignId: String(req.params.id || "") });
  res.json({ message: "Popup campaign deleted." });
});

export default router;
