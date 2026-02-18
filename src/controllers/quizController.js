import mongoose from "mongoose";
import { readFile } from "fs/promises";
import Question from "../models/Question.js";
import User from "../models/User.js";
import UserQuestionProgress from "../models/UserQuestionProgress.js";
import { overallLevelFromXp, subjectLevelFromXp, xpByDifficulty } from "../utils/xpCalculator.js";

const shuffle = (items = []) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const toObject = (value) => (value instanceof Map ? Object.fromEntries(value.entries()) : (value || {}));
const quizFiles = [
  "class6/physics.json",
  "class6/chemistry.json",
  "class6/biology.json",
  "class6/english.json",
  "class6/french.json",
  "class6/history.json",
  "class6/geography.json",
  "class6/civics.json",
  "class7/physics.json",
  "class7/chemistry.json",
  "class7/biology.json",
  "class7/english.json",
  "class7/french.json",
  "class7/history.json",
  "class7/geography.json",
  "class7/civics.json",
  "class8/physics.json",
  "class8/chemistry.json",
  "class8/biology.json",
  "class8/english.json",
  "class8/french.json",
  "class8/history.json",
  "class8/geography.json",
  "class8/civics.json"
];

export const getQuizStats = async (req, res) => {
  const user = await User.findById(req.user.sub).select("streakCount totalXP subjectXP subjectLevel").lean();
  if (!user) return res.status(404).json({ message: "User not found" });

  const totalXP = Number(user.totalXP || 0);
  res.json({
    streakCount: Number(user.streakCount || 0),
    totalXP,
    overallLevel: overallLevelFromXp(totalXP),
    subjectXP: toObject(user.subjectXP),
    subjectLevel: toObject(user.subjectLevel)
  });
};

export const getQuizMeta = async (req, res) => {
  const [subjects, classLevels] = await Promise.all([
    Question.distinct("subject"),
    Question.distinct("classLevel")
  ]);
  res.json({
    subjects: subjects.sort((a, b) => String(a).localeCompare(String(b))),
    classLevels: classLevels.sort((a, b) => Number(a) - Number(b))
  });
};

export const seedQuizBank = async (req, res) => {
  const totalExisting = await Question.estimatedDocumentCount();
  if (totalExisting > 0 && req.query.force !== "1") {
    return res.json({
      message: "Quiz bank already exists. Use ?force=1 to reseed.",
      inserted: 0,
      total: totalExisting
    });
  }

  if (req.query.force === "1") {
    await Question.deleteMany({});
    await UserQuestionProgress.deleteMany({});
  }

  let batch = [];
  for (let i = 0; i < quizFiles.length; i += 1) {
    const rel = quizFiles[i];
    const fileUrl = new URL(`../../data/${rel}`, import.meta.url);
    const raw = await readFile(fileUrl, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      batch = batch.concat(parsed);
    }
  }

  if (!batch.length) {
    return res.status(400).json({ message: "No quiz data found to seed" });
  }

  await Question.insertMany(batch, { ordered: false });
  const total = await Question.estimatedDocumentCount();
  return res.json({
    message: "Quiz bank seeded",
    inserted: batch.length,
    total
  });
};

export const getQuiz = async (req, res) => {
  const classLevel = Number(req.query.classLevel || 0);
  const subject = String(req.query.subject || "").trim();
  const difficulty = String(req.query.difficulty || "").trim().toLowerCase();

  if (!classLevel || !subject || !["easy", "medium", "hard"].includes(difficulty)) {
    return res.status(400).json({ message: "classLevel, subject and valid difficulty are required" });
  }

  const userId = new mongoose.Types.ObjectId(req.user.sub);
  const now = new Date();

  const candidates = await Question.aggregate([
    {
      $match: {
        classLevel,
        subject,
        difficulty
      }
    },
    {
      $lookup: {
        from: "userquestionprogresses",
        let: { questionId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$question", "$$questionId"] },
                  { $eq: ["$user", userId] }
                ]
              }
            }
          }
        ],
        as: "progress"
      }
    },
    {
      $addFields: {
        progress: { $arrayElemAt: ["$progress", 0] }
      }
    },
    {
      $addFields: {
        masteredActive: {
          $and: [
            { $gte: [{ $ifNull: ["$progress.correctCount", 0] }, 2] },
            { $gt: [{ $ifNull: ["$progress.masteredUntil", new Date(0)] }, now] }
          ]
        }
      }
    },
    { $match: { masteredActive: false } },
    {
      $addFields: {
        priority: {
          $switch: {
            branches: [
              {
                case: {
                  $and: [
                    { $ne: ["$progress", null] },
                    { $eq: [{ $ifNull: ["$progress.isCorrect", false] }, false] }
                  ]
                },
                then: 0
              },
              {
                case: { $eq: ["$progress", null] },
                then: 1
              }
            ],
            default: 2
          }
        }
      }
    },
    { $sort: { priority: 1, "progress.lastAttempted": 1, _id: 1 } },
    { $limit: 40 },
    {
      $project: {
        _id: 1,
        classLevel: 1,
        subject: 1,
        topic: 1,
        difficulty: 1,
        question: 1,
        options: 1,
        explanation: 1
      }
    }
  ]);

  if (!candidates.length) {
    return res.status(404).json({ message: "No questions available right now" });
  }

  const items = shuffle(candidates).slice(0, 5);
  return res.json({ questions: items });
};

