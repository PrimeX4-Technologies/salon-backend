import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcrypt";

export interface IUser extends Document {
    name: string;
    email?: string;
    phone?: string;
    password?: string;
    googleId?: string;
    authProvider: "local" | "google";
    role: "admin" | "employee" | "client";
    gender?: "male" | "female";
    avatar?: string;
    isActive: boolean;
    comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },
        email: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true,
        },
        phone: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        password: {
            type: String,
            select: false,
            minlength: 8,
        },
        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },
        authProvider: {
            type: String,
            enum: ["local", "google"],
            required: true,
            default: "local",
        },
        role: {
            type: String,
            enum: ["admin", "employee", "client"],
            default: "client",
        },
        gender: {
            type: String,
            enum: ["male", "female"],
        },
        avatar: {
            type: String,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    },
);

UserSchema.pre('validate', function (this: IUser, next) {
    if (!this.email && !this.phone) {
        this.invalidate('email', 'You must provide either an email or a mobile number.')
    }

    if (['admin', 'employee'].includes(this.role) && this.authProvider === 'google') {
        this.invalidate('authProvider', 'Staff and Admins are restricted to local authentication only.')
    }

    if (this.authProvider === 'google' && !this.googleId) {
        this.invalidate('googleId', 'Google ID is required for Google authentication. ')
    }

    if (this.authProvider === 'local' && !this.password) {
        this.invalidate('password', 'Password is required for local authentication. ')
    }

    next()
})

UserSchema.pre<IUser>("save", async function (next) {
    if (!this.isModified("password") || !this.password) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error: any) {
        next(error);
    }
});

UserSchema.methods.comparePassword = async function (
    candidatePassword: string,
): Promise<boolean> {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

UserSchema.set("toJSON", {
    transform: function (doc, ret, options) {
        delete (ret as any).password;
        delete (ret as any).__v;
        return ret;
    },
});

export { UserSchema };
export default mongoose.model<IUser>("User", UserSchema);
