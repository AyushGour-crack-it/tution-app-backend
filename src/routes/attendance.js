import express from "express";
import Attendance from "../models/Attendance.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const items = await Attendance.find().sort({ date: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Attendance.create(req.body);
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Attendance not found" });
  }
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Attendance.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Attendance not found" });
  }
  return res.json({ message: "Attendance deleted" });
});

export default router;
