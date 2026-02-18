import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import Student from "../models/Student.js";
import Otp from "../models/Otp.js";
import Notification from "../models/Notification.js";
import cloudinary from "../utils/cloudinary.js";
import { signToken, requireAuth, requireRole } from "../utils/auth.js";
import {
  loginLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  registerLimiter
} from "../utils/rateLimiters.js";
import {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  sanitizeText
} from "../utils/validators.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const googleClient = new OAuth2Client();

const toResponseUser = (user) => ({
  id: user._id,
  name: user.name,
  role: user.role,
  email: user.email,
  phone: user.phone,
  studentId: user.studentId,
  avatarUrl: user.avatarUrl,
  bio: user.bio,
  bonusXp: Number(user.bonusXp || 0),
  studentApprovalStatus: user.studentApprovalStatus || "approved",
  studentReviewMessage: user.studentReviewMessage || "",
  pendingStudentProfile: user.pendingStudentProfile || null,
  likesCount: Array.isArray(user.profileLikedBy) ? user.profileLikedBy.length : 0
});

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const maybeNotifyTeacherForNewStudentLogin = async (user) => {
  if (user.role !== "student" || user.studentApprovalStatus !== "approved" || user.lastLoginAt) return;
  await Notification.create({
    title: "New Student Login",
    message: `${user.name} just logged in as a student.`,
    target: "teacher"
  });
};

const parseDateSafe = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const sanitizePendingStudentProfile = (body = {}) => ({
  dateOfBirth: parseDateSafe(body.dateOfBirth),
  schoolName: sanitizeText(body.schoolName, 120),
  grade: sanitizeText(body.grade, 60),
  address: sanitizeText(body.address, 240),
  guardianName: sanitizeText(body.guardianName, 120),
  guardianPhone: normalizePhone(body.guardianPhone),
  guardianRelation: sanitizeText(body.guardianRelation, 80),
  emergencyContact: normalizePhone(body.emergencyContact)
});

const generateRollNumber = () => {
  const seed = Date.now().toString(36).slice(-6).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `STD-${seed}${random}`;
};

const verifyGoogleCredential = async (credential) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google auth is not configured");
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: clientId
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.email_verified) {
    throw new Error("Google account email is not verified");
  }
  return {
    email: normalizeEmail(payload.email),
    name: sanitizeText(payload.name, 120),
    avatarUrl: payload.picture || ""
  };
};

