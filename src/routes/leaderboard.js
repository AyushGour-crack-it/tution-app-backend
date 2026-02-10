import express from "express";
import Attendance from "../models/Attendance.js";
import Mark from "../models/Mark.js";
import Student from "../models/Student.js";
import { requireAuth } from "../utils/auth.js";

const router = express.Router();

const byDate = (a, b) => new Date(a.date) - new Date(b.date);

const computeStreak = (records) => {
  const dates = records
    .filter((r) => r.status === "present")
    .map((r) => new Date(r.date))
    .sort((a, b) => a - b);
  let best = 0;
  let current = 0;
  for (let i = 0; i < dates.length; i += 1) {
    if (i === 0) {
      current = 1;
    } else {
      const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
      if (diff === 1) current += 1;
      else current = 1;
    }
    if (current > best) best = current;
  }
  return best;
};

router.get("/", requireAuth, async (req, res) => {
  const [students, attendance, marks] = await Promise.all([
    Student.find().lean(),
    Attendance.find().lean(),
    Mark.find().lean()
  ]);

  const attendanceByStudent = new Map();
  attendance.sort(byDate).forEach((record) => {
    const key = String(record.studentId);
    if (!attendanceByStudent.has(key)) attendanceByStudent.set(key, []);
    attendanceByStudent.get(key).push(record);
  });

  const marksByStudent = new Map();
  marks.forEach((record) => {
    const key = String(record.studentId);
    if (!marksByStudent.has(key)) marksByStudent.set(key, []);
    marksByStudent.get(key).push(record);
  });

  const streaks = students.map((student) => ({
    studentId: student._id,
    name: student.name,
    streak: computeStreak(attendanceByStudent.get(String(student._id)) || [])
  }));

  const averages = students.map((student) => {
    const entries = marksByStudent.get(String(student._id)) || [];
    const totals = entries.reduce(
      (acc, item) => {
        acc.score += item.score;
        acc.max += item.maxScore;
        return acc;
      },
      { score: 0, max: 0 }
    );
    const percent = totals.max ? Math.round((totals.score / totals.max) * 100) : 0;
    return { studentId: student._id, name: student.name, percent };
  });

  res.json({
    streaks: streaks.sort((a, b) => b.streak - a.streak).slice(0, 10),
    averages: averages.sort((a, b) => b.percent - a.percent).slice(0, 10)
  });
});

export default router;
