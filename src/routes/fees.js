import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import Fee from "../models/Fee.js";
import Receipt from "../models/Receipt.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import OfflinePaymentRequest from "../models/OfflinePaymentRequest.js";
import { requireAuth, requireRole } from "../utils/auth.js";
import { paymentLimiter } from "../utils/rateLimiters.js";
import { sanitizeText } from "../utils/validators.js";
import { emitFeeUpdated } from "../utils/realtime.js";

const router = express.Router();

const normalizeToDayStart = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const parseFeeMonth = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return null;
  const direct = new Date(`${text} 01`);
  if (!Number.isNaN(direct.getTime())) {
    return { year: direct.getFullYear(), monthIndex: direct.getMonth() };
  }
  const yyyyMm = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yyyyMm) {
    const year = Number(yyyyMm[1]);
    const month = Number(yyyyMm[2]);
    if (month >= 1 && month <= 12) {
      return { year, monthIndex: month - 1 };
    }
  }
  return null;
};

const computeDueDate = ({ month, joinedAt }) => {
  const parsed = parseFeeMonth(month);
  if (!parsed || !joinedAt) return null;
  const anchor = new Date(joinedAt);
  if (Number.isNaN(anchor.getTime())) return null;
  const dueDay = anchor.getDate() || 1;
  const lastDate = new Date(parsed.year, parsed.monthIndex + 1, 0).getDate();
  const day = Math.min(dueDay, lastDate);
  return new Date(parsed.year, parsed.monthIndex, day, 9, 0, 0, 0);
};

const resolveDueDateForFee = async (fee) => {
  if (fee?.dueDate) return fee.dueDate;
  const student = await Student.findById(fee.studentId).select("joinedAt").lean();
  const computed = computeDueDate({ month: fee?.month, joinedAt: student?.joinedAt });
  if (computed && fee?.save) {
    fee.dueDate = computed;
    await fee.save();
  }
  return computed;
};

const computeFeeXp = ({ dueDate, paidOn }) => {
  if (!dueDate) {
    return { lateDays: 0, xpAwarded: 50 };
  }
  const due = normalizeToDayStart(dueDate);
  const paid = normalizeToDayStart(paidOn || new Date());
  const lateDays = Math.max(0, Math.floor((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  if (lateDays === 0) {
    return { lateDays: 0, xpAwarded: 60 };
  }
  return { lateDays, xpAwarded: Math.max(25, 60 - lateDays) };
};

const getRazorpay = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    return null;
  }
  return new Razorpay({ key_id, key_secret });
};

const notifyTeacherPayment = async ({ fee, amount, method, lateDays = 0, dueDate = null }) => {
  const student = await Student.findById(fee.studentId).select("name studentId phone guardian").lean();
  const studentName = student?.name || student?.studentId || "A student";
  const phone = student?.phone || student?.guardian?.phone || "";
  const timeliness = lateDays > 0
    ? `${lateDays} day(s) late`
    : "on time";
  await Notification.create({
    title: "Fee Received",
    message:
      `${studentName}${phone ? ` (${phone})` : ""} paid ₹${Number(amount || 0)} via ${method || "UPI"} (${timeliness})` +
      `${dueDate ? `, due ${new Date(dueDate).toLocaleDateString()}` : ""}.`,
    target: "teacher"
  });
};

const awardStudentPaymentXp = async ({ fee, amount, method, source, lateDays = 0, xpAwarded = 0 }) => {
  const studentUser = await User.findOne({ role: "student", studentId: fee.studentId }).select("_id bonusXp").lean();
  if (!studentUser?._id) return;
  await User.updateOne(
    { _id: studentUser._id },
    { $inc: { bonusXp: Number(xpAwarded || 0) } }
  );
  const timelinessMessage = lateDays > 0
    ? `Paid ${lateDays} day(s) late.`
    : "Paid on time.";
  await Notification.create({
    title: "Payment Received",
    message:
      `Your payment has been received 🙏 Thank you for being a part of our learning community. ` +
      `₹${Number(amount || 0)} via ${method || "UPI"} (${source}). ${timelinessMessage} +${Number(xpAwarded || 0)} XP added.`,
    target: "student",
    studentId: fee.studentId
  });
};

const createPaymentRecord = async ({ fee, amount, method, reference = "", source = "manual" }) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Invalid amount");
  }

  const dueDate = await resolveDueDateForFee(fee);
  const paidOn = new Date();
  const { lateDays, xpAwarded } = computeFeeXp({ dueDate, paidOn });

  fee.payments.push({
    amount: numericAmount,
    paidOn,
    note: reference || "",
    method: method || "UPI",
    reference: reference || "",
    source,
    dueDateSnapshot: dueDate || null,
    lateDays,
    xpAwarded
  });
  await fee.save();
  emitFeeUpdated({ fee, action: "payment_added" });

  const receipt = await Receipt.create({
    studentId: fee.studentId,
    feeId: fee._id,
    amount: numericAmount,
    paidOn,
    method: method || "UPI",
    reference: reference || "",
    dueDate: dueDate || null,
    lateDays,
    xpAwarded
  });

  await notifyTeacherPayment({
    fee,
    amount: numericAmount,
    method: method || "UPI",
    lateDays,
    dueDate
  });
  await awardStudentPaymentXp({
    fee,
    amount: numericAmount,
    method: method || "UPI",
    source,
    lateDays,
    xpAwarded
  });

  return { fee, receipt, lateDays, xpAwarded, dueDate };
};

