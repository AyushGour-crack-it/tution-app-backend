import admin from "firebase-admin";
import User from "../models/User.js";

let firebaseReady = false;
let firebaseInitAttempted = false;

const decodePrivateKey = (value) => String(value || "").replace(/\\n/g, "\n");

const initFirebase = () => {
  if (firebaseInitAttempted) return firebaseReady;
  firebaseInitAttempted = true;

  try {
    if (admin.apps.length) {
      firebaseReady = true;
      return true;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKeyRaw) {
      firebaseReady = false;
      return false;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: decodePrivateKey(privateKeyRaw)
      })
    });
    firebaseReady = true;
    return true;
  } catch {
    firebaseReady = false;
    return false;
  }
};

const uniqueTokens = (tokens = []) =>
  [...new Set((tokens || []).map((item) => String(item || "").trim()).filter(Boolean))];

export const sendPushToUsers = async ({ userIds = [], title, body, data = {} }) => {
  if (!initFirebase()) return;
  const ids = [...new Set((userIds || []).map((id) => String(id || "")).filter(Boolean))];
  if (!ids.length) return;

  const users = await User.find({ _id: { $in: ids } }).select("_id fcmTokens").lean();
  const tokenOwnerMap = new Map();
  users.forEach((user) => {
    const ownerId = String(user?._id || "");
    uniqueTokens(user?.fcmTokens || []).forEach((token) => {
      tokenOwnerMap.set(token, ownerId);
    });
  });
  const tokens = [...tokenOwnerMap.keys()];
  if (!tokens.length) return;

  const payload = {
    notification: {
      title: String(title || "Our Tution"),
      body: String(body || "")
    },
    data: Object.fromEntries(
      Object.entries(data || {}).map(([key, value]) => [String(key), String(value)])
    ),
    webpush: {
      fcmOptions: {
        link: String(data?.clickAction || "/notifications")
      }
    }
  };

  try {
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      ...payload
    });

    const invalidCodes = new Set([
      "messaging/invalid-registration-token",
      "messaging/registration-token-not-registered"
    ]);
    const invalidTokenOwners = new Map();
    result.responses.forEach((response, index) => {
      if (response.success) return;
      const code = response.error?.code || "";
      if (!invalidCodes.has(code)) return;
      const token = tokens[index];
      const ownerId = tokenOwnerMap.get(token);
      if (!token || !ownerId) return;
      if (!invalidTokenOwners.has(ownerId)) {
        invalidTokenOwners.set(ownerId, []);
      }
      invalidTokenOwners.get(ownerId).push(token);
    });

    if (invalidTokenOwners.size) {
      await Promise.all(
        [...invalidTokenOwners.entries()].map(([ownerId, staleTokens]) =>
          User.updateOne({ _id: ownerId }, { $pull: { fcmTokens: { $in: staleTokens } } })
        )
      );
    }
  } catch {
    // fail silently to avoid blocking core API actions
  }
};

export const sendPushByTarget = async ({ target = "all", studentId = null, title, body, data = {} }) => {
  if (!initFirebase()) return;
  let users = [];

  if (target === "teacher") {
    users = await User.find({ role: "teacher" }).select("_id").lean();
  } else if (target === "student") {
    if (studentId) {
      users = await User.find({ role: "student", studentId }).select("_id").lean();
    } else {
      users = await User.find({ role: "student" }).select("_id").lean();
    }
  } else {
    users = await User.find({ role: { $in: ["teacher", "student"] } }).select("_id").lean();
  }

  await sendPushToUsers({
    userIds: users.map((user) => user._id.toString()),
    title,
    body,
    data
  });
};
