'use strict'

const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
	name: { type: String, required: true, trim: true },
	email: { type: String, required: true, unique: true, lowercase: true, trim: true },
	password: { type: String, required: true },
	role: { type: String, enum: ['admin','practitioner'], default: 'practitioner' },
	active: { type: Boolean, default: true },
	last_login_at: { type: Date },
	password_changed_at: { type: Date },
	otp: { type: String  },
}, { timestamps: true });

mongoose.model('User', userSchema);