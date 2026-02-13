import express from "express";
import Holiday from "../models/Holiday.js";
import Notification from "../models/Notification.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { emitHolidaysUpdated } from "../utils/realtime.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await Holiday.find().sort({ date: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Holiday.create(req.body);
  emitHolidaysUpdated({ action: "created", holidayId: created._id?.toString() || "" });
  const holidayDate = created.date ? new Date(created.date).toLocaleDateString() : "";
  const details = [holidayDate, created.note].filter(Boolean).join(" - ");
  await Notification.create({
    title: `Holiday: ${created.title}`,
    message: details || `${created.title} has been added to the holiday calendar.`,
    target: "all"
  });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Holiday.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Holiday not found" });
  }
  emitHolidaysUpdated({ action: "updated", holidayId: updated._id?.toString() || "" });
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Holiday.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Holiday not found" });
  }
  emitHolidaysUpdated({ action: "deleted", holidayId: deleted._id?.toString() || "" });
  return res.json({ message: "Holiday deleted" });
});

export default router;
