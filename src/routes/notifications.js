import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const query = { target: "all" };
  if (req.user.role === "student" && req.user.studentId) {
    query.$or = [{ target: "all" }, { target: "student", studentId: req.user.studentId }];
  }
  const items = await Notification.find(query).sort({ createdAt: -1 }).limit(50);
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const { title, message, studentId } = req.body;
  if (!title || !message) {
    return res.status(400).json({ message: "Missing title or message" });
  }
  const created = await Notification.create({
    title,
    message,
    target: studentId ? "student" : "all",
    studentId: studentId || null
  });
  res.status(201).json(created);
});

router.post("/:id/read", requireAuth, async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) {
    return res.status(404).json({ message: "Notification not found" });
  }
  const already = notification.readBy.some((id) => id.toString() === req.user.sub);
  if (!already) {
    notification.readBy.push(req.user.sub);
    await notification.save();
  }
  res.json({ message: "Marked read" });
});

export default router;
