const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

export const sanitizeText = (value, maxLength = 255) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

export const normalizeEmail = (value) => sanitizeText(value, 320).toLowerCase();

export const normalizePhone = (value) =>
  sanitizeText(value, 32).replace(/[^\d+]/g, "").slice(0, 20);

export const isValidEmail = (value) => emailPattern.test(normalizeEmail(value));

export const isStrongPassword = (value) => strongPasswordPattern.test(String(value || ""));
