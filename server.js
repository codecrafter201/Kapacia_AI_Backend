"use strict";

require("dotenv").config();
let config = {};
config.app = require("./config/app");
config.database = require("./config/database");

/*
 |--------------------------------------------------------------------------
 | Node_framwork - A Node Framework For Website & apis
 |--------------------------------------------------------------------------
 |
 | This file allows us to Starts server & gave functionality from the
 | built-in Node web server. 
 |
 */

let express = require("express");
let mongoose = require("mongoose");
let autoload = require("./bootstrap/autoload");

let app = express();
app.use("/", autoload);

let http = require("http").Server(app);
global.io = require("socket.io")(http, {
  path: "/socket.io",
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});
require("./routes/socket");
/**
 * On Database Connection.
 */

mongoose.Promise = global.Promise;

mongoose.set("useNewUrlParser", true);
mongoose.set("useFindAndModify", false);
mongoose.set("useCreateIndex", true);
mongoose.set("useUnifiedTopology", true);
mongoose.connect(
  `mongodb://${config.database.mongodb.username}:${config.database.mongodb.password}@${config.database.mongodb.host}:${config.database.mongodb.port}/${config.database.mongodb.database}?authSource=${config.database.mongodb.authSource}`,
);
mongoose.connection
  .on("connecting", () => console.log("Connecting to database..."))
  .on("disconnecting", () => console.log("Disconnecting to database..."))
  .on("disconnected", () =>
    console.log("Connection to the database has been disconnected"),
  )
  .on("error", (error) => console.log("Err:", error))
  .on("reconnected", () => console.log("mongodb Reconnected"))
  .on("reconnectFailed", () => console.log("Reconnect failed"))
  .on("connected", () => console.log("Connected to database..."))
  .on("close", () => console.log("Connection has been closed..."))
  .once("open", () => {
    http.listen(config.app.port, () => {
      console.log("Server Running on port " + config.app.port);
    });
    app.on("error", onError);
    app.on("listening", onListening);
  });

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }

  let bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case "EACCES":
      console.error(bind + " requires elevated privileges");
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(bind + " is already in use");
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  let addr = server.address();
  let bind = typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
  debug("Listening on " + bind);
}