router.post("/register", registerLimiter, upload.single("avatar"), async (req, res) => {
  const { role } = req.body;
  const teacherAccessId = sanitizeText(req.body.teacherAccessId, 120);
  const name = sanitizeText(req.body.name, 120);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const phone = normalizePhone(req.body.phone);
  const bio = sanitizeText(req.body.bio, 280);

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "Missing fields" });
  }
  if (!["teacher", "student"].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }
  if (role === "teacher") {
    const expectedTeacherAccessId = process.env.TEACHER_ACCESS_ID || "Ayush@8090";
    if (!teacherAccessId || teacherAccessId !== expectedTeacherAccessId) {
      return res.status(403).json({ message: "Invalid Teacher ID" });
    }
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message: "Password must be 8+ chars with uppercase, lowercase and number"
    });
  }
  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }
  const pendingStudentProfile = sanitizePendingStudentProfile(req.body);
  const passwordHash = await bcrypt.hash(password, 10);
  let avatarUrl = "";
  if (req.file) {
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ message: "Avatar must be an image file" });
    }
    try {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder: "ayush-profile" },
          (error, result) => {
            if (error) return reject(error);
            return resolve(result);
          }
        );
        Readable.from(req.file.buffer).pipe(stream);
      });
      avatarUrl = uploadResult.secure_url;
    } catch (err) {
      return res.status(400).json({
        message: "Avatar upload failed. Check Cloudinary configuration."
      });
    }
  }
  const user = await User.create({
    name,
    email,
    phone,
    passwordHash,
    role,
    studentId: null,
    avatarUrl,
    bio: bio || "",
    studentApprovalStatus: role === "student" ? "pending" : "approved",
    pendingStudentProfile: role === "student" ? pendingStudentProfile : undefined
  });
  if (user.role === "student") {
    const details = [
      `Name: ${user.name}`,
      pendingStudentProfile.grade ? `Class: ${pendingStudentProfile.grade}` : "",
      pendingStudentProfile.guardianPhone ? `Guardian: ${pendingStudentProfile.guardianPhone}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
    await Notification.create({
      title: "Student Registration Request",
      message: details || `${user.name} requested student access.`,
      target: "teacher"
    });
  }
  const token = signToken(user);
  return res.status(201).json({
    token,
    user: toResponseUser(user)
  });
});

router.post("/login", loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(400).json({ message: "Missing credentials" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Invalid credentials" });
  }
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  await maybeNotifyTeacherForNewStudentLogin(user);
  user.lastLoginAt = new Date();
  await user.save();
  const token = signToken(user);
  return res.json({
    token,
    user: toResponseUser(user)
  });
});

router.post("/google", loginLimiter, async (req, res) => {
  const credential = sanitizeText(req.body.credential, 4000);
  const mode = sanitizeText(req.body.mode, 16) || "login";
  const role = sanitizeText(req.body.role, 20);
  const teacherAccessId = sanitizeText(req.body.teacherAccessId, 120);
  const phone = normalizePhone(req.body.phone);
  const bio = sanitizeText(req.body.bio, 280);
  const providedName = sanitizeText(req.body.name, 120);
  const pendingStudentProfile = sanitizePendingStudentProfile(req.body);

  if (!credential) {
    return res.status(400).json({ message: "Missing Google credential" });
  }
  if (!["login", "register"].includes(mode)) {
    return res.status(400).json({ message: "Invalid Google auth mode" });
  }

  let googleProfile;
  try {
    googleProfile = await verifyGoogleCredential(credential);
  } catch (error) {
    return res.status(401).json({ message: error.message || "Invalid Google sign-in" });
  }

  const existingUser = await User.findOne({ email: googleProfile.email });

  if (mode === "login") {
    if (!existingUser) {
      return res.status(404).json({ message: "No account found for this Google email. Register first." });
    }
    if (!existingUser.avatarUrl && googleProfile.avatarUrl) {
      existingUser.avatarUrl = googleProfile.avatarUrl;
    }
    await maybeNotifyTeacherForNewStudentLogin(existingUser);
    existingUser.lastLoginAt = new Date();
    await existingUser.save();
    const token = signToken(existingUser);
    return res.json({
      token,
      user: toResponseUser(existingUser)
    });
  }

  if (existingUser) {
    return res.status(409).json({ message: "Email already registered. Use Sign In with Google." });
  }
  if (!["teacher", "student"].includes(role)) {
    return res.status(400).json({ message: "Choose role before Google signup" });
  }
  if (role === "teacher") {
    const expectedTeacherAccessId = process.env.TEACHER_ACCESS_ID || "Ayush@8090";
    if (!teacherAccessId || teacherAccessId !== expectedTeacherAccessId) {
      return res.status(403).json({ message: "Invalid Teacher ID" });
    }
  }
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  const user = await User.create({
    name: providedName || googleProfile.name || googleProfile.email.split("@")[0],
    email: googleProfile.email,
    phone,
    passwordHash,
    role,
    studentId: null,
    avatarUrl: googleProfile.avatarUrl,
    bio: bio || "",
    studentApprovalStatus: role === "student" ? "pending" : "approved",
    pendingStudentProfile: role === "student" ? pendingStudentProfile : undefined
  });

  if (user.role === "student") {
    const details = [
      `Name: ${user.name}`,
      pendingStudentProfile.grade ? `Class: ${pendingStudentProfile.grade}` : "",
      pendingStudentProfile.guardianPhone ? `Guardian: ${pendingStudentProfile.guardianPhone}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
    await Notification.create({
      title: "Student Registration Request",
      message: details || `${user.name} requested student access.`,
      target: "teacher"
    });
  }
  const token = signToken(user);
  return res.status(201).json({
    token,
    user: toResponseUser(user)
  });
});

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

