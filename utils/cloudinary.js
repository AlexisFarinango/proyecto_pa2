const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const configure = (opts) => {
  cloudinary.config({
    cloud_name: opts.cloud_name,
    api_key: opts.api_key,
    api_secret: opts.api_secret,
    secure: true
  });
};

const uploadBuffer = (buffer, filename, folder = 'Futbol') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

module.exports = { configure, uploadBuffer };
