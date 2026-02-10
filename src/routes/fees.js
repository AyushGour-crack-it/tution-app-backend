import express from "express";
import Fee from "../models/Fee.js";
import Receipt from "../models/Receipt.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const query = {};
  if (req.user.role === "student") {
    if (!req.user.studentId) {
      return res.json([]);
    }
    query.studentId = req.user.studentId;
  } else if (req.query.studentId) {
    query.studentId = req.query.studentId;
  }
  const items = await Fee.find(query).sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const created = await Fee.create(req.body);
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const updated = await Fee.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  return res.json(updated);
});

router.post("/:id/payments", requireAuth, requireRole("teacher"), async (req, res) => {
  const { amount, method, reference } = req.body;
  if (!amount) {
    return res.status(400).json({ message: "Amount required" });
  }
  const fee = await Fee.findById(req.params.id);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  fee.payments.push({ amount, paidOn: new Date(), note: reference || "" });
  await fee.save();
  const receipt = await Receipt.create({
    studentId: fee.studentId,
    feeId: fee._id,
    amount,
    paidOn: new Date(),
    method: method || "UPI",
    reference: reference || ""
  });
  return res.status(201).json({ fee, receipt });
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Fee.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  return res.json({ message: "Fee record deleted" });
});

export default router;
