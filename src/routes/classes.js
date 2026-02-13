import express from "express";
import ClassModel from "../models/Class.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { emitClassesUpdated } from "../utils/realtime.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await ClassModel.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await ClassModel.create(req.body);
  emitClassesUpdated({ action: "created", classId: created._id?.toString() || "" });
  res.status(201).json(created);
});

router.get("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const item = await ClassModel.findById(req.params.id);
  if (!item) {
    return res.status(404).json({ message: "Class not found" });
  }
  return res.json(item);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await ClassModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Class not found" });
  }
  emitClassesUpdated({ action: "updated", classId: updated._id?.toString() || "" });
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await ClassModel.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Class not found" });
  }
  emitClassesUpdated({ action: "deleted", classId: deleted._id?.toString() || "" });
  return res.json({ message: "Class deleted" });
});

export default router;