router.post("/request-otp", otpRequestLimiter, async (req, res) => {
  const channel = sanitizeText(req.body.channel, 10);
  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);
  if (!channel || (channel !== "email" && channel !== "phone")) {
    return res.status(400).json({ message: "Invalid channel" });
  }
  const user = await User.findOne(
    channel === "email" ? { email } : { phone }
  );
  if (!user) return res.json({ message: "If account exists, OTP was sent" });
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Otp.create({ userId: user._id, channel, code, expiresAt });

  // TODO: Integrate SMS/Email provider. For now we log it on the server.
  // eslint-disable-next-line no-console
  console.log(`OTP for ${channel} ${channel === "email" ? user.email : user.phone}: ${code}`);

  return res.json({ message: "If account exists, OTP was sent" });
});

router.post("/verify-otp", otpVerifyLimiter, async (req, res) => {
  const channel = sanitizeText(req.body.channel, 10);
  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);
  const code = sanitizeText(req.body.code, 8);
  const user = await User.findOne(
    channel === "email" ? { email } : { phone }
  );
  if (!user) {
    return res.status(400).json({ message: "Invalid OTP" });
  }
  const record = await Otp.findOne({
    userId: user._id,
    channel,
    code
  }).sort({ createdAt: -1 });
  if (!record) {
    return res.status(400).json({ message: "Invalid OTP" });
  }
  if (record.expiresAt < new Date()) {
    return res.status(400).json({ message: "OTP expired" });
  }
  await Otp.deleteMany({ userId: user._id, channel });
  await maybeNotifyTeacherForNewStudentLogin(user);
  user.lastLoginAt = new Date();
  await user.save();
  const token = signToken(user);
  return res.json({
    token,
    user: toResponseUser(user)
  });
});

router.post("/reset-password", otpVerifyLimiter, async (req, res) => {
  const channel = sanitizeText(req.body.channel, 10);
  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);
  const code = sanitizeText(req.body.code, 8);
  const newPassword = String(req.body.newPassword || "");
  if (!newPassword) {
    return res.status(400).json({ message: "Missing new password" });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      message: "Password must be 8+ chars with uppercase, lowercase and number"
    });
  }
  const user = await User.findOne(
    channel === "email" ? { email } : { phone }
  );
  if (!user) {
    return res.status(400).json({ message: "Invalid OTP" });
  }
  const record = await Otp.findOne({
    userId: user._id,
    channel,
    code
  }).sort({ createdAt: -1 });
  if (!record) {
    return res.status(400).json({ message: "Invalid OTP" });
  }
  if (record.expiresAt < new Date()) {
    return res.status(400).json({ message: "OTP expired" });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  await Otp.deleteMany({ userId: user._id, channel });
  return res.json({ message: "Password updated" });
});

router.put(
  "/me",
  requireAuth,
  upload.single("avatar"),
  async (req, res) => {
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const { name, phone, bio } = req.body;
    if (name) user.name = sanitizeText(name, 120);
    if (phone !== undefined) user.phone = normalizePhone(phone);
    if (bio !== undefined) user.bio = sanitizeText(bio, 280);

    if (req.file) {
      const hasCloudinary =
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET;
      if (!hasCloudinary) {
        return res
          .status(400)
          .json({ message: "Cloudinary is not configured. Remove avatar or set keys." });
      }
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { resource_type: "image", folder: "ayush-profile" },
            (error, result) => {
              if (error) return reject(error);
              return resolve(result);
            }
          );
          Readable.from(req.file.buffer).pipe(stream);
        });
        user.avatarUrl = uploadResult.secure_url;
      } catch (err) {
        return res.status(400).json({
          message: "Avatar upload failed. Check Cloudinary configuration."
        });
      }
    }

    await user.save();
    return res.json({
      user: toResponseUser(user)
    });
  }
);

router.put("/me/password", requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing password fields" });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({
      message: "Password must be 8+ chars with uppercase, lowercase and number"
    });
  }
  const user = await User.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  return res.json({ message: "Password updated" });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  return res.json({
    user: toResponseUser(user)
  });
});