const listPaymentTransactions = async () => {
  const receipts = await Receipt.find()
    .sort({ paidOn: -1, createdAt: -1 })
    .limit(200)
    .populate("studentId", "name studentId phone guardian")
    .lean();

  const byStudent = new Map();
  receipts.forEach((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    if (!key) return;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(receipt);
  });

  return receipts.slice(0, 60).map((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    const history = byStudent.get(key) || [];
    const index = history.findIndex((item) => String(item?._id || "") === String(receipt?._id || ""));
    const previous = index >= 0 ? history[index + 1] : null;
    const currentPaidOn = receipt?.paidOn ? new Date(receipt.paidOn) : new Date(receipt.createdAt);
    const previousPaidOn = previous?.paidOn ? new Date(previous.paidOn) : previous?.createdAt ? new Date(previous.createdAt) : null;
    const daysSincePrevious = previousPaidOn
      ? Math.max(0, Math.floor((currentPaidOn.getTime() - previousPaidOn.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    return {
      receiptId: receipt._id,
      feeId: receipt.feeId,
      studentName: receipt?.studentId?.name || receipt?.studentId?.studentId || "Student",
      studentPhone: receipt?.studentId?.phone || receipt?.studentId?.guardian?.phone || "",
      amount: Number(receipt?.amount || 0),
      method: receipt?.method || "UPI",
      reference: receipt?.reference || "",
      paidOn: receipt?.paidOn || receipt?.createdAt,
      dueDate: receipt?.dueDate || null,
      lateDays: Number(receipt?.lateDays || 0),
      xpAwarded: Number(receipt?.xpAwarded || 0),
      daysSincePrevious
    };
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
  for (const fee of items) {
    if (!fee?.dueDate) {
      await resolveDueDateForFee(fee);
    }
  }
  res.json(items);
});

router.get("/transactions", requireAuth, requireRole("teacher"), async (req, res) => {
  const items = await listPaymentTransactions();
  res.json(items);
});

router.get("/offline-requests", requireAuth, requireRole("teacher"), async (req, res) => {
  const status = sanitizeText(req.query.status, 20);
  const query = status && ["pending", "approved", "rejected"].includes(status)
    ? { status }
    : {};
  const items = await OfflinePaymentRequest.find(query)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("studentId", "name studentId phone guardian")
    .populate("feeId", "month total payments")
    .lean();
  res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const payload = { ...req.body };
  if (!payload.dueDate && payload.studentId && payload.month) {
    const student = await Student.findById(payload.studentId).select("joinedAt").lean();
    payload.dueDate = computeDueDate({ month: payload.month, joinedAt: student?.joinedAt });
  }
  const created = await Fee.create(payload);
  emitFeeUpdated({ fee: created, action: "created" });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const current = await Fee.findById(req.params.id).select("studentId month").lean();
  if (!current) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  const payload = { ...req.body };
  if (!payload.dueDate) {
    const studentId = payload.studentId || current.studentId;
    const month = payload.month || current.month;
    if (studentId && month) {
      const student = await Student.findById(studentId).select("joinedAt").lean();
      payload.dueDate = computeDueDate({ month, joinedAt: student?.joinedAt });
    }
  }
  const updated = await Fee.findByIdAndUpdate(req.params.id, payload, { new: true });
  if (!updated) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  emitFeeUpdated({ fee: updated, action: "updated" });
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
  const created = await createPaymentRecord({
    fee,
    amount,
    method: method || "UPI",
    reference: reference || "",
    source: "manual"
  });
  return res.status(201).json(created);
});

router.post("/:id/offline-request", requireAuth, requireRole("student"), paymentLimiter, async (req, res) => {
  const amount = Number(req.body.amount);
  const message = sanitizeText(req.body.message, 400);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Valid amount is required" });
  }

  const fee = await Fee.findById(req.params.id);
  if (!fee) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  if (String(fee.studentId) !== String(req.user.studentId || "")) {
    return res.status(403).json({ message: "Forbidden for this fee record" });
  }

  const existingPending = await OfflinePaymentRequest.findOne({
    feeId: fee._id,
    studentUserId: req.user.sub,
    status: "pending"
  });
  if (existingPending) {
    return res.status(409).json({ message: "You already have a pending offline payment request" });
  }

  const created = await OfflinePaymentRequest.create({
    feeId: fee._id,
    studentId: fee.studentId,
    studentUserId: req.user.sub,
    amount,
    message
  });

  await Notification.create({
    title: "Offline Payment Request",
    message: `${req.user.name} requested offline payment confirmation of ₹${amount}${message ? ` (${message})` : ""}.`,
    target: "teacher"
  });

  return res.status(201).json(created);
});

router.post("/offline-requests/:id/review", requireAuth, requireRole("teacher"), paymentLimiter, async (req, res) => {
  const action = sanitizeText(req.body.action, 20);
  const teacherNote = sanitizeText(req.body.teacherNote, 300);
  const method = sanitizeText(req.body.method, 30) || "Cash";
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "action must be approve or reject" });
  }

  const request = await OfflinePaymentRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({ message: "Offline request not found" });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ message: "Request already reviewed" });
  }

  request.status = action === "approve" ? "approved" : "rejected";
  request.teacherNote = teacherNote;
  request.reviewedBy = req.user.sub;
  request.reviewedAt = new Date();
  await request.save();

  if (action === "approve") {
    const fee = await Fee.findById(request.feeId);
    if (!fee) {
      return res.status(404).json({ message: "Fee record not found for approval" });
    }

    const reference = `OfflineReq:${request._id}`;
    const paymentResult = await createPaymentRecord({
      fee,
      amount: request.amount,
      method,
      reference,
      source: "offline"
    });

    await Notification.create({
      title: "Offline Payment Approved",
      message:
        `Your offline payment request of ₹${request.amount} has been approved. ` +
        `${paymentResult?.lateDays > 0 ? `Paid ${paymentResult.lateDays} day(s) late.` : "Paid on time."} ` +
        `+${Number(paymentResult?.xpAwarded || 0)} XP added.`,
      target: "student",
      studentId: request.studentId
    });
  } else {
    await Notification.create({
      title: "Offline Payment Rejected",
      message: `Your offline payment request was rejected.${teacherNote ? ` ${teacherNote}` : ""}`,
      target: "student",
      studentId: request.studentId
    });
  }

  return res.json({ message: `Offline request ${request.status}` });
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

  const created = await createPaymentRecord({
    fee,
    amount: numericAmount,
    method: "Razorpay",
    reference: razorpay_payment_id,
    source: "online"
  });

  return res.status(201).json(created);
});

router.delete("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  const deleted = await Fee.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Fee record not found" });
  }
  emitFeeUpdated({ fee: deleted, action: "deleted" });
  return res.json({ message: "Fee record deleted" });
});

export default router;
