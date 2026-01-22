'use strict'

/*
|--------------------------------------------------------------------------
| Bootstrap Model application
|--------------------------------------------------------------------------
|
| The first thing we will do is create a new Node application instance
| which serves as the "glue" for all the components of Node, and is
| the IoC container for the system binding all of the various parts.
|
*/

 let fs = require('fs');
 let path = require('path');
 let modelsDir = path.join(__dirname, '../../app/Models');

fs.readdirSync(modelsDir)
.filter((file)=>~file.indexOf('.js'))
.forEach((file)=>require(path.join(modelsDir, file)));