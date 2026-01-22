'use strict'

const cloudinary = require('cloudinary').v2;

let path = require('path');
let fs = require('fs');

let json = require('../../../Traits/ApiResponser');

/*
|--------------------------------------------------------------------------
| Upload Controller
|--------------------------------------------------------------------------
|
| This controller handles all image upload attachments in the application
| The controller uses a trait to conveniently provide its functionality
| to your applications.
|
*/

let o = {}

// o.upload = function(req, res){
//   if(!req.file){
//       return json.errorResponse(res, "No file attached!", 404);
//   }

//   let extension = (!req.body.extension) ? "jpg" : req.body.extension;
//   let filename = Date.now() + '.' + extension;
//   let serverAddress = req.protocol + '://'+ req.headers.host + '/';
//   let destination = path.join(__dirname, '..', 'public', 'uploads');

//   // Check if the directory exists and create it if it doesn't
//   if (!fs.existsSync(destination)){
//       fs.mkdirSync(destination, { recursive: true });
//   }

//   let newFile = {
//       target: serverAddress + 'public/uploads/' + filename,
//   };

//   fs.writeFile(path.join(destination, filename), req.file.buffer, function(err){
//       if(err){
//           console.log(err);
//           return json.errorResponse(res, "Write file to server failed!");
//       }

//       json.successResponse(res, newFile);
//   });
// };

o.uploadSingle = async function (req, res) {
  const file = req.file;
  let destination = "public/uploads/";

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  if (file) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          folder: destination,
          allowed_formats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'quicktime', 'x-msvideo', 'mp3', 'ogg', 'wav', 'mpeg', 'mind'],
          public_id: Date.now(), 
          resource_type: 'auto',
          quality: "auto:low",
        }, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.secure_url);
          }
        });

        const readableStream = require('stream').Readable.from(file.buffer);
        readableStream.pipe(stream);
      });

      json.successResponse(res, { imageUrl: result });
    } catch (error) {
      console.log("upload", error);
      res.status(500).json({ error: "Error during image upload" });
    }
  } else {
    res.status(400).json({ error: "No file provided" });
  }
}

o.imageUpload = async function (req, res) {
  const file = req.file;
  let destination = "public/uploads/";

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  if (file) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          folder: destination,
          allowed_formats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'quicktime', 'x-msvideo', 'mp3', 'ogg', 'wav', 'mpeg', 'mind'],
          public_id: Date.now(), //+ '_' + req.params.lectureId
          resource_type: 'auto'
        }, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.secure_url);
          }
        });

        const readableStream = require('stream').Readable.from(file.buffer);
        readableStream.pipe(stream);
      });

      return result;
    } catch (error) {
      console.log("upload", error);
      res.status(500).json({ error: "Error during image upload" });
    }
  } else {
    res.status(400).json({ error: "No file provided" });
  }
}

o.uploadMultiple = async function (req, res) {
  const files = req.files;
  let imagesPaths = [];
  let destination = "public/uploads/";

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  if (files && files.length > 0) {
    try {
      imagesPaths = await Promise.all(files.map(async (file) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({
            folder: destination,
            allowed_formats: ['png', 'jpg', 'jpeg', 'gif', 'mp4', 'quicktime', 'x-msvideo', 'mp3', 'ogg', 'wav', 'mpeg', 'mind', 'application/pdf', 'csv', 'pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'], public_id: Date.now(), //+ '_' + req.params.lectureId
            resource_type: 'auto',
            quality: "auto:low",
          }, (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result.secure_url);
            }
          });
          const readableStream = require('stream').Readable.from(file.buffer);
          readableStream.pipe(stream);
        });
      }));
      console.log(imagesPaths);
      return imagesPaths;

    } catch (error) {
      console.log("upload", error);
      res.status(500).json({ error: "Error during image upload" });
    }
  } else {
    res.status(400).json({ error: "No files provided" });
  }
}

o.uploadVideo = async function (req, res) {
  const files = req.files;
  let imagesPaths = [];
  let destination = "public/uploads/";

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  if (files && files.length > 0) {
    try {
      imagesPaths = await Promise.all(files.map(async (file) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({
            folder: destination,
            allowed_formats: ['mp4', 'quicktime', 'x-msvideo', 'mpeg'], public_id: Date.now(), //+ '_' + req.params.lectureId
            resource_type: 'auto'
          }, (error, result) => {
            if (error) {
              reject(error);
            } else {
              const isVideo = result.resource_type === "video";
              resolve({
                url: result.secure_url,
                duration: isVideo ? result.duration / 60 : null,
              });
            }
          });
          const readableStream = require('stream').Readable.from(file.buffer);
          readableStream.pipe(stream);
        });
      }));

      json.successResponse(res, imagesPaths);
    } catch (error) {
      console.log("upload", error);
      res.status(500).json({ error: "Error during image upload" });
    }
  } else {
    res.status(400).json({ error: "No files provided" });
  }
}

module.exports = o;