import jwt from "jsonwebtoken";

const jwtSecret = () => process.env.JWT_SECRET || "dev_secret_change_me";

export const signToken = (user) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      name: user.name,
      studentId: user.studentId ? user.studentId.toString() : null
    },
    jwtSecret(),
    { expiresIn: "7d" }
  );

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }
  try {
    const payload = jwt.verify(token, jwtSecret());
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
};
