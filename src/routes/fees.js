import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import Fee from "../models/Fee.js";
import Receipt from "../models/Receipt.js";
import Student from "../models/Student.js";
import Notification from "../models/Notification.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { paymentLimiter } from "../utils/rateLimiters.js";

const router = express.Router();

const getRazorpay = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    return null;
  }
  return new Razorpay({ key_id, key_secret });
};

const notifyTeacherPayment = async ({ fee, amount, method }) => {
  const student = await Student.findById(fee.studentId).select("name studentId").lean();
  const studentName = student?.name || student?.studentId || "A student";
  await Notification.create({
    title: "Fee Received",
    message: `${studentName} paid ₹${Number(amount || 0)} via ${method || "UPI"}.`,
    target: "teacher"
  });
};

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

router.post("/:id/payments", requireAuth, requireRole("teacher"), paymentLimiter, async (req, res) => {
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
  await notifyTeacherPayment({ fee, amount, method: method || "UPI" });
  return res.status(201).json({ fee, receipt });
});

router.post("/:id/razorpay/order", requireAuth, paymentLimiter, async (req, res) => {
  const { amount } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ message: "Amount required" });
  }
  const fee = await Fee.findById(req.params.id);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  if (req.user.role === "student" && String(fee.studentId) !== String(req.user.studentId || "")) {
    return res.status(403).json({ message: "Forbidden for this fee record" });
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    return res.status(500).json({ message: "Razorpay is not configured" });
  }

  const order = await razorpay.orders.create({
    amount: Math.round(Number(amount) * 100),
    currency: "INR",
    notes: {
      feeId: String(fee._id),
      studentId: String(fee.studentId)
    }
  });

  return res.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID
  });
});

router.post("/:id/razorpay/verify", requireAuth, paymentLimiter, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount) {
    return res.status(400).json({ message: "Missing payment verification fields" });
  }
  const fee = await Fee.findById(req.params.id);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  if (req.user.role === "student" && String(fee.studentId) !== String(req.user.studentId || "")) {
    return res.status(403).json({ message: "Forbidden for this fee record" });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return res.status(500).json({ message: "Razorpay secret not configured" });
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
  if (expected !== razorpay_signature) {
    return res.status(400).json({ message: "Invalid payment signature" });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: "Invalid amount" });
  }

  fee.payments.push({
    amount: numericAmount,
    paidOn: new Date(),
    note: `Razorpay:${razorpay_payment_id}`
  });
  await fee.save();

  const receipt = await Receipt.create({
    studentId: fee.studentId,
    feeId: fee._id,
    amount: numericAmount,
    paidOn: new Date(),
    method: "Razorpay",
    reference: razorpay_payment_id
  });
  await notifyTeacherPayment({ fee, amount: numericAmount, method: "Razorpay" });

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
