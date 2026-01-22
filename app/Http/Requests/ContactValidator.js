"use strict";

const { check, validationResult } = require("express-validator");

let o = {};

o.contactUs = [
  check("email").trim().isEmail().withMessage("Must Be Email"),
];

o.validateContact = function (req, res, next) {
  let errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res
      .status(400)
      .json({ errors: errors.array(), code: 400 });
  }

  next();
};

module.exports = o;
