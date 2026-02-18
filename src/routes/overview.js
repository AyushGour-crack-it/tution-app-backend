import express from "express";
import Student from "../models/Student.js";
import Homework from "../models/Homework.js";
import Fee from "../models/Fee.js";
import Receipt from "../models/Receipt.js";
import SyllabusItem from "../models/SyllabusItem.js";
import Holiday from "../models/Holiday.js";
import Announcement from "../models/Announcement.js";
import { requireAuth, requireRole } from "../utils/auth.js";

const router = express.Router();

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

router.get("/", requireAuth, requireRole("teacher"), async (req, res) => {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    studentCount,
    homeworkDueCount,
    fees,
    focusItems,
    homeworkUpcoming,
    holidays,
    announcements,
    recentReceipts
  ] =
    await Promise.all([
      Student.countDocuments(),
      Homework.countDocuments({ dueDate: { $gte: startOfDay(now), $lte: upcomingEnd } }),
      Fee.find(),
      SyllabusItem.find({ targetDate: { $gte: startOfDay(now), $lte: weekEnd } })
        .sort({ targetDate: 1 })
        .limit(5),
      Homework.find({ dueDate: { $gte: startOfDay(now), $lte: upcomingEnd } })
        .sort({ dueDate: 1 })
        .limit(5),
      Holiday.find({ date: { $gte: startOfDay(now), $lte: upcomingEnd } })
        .sort({ date: 1 })
        .limit(5),
      Announcement.find().sort({ date: -1 }).limit(5),
      Receipt.find()
        .sort({ paidOn: -1, createdAt: -1 })
        .limit(120)
        .populate("studentId", "name studentId phone guardian")
        .lean()
    ]);

  const feeTotals = fees.reduce(
    (acc, item) => {
      const expected = Number(item.total || 0);
      const paid = (item.payments || []).reduce((p, pay) => p + Number(pay.amount || 0), 0);
      const due = Math.max(expected - paid, 0);
      acc.expected += expected;
      acc.collected += paid;
      acc.pending += due;
      if (due > 0) acc.studentsWithPending += 1;
      acc.thisMonth += (item.payments || []).reduce((monthSum, payment) => {
        const paidOn = payment?.paidOn ? new Date(payment.paidOn) : null;
        if (!paidOn) return monthSum;
        if (paidOn >= monthStart && paidOn < monthEnd) {
          return monthSum + Number(payment.amount || 0);
        }
        return monthSum;
      }, 0);
      return acc;
    },
    { expected: 0, collected: 0, pending: 0, thisMonth: 0, studentsWithPending: 0 }
  );

  const feesCollectedTotal = feeTotals.collected;
  const collectionRate = feeTotals.expected
    ? Math.round((feeTotals.collected / feeTotals.expected) * 100)
    : 0;

  const recentByStudent = new Map();
  recentReceipts.forEach((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    if (!key) return;
    if (!recentByStudent.has(key)) recentByStudent.set(key, []);
    recentByStudent.get(key).push(receipt);
  });

  const recentPayments = recentReceipts.slice(0, 8).map((receipt) => {
    const key = String(receipt?.studentId?._id || "");
    const history = recentByStudent.get(key) || [];
    const index = history.findIndex((item) => String(item?._id || "") === String(receipt?._id || ""));
    const previous = index >= 0 ? history[index + 1] : null;
    const currentPaidOn = receipt?.paidOn ? new Date(receipt.paidOn) : new Date(receipt.createdAt);
    const previousPaidOn = previous?.paidOn ? new Date(previous.paidOn) : previous?.createdAt ? new Date(previous.createdAt) : null;
    const daysSincePrevious = previousPaidOn
      ? Math.max(0, Math.floor((currentPaidOn.getTime() - previousPaidOn.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    return {
      id: receipt._id,
      studentName: receipt?.studentId?.name || receipt?.studentId?.studentId || "Student",
      studentPhone: receipt?.studentId?.phone || receipt?.studentId?.guardian?.phone || "",
      amount: Number(receipt.amount || 0),
      method: receipt.method || "UPI",
      paidOn: receipt.paidOn || receipt.createdAt,
      daysSincePrevious
    };
  });

  const feesPendingTotalLegacy = fees.reduce((sum, item) => {
    const paid = (item.payments || []).reduce((p, pay) => p + pay.amount, 0);
    return sum + Math.max(item.total - paid, 0);
  }, 0);

  const upcoming = [
    ...homeworkUpcoming.map((item) => ({
      title: item.title,
      date: item.dueDate,
      note: "Homework"
    })),
    ...holidays.map((item) => ({
      title: item.title,
      date: item.date,
      note: "Holiday"
    }))
  ]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 6);

  return res.json({
    stats: {
      students: studentCount,
      homeworkDue: homeworkDueCount,
      feesPendingTotal: feesPendingTotalLegacy,
      feesCollectedTotal
    },
    feesOverview: {
      expectedTotal: feeTotals.expected,
      collectedTotal: feeTotals.collected,
      pendingTotal: feeTotals.pending,
      collectedThisMonth: feeTotals.thisMonth,
      collectionRate,
      studentsWithPending: feeTotals.studentsWithPending,
      recentPayments
    },
    focus: focusItems.map((item) => ({
      subject: item.subject,
      topic: item.topic,
      targetDate: item.targetDate
    })),
    upcoming,
    announcements
  });
});

export default router;
