import mongoose from "mongoose";

const HolidaySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    date: { type: Date, required: true },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("Holiday", HolidaySchema);
