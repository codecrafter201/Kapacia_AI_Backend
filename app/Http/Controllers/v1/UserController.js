"use strict";

const mongoose = require("mongoose");
const User = mongoose.model("User");
const { imageUpload } = require("./UploadController");

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const ejs = require("ejs");
const path = require("path");
const crypto = require("crypto");

let config = {};
config.app = require("../../../../config/app");
config.services = require("../../../../config/services");
const { JWT_EXPIRES_IN } = require("../../../../config/constants");

const json = require("../../../Traits/ApiResponser");
const mailer = require("../../../Traits/SendEmail");

const createToken = (user) => {
  return jwt.sign(
    {
      _id: user._id,
      email: user.email,
      name: user.name,
    },
    config.app.key,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

let o = {};

o.register = async (req, res, next) => {
  try {
    console.log("Registering user with data:", req.body);
    const { name, email, password, role } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 5);
    const existingUser = await User.findOne({ email: email });
    if (existingUser) {
      return json.errorResponse(res, "User already exists", 409);
    }
    const user = new User({
      name: name,
      email: email,
      password: hashedPassword,
      role: role,
    });
    await user.save();
    return json.successResponse(
      res,
      {
        message: "User registered successfully",
        keyName: "data",
        data: { userId: user._id },
      },
      201
    );
  } catch (err) {
    console.error("Failed to register user:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to register user";
    return json.errorResponse(res, errorMessage, 500);
  }
};
o.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return json.errorResponse(res, "Invalid Credentials", 404);
    }
    const isMatch = await bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return json.errorResponse(res, "Invalid credentials", 401);
    }
    const token = createToken(user);
    const userObject = user.toObject();
    delete userObject.password;
    const userData = { ...userObject, token };
    return json.successResponse(
      res,
      {
        message: "Login successful",
        userMessage: "Welcome back!",
        keyName: "userData",
        data: userData,
      },
      200
    );
  } catch (err) {
    console.error("Failed to login:", err);
    const errorMessage = err.message || err.toString() || "Failed to login";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getUser = async (req, res, next) => {
  try {
    const { _id } = req.decoded;
    const user = await User.findById(_id).select("-password");
    if (!user) {
      return json.errorResponse(res, "User not found", 404);
    }
    return json.successResponse(
      res,
      {
        message: "User fetched successfully",
        keyName: "userData",
        data: user,
      },
      200
    );
  } catch (err) {
    console.error("Failed to get user:", err);
    const errorMessage = err.message || err.toString() || "Failed to get user";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.forgetPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return json.errorResponse(res, "User not found", 404);
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    user.otp = Math.floor(100000 + Math.random() * 900000).toString();

    await user.save();

    const html = await ejs.renderFile(
      path.join(
        __dirname,
        "../../../../resources/views/emails/forgot-password-email.ejs"
      ),
      { resetPasswordCode: user.otp, baseURL: config.app.url }
    );

    mailer.send(user.email, "Forget Password?", html);

    return json.successResponse(
      res,
      {
        message: "Otp Sent to your email.",
        keyName: "data",
        data: { email: user.email },
      },
      200
    );
  } catch (err) {
    console.error("Forget Password Error:", err);
    const errorMessage = err.message || err.toString() || "Failed to send OTP";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email, otp: otp });
    if (!user) {
      return json.errorResponse(res, "Invalid Otp", 404);
    }
    const isExpired = user.resetPasswordExpires <= new Date();
    if (isExpired) {
      return json.errorResponse(res, "The code has been expired!", 410);
    }

    user.otp = null;
    await user.save();

    return json.successResponse(
      res,
      {
        message: "Otp Verified Successfully.",
        keyName: "data",
        data: { verified: true },
      },
      200
    );
  } catch (err) {
    console.error("Otp Verification Error:", err);
    const errorMessage =
      err.message || err.toString() || "Otp Verification Failed";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.resetPassword = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return json.errorResponse(res, "User not found", 404);
    }
    user.password = bcrypt.hashSync(password, 5);
    await user.save();
    
    return json.successResponse(
      res,
      {
        message: "Password reset successfully.",
        keyName: "data",
        data: { success: true },
      },
      200
    );
  } catch (err) {
    console.error("Reset Password Error:", err);
    const errorMessage =
      err.message || err.toString() || "Reset Password Failed";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = "", active } = req.query;
    
    // Build filter
    const filter = {};
    
    // Search filter - search in name and email
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    // Active filter
    if (active !== undefined) {
      filter.active = active === "true" || active === true;
    }
    
    // Calculate pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Get total count
    const total = await User.countDocuments(filter);
    
    // Get paginated users
    const users = await User.find(filter)
      .select("-password -otp")
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip);
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;
    
    return json.successResponse(
      res,
      {
        message: "All users fetched successfully",
        keyName: "users",
        data: users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNextPage,
          hasPrevPage,
        },
        stats: {
          total,
          active: await User.countDocuments({ ...filter, active: true }),
          inactive: await User.countDocuments({ ...filter, active: false }),
        },
      },
      200
    );
  } catch (err) {
    console.error("Failed to fetch users:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch users";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.getPractitionerUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = "", active } = req.query;
    
    // Build filter with role = practitioner
    const filter = { role: "practitioner" };
    
    // Search filter - search in name and email
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    // Active filter
    if (active !== undefined) {
      filter.active = active === "true" || active === true;
    }
    
    // Calculate pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Get total count
    const total = await User.countDocuments(filter);
    
    // Get paginated users
    const users = await User.find(filter)
      .select("-password -otp")
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip);
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;
    
    return json.successResponse(
      res,
      {
        message: "Practitioner users fetched successfully",
        keyName: "practitioners",
        data: users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNextPage,
          hasPrevPage,
        },
        stats: {
          total,
          active: await User.countDocuments({ ...filter, active: true }),
          inactive: await User.countDocuments({ ...filter, active: false }),
        },
      },
      200
    );
  } catch (err) {
    console.error("Failed to fetch practitioner users:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to fetch practitioner users";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updateProfile = async (req, res, next) => {
  try {
    const { _id } = req.decoded;
    const { name } = req.body;

    if (!name || name.trim() === "") {
      return json.errorResponse(res, "Name is required", 400);
    }

    const user = await User.findById(_id);
    if (!user) {
      return json.errorResponse(res, "User not found", 404);
    }

    user.name = name.trim();
    await user.save();

    const updatedUser = await User.findById(_id).select("-password");

    return json.successResponse(
      res,
      {
        message: "Profile updated successfully",
        keyName: "user",
        data: updatedUser,
      },
      200
    );
  } catch (err) {
    console.error("Failed to update profile:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update profile";
    return json.errorResponse(res, errorMessage, 500);
  }
};

o.updatePassword = async (req, res, next) => {
  try {
    const { _id } = req.decoded;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return json.errorResponse(
        res,
        "Current password and new password are required",
        400
      );
    }

    if (newPassword.length < 6) {
      return json.errorResponse(
        res,
        "New password must be at least 6 characters long",
        400
      );
    }

    const user = await User.findById(_id);
    if (!user) {
      return json.errorResponse(res, "User not found", 404);
    }

    // Verify current password
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password);
    if (!isPasswordValid) {
      return json.errorResponse(res, "Current password is incorrect", 401);
    }

    // Hash and update new password
    user.password = bcrypt.hashSync(newPassword, 5);
    user.password_changed_at = new Date();
    await user.save();

    return json.successResponse(
      res,
      {
        message: "Password updated successfully",
        keyName: "data",
        data: null,
      },
      200
    );
  } catch (err) {
    console.error("Failed to update password:", err);
    const errorMessage =
      err.message || err.toString() || "Failed to update password";
    return json.errorResponse(res, errorMessage, 500);
  }
};

module.exports = o;
    
