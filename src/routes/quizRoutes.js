import express from "express";
import { requireAuth } from "../utils/auth.js";
import { getQuiz, getQuizStats, submitQuiz } from "../controllers/quizController.js";

const router = express.Router();

router.get("/stats", requireAuth, getQuizStats);
router.get("/", requireAuth, getQuiz);
router.post("/submit", requireAuth, submitQuiz);

export default router;
