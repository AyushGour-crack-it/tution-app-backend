import express from "express";
import { requireAuth, requireRole } from "../utils/auth.js";
import { getQuiz, getQuizMeta, getQuizStats, seedQuizBank, submitQuiz } from "../controllers/quizController.js";

const router = express.Router();

router.get("/stats", requireAuth, getQuizStats);
router.get("/meta", requireAuth, getQuizMeta);
router.post("/seed", requireAuth, requireRole("teacher"), seedQuizBank);
router.get("/", requireAuth, getQuiz);
router.post("/submit", requireAuth, submitQuiz);

export default router;
