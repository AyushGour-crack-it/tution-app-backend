import express from "express";
import Student from "../models/Student.js";
import Homework from "../models/Homework.js";
import Fee from "../models/Fee.js";
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

  const [studentCount, homeworkDueCount, fees, focusItems, homeworkUpcoming, holidays, announcements] =
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
      Announcement.find().sort({ date: -1 }).limit(5)
    ]);

  const feesPendingTotal = fees.reduce((sum, item) => {
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
      feesPendingTotal
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
