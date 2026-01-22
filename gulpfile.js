let gulp 		 = require('gulp')
	nodemon 	 = require('gulp-nodemon')
				   require('dotenv').config();

gulp.task('server', async function(){

	nodemon({
		script : 'server.js',
		ext : 'js',
		env : {
			'PORT' : process.env.PORT || 3000 
		},
		legacyWatch: true,
		ignore : ['node_modules', 'public', 'resources']
	})

	.on('restart',function(){
		console.log('restarting');
	})

})

gulp.task('default', gulp.series('server'));
gulp.task('serve', gulp.series('server'));


