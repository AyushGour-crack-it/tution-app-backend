import express from "express";
import Holiday from "../models/Holiday.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await Holiday.find().sort({ date: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Holiday.create(req.body);
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Holiday.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Holiday not found" });
  }
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Holiday.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Holiday not found" });
  }
  return res.json({ message: "Holiday deleted" });
});

export default router;
