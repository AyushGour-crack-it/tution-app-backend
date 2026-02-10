import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import mongoose from "mongoose";

import studentRoutes from "./routes/students.js";
import classRoutes from "./routes/classes.js";
import homeworkRoutes from "./routes/homeworks.js";
import syllabusRoutes from "./routes/syllabus.js";
import attendanceRoutes from "./routes/attendance.js";
import holidayRoutes from "./routes/holidays.js";
import feeRoutes from "./routes/fees.js";
import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";
import announcementRoutes from "./routes/announcements.js";
import overviewRoutes from "./routes/overview.js";
import marksRoutes from "./routes/marks.js";
import notificationRoutes from "./routes/notifications.js";
import invoiceRoutes from "./routes/invoices.js";
import receiptRoutes from "./routes/receipts.js";
import leaderboardRoutes from "./routes/leaderboard.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/students", studentRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/homeworks", homeworkRoutes);
app.use("/api/syllabus", syllabusRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/fees", feeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/overview", overviewRoutes);
app.use("/api/marks", marksRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const start = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });
};

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
