'use strict'

/*
|--------------------------------------------------------------------------
| Create The Application
|--------------------------------------------------------------------------
|
| The first thing we will do is create a new Node application instance
| which serves as the "glue" for all the components of Node, and is
| the IoC container for the system binding all of the various parts.
|
*/

 let path 	  		= require('path');
 
 let express  		= require('express');
 let mongoose 		= require('mongoose');
				  	  require('./cache/services');

 let favicon 		= require('serve-favicon');
 let helmet   		= require('helmet');
 let morgan   		= require('morgan');
 let bodyParser 	= require('body-parser');
 
 let validator  	= require('express-validator');

 let api 			= require('../routes/api');
 let web 			= require('../routes/web');

 let app 			= express();

/*
|--------------------------------------------------------------------------
| Cross Orgin 
|--------------------------------------------------------------------------
|
| A resource makes a cross-origin HTTP request when it requests a resource from a 
| different domain, protocol, or port to its own.The Cross-Origin Resource Sharing
| mechanism gives web servers cross-domain access controls, which enable secure cross-domain
| cross-domain data transfer
|
*/

 app.all('*', function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'PUT, GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-access-token');
  next(); 
 });

/*
|--------------------------------------------------------------------------
| Template Engine
|--------------------------------------------------------------------------
|
| Developing template engines for Express. Use the app.engine(ext, callback)
| method to create your own template engine. ext refers to the file extension
| and callback is the template engine function.
|
*/
 app.set('views', path.join(__dirname, '../resources/views'))
 app.set('view engine', 'ejs');

/*
|--------------------------------------------------------------------------
| Bind Important Interfaces
|--------------------------------------------------------------------------
|
| Next, we need to bind some important interfaces into the container so
| we will be able to resolve them when needed. The kernels serve the
| incoming requests to this application from both the web and CLI.
|
*/
 
 app.enable('trust proxy');
 app.use(favicon(path.join(__dirname, '../public', 'favicon.ico')));
 app.use('/public', express.static(path.join(__dirname, '../public')));
 app.use('/docs', express.static(path.join(__dirname, '../docs/swagger-ui')));
 app.use(helmet());
 app.use(helmet.hidePoweredBy({ setTo: 'Suffah Framework' }));
 app.use(morgan('dev'));
 app.use(bodyParser.urlencoded({ extended: true })); // parse application/x-www-form-urlencoded 
 app.use(bodyParser.json());

 app.use('/api/v1', api);
 app.use('/web', web);
 
/*
|--------------------------------------------------------------------------
| Exceptions Handler 
|--------------------------------------------------------------------------
|
| Define error-handling middleware functions in the same way as other middleware
| Set the environment letiable NODE_ENV to production.
|
*/

 require('./../app/Exceptions/Handler')(app);

/*
|--------------------------------------------------------------------------
| Return The Application
|--------------------------------------------------------------------------
|
| This script returns the application instance. The instance is given to
| the calling script so we can separate the building of the instances
| from the actual running of the application and sending responses.
|
*/

module.exports = app;
