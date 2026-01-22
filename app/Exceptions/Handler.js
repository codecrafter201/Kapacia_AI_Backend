'use strict'

module.exports = function handler(app) {

  app.use(logErrors);
  app.use(clientErrorHandler);
  app.use(notFound);
  app.use(errorHandler);

  function logErrors (err, req, res, next) {
    console.error(err.stack)
    res.status(500).json({
      error: err.stack,
      code: "500"
    })

  }

  function clientErrorHandler (err, req, res, next) {
    
      res.status(500).json({

          error: 'Something failed!' ,
          code: "500"
        }
      )
  }

  function notFound(req, res, next){
  	
    res.status(404).json({

        error: 'This specified URL cannot be found',
        code: "404"
      }
    )
  }

  function errorHandler (err, req, res, next) {
    res.status(500).json({

        error : err || 'Something Broken',
        code: "500"
    })
  }

}