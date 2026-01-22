"use strict";

let o = {};

/**
 * Format and send success response with structured data
 * @param {Object} res - Express response object
 * @param {Object} options - Response options
 * @param {String} options.message - Success message
 * @param {String} options.userMessage - User-friendly message (optional)
 * @param {String} options.keyName - Dynamic key name for data (default: 'data')
 * @param {Any} options.data - Response data
 * @param {Object} options.pagination - Pagination info (optional)
 * @param {Number} options.pagination.page - Current page
 * @param {Number} options.pagination.limit - Items per page
 * @param {Number} options.pagination.total - Total items
 * @param {Number} options.pagination.totalPages - Total pages
 * @param {Object} options.stats - Additional stats (optional)
 * @param {String} options.description - Additional description (optional)
 * @param {String} options.documentation - Documentation link (optional)
 * @param {Number} statusCode - HTTP status code (default: 200)
 */
o.successResponse = function (res, options, statusCode = 200) {
  // Handle backward compatibility - if options is not an object with message
  if (
    typeof options === "string" ||
    (options && !options.message && !options.keyName)
  ) {
    // Old format: successResponse(res, data, statusCode)
    return res.status(statusCode).json({
      data: options,
    });
  }

  const {
    message = "Request processed successfully",
    userMessage,
    keyName = "data",
    data = [],
    pagination,
    stats,
    description,
    documentation,
  } = options;

  const response = {
    success: true,
    message: message,
    ...(userMessage && { userMessage }),
    [keyName]: data,
    ...(pagination && { pagination }),
    ...(stats && { stats }),
    ...(description && { description }),
    ...(documentation && { documentation }),
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Format and send error response
 * @param {Object} res - Express response object
 * @param {String|Object} error - Error message or error object
 * @param {Number} statusCode - HTTP status code (default: 500)
 * @param {Object} options - Additional error options
 */
o.errorResponse = function (res, error, statusCode = 500, options = {}) {
  console.log("error => ", error);

  const message =
    typeof error === "string" ? error : error.message || "Server Error";
  const code =
    typeof error === "object" ? error.code || statusCode : statusCode;

  const response = {
    success: false,
    message: message,
    code: code,
    error: typeof error === "object" ? error : { message },
    ...(options.description && { description: options.description }),
    ...(options.documentation && { documentation: options.documentation }),
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Legacy method - show all items
 * @deprecated Use successResponse instead
 */
o.showAll = function (res, collection, statusCode = 200) {
  return res.status(statusCode).json({
    data: collection,
  });
};

/**
 * Legacy method - show one item
 * @deprecated Use successResponse instead
 */
o.showOne = function (res, model, statusCode = 200) {
  return res.status(statusCode).json({
    data: model,
  });
};

/**
 * Helper to calculate pagination metadata
 * @param {Number} page - Current page
 * @param {Number} limit - Items per page
 * @param {Number} total - Total items
 */
o.getPaginationMeta = function (page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    total: total,
    totalPages: totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

module.exports = o;
