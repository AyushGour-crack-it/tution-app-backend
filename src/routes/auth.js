import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { Readable } from "stream";
import User from "../models/User.js";
import Student from "../models/Student.js";
import Otp from "../models/Otp.js";
import Notification from "../models/Notification.js";
import cloudinary from "../utils/cloudinary.js";
import { signToken, requireAuth } from "../utils/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const toResponseUser = (user) => ({
  id: user._id,
  name: user.name,
  role: user.role,
  email: user.email,
  phone: user.phone,
  studentId: user.studentId,
  avatarUrl: user.avatarUrl,
  bio: user.bio
});

const maybeNotifyTeacherForNewStudentLogin = async (user) => {
  if (user.role !== "student" || user.lastLoginAt) return;
  await Notification.create({
    title: "New Student Login",
    message: `${user.name} just logged in as a student.`,
    target: "teacher"
  });
};

router.post("/register", upload.single("avatar"), async (req, res) => {
  const { name, email, password, role, studentId, phone, bio } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "Missing fields" });
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: "Email already registered" });
  }
  if (role === "student" && studentId) {
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(400).json({ message: "Invalid studentId" });
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);
  let avatarUrl = "";
  if (req.file) {
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
    email: email.toLowerCase(),
    phone: phone || "",
    passwordHash,
    role,
    studentId: role === "student" ? studentId || null : null,
    avatarUrl,
    bio: bio || ""
  });
  if (user.role === "student") {
    await maybeNotifyTeacherForNewStudentLogin(user);
    user.lastLoginAt = new Date();
    await user.save();
  }
  const token = signToken(user);
  return res.status(201).json({
    token,
    user: toResponseUser(user)
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Missing credentials" });
  }
  const user = await User.findOne({ email: email.toLowerCase() });
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

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

router.post("/request-otp", async (req, res) => {
  const { channel, email, phone } = req.body;
  if (!channel || (channel !== "email" && channel !== "phone")) {
    return res.status(400).json({ message: "Invalid channel" });
  }
  const user = await User.findOne(
    channel === "email" ? { email: (email || "").toLowerCase() } : { phone }
  );
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Otp.create({ userId: user._id, channel, code, expiresAt });

  // TODO: Integrate SMS/Email provider. For now we log it on the server.
  // eslint-disable-next-line no-console
  console.log(`OTP for ${channel} ${channel === "email" ? user.email : user.phone}: ${code}`);

  return res.json({ message: "OTP sent" });
});

router.post("/verify-otp", async (req, res) => {
  const { channel, email, phone, code } = req.body;
  const user = await User.findOne(
    channel === "email" ? { email: (email || "").toLowerCase() } : { phone }
  );
  if (!user) {
    return res.status(404).json({ message: "User not found" });
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

router.post("/reset-password", async (req, res) => {
  const { channel, email, phone, code, newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ message: "Missing new password" });
  }
  const user = await User.findOne(
    channel === "email" ? { email: (email || "").toLowerCase() } : { phone }
  );
  if (!user) {
    return res.status(404).json({ message: "User not found" });
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
    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (bio !== undefined) user.bio = bio;

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
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing password fields" });
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

export default router;
