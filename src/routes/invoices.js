import express from "express";
import Invoice from "../models/Invoice.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const query = {};
  if (req.user.role === "student") {
    if (!req.user.studentId) return res.json([]);
    query.studentId = req.user.studentId;
  } else if (req.query.studentId) {
    query.studentId = req.query.studentId;
  }
  const items = await Invoice.find(query).sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const { studentId, number, status, dueDate, items, total } = req.body;
  if (!studentId || !number || total === undefined) {
    return res.status(400).json({ message: "Missing invoice fields" });
  }
  const created = await Invoice.create({
    studentId,
    number,
    status: status || "draft",
    dueDate: dueDate || null,
    items: items || [],
    total
  });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Invoice.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  res.json({ message: "Invoice deleted" });
});

export default router;