router.get("/student-requests", requireAuth, requireRole("teacher"), async (req, res) => {
  const status = sanitizeText(req.query.status, 20);
  const query = { role: "student" };
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    query.studentApprovalStatus = status;
  }
  const items = await User.find(query)
    .select("name email phone avatarUrl createdAt studentApprovalStatus studentReviewMessage pendingStudentProfile")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json(items);
});

router.post("/student-requests/:id/review", requireAuth, requireRole("teacher"), async (req, res) => {
  const action = sanitizeText(req.body.action, 20);
  const message = sanitizeText(req.body.message, 300);
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "action must be approve or reject" });
  }

  const user = await User.findOne({ _id: req.params.id, role: "student" });
  if (!user) {
    return res.status(404).json({ message: "Student request not found" });
  }
  if (user.studentApprovalStatus !== "pending") {
    return res.status(400).json({ message: "Request already reviewed" });
  }

  if (action === "approve") {
    const profile = user.pendingStudentProfile || {};
    const createdStudent = await Student.create({
      name: user.name,
      rollNumber: profile.rollNumber || generateRollNumber(),
      grade: sanitizeText(profile.grade, 60),
      guardian: {
        name: sanitizeText(profile.guardianName, 120),
        phone: normalizePhone(profile.guardianPhone)
      },
      dateOfBirth: profile.dateOfBirth || null,
      schoolName: sanitizeText(profile.schoolName, 120),
      emergencyContact: normalizePhone(profile.emergencyContact),
      email: user.email,
      phone: user.phone || normalizePhone(profile.guardianPhone),
      address: sanitizeText(profile.address, 240)
    });

    user.studentId = createdStudent._id;
    user.studentApprovalStatus = "approved";
    user.studentReviewMessage = message || "Your registration is approved.";
    user.pendingStudentProfile = undefined;
    await user.save();

    await Notification.create({
      title: "Registration Approved",
      message: user.studentReviewMessage,
      target: "student",
      studentId: createdStudent._id
    });

    return res.json({ message: "Student request approved" });
  }

  user.studentApprovalStatus = "rejected";
  user.studentReviewMessage = message || "Registration request was declined.";
  await user.save();

  return res.json({ message: "Student request rejected" });
});

router.post("/daily-xp", requireAuth, requireRole("student"), async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  if (user.studentApprovalStatus !== "approved" || !user.studentId) {
    return res.json({
      awarded: false,
      amount: 0,
      totalBonusXp: Number(user.bonusXp || 0),
      claimedAt: null
    });
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const alreadyClaimedToday = user.lastDailyXpAt && user.lastDailyXpAt >= todayStart;
  if (alreadyClaimedToday) {
    return res.json({
      awarded: false,
      amount: 0,
      totalBonusXp: Number(user.bonusXp || 0),
      claimedAt: user.lastDailyXpAt
    });
  }

  user.bonusXp = Number(user.bonusXp || 0) + 25;
  user.lastDailyXpAt = now;
  await user.save();

  await Notification.create({
    title: "Daily XP Bonus",
    message: "You earned +25 XP for showing up today. Keep the streak alive!",
    target: "student",
    studentId: user.studentId || null
  });

  return res.json({
    awarded: true,
    amount: 25,
    totalBonusXp: Number(user.bonusXp || 0),
    claimedAt: now
  });
});

router.post("/push-token", requireAuth, async (req, res) => {
  const token = sanitizeText(req.body.token, 4096);
  if (!token) {
    return res.status(400).json({ message: "Missing push token" });
  }
  await User.updateOne(
    { _id: req.user.sub },
    { $addToSet: { fcmTokens: token } }
  );
  return res.json({ message: "Push token registered" });
});

router.delete("/push-token", requireAuth, async (req, res) => {
  const token = sanitizeText(req.body.token, 4096);
  if (!token) {
    return res.status(400).json({ message: "Missing push token" });
  }
  await User.updateOne(
    { _id: req.user.sub },
    { $pull: { fcmTokens: token } }
  );
  return res.json({ message: "Push token removed" });
});

export default router;
