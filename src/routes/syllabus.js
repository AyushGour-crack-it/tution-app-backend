import express from "express";
import SyllabusItem from "../models/SyllabusItem.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { emitSyllabusUpdated } from "../utils/realtime.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await SyllabusItem.find().sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await SyllabusItem.create(req.body);
  emitSyllabusUpdated({ action: "created", syllabusId: created._id?.toString() || "" });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await SyllabusItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Syllabus item not found" });
  }
  emitSyllabusUpdated({ action: "updated", syllabusId: updated._id?.toString() || "" });
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await SyllabusItem.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Syllabus item not found" });
  }
  emitSyllabusUpdated({ action: "deleted", syllabusId: deleted._id?.toString() || "" });
  return res.json({ message: "Syllabus item deleted" });
});

export default router;
