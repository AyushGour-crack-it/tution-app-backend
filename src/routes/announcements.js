import express from "express";
import Announcement from "../models/Announcement.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await Announcement.find().sort({ date: -1 }).limit(20);
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const { title, note, date } = req.body;
  if (!title) {
    return res.status(400).json({ message: "Title is required" });
  }
  const created = await Announcement.create({
    title,
    note: note || "",
    date: date ? new Date(date) : new Date()
  });
  return res.status(201).json(created);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Announcement.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Announcement not found" });
  }
  return res.json({ message: "Announcement deleted" });
});

export default router;
