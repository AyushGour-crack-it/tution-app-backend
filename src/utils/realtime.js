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
