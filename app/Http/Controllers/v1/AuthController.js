"user strict";

let jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = mongoose.model("User");

let config = {};
config.app = require("../../../../config/app");

let json = require("../../../Traits/ApiResponser");

/*
    |--------------------------------------------------------------------------
    | Authentication Controller
    |--------------------------------------------------------------------------
    |
    | This controller handles authenticating users for the application
    | get x-access-token from header to authenticates. The controller uses 
    | a trait to conveniently provide its functionality to your applications.
    |
    */

let o = {};

o.authenticate = (req, res, next) => {
  let token = req.headers["x-access-token"];

  if (!token) {
    return json.errorResponse(res, "Token Not Found", 404);
  }

  jwt.verify(token, config.app.key, function (err, decoded) {
    if (err) {
      //console.log(err);
      return json.errorResponse(res, "Connection Unautherized!", 401);
    }

    req.decoded = decoded;
    next();
  });
};

o.authenticateAdmin = async (req, res, next) => {
  let token = req.headers["x-access-token"];

  if (!token) {
    return json.errorResponse(res, "Token Not Found", 404);
  }

  try {
    const decoded = jwt.verify(token, config.app.key);

    // Find the user by ID
    const user = await User.findById(decoded._id);

    if (!user) {
      return json.errorResponse(res, "User Not Found", 404);
    }

    // Check if user is admin using isAdmin field
    if (!user.role || user.role !== "admin") {
      return json.errorResponse(
        res,
        "Unauthorized! Admin access required.",
        403
      );
    }

    req.decoded = decoded;
    req.user = user; // Attach user object to request
    next();
  } catch (err) {
    console.log("Admin Auth Error:", err);
    return json.errorResponse(res, "Connection Unauthorized!", 401);
  }
};

module.exports = o;
