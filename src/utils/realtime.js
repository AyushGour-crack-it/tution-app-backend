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

const emitChatEvent = ({ event, payload }) => {
  if (!ioInstance || !payload || !event) return;
  const senderId = payload.senderId ? String(payload.senderId) : "";
  const recipientUserId = payload.recipientUserId ? String(payload.recipientUserId) : "";

  if (recipientUserId) {
    emitToRoom(`user:${senderId}`, event, payload);
    emitToRoom(`user:${recipientUserId}`, event, payload);
    return;
  }

  emitToRoom("role:teacher", event, payload);
  emitToRoom("role:student", event, payload);
};

export const emitChatMessageUpdated = (message) => {
  const payload = message?.toObject ? message.toObject() : message;
  emitChatEvent({ event: "chat:updated", payload });
};

export const emitChatMessageDeleted = ({ messageId, senderId, recipientUserId }) => {
  const payload = {
    messageId: String(messageId || ""),
    senderId: String(senderId || ""),
    recipientUserId: recipientUserId ? String(recipientUserId) : ""
  };
  emitChatEvent({ event: "chat:deleted", payload });
};

export const emitChatTyping = ({ senderId, senderName, senderRole, recipientUserId }) => {
  if (!ioInstance || !senderId) return;
  const payload = {
    senderId: String(senderId),
    senderName: String(senderName || "Someone"),
    senderRole: String(senderRole || "")
  };

  if (recipientUserId) {
    emitToRoom(`user:${String(recipientUserId)}`, "chat:typing", payload);
    return;
  }

  if (senderRole === "teacher") {
    emitToRoom("role:student", "chat:typing", payload);
    return;
  }
  if (senderRole === "student") {
    emitToRoom("role:teacher", "chat:typing", payload);
  }
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

export const emitMarksUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "marks:updated", payload);
  emitToRoom("role:student", "marks:updated", payload);
};

export const emitAttendanceUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "attendance:updated", payload);
  emitToRoom("role:student", "attendance:updated", payload);
};

export const emitHomeworkUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "homework:updated", payload);
  emitToRoom("role:student", "homework:updated", payload);
};

export const emitLeaderboardUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "leaderboard:updated", payload);
  emitToRoom("role:student", "leaderboard:updated", payload);
};

export const emitStudentsUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "students:updated", payload);
  emitToRoom("role:student", "students:updated", payload);
};

export const emitBadgesUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "badges:updated", payload);
  emitToRoom("role:student", "badges:updated", payload);
};

export const emitClassesUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "classes:updated", payload);
  emitToRoom("role:student", "classes:updated", payload);
};

export const emitSyllabusUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "syllabus:updated", payload);
  emitToRoom("role:student", "syllabus:updated", payload);
};

export const emitHolidaysUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "holidays:updated", payload);
  emitToRoom("role:student", "holidays:updated", payload);
};

export const emitInvoicesUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "invoices:updated", payload);
  emitToRoom("role:student", "invoices:updated", payload);
};
