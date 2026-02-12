let ioInstance = null;

export const setRealtimeServer = (io) => {
  ioInstance = io;
};

export const getRealtimeServer = () => ioInstance;

const emitToRoom = (room, event, payload) => {
  if (!ioInstance || !room) return;
  ioInstance.to(room).emit(event, payload);
};

export const emitChatMessageCreated = (message) => {
  if (!ioInstance || !message) return;
  const payload = message.toObject ? message.toObject() : message;
  const senderId = payload.senderId ? String(payload.senderId) : "";
  const recipientUserId = payload.recipientUserId ? String(payload.recipientUserId) : "";

  if (recipientUserId) {
    emitToRoom(`user:${senderId}`, "chat:new", payload);
    emitToRoom(`user:${recipientUserId}`, "chat:new", payload);
    return;
  }

  emitToRoom("role:teacher", "chat:new", payload);
  emitToRoom("role:student", "chat:new", payload);
};

export const emitNotificationCreated = (notification) => {
  if (!ioInstance || !notification) return;
  const payload = notification.toObject ? notification.toObject() : notification;
  const target = payload.target || "all";

  if (target === "teacher") {
    emitToRoom("role:teacher", "notification:new", payload);
    return;
  }
  if (target === "student") {
    const studentId = payload.studentId ? String(payload.studentId) : "";
    if (studentId) {
      emitToRoom(`student:${studentId}`, "notification:new", payload);
    } else {
      emitToRoom("role:student", "notification:new", payload);
    }
    return;
  }

  emitToRoom("role:teacher", "notification:new", payload);
  emitToRoom("role:student", "notification:new", payload);
};

export const emitFeeUpdated = ({ fee, studentId, action = "updated" }) => {
  if (!ioInstance || !fee) return;
  const payload = {
    action,
    studentId: studentId ? String(studentId) : (fee.studentId ? String(fee.studentId) : ""),
    fee: fee.toObject ? fee.toObject() : fee
  };
  emitToRoom("role:teacher", "fee:updated", payload);
  if (payload.studentId) {
    emitToRoom(`student:${payload.studentId}`, "fee:updated", payload);
  } else {
    emitToRoom("role:student", "fee:updated", payload);
  }
};

export const emitBadgeRequestUpdated = ({ request, studentUserId, status = "pending" }) => {
  if (!ioInstance || !request) return;
  const payload = {
    status,
    request: request.toObject ? request.toObject() : request
  };
  emitToRoom("role:teacher", "badge:request-updated", payload);
  if (studentUserId) {
    emitToRoom(`user:${String(studentUserId)}`, "badge:request-updated", payload);
  }
};

export const emitBadgeAwarded = ({ studentUserId, badgeKey }) => {
  if (!ioInstance || !studentUserId) return;
  emitToRoom(`user:${String(studentUserId)}`, "badge:awarded", { badgeKey: String(badgeKey || "") });
};
