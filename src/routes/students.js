import express from "express";
import Student from "../models/Student.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const items = await Student.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Student.create(req.body);
  res.status(201).json(created);
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
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Student.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Student not found" });
  }
  return res.json({ message: "Student deleted" });
});

export default router;
