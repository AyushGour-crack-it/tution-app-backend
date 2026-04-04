import express from "express";
import Mark from "../models/Mark.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { emitLeaderboardUpdated, emitMarksUpdated } from "../utils/realtime.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const query = {};
  if (req.user.role === "student") {
    if (!req.user.studentId) return res.json([]);
    query.studentId = req.user.studentId;
  } else if (req.query.studentId) {
    query.studentId = req.query.studentId;
  }
  const items = await Mark.find(query).sort({ date: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Mark.create(req.body);
  emitMarksUpdated({ action: "created", markId: created._id?.toString() || "" });
  emitLeaderboardUpdated({ source: "marks" });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Mark.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Mark not found" });
  }
  emitMarksUpdated({ action: "updated", markId: updated._id?.toString() || "" });
  emitLeaderboardUpdated({ source: "marks" });
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Mark.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Mark not found" });
  }
  emitMarksUpdated({ action: "deleted", markId: deleted._id?.toString() || "" });
  emitLeaderboardUpdated({ source: "marks" });
  return res.json({ message: "Mark deleted" });
});

// Clear marks for a student or all marks (admin only)
router.delete("/clear/:studentId?", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const { studentId } = req.params;
    const query = studentId ? { studentId } : {};

    const result = await Mark.deleteMany(query);

    emitMarksUpdated({ action: "cleared", studentId: studentId || "all" });
    emitLeaderboardUpdated({ source: "marks" });

    return res.json({
      message: `Cleared ${result.deletedCount} marks`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Error clearing marks:", error);
    return res.status(500).json({ message: "Failed to clear marks" });
  }
});

// Bulk clear marks by criteria
router.post("/clear", requireAuth, requireRole("teacher"), async (req, res) => {
  try {
    const { studentId, subject, class: className, dateRange } = req.body;
    const query = {};

    if (studentId) query.studentId = studentId;
    if (subject) query.subject = subject;
    if (className) query.class = className;
    if (dateRange) {
      query.date = {
        $gte: new Date(dateRange.start),
        $lte: new Date(dateRange.end)
      };
    }

    const result = await Mark.deleteMany(query);

    emitMarksUpdated({ action: "bulk_cleared", criteria: req.body });
    emitLeaderboardUpdated({ source: "marks" });

    return res.json({
      message: `Cleared ${result.deletedCount} marks`,
      deletedCount: result.deletedCount,
      criteria: req.body
    });
  } catch (error) {
    console.error("Error bulk clearing marks:", error);
    return res.status(500).json({ message: "Failed to clear marks" });
  }
});

export default router;
