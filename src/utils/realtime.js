let ioInstance = null;

export const setRealtimeServer = (io) => {
  ioInstance = io;
};

export const getRealtimeServer = () => ioInstance;

const emitToRoom = (room, event, payload) => {
  if (!ioInstance || !room) return;
  ioInstance.to(room).emit(event, payload);
};

const emitToUsers = (userIds = [], event, payload) => {
  if (!ioInstance || !event) return;
  const unique = [...new Set((userIds || []).map((id) => String(id || "")).filter(Boolean))];
  unique.forEach((id) => emitToRoom(`user:${id}`, event, payload));
};

export const emitChatConversationCreated = ({ conversation, userIds = [] }) => {
  if (!conversation) return;
  const payload = conversation.toObject ? conversation.toObject() : conversation;
  emitToUsers(userIds, "chat:conversation-created", payload);
  emitToUsers(userIds, "chat:inbox-updated", { conversationId: String(payload?._id || "") });
};

export const emitChatConversationUpdated = ({ conversation, userIds = [] }) => {
  if (!conversation) return;
  const payload = conversation.toObject ? conversation.toObject() : conversation;
  emitToUsers(userIds, "chat:conversation-updated", payload);
  emitToUsers(userIds, "chat:inbox-updated", { conversationId: String(payload?._id || "") });
};

export const emitChatMessageCreated = ({ message, conversationId, userIds = [] }) => {
  if (!message) return;
  const payload = {
    conversationId: String(conversationId || message?.conversationId || ""),
    message: message.toObject ? message.toObject() : message
  };
  emitToUsers(userIds, "chat:message-new", payload);
  emitToUsers(userIds, "chat:new", payload.message);
};

export const emitChatMessageUpdated = ({ message, conversationId, userIds = [] }) => {
  if (!message) return;
  const payload = {
    conversationId: String(conversationId || message?.conversationId || ""),
    message: message.toObject ? message.toObject() : message
  };
  emitToUsers(userIds, "chat:message-updated", payload);
  emitToUsers(userIds, "chat:updated", payload.message);
};

export const emitChatTyping = ({ conversationId, senderId, senderName, senderRole, userIds = [] }) => {
  if (!senderId || !conversationId) return;
  emitToUsers(userIds, "chat:typing", {
    conversationId: String(conversationId),
    senderId: String(senderId),
    senderName: String(senderName || "Someone"),
    senderRole: String(senderRole || "")
  });
};

export const emitChatReportCreated = ({ report, userIds = [] }) => {
  if (!report) return;
  const payload = report.toObject ? report.toObject() : report;
  emitToUsers(userIds, "chat:report-created", payload);
};

export const emitChatReportUpdated = ({ report, userIds = [] }) => {
  if (!report) return;
  const payload = report.toObject ? report.toObject() : report;
  emitToUsers(userIds, "chat:report-updated", payload);
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

export const emitPopupCampaignsUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "popup-campaigns:updated", payload);
  emitToRoom("role:student", "popup-campaigns:updated", payload);
};

export const emitInvoicesUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "invoices:updated", payload);
  emitToRoom("role:student", "invoices:updated", payload);
};

export const emitUserPresenceUpdated = (payload = {}) => {
  emitToRoom("role:teacher", "presence:updated", payload);
  emitToRoom("role:student", "presence:updated", payload);
};