export const submitQuiz = async (req, res) => {
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const subject = String(req.body.subject || "").trim();
  if (!answers.length) {
    return res.status(400).json({ message: "answers are required" });
  }

  const ids = answers.map((item) => String(item?.questionId || "").trim()).filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  if (ids.length !== uniqueIds.length) {
    return res.status(400).json({ message: "Duplicate question submission detected" });
  }

  const questions = await Question.find({
    _id: { $in: uniqueIds },
    ...(subject ? { subject } : {})
  })
    .select("_id subject difficulty correctAnswer explanation")
    .lean();
  if (questions.length !== uniqueIds.length) {
    return res.status(400).json({ message: "Invalid question payload" });
  }

  const questionById = new Map(questions.map((item) => [String(item._id), item]));
  const now = new Date();
  let correctCount = 0;
  let earnedXP = 0;
  const detailedResults = [];

  for (let i = 0; i < answers.length; i += 1) {
    const answer = answers[i];
    const questionId = String(answer.questionId);
    const selectedOption = Number(answer.selectedOption);
    const question = questionById.get(questionId);
    if (!question) continue;

    const isCorrect = selectedOption === Number(question.correctAnswer);
    if (isCorrect) {
      correctCount += 1;
      earnedXP += xpByDifficulty(question.difficulty);
    }

    await Question.updateOne(
      { _id: question._id },
      {
        $inc: {
          timesAttempted: 1,
          timesCorrect: isCorrect ? 1 : 0
        }
      }
    );

    const progress = await UserQuestionProgress.findOne({
      user: req.user.sub,
      question: question._id
    });

    if (!progress) {
      const correctHits = isCorrect ? 1 : 0;
      await UserQuestionProgress.create({
        user: req.user.sub,
        question: question._id,
        isCorrect,
        attempts: 1,
        lastAttempted: now,
        correctCount: correctHits,
        masteredUntil: correctHits >= 2 ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : null
      });
    } else {
      progress.attempts = Number(progress.attempts || 0) + 1;
      progress.isCorrect = isCorrect;
      progress.lastAttempted = now;
      if (isCorrect) {
        progress.correctCount = Number(progress.correctCount || 0) + 1;
        if (progress.correctCount >= 2) {
          progress.masteredUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        }
      } else {
        progress.masteredUntil = null;
      }
      await progress.save();
    }

    detailedResults.push({
      questionId,
      correctAnswer: Number(question.correctAnswer),
      explanation: String(question.explanation || ""),
      isCorrect
    });
  }

  if (answers.length === 5 && correctCount === 5) {
    earnedXP += 10;
  }

  const user = await User.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const today = startOfDay(new Date());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const last = user.lastActiveDate ? startOfDay(new Date(user.lastActiveDate)) : null;

  if (last && last.getTime() === yesterday.getTime()) {
    user.streakCount = Number(user.streakCount || 0) + 1;
  } else if (last && last.getTime() === today.getTime()) {
    user.streakCount = Number(user.streakCount || 0);
  } else {
    user.streakCount = 1;
  }
  user.lastActiveDate = today;

  if (Number(user.streakCount || 0) >= 7) {
    earnedXP += 5;
  }

  const subjectKey = subject || String(questions[0]?.subject || "General");
  const currentSubjectXp = Number(user.subjectXP?.get(subjectKey) || 0);
  const nextSubjectXp = currentSubjectXp + earnedXP;
  user.subjectXP.set(subjectKey, nextSubjectXp);
  user.totalXP = Number(user.totalXP || 0) + earnedXP;
  const nextSubjectLevel = subjectLevelFromXp(nextSubjectXp);
  user.subjectLevel.set(subjectKey, nextSubjectLevel);
  await user.save();

  return res.json({
    earnedXP,
    newSubjectLevel: nextSubjectLevel,
    newOverallLevel: overallLevelFromXp(user.totalXP),
    streakCount: Number(user.streakCount || 0),
    correctCount,
    detailedResults
  });
};
