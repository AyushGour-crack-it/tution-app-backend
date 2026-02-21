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

const DAY_MS = 1000 * 60 * 60 * 24;

const normalizeToDayStart = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const monthKeyFromDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabelFromKey = (monthKey = "") => {
  const match = String(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return "";
  }
  return new Date(year, monthIndex, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
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

const monthKeyFromFeeInput = ({ monthKey = "", month = "" }) => {
  const direct = String(monthKey || "").trim();
  if (/^\d{4}-\d{2}$/.test(direct)) return direct;
  const parsed = parseFeeMonth(month);
  if (!parsed) return "";
  return `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, "0")}`;
};

const computeDueDate = ({ monthKey = "", month = "", joinedAt }) => {
  const resolvedKey = monthKeyFromFeeInput({ monthKey, month });
  if (!resolvedKey || !joinedAt) return null;
  const anchor = new Date(joinedAt);
  if (Number.isNaN(anchor.getTime())) return null;
  const parsed = parseFeeMonth(resolvedKey);
  if (!parsed) return null;
  const dueDay = anchor.getDate() || 1;
  const lastDate = new Date(parsed.year, parsed.monthIndex + 1, 0).getDate();
  const day = Math.min(dueDay, lastDate);
  return new Date(parsed.year, parsed.monthIndex, day, 9, 0, 0, 0);
};

const resolveDueDateForFee = async (fee) => {
  if (fee?.dueDate && fee?.monthKey) return fee.dueDate;
  const student = await Student.findById(fee.studentId).select("joinedAt").lean();
  const resolvedMonthKey = monthKeyFromFeeInput({ monthKey: fee?.monthKey, month: fee?.month });
  const computed = computeDueDate({ monthKey: resolvedMonthKey, month: fee?.month, joinedAt: student?.joinedAt });
  if (fee?.save) {
    let changed = false;
    if (resolvedMonthKey && !fee.monthKey) {
      fee.monthKey = resolvedMonthKey;
      changed = true;
    }
    if (computed && !fee.dueDate) {
      fee.dueDate = computed;
      changed = true;
    }
    if (changed) {
      await fee.save();
    }
  }
  return computed || fee?.dueDate || null;
};

const ensureRecurringFeesForStudents = async (studentIds = []) => {
  const ids = [...new Set(studentIds.map((id) => String(id || "")).filter(Boolean))];
  if (!ids.length) return;

  const students = await Student.find({ _id: { $in: ids } })
    .select("_id joinedAt monthlyFee")
    .lean();
  if (!students.length) return;

  const fees = await Fee.find({ studentId: { $in: ids } })
    .select("_id studentId month monthKey")
    .lean();

  const existingByStudent = new Map();
  fees.forEach((fee) => {
    const studentId = String(fee.studentId || "");
    if (!studentId) return;
    if (!existingByStudent.has(studentId)) existingByStudent.set(studentId, new Set());
    const key = monthKeyFromFeeInput({ monthKey: fee.monthKey, month: fee.month });
    if (key) existingByStudent.get(studentId).add(key);
  });

  const now = new Date();
  const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const toCreate = [];

  students.forEach((student) => {
    const monthlyFee = Number(student?.monthlyFee || 0);
    const joinedAt = student?.joinedAt ? new Date(student.joinedAt) : null;
    if (!monthlyFee || monthlyFee <= 0 || !joinedAt || Number.isNaN(joinedAt.getTime())) return;

    const cursor = new Date(joinedAt.getFullYear(), joinedAt.getMonth(), 1);
    const existing = existingByStudent.get(String(student._id)) || new Set();

    while (cursor <= nowMonthStart) {
      const monthKey = monthKeyFromDate(cursor);
      if (monthKey && !existing.has(monthKey)) {
        toCreate.push({
          studentId: student._id,
          month: monthLabelFromKey(monthKey) || monthKey,
          monthKey,
          total: monthlyFee,
          dueDate: computeDueDate({ monthKey, joinedAt })
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  });

  if (!toCreate.length) return;
  try {
    await Fee.insertMany(toCreate, { ordered: false });
  } catch {
    // Duplicate races are acceptable and can be ignored.
  }
};

const computeFeeTimingAndXp = ({ dueDate, paidOn }) => {
  if (!dueDate) {
    return {
      lateDays: 0,
      xpAwarded: 100,
      timingStatus: "on_time",
      timingDays: 0
    };
  }
  const due = normalizeToDayStart(dueDate);
  const paid = normalizeToDayStart(paidOn || new Date());
  const diffDays = Math.floor((paid.getTime() - due.getTime()) / DAY_MS);
  const lateDays = Math.max(0, diffDays);
  const timingStatus = diffDays < 0 ? "early" : diffDays > 0 ? "late" : "on_time";
  const timingDays = Math.abs(diffDays);
  const xpAwarded = lateDays >= 6 ? 50 : 100;
  return { lateDays, xpAwarded, timingStatus, timingDays };
};

const describeTiming = ({ timingStatus = "on_time", timingDays = 0 }) => {
  if (timingStatus === "late") return `${timingDays} day(s) late`;
  if (timingStatus === "early") return `${timingDays} day(s) early`;
  return "on time";
};

const getRazorpay = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) return null;
  return new Razorpay({ key_id, key_secret });
};

const notifyTeacherPayment = async ({
  fee,
  amount,
  method,
  timingStatus = "on_time",
  timingDays = 0,
  dueDate = null
}) => {
  const student = await Student.findById(fee.studentId).select("name studentId phone guardian").lean();
  const studentName = student?.name || student?.studentId || "A student";
  const phone = student?.phone || student?.guardian?.phone || "";
  await Notification.create({
    title: "Fee Received",
    message:
      `${studentName}${phone ? ` (${phone})` : ""} paid ₹${Number(amount || 0)} via ${method || "UPI"} ` +
      `(${describeTiming({ timingStatus, timingDays })})` +
      `${dueDate ? `, due ${new Date(dueDate).toLocaleDateString()}` : ""}.`,
    target: "teacher"
  });
};

const awardStudentPaymentXp = async ({
  fee,
  amount,
  method,
  source,
  timingStatus = "on_time",
  timingDays = 0,
  xpAwarded = 0
}) => {
  const studentUser = await User.findOne({ role: "student", studentId: fee.studentId }).select("_id").lean();
  if (!studentUser?._id) return;
  await User.updateOne(
    { _id: studentUser._id },
    { $inc: { bonusXp: Number(xpAwarded || 0) } }
  );

  await Notification.create({
    title: "Payment Received",
    message:
      `Your payment has been received. ₹${Number(amount || 0)} via ${method || "UPI"} (${source}). ` +
      `${describeTiming({ timingStatus, timingDays })}. +${Number(xpAwarded || 0)} XP added.`,
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
  const { lateDays, xpAwarded, timingStatus, timingDays } = computeFeeTimingAndXp({ dueDate, paidOn });

  fee.payments.push({
    amount: numericAmount,
    paidOn,
    note: reference || "",
    method: method || "UPI",
    reference: reference || "",
    source,
    dueDateSnapshot: dueDate || null,
    lateDays,
    xpAwarded,
    timingStatus,
    timingDays
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
    xpAwarded,
    timingStatus,
    timingDays
  });

  await notifyTeacherPayment({
    fee,
    amount: numericAmount,
    method: method || "UPI",
    timingStatus,
    timingDays,
    dueDate
  });
  await awardStudentPaymentXp({
    fee,
    amount: numericAmount,
    method: method || "UPI",
    source,
    timingStatus,
    timingDays,
    xpAwarded
  });

  return { fee, receipt, lateDays, xpAwarded, timingStatus, timingDays, dueDate };
};

const listPaymentTransactions = async ({ studentId = "", limit = 200 }) => {
  const query = {};
  if (studentId) query.studentId = studentId;
  const receipts = await Receipt.find(query)
    .sort({ paidOn: -1, createdAt: -1 })
    .limit(limit)
    .populate("studentId", "name studentId phone guardian")
    .lean();

  const byStudent = new Map();
  receipts.forEach((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    if (!key) return;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(receipt);
  });

  return receipts.map((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    const history = byStudent.get(key) || [];
    const index = history.findIndex((item) => String(item?._id || "") === String(receipt?._id || ""));
    const previous = index >= 0 ? history[index + 1] : null;
    const currentPaidOn = receipt?.paidOn ? new Date(receipt.paidOn) : new Date(receipt.createdAt);
    const previousPaidOn = previous?.paidOn ? new Date(previous.paidOn) : previous?.createdAt ? new Date(previous.createdAt) : null;
    const daysSincePrevious = previousPaidOn
      ? Math.max(0, Math.floor((currentPaidOn.getTime() - previousPaidOn.getTime()) / DAY_MS))
      : null;

    const timingStatus = receipt?.timingStatus || (Number(receipt?.lateDays || 0) > 0 ? "late" : "on_time");
    const timingDays = Number(receipt?.timingDays ?? receipt?.lateDays ?? 0);
    const method = receipt?.method || "UPI";

    return {
      receiptId: receipt._id,
      feeId: receipt.feeId,
      studentId: receipt?.studentId?._id || null,
      studentName: receipt?.studentId?.name || receipt?.studentId?.studentId || "Student",
      studentPhone: receipt?.studentId?.phone || receipt?.studentId?.guardian?.phone || "",
      amount: Number(receipt?.amount || 0),
      paymentMode: method,
      method,
      transactionId: method === "Razorpay" ? receipt?.reference || "" : "",
      reference: receipt?.reference || "",
      paidOn: receipt?.paidOn || receipt?.createdAt,
      dueDate: receipt?.dueDate || null,
      lateDays: Number(receipt?.lateDays || 0),
      xpAwarded: Number(receipt?.xpAwarded || 0),
      timingStatus,
      timingDays,
      timingLabel: describeTiming({ timingStatus, timingDays }),
      daysSincePrevious
    };
  });
};

router.get("/", requireAuth, async (req, res) => {
  const query = {};
  let targetStudentIds = [];

  if (req.user.role === "student") {
    if (!req.user.studentId) return res.json([]);
    query.studentId = req.user.studentId;
    targetStudentIds = [req.user.studentId];
  } else if (req.query.studentId) {
    query.studentId = req.query.studentId;
    targetStudentIds = [req.query.studentId];
  } else {
    const allStudents = await Student.find().select("_id").lean();
    targetStudentIds = allStudents.map((item) => item._id);
  }

  await ensureRecurringFeesForStudents(targetStudentIds);
  const items = await Fee.find(query).sort({ dueDate: -1, createdAt: -1 });
  for (const fee of items) {
    if (!fee?.dueDate || !fee?.monthKey) {
      await resolveDueDateForFee(fee);
    }
  }
  return res.json(items);
});

router.get("/transactions", requireAuth, async (req, res) => {
  let studentId = "";
  if (req.user.role === "student") {
    studentId = String(req.user.studentId || "");
    if (!studentId) return res.json([]);
  } else if (req.query.studentId) {
    studentId = String(req.query.studentId || "");
  }

  const items = await listPaymentTransactions({ studentId, limit: 240 });
  return res.json(items);
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
    .populate("feeId", "month monthKey total payments dueDate")
    .lean();
  return res.json(items);
});

router.post("/", requireAuth, requireRole("teacher"), async (req, res) => {
  return res.status(403).json({
    message: "Manual fee creation is disabled. Fees are auto-generated from student join date and monthly fee."
  });
});

router.put("/:id", requireAuth, requireRole("teacher"), async (req, res) => {
  return res.status(403).json({
    message: "Manual fee editing is disabled. Update the student's monthly fee/join date instead."
  });
});

router.post("/:id/payments", requireAuth, requireRole("teacher"), paymentLimiter, async (req, res) => {
  return res.status(403).json({
    message: "Manual payment entry is disabled. Use online payment or approve an offline request."
  });
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
        `${describeTiming({
          timingStatus: paymentResult?.timingStatus,
          timingDays: paymentResult?.timingDays
        })}. +${Number(paymentResult?.xpAwarded || 0)} XP added.`,
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
  return res.status(403).json({
    message: "Manual fee deletion is disabled to preserve payment history."
  });
});

export default router;
