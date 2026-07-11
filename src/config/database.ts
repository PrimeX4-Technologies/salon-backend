import mongoose from "mongoose"
import { config } from "./env.js"

export const connectDB = async (): Promise<void> => {
    try {
        if (!config.MONGO_URI) {
            console.warn("DB URI is not available")
            return
        }
        await mongoose.connect(config.MONGO_URI)
        console.log("MongoDB connection successfully established.")
    } catch (error) {
        console.error('MongoDB connection failed:', error)
        throw error
    }
}