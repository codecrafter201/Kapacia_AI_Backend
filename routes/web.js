'use strict'

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register Web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "web" middleware group. Enjoy building your Web!
|
*/

let express = require('express');
              require('express-group-routes');
     
/** Controllers **/
let userCtrl = require('../app/Http/Controllers/v1/UserController');
let socketCtrl = require('../app/Http/Controllers/v1/SocketController');

/** Validation **/

let	app = express.Router();

// app.group("/", (Route) => {

//     Route.get("/reset-password", userCtrl.resetPasswordPage);
//     Route.post("/reset-password", userReq.resetPassword, userReq.validate, userCtrl.resetPassword);
// });

module.exports = app;