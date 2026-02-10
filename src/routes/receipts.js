import express from "express";
import Receipt from "../models/Receipt.js";
import { requireAuth } from "../utils/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const query = {};
  if (req.user.role === "student") {
    if (!req.user.studentId) return res.json([]);
    query.studentId = req.user.studentId;
  } else if (req.query.studentId) {
    query.studentId = req.query.studentId;
  }
  const items = await Receipt.find(query).sort({ createdAt: -1 });
  res.json(items);
});

export default router;
