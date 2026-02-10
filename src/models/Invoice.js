import mongoose from "mongoose";

const LineItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true }
  },
  { _id: false }
);

const InvoiceSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    number: { type: String, required: true },
    status: { type: String, enum: ["draft", "sent", "paid"], default: "draft" },
    dueDate: { type: Date },
    items: { type: [LineItemSchema], default: [] },
    total: { type: Number, required: true }
  },
  { timestamps: true }
);

export default mongoose.model("Invoice", InvoiceSchema);
